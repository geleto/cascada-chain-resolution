import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { metaOf } from "../src/meta.js"
import { readLanguageProperty } from "../src/language-properties.js"
import { snapshotExternalValue } from "../src/external-snapshot.js"
import { OperationOwner } from "../src/operation-lifecycle.js"
import { ArrayView } from "../src/array-view.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { createRandom, randomInteger } from "./native-equivalence-support.js"

const context = () => ({ execution: new r.Execution(), errorContext: {} })
const tick = () => new Promise(resolve => setImmediate(resolve))
const sync = value => ({ then(deliver) { return deliver(value) } })

describe("entry structural publication", () => {
    it("writes an owned Array in place while unrelated growth is pending", async () => {
        const count = 256, input = new Array(count).fill(0), ctx = context()
        const chain = new r.Chain(r.import(input, ctx), ctx), hold = Promise.withResolvers()
        const entry = r.enter(chain, [count + 5], ctx, true, () => hold.promise)
        // Entry already isolated the imported Array. No output or lease holds
        // this owner, so uncertainty alone must not copy it on every write.
        const owned = readLanguageProperty(chain._state, "value", ctx)
        assert.notEqual(owned, input)
        for (let index = 0; index < count; index++) {
            r.assignPath(chain, [index], index + 1, ctx)
            assert.equal(readLanguageProperty(chain._state, "value", ctx), owned)
        }
        hold.resolve()
        await entry
        assert.deepEqual(await r.export(chain, [], ctx), Array.from({ length: count }, (_, index) => index + 1))
        assert.deepEqual(input, new Array(count).fill(0))
        verifyRefCounts(ctx, chain._state)
    })

    it("does not register unused length forks created by repeated COW", async () => {
        const ctx = context(), chain = new r.Chain([], ctx), hold = Promise.withResolvers()
        const entry = r.enter(chain, [10], ctx, true, () => hold.promise)
        const source = metaOf(chain._state.value, ctx).arrayView._lengthState.head.source
        for (let i = 0; i < 1000; i++) {
            r.lookupPath(chain, [], ctx) // Retained outputs require actual COW.
            r.assignPath(chain, [0], i, ctx)
        }
        assert.equal(source.nodes.size, 0)
        const length = r.lookupPath(chain, ["length"], ctx)
        assert.equal(source.nodes.size, 1)
        hold.resolve()
        await entry
        assert.equal(await length, 1)
        assert.equal(source.nodes.size, 0)
        assert.deepEqual(await r.export(chain, [], ctx), [999])
        verifyRefCounts(ctx, chain._state)
    })
    for (const captures of [false, true]) for (const action of ["replace", "delete", "repair"]) {
        it(`preserves growth from a queued failed prefix before ${action}, captures=${captures}`, async () => {
            const ctx = context(), chain = new r.Chain([0], ctx), hold = Promise.withResolvers()
            const entry = r.enter(chain, [3], ctx, true, () => hold.promise)
            r.assignPath(chain, [3, "x"], 1, ctx)
            const earlierLength = captures ? r.lookupPath(chain, ["length"], ctx) : undefined
            const earlier = captures ? r.export(chain, [], ctx) : undefined
            const change = action === "replace" ? r.assignPath(chain, [3], 7, ctx)
                : action === "delete" ? r.deletePath(chain, [3], ctx) : r.repairPath(chain, [3], ctx)
            hold.resolve()
            await Promise.all([entry, change])
            if (captures) {
                assert.equal(await earlierLength, 4)
                assert(r.isPoisonError(await earlier))
            }
            assert.equal(await r.lookupPath(chain, ["length"], ctx), 4)
            const expected = action === "replace" ? [0, , , 7] : Object.assign(new Array(4), { 0: 0 })
            assert.deepEqual(await r.export(chain, [], ctx), expected)
            await r.run(chain, [], "push", [9], ctx, { mutationScopeDepth: 0 })
            expected.push(9)
            assert.deepEqual(await r.export(chain, [], ctx), expected)
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const captures of [false, true]) for (const first of ["assign", "prefix", "call"]) {
        it(`preserves record order across stacked ${first} and replacement, captures=${captures}`, async () => {
            const ctx = context(), chain = new r.Chain({ k0: 0 }, ctx), hold = Promise.withResolvers()
            const entry = r.enter(chain, ["k2"], ctx, true, () => hold.promise)
            if (first === "assign") r.assignPath(chain, ["k2"], 5, ctx)
            else if (first === "prefix") r.assignPath(chain, ["k2", "x"], 1, ctx)
            else r.run(chain, ["k2"], "init", [], ctx, { mutationScopeDepth: 1 })
            r.assignPath(chain, ["k3"], 3, ctx)
            const earlier = captures ? r.export(chain, [], ctx) : undefined
            r.assignPath(chain, ["k2"], 6, ctx)
            hold.resolve()
            await entry
            if (captures) {
                const value = await earlier
                if (first === "assign") assert.deepEqual(Object.keys(value), ["k0", "k2", "k3"])
                else assert(r.isPoisonError(value))
            }
            const output = await r.export(chain, [], ctx)
            assert.deepEqual(output, { k0: 0, k2: 6, k3: 3 })
            assert.deepEqual(Object.keys(output), ["k0", "k2", "k3"])
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state)
        })
    }

    const emptyRangeCases = [
        ["slice", [9, 10], []],
        ["slice", [9], []],
        ["slice", [-2, -2], []],
        ["slice", [-1, -2], []],
        ["slice", [Infinity], []],
        ["slice", [0, -Infinity], []],
        ["at", [-Infinity], undefined],
        ["at", [-9], undefined],
        ["at", [Infinity], undefined],
        ["with", [-Infinity, 7], r.ERROR_KIND.InvalidArrayOperation],
        ["with", [-9, 7], r.ERROR_KIND.InvalidArrayOperation],
        ["with", [Infinity, 7], r.ERROR_KIND.InvalidArrayOperation],
        ["includes", [1, Infinity], false],
        ["includes", [1, 9], false],
        ["indexOf", [1, Infinity], -1],
        ["indexOf", [1, 9], -1],
        ["lastIndexOf", [1, -Infinity], -1],
        ["lastIndexOf", [1, -9], -1],
    ]
    for (const [method, args, expected] of emptyRangeCases) {
        it(`${method}(${args}) completes its certain outcome without awaiting unrelated growth`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), chain = new r.Chain([1], ctx)
            const entry = r.enter(chain, [5], ctx, true, () => hold.promise)
            try {
                const result = r.run(chain, [], method, args, ctx, {})
                assert(!(result instanceof Promise))
                if (method === "with") assert.equal(result.kind, expected)
                else if (method === "slice") assert.deepEqual(r.export(new r.Chain(result, ctx), [], ctx), expected)
                else assert.equal(result, expected)
            } finally { hold.resolve() }
            await entry
            assert.deepEqual(r.export(chain, [], ctx), [1])
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const method of ["slice", "includes", "indexOf", "lastIndexOf"]) {
        for (const rejects of [false, true]) {
            it(`${method} processes pending inputs before its empty range, rejects=${rejects}`, async () => {
                const ctx = context(), hold = Promise.withResolvers(), argument = Promise.withResolvers()
                const chain = new r.Chain([1], ctx), cause = new Error("argument rejection")
                const entry = r.enter(chain, [5], ctx, true, () => hold.promise)
                const args = method === "slice" ? [Infinity, argument.promise]
                    : [argument.promise, method === "lastIndexOf" ? -Infinity : Infinity]
                const result = r.run(chain, [], method, args, ctx, {})
                assert(result instanceof Promise)
                let outcome
                result.then(value => { outcome = value })
                if (rejects) argument.reject(cause)
                else argument.resolve(1)
                try {
                    await tick()
                    if (rejects) {
                        assert.equal(outcome?.cause, cause, "argument failure must finish while entry is still open")
                        assert.equal(outcome.errorContext, ctx.errorContext)
                    } else if (method === "slice") {
                        assert.notEqual(outcome, undefined, "empty result must finish while entry is still open")
                        assert.deepEqual(r.export(new r.Chain(outcome, ctx), [], ctx), [])
                    } else assert.equal(outcome, method === "includes" ? false : -1)
                } finally { hold.resolve() }
                await entry
                assert.equal(ctx.execution.fatalError, null)
                verifyRefCounts(ctx, chain._state)
            })
        }
    }

    for (const reverse of [false, true]) {
        it(`starts all independent out-of-range entries before any completes, descending=${reverse}`, async () => {
            const ctx = context(), chain = new r.Chain([], ctx), hold = Promise.withResolvers()
            const indexes = reverse ? [5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5]
            const started = []
            const entries = indexes.map(index => r.enter(chain, [index], ctx, true, inside => {
                started.push(index)
                return hold.promise.then(() => r.assignPath(inside, [], index, ctx))
            }))
            try { assert.deepEqual(started, indexes) }
            finally { hold.resolve() }
            await Promise.all(entries)
            assert.deepEqual(await r.export(chain, [], ctx), [0, 1, 2, 3, 4, 5])
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const mutable of [false, true]) {
        it(`completes a no-op entry through a never-settling unused intermediate, mutable=${mutable}`, () => {
            const ctx = context(), never = new Promise(() => {})
            const chain = new r.Chain({ branch: never, sibling: 1 }, ctx)
            let calls = 0
            const result = r.enter(chain, ["branch", "unused"], ctx, mutable, () => { calls++; return 7 })
            assert.equal(result, 7)
            assert.equal(calls, 1)
            assert.equal(r.lookupPath(chain, ["sibling"], ctx), 1)
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("discards completed physical-order tokens without disturbing pending captures", async () => {
        const ctx = context(), hold = Promise.withResolvers()
        const data = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`k${i}`, i]))
        const keys = Object.keys(data)
        const chain = new r.Chain(data, ctx)
        const entry = r.enter(chain, ["k0"], ctx, true, () => hold.promise)
        const captured = r.export(chain, [], ctx)
        for (let round = 0; round < 4; round++) {
            for (let i = 1; i < 64; i++) r.enter(chain, [`k${i}`], ctx, true, () => {})
            assert.equal(metaOf(chain._state.value, ctx).recordOrder.positions.size, 1)
        }
        hold.resolve()
        await entry
        assert.equal(metaOf(chain._state.value, ctx).recordOrder.positions.size, 0)
        for (let i = 0; i < 64; i++) r.assignPath(chain, [`k${i}`], i, ctx)
        assert.equal(metaOf(chain._state.value, ctx).recordOrder.positions.size, 0)
        assert.deepEqual(Object.keys(await captured), keys)
        assert.deepEqual(Object.keys(await r.export(chain, [], ctx)), keys)
        r.assignPath(chain, ["later"], 64, ctx)
        assert.deepEqual(Object.keys(await r.export(chain, [], ctx)), [...keys, "later"])
        verifyRefCounts(ctx, chain._state)
    })

    it("bounds settled entry bookkeeping by live placements across creation and deletion cycles", () => {
        const ctx = context(), chain = new r.Chain([], ctx)
        for (let round = 0; round < 4; round++) {
            for (let index = 0; index < 64; index++) r.enter(chain, [index], ctx, true,
                inside => r.assignPath(inside, [], index, ctx))
            const versions = Object.values(metaOf(chain._state.value, ctx).placementVersions ?? {})
            assert(versions.length <= 64)
            assert(versions.every(version => !version.publication && !version.transition))
            for (let index = 0; index < 64; index++) r.deletePath(chain, [index], ctx)
            assert.equal(Object.keys(metaOf(chain._state.value, ctx).placementVersions ?? {}).length, 0)
            assert.deepEqual(r.export(chain, [], ctx), new Array(64))
            verifyRefCounts(ctx, chain._state)
        }
    })

    for (const pending of [false, true]) {
        it(`publishes growth before the element completes, pending value=${pending}`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), value = Promise.withResolvers()
            const chain = new r.ContextChain({ a: [] }, ctx)
            let inside
            const entry = r.enter(chain, ["a", 5], ctx, true, entered => { inside = entered; return hold.promise })
            const before = r.lookupPath(chain, ["a", "length"], ctx)
            assert(before instanceof Promise)
            const element = r.lookupPath(chain, ["a", 5], ctx)
            r.assignPath(inside, [], pending ? value.promise : 7, ctx)
            assert.equal(r.lookupPath(chain, ["a", "length"], ctx), 6)
            assert.equal(await before, 6)
            let delivered = false
            element.then(() => delivered = true)
            await tick()
            assert.equal(delivered, false)
            hold.resolve()
            await entry
            if (pending) { await tick(); assert.equal(delivered, false); value.resolve(7) }
            assert.equal(await element, 7)
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("keeps creation followed by deletion as growth, including nested entry", async () => {
        const ctx = context(), outer = Promise.withResolvers(), inner = Promise.withResolvers()
        const chain = new r.Chain([], ctx)
        let child, childResult
        const entry = r.enter(chain, [5], ctx, true, entered => {
            childResult = r.enter(entered, [], ctx, true, nested => { child = nested; return inner.promise })
            return outer.promise
        })
        const result = r.export(chain, [], ctx)
        r.assignPath(child, [], 1, ctx)
        r.deletePath(child, [], ctx)
        assert.equal(r.lookupPath(chain, ["length"], ctx), 6)
        outer.resolve()
        await entry
        let completed = false
        result.then(() => completed = true)
        await tick()
        assert.equal(completed, false)
        inner.resolve()
        await childResult
        assert.deepEqual(await result, new Array(6))
        verifyRefCounts(ctx, chain._state)
    })

    it("registers queued same-index growth at issuance and terminates inherited no-growth", async () => {
        const ctx = context(), release = Promise.withResolvers()
        const chain = new r.Chain([], ctx)
        const first = r.enter(chain, [5], ctx, true, () => release.promise)
        const before = r.lookupPath(chain, ["length"], ctx)
        const second = r.enter(chain, [5], ctx, true, inside => r.assignPath(inside, [], 7, ctx))
        const after = r.lookupPath(chain, ["length"], ctx)
        const third = r.enter(chain, [5], ctx, true, () => sync("done"))
        const last = r.lookupPath(chain, ["length"], ctx)
        release.resolve()
        await Promise.all([first, second, third])
        assert.equal(await before, 0)
        assert.equal(await after, 6)
        assert.equal(await last, 6)
    })

    for (const existing of [false, true]) for (const deletion of [false, true]) {
        it(`orders a plain command after an entry's final presence, existing=${existing}, delete=${deletion}`, async () => {
            const ctx = context(), hold = Promise.withResolvers()
            const initial = existing ? { first: 0, target: 1 } : { first: 0 }
            const expected = { ...initial }, chain = new r.Chain({ ...initial }, ctx)
            const entry = r.enter(chain, ["target"], ctx, true, inside => hold.promise.then(() =>
                existing ? r.deletePath(inside, [], ctx) : r.assignPath(inside, [], 1, ctx)))
            if (existing) delete expected.target
            else expected.target = 1
            r.assignPath(chain, ["middle"], 2, ctx)
            expected.middle = 2
            if (deletion) { r.deletePath(chain, ["target"], ctx); delete expected.target }
            else { r.assignPath(chain, ["target"], 3, ctx); expected.target = 3 }
            const output = r.export(chain, [], ctx)
            hold.resolve()
            await entry
            assert.deepEqual(await output, expected)
            assert.deepEqual(Object.keys(await output), Object.keys(expected))
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const pending of [false, true]) for (const append of [false, true]) {
        it(`publishes queued assignment growth before its payload, pending=${pending}, append=${append}`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), data = Promise.withResolvers()
            const chain = new r.Chain([0, 1, 2], ctx)
            const entry = r.enter(chain, [5], ctx, true, () => hold.promise)
            const before = r.lookupPath(chain, ["length"], ctx)
            r.assignPath(chain, [5], pending ? data.promise : 3, ctx)
            const assignedLength = r.lookupPath(chain, ["length"], ctx)
            const pushed = append ? r.run(chain, [], "push", [7], ctx, { mutationScopeDepth: 0 }) : undefined
            const output = r.export(chain, [], ctx)
            hold.resolve()
            await entry
            assert.equal(await before, 3)
            assert.equal(await assignedLength, 6)
            if (append) assert.equal(await pushed, 7)
            data.resolve(3)
            const expected = [0, 1, 2, , , 3]
            if (append) expected.push(7)
            assert.deepEqual(await output, expected)
            assert.deepEqual(await r.export(chain, [], ctx), expected)
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("keeps bounded and fixed-index consumers independent of unrelated growth", async () => {
        const ctx = context(), hold = Promise.withResolvers()
        const chain = new r.Chain([1, 2], ctx)
        const entry = r.enter(chain, [5], ctx, true, () => hold.promise)
        assert.equal(r.run(chain, [], "at", [0], ctx, {}), 1)
        assert.equal(r.run(chain, [], "at", [4], ctx, {}), undefined)
        const slice = r.run(chain, [], "slice", [0, 2], ctx, {})
        assert(!(slice instanceof Promise))
        assert.deepEqual(r.export(new r.Chain(slice, ctx), [], ctx), [1, 2])
        const invalid = r.run(chain, [], "with", [6, 9], ctx, {})
        assert.equal(invalid.kind, r.ERROR_KIND.InvalidArrayOperation)
        const exact = r.run(chain, [], "with", [0, 9], ctx, {})
        assert(exact instanceof Promise)
        hold.resolve()
        await entry
        assert.deepEqual(r.export(new r.Chain(await exact, ctx), [], ctx), [9, 2])
    })

    it("includes undecided placements inside a bounded slice but excludes their unrelated siblings", async () => {
        const ctx = context(), first = Promise.withResolvers(), other = Promise.withResolvers()
        const chain = new r.Chain([], ctx)
        let inside
        const entry = r.enter(chain, [1], ctx, true, entered => { inside = entered; return first.promise })
        const sibling = r.enter(chain, [5], ctx, true, () => other.promise)
        const result = r.run(chain, [], "slice", [0, 2], ctx, {})
        r.assignPath(inside, [], 7, ctx)
        first.resolve()
        await entry
        assert.deepEqual(await r.export(new r.Chain(await result, ctx), [], ctx), [,7])
        other.resolve()
        await sibling
    })

    it("captures record insertion order for copies and native receivers", async () => {
        const ctx = context(), hold = Promise.withResolvers()
        const chain = new r.Chain({ a: 1, b: 2 }, ctx)
        let inside
        const entry = r.enter(chain, ["a"], ctx, true, entered => { inside = entered; return hold.promise })
        const before = r.export(chain, [], ctx)
        r.assignPath(chain, ["c"], 3, ctx)
        r.deletePath(inside, [], ctx)
        r.assignPath(inside, [], 1, ctx)
        const after = r.export(chain, [], ctx)
        hold.resolve()
        await entry
        assert.deepEqual(Object.keys(await before), ["b", "a"])
        assert.deepEqual(Object.keys(await after), ["b", "a", "c"])
        const receiver = new r.Chain({ data: r.lookupPath(chain, [], ctx), keys() { return Object.keys(this.data) } }, ctx)
        assert.deepEqual(await r.run(receiver, [], "keys", [], ctx, {}), ["b", "a", "c"])
        verifyRefCounts(ctx, chain._state, receiver._state)
    })

    for (const method of ["at", "join", "toString"]) {
        it(`${method} protects an ordinary pending element before a queued mutation can use it`, async () => {
            const ctx = context(), data = Promise.withResolvers()
            const chain = new r.Chain([data.promise], ctx)
            const result = r.run(chain, [], method, method === "at" ? [0] : [], ctx, {})
            const mutation = r.assignPath(chain, [0, 0], "after", ctx)
            data.resolve(["before"])
            await mutation
            const output = new r.Chain(await result, ctx)
            assert.deepEqual(await r.export(output, [], ctx), method === "at" ? ["before"] : "before")
            assert.deepEqual(await r.export(chain, [], ctx), [["after"]])
            verifyRefCounts(ctx, chain._state, output._state)
        })

        for (const delivery of ["ready", "synchronous", "pending"]) {
            it(`${method} protects a ${delivery} element before a queued mutation can use it`, async () => {
                const ctx = context(), hold = Promise.withResolvers(), data = Promise.withResolvers()
                const chain = new r.Chain([], ctx)
                let inside
                const entry = r.enter(chain, [0], ctx, true, entered => { inside = entered; return hold.promise })
                const result = r.run(chain, [], method, method === "at" ? [0] : [], ctx, {})
                const value = ["before"]
                r.assignPath(inside, [], delivery === "pending" ? data.promise : delivery === "synchronous" ? sync(value) : value, ctx)
                const mutation = r.assignPath(chain, [0, 0], "after", ctx)
                hold.resolve()
                await entry
                data.resolve(value)
                await mutation
                const output = new r.Chain(await result, ctx)
                assert.deepEqual(await r.export(output, [], ctx), method === "at" ? ["before"] : "before")
                assert.deepEqual(await r.export(chain, [], ctx), [["after"]])
                verifyRefCounts(ctx, chain._state, output._state)
            })
        }
    }

    for (const copy of ["COW", "borrowed result"]) {
        for (const change of ["stay absent", "create before copy", "create after copy", "replace", "recreate before copy", "recreate after copy"]) {
            it(`${copy} preserves record order when an entry will ${change}`, async () => {
                const ctx = context(), hold = Promise.withResolvers()
                const existed = change === "replace" || change.startsWith("recreate")
                const chain = new r.Chain(existed ? { a: 1, b: 2 } : { b: 2 }, ctx)
                let inside
                const entry = r.enter(chain, ["a"], ctx, true, entered => { inside = entered; return hold.promise })
                const mutate = () => {
                    if (change.startsWith("recreate")) r.deletePath(inside, [], ctx)
                    r.assignPath(inside, [], 1, ctx)
                }
                if (change !== "stay absent" && !change.endsWith("after copy")) mutate()
                if (copy === "COW") r.lookupPath(chain, [], ctx)
                r.assignPath(chain, ["c"], 3, ctx)
                const copied = copy === "COW" ? chain : new r.Chain(r.importMethodResult(r.lookupPath(chain, [], ctx), ctx), ctx)
                const captured = r.export(copied, [], ctx)
                if (change.endsWith("after copy")) mutate()
                hold.resolve()
                await entry
                const keys = change === "stay absent" ? ["b", "c"] : change === "replace" ? ["a", "b", "c"] : ["b", "a", "c"]
                assert.deepEqual(Object.keys(await captured), keys)
                assert.deepEqual(Object.keys(await r.export(copied, [], ctx)), keys)
                const receiver = new r.Chain({ data: r.lookupPath(copied, [], ctx), keys() { return Object.keys(this.data) } }, ctx)
                assert.deepEqual(await r.run(receiver, [], "keys", [], ctx, {}), keys)
                verifyRefCounts(ctx, chain._state, copied._state, receiver._state)
            })
        }
    }

    it("captures ready siblings before export waits for shape", async () => {
        const ctx = context(), hold = Promise.withResolvers()
        const chain = new r.ContextChain({ a: [1] }, ctx)
        const entry = r.enter(chain, ["a", 5], ctx, true, () => hold.promise)
        const result = r.export(chain, ["a"], ctx)
        r.assignPath(chain, ["a", 0], 9, ctx)
        hold.resolve()
        await entry
        assert.deepEqual(await result, [1])
        assert.deepEqual(await r.export(chain, ["a"], ctx), [9])
    })

    for (const reverse of [false, true]) {
        it(`orders nested record creation by entry issuance, reverse completion=${reverse}`, async () => {
            const ctx = context(), first = Promise.withResolvers(), second = Promise.withResolvers()
            const chain = new r.Chain({ a: 1, b: 2 }, ctx)
            const a = r.enter(chain, ["a"], ctx, true, outer => r.enter(outer, [], ctx, true,
                inner => first.promise.then(() => { r.deletePath(inner, [], ctx); r.assignPath(inner, [], 1, ctx) })))
            const before = r.export(chain, [], ctx)
            const z = r.enter(chain, ["z"], ctx, true, inner => second.promise.then(() => r.assignPath(inner, [], 4, ctx)))
            r.assignPath(chain, ["c"], 3, ctx)
            const after = r.export(chain, [], ctx)
            if (reverse) { second.resolve(); await z; first.resolve() }
            else { first.resolve(); await a; second.resolve() }
            await Promise.all([a, z])
            assert.deepEqual(Object.keys(await before), ["b", "a"])
            assert.deepEqual(Object.keys(await after), ["b", "a", "z", "c"])
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("reserves queued same-key recreation without moving a preceding no-op capture", async () => {
        const ctx = context(), hold = Promise.withResolvers()
        const chain = new r.Chain({ a: 1, b: 2 }, ctx)
        const first = r.enter(chain, ["a"], ctx, true, () => hold.promise)
        const before = r.export(chain, [], ctx)
        const second = r.enter(chain, ["a"], ctx, true, inside => {
            r.deletePath(inside, [], ctx)
            r.assignPath(inside, [], 1, ctx)
        })
        r.assignPath(chain, ["c"], 3, ctx)
        hold.resolve()
        await Promise.all([first, second])
        assert.deepEqual(Object.keys(await before), ["a", "b"])
        assert.deepEqual(Object.keys(await r.export(chain, [], ctx)), ["b", "a", "c"])
    })

    for (const Chain of [r.Chain, r.ContextChain]) {
        it(`push preserves an unfinished in-range placement in ${Chain.name}`, async () => {
            const ctx = context(), hold = Promise.withResolvers()
            const source = [1, 2, 3], chain = new Chain(source, ctx)
            let inside
            const entry = r.enter(chain, [1], ctx, true, entered => { inside = entered; return hold.promise })
            const before = r.export(chain, [], ctx)
            assert.equal(r.run(chain, [], "push", [4], ctx, { mutationScopeDepth: 0 }), 4)
            assert.equal(r.lookupPath(chain, [3], ctx), 4)
            r.assignPath(inside, [], 9, ctx)
            hold.resolve()
            await entry
            assert.deepEqual(await before, [1, 9, 3])
            assert.deepEqual(await r.export(chain, [], ctx), [1, 9, 3, 4])
            if (Chain === r.ContextChain) assert.deepEqual(source, [1, 2, 3])
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("push waits for unknown length but can finish before the contributing entry", async () => {
        const ctx = context(), hold = Promise.withResolvers()
        const chain = new r.Chain([1], ctx)
        let inside, result
        const entry = r.enter(chain, [3], ctx, true, entered => { inside = entered; return hold.promise })
        const pushed = r.run(chain, [], "push", [5], ctx, { mutationScopeDepth: 0 })
        assert(pushed instanceof Promise)
        pushed.then(value => result = value)
        await tick()
        assert.equal(result, undefined)
        r.assignPath(inside, [], 4, ctx)
        await tick()
        assert.equal(result, 5)
        hold.resolve()
        await entry
        assert.deepEqual(await r.export(chain, [], ctx), [1, , , 4, 5])
    })

    for (const length of [2, 3, 5]) {
        it(`length ${length} does not wait for an entry in its retained prefix`, async () => {
            const ctx = context(), hold = Promise.withResolvers()
            const chain = new r.Chain([1, 2, 3], ctx)
            let inside
            const entry = r.enter(chain, [1], ctx, true, entered => { inside = entered; return hold.promise })
            const before = r.export(chain, [], ctx)
            r.assignPath(chain, ["length"], length, ctx)
            assert.equal(r.lookupPath(chain, ["length"], ctx), length)
            r.assignPath(inside, [], 9, ctx)
            hold.resolve()
            await entry
            assert.deepEqual(await before, [1, 9, 3])
            const expected = [1, 9, 3]
            expected.length = length
            assert.deepEqual(await r.export(chain, [], ctx), expected)
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const created of [false, true]) {
        it(`length assignment preserves pending growth in its retained prefix, created=${created}`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), chain = new r.Chain([], ctx)
            let inside
            const entry = r.enter(chain, [3], ctx, true, entered => { inside = entered; return hold.promise })
            const before = r.export(chain, [], ctx)
            r.assignPath(chain, ["length"], 6, ctx)
            assert.equal(r.lookupPath(chain, ["length"], ctx), 6)
            if (created) r.assignPath(inside, [], 9, ctx)
            hold.resolve()
            await entry
            const expected = []
            if (created) expected[3] = 9
            assert.deepEqual(await before, expected)
            expected.length = 6
            assert.deepEqual(await r.export(chain, [], ctx), expected)
            verifyRefCounts(ctx, chain._state)
        })

        it(`length waits only for its removed suffix, created=${created}`, async () => {
            const ctx = context(), prefix = Promise.withResolvers(), suffix = Promise.withResolvers(), size = Promise.withResolvers()
            const data = Promise.withResolvers(), chain = new r.Chain([1, 2, 3], ctx)
            const kept = r.enter(chain, [1], ctx, true, () => prefix.promise)
            let inside
            const removed = r.enter(chain, [5], ctx, true, entered => { inside = entered; return suffix.promise })
            r.assignPath(chain, ["length"], size.promise, ctx)
            let length
            const result = r.lookupPath(chain, ["length"], ctx).then(value => length = value)
            size.resolve(4)
            await tick()
            assert.equal(length, undefined)
            if (created) r.assignPath(inside, [], data.promise, ctx)
            suffix.resolve()
            await removed
            await tick()
            assert.equal(length, 4)
            prefix.resolve()
            await Promise.all([kept, result])
            assert.deepEqual(await r.export(chain, [], ctx), [1, 2, 3, ,])
            data.resolve(7)
            await tick()
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("materializes the same storage for direct and entered index assignment", () => {
        for (const entered of [false, true]) {
            const ctx = context(), cause = Error("creation refused")
            const storage = [0, 1, 2]
            const chain = new r.Chain(new Proxy(storage, {
                defineProperty(target, key, descriptor) {
                    if (key === "length") return Reflect.defineProperty(target, key, descriptor)
                    throw cause
                },
            }), ctx)
            // A failed direct write commits logical growth without reserving
            // physical capacity. Both subsequent routes must materialize it.
            const failure = r.assignPath(chain, [5], 7, ctx)
            assert.equal(failure.cause, cause)
            assert.equal(r.lookupPath(chain, ["length"], ctx), 6)
            const result = entered ? r.enter(chain, [4], ctx, true, inside => r.assignPath(inside, [], 8, ctx)) :
                r.assignPath(chain, [4], 8, ctx)
            assert.equal(result, undefined)
            assert.equal(r.lookupPath(chain, [4], ctx), 8)
            assert.equal(r.lookupPath(chain, [5], ctx), failure)
            assert.deepEqual(storage, [0, 1, 2])
        }
    })

    for (const method of ["join", "toString", "flat", "toSorted", "concat"]) {
        for (const outcome of ["absent", "created", "deleted"]) {
            it(`${method} captures available placements before ${outcome} growth settles`, async () => {
                const ctx = context(), hold = Promise.withResolvers()
                let reads = 0, inside
                const source = new Proxy([3, 1], {
                    getOwnPropertyDescriptor(target, key) {
                        if (key === "0") reads++
                        return Reflect.getOwnPropertyDescriptor(target, key)
                    },
                })
                const chain = new r.Chain(source, ctx)
                const entry = r.enter(chain, [4], ctx, true, entered => { inside = entered; return hold.promise })
                reads = 0
                const result = r.run(chain, [], method, [], ctx, {})
                try {
                    assert(reads > 0, "Available placements must be captured while growth is undecided")
                    r.assignPath(chain, [0], 9, ctx)
                    r.assignPath(chain, [7], 99, ctx)
                    if (outcome !== "absent") r.assignPath(inside, [], 2, ctx)
                    if (outcome === "deleted") r.deletePath(inside, [], ctx)
                } finally { hold.resolve() }
                await entry
                const expected = [3, 1]
                if (outcome !== "absent") expected[4] = 2
                if (outcome === "deleted") delete expected[4]
                const output = new r.Chain(await result, ctx)
                assert.deepEqual(await r.export(output, [], ctx), expected[method]())
                verifyRefCounts(ctx, chain._state, output._state)
            })
        }
    }

    it("concat protects captured inputs until shape publication without waiting for element data", async () => {
        const ctx = context(), hold = Promise.withResolvers(), data = Promise.withResolvers()
        const chain = new r.Chain([{ n: 1 }], ctx), suffix = [{ n: 2 }]
        const argument = new r.Chain(suffix, ctx)
        let inside, output
        const entry = r.enter(chain, [3], ctx, true, entered => { inside = entered; return hold.promise })
        const completed = Promise.resolve(r.run(chain, [], "concat", [suffix], ctx, {}))
            .then(value => { output = new r.Chain(value, ctx) })
        try {
            r.assignPath(chain, [0, "n"], 9, ctx)
            r.assignPath(argument, [0, "n"], 8, ctx)
            r.assignPath(inside, [], data.promise, ctx)
            await tick()
            assert(output, "Known length must expose the result before entry and element data finish")
            assert.equal(r.lookupPath(output, ["length"], ctx), 5)
            assert.equal(r.lookupPath(output, [0, "n"], ctx), 1)
            assert.equal(r.lookupPath(output, [4, "n"], ctx), 2)
        } finally { hold.resolve(); data.resolve(7) }
        await Promise.all([entry, completed])
        assert.deepEqual(await r.export(output, [], ctx), [{ n: 1 }, , , 7, { n: 2 }])
        verifyRefCounts(ctx, chain._state, argument._state, output._state)
    })

    it("orders shrink after an element transition without waiting for its payload", async () => {
        const ctx = context(), hold = Promise.withResolvers(), never = new Promise(() => {})
        const chain = new r.Chain([0, 1, 2], ctx)
        const entry = r.enter(chain, [5], ctx, true, inside => {
            r.assignPath(inside, [], never, ctx)
            return hold.promise
        })
        assert.equal(r.lookupPath(chain, ["length"], ctx), 6)
        r.assignPath(chain, ["length"], 1, ctx)
        const result = r.export(chain, [], ctx)
        assert(result instanceof Promise)
        hold.resolve()
        await entry
        assert.deepEqual(await result, [0])
    })

    for (const append of [false, true]) for (const payloadFirst of [false, true]) {
        it(`truncates copied metadata-only placements, append=${append}, payload first=${payloadFirst}`, async () => {
            const ctx = context(), command = Promise.withResolvers(), data = Promise.withResolvers(), hold = Promise.withResolvers()
            const chain = new r.Chain([0, 1, 2], ctx)
            const created = r.enter(chain, [3], ctx, true, inside => command.promise.then(() =>
                r.assignPath(inside, [], data.promise, ctx)))
            const kept = r.enter(chain, [1], ctx, true, () => hold.promise)
            r.assignPath(chain, ["length"], 2, ctx)
            const retained = r.lookupPath(chain, [], ctx)
            const pushed = append ? r.run(chain, [], "push", [160], ctx, { mutationScopeDepth: 0 }) : undefined
            const output = r.export(chain, [], ctx)
            command.resolve()
            await tick()
            assert.equal(await r.lookupPath(chain, ["length"], ctx), append ? 3 : 2)
            if (payloadFirst) { data.resolve(100); await tick() }
            hold.resolve()
            await Promise.all([created, kept, pushed])
            const snapshot = new r.Chain(await retained, ctx)
            const expected = append ? [0, 1, 160] : [0, 1]
            assert.deepEqual(await output, expected)
            assert.deepEqual(await r.export(snapshot, [], ctx), [0, 1])
            if (!payloadFirst) { data.resolve(100); await tick() }
            assert.deepEqual(await r.export(chain, [], ctx), expected)
            assert.deepEqual(await r.export(snapshot, [], ctx), [0, 1])
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state, snapshot._state)
        })
    }

    it("rejects unresolved external snapshots without adding a shape watcher", async () => {
        const ctx = context(), hold = Promise.withResolvers()
        const array = [], chain = new r.Chain(array, ctx)
        const entry = r.enter(chain, [5], ctx, true, () => hold.promise)
        const state = metaOf(array, ctx).arrayView._lengthState
        const tail = state.tail
        const failure = snapshotExternalValue(array, ctx)
        assert(r.isPoisonError(failure))
        assert.equal(state.tail, tail)
        hold.resolve()
        await entry
        assert.deepEqual(snapshotExternalValue(array, ctx), [])
    })

    it("does not write storage for no-op protection or optional discovery failure", () => {
        const ctx = context()
        let writes = 0
        const source = new Proxy({ value: 1 }, {
            ownKeys() { throw Error("unrelated enumeration") },
            set() { writes++; throw Error("write") },
            defineProperty() { writes++; throw Error("define") },
        })
        const chain = new r.Chain(source, ctx)
        assert.equal(r.enter(chain, ["value"], ctx, true, () => 7), 7)
        assert.equal(writes, 0)
        let fail = false, calls = 0
        const unreadable = new Proxy({ child: 1 }, { getOwnPropertyDescriptor(t, k) {
            if (fail && k === "child") throw Error("descriptor")
            return Reflect.getOwnPropertyDescriptor(t, k)
        } })
        const imported = new r.ContextChain(unreadable, ctx)
        fail = true
        assert.equal(r.enter(imported, ["child", "x"], ctx, true, () => { calls++; return 9 }), 9)
        assert.equal(calls, 1)
        fail = false
        assert.deepEqual(r.export(imported, [], ctx), { child: 1 })
    })

    for (const array of [false, true]) for (const imported of [false, true]) for (const indexed of [false, true]) for (const mutate of [false, true]) {
        it(`keeps entry usable after each fallible discovery read, Array=${array}, imported=${imported}, indexed=${indexed}, mutate=${mutate}`, async () => {
            async function exercise(failAt) {
                const ctx = context(), hold = Promise.withResolvers(), cause = new Error("entry inspection")
                const key = array ? "0" : "item"
                const storage = array ? [{ n: 1 }] : { item: { n: 1 } }
                let active = false, reads = 0, injected = false, calls = 0
                const inspect = () => {
                    if (active && ++reads === failAt) { injected = true; throw cause }
                }
                const source = new Proxy(storage, {
                    getOwnPropertyDescriptor(target, key) { inspect(); return Reflect.getOwnPropertyDescriptor(target, key) },
                    ownKeys(target) { inspect(); return Reflect.ownKeys(target) },
                    isExtensible(target) { inspect(); return Reflect.isExtensible(target) },
                    get(target, key, receiver) {
                        // Native Promise assimilation requires a safe then lookup.
                        if (key === "length") inspect()
                        return Reflect.get(target, key, receiver)
                    },
                })
                const root = { branch: source, sibling: 4 }
                const chain = imported ? new r.ContextChain(root, ctx) : new r.Chain(root, ctx)
                if (indexed) assert.equal(r.hasError(chain, [], ctx), false)
                active = true
                let entry
                try {
                    entry = r.enter(chain, ["branch", key], ctx, true, inside => {
                        active = false
                        calls++
                        if (mutate) r.assignPath(inside, ["n"], 2, ctx)
                        return hold.promise
                    })
                    assert.equal(calls, 1)
                    assert.equal(ctx.execution.fatalError, null)
                    assert.equal(r.lookupPath(chain, ["sibling"], ctx), 4)
                    verifyRefCounts(ctx, chain._state)
                } finally {
                    active = false
                    hold.resolve(7)
                }
                assert.equal(await entry, 7)
                assert.equal(injected, failAt > 0, `injection ${failAt} was reached`)
                const expected = { branch: array ? [{ n: 1 }] : { item: { n: 1 } }, sibling: 4 }
                if (mutate) expected.branch[key].n = 2
                assert.deepEqual(await r.export(chain, [], ctx), expected)
                assert.equal(r.hasError(chain, [], ctx), false)
                assert.equal(r.getErrors(chain, [], ctx), null)
                verifyRefCounts(ctx, chain._state)
                r.assignPath(chain, ["branch", key, "n"], 9, ctx)
                expected.branch[key].n = 9
                assert.deepEqual(await r.export(chain, [], ctx), expected)
                verifyRefCounts(ctx, chain._state)
                return reads
            }
            // Replay each host read from a fresh equivalent graph. Unlike an
            // always-throwing trap, this reaches reads after successful discovery.
            const count = await exercise(0)
            assert(count > 0)
            for (let failAt = 1; failAt <= count; failAt++) await exercise(failAt)
        })
    }

    for (const entered of [false, true]) it(`commits poison growth and preserves it through repair, entered=${entered}`, async () => {
        const ctx = context(), cause = new Error("creation refused")
        const storage = [0, 1, 2]
        const source = new Proxy(storage, {
            defineProperty(target, key, descriptor) {
                if (key === "length") return Reflect.defineProperty(target, key, descriptor)
                throw cause
            },
        })
        const chain = new r.Chain(source, ctx)
        const failure = entered ? r.enter(chain, [5], ctx, true, inside => r.assignPath(inside, [], 7, ctx)) :
            r.assignPath(chain, [5], 7, ctx)
        assert.equal(failure.cause, cause)
        assert.equal(r.lookupPath(chain, [5], ctx), failure)
        assert.equal(r.lookupPath(chain, ["length"], ctx), 6)
        assert.equal(storage.length, 3)
        assert.equal(Object.hasOwn(storage, 5), false)
        assert.equal(r.hasError(chain, [], ctx), true)
        assert.equal(r.getErrors(chain, [], ctx), failure)
        await r.repairPath(chain, [5], ctx)
        const expected = [0, 1, 2]
        expected.length = 6
        assert.deepEqual(await r.export(chain, [], ctx), expected)
        assert.deepEqual(snapshotExternalValue(r.lookupPath(chain, [], ctx), ctx), expected)
        verifyRefCounts(ctx, chain._state)
    })

    it("matches an independent poison/recovery model through stacked command sequences", async function () {
        this.timeout(10000)
        let seed = 0x9fc92
        const random = n => Math.floor(((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32) * n)
        for (const array of [false, true]) for (const captures of [false, true]) for (let run = 0; run < 32; run++) {
            const startSeed = seed, ctx = context(), expected = array ? [0] : { k0: 0 }
            const initial = array ? [...expected] : { ...expected }
            const chain = new r.Chain(run % 2 ? r.import(initial, ctx) : initial, ctx)
            const pending = [], work = [], checks = [], trace = []
            const defer = value => {
                const task = Promise.withResolvers()
                pending.push(() => task.resolve(value))
                return task.promise
            }
            const errors = value => value === null ? [] : (value.errors ?? [value])
                .map(error => [error.errorContext.turn, error.kind]).sort((a, b) => a[0] - b[0])
            const capture = () => {
                const snapshot = array ? expected.slice() : { ...expected }
                checks.push({ snapshot, output: r.export(chain, [], ctx), errors: r.getErrors(chain, [], ctx),
                    length: array ? r.lookupPath(chain, ["length"], ctx) : undefined })
            }
            for (let turn = 0; turn < 12; turn++) {
                // Deliberately start with several commands behind one no-op
                // entry. Random schedules alone rarely select this dependency.
                const kind = turn < 3 ? [4, 2, 0][turn] : random(5)
                const key = array ? turn < 3 ? 3 : random(5) : `k${turn < 3 ? 3 : random(5)}`
                const value = random(20), source = { execution: ctx.execution, errorContext: { turn } }
                const route = turn < 3 ? 0 : random(3)
                const input = kind === 0 && random(2) ? defer(value) : value
                trace.push({ kind, key, value, route })
                if (kind === 4) {
                    const completion = defer()
                    work.push(r.enter(chain, [key], source, true, () => completion))
                }
                else {
                    const command = (target, path) => kind === 0 ? r.assignPath(target, path, input, source)
                        : kind === 1 ? r.deletePath(target, path, source)
                            : kind === 2 ? r.assignPath(target, [...path, "x"], 1, source) : r.repairPath(target, path, source)
                    work.push(route === 0 ? command(chain, [key]) : route === 1
                        ? r.enter(chain, [key], source, true, inside => command(inside, []))
                        : r.enter(chain, [], source, true, inside => command(inside, [key])))
                    if (kind === 0) expected[key] = value
                    else if (kind === 1) delete expected[key]
                    else if (kind === 2 && typeof expected[key] !== "object") {
                        expected[key] = { turn, kind: expected[key] === undefined ? r.ERROR_KIND.NullLookup : r.ERROR_KIND.ScalarLookup,
                            present: Object.hasOwn(expected, key), value: expected[key] }
                    } else if (kind === 3 && typeof expected[key] === "object") {
                        const baseline = expected[key]
                        if (baseline.present) expected[key] = baseline.value
                        else delete expected[key]
                    }
                }
                if (captures) capture()
            }
            capture()
            while (pending.length) {
                pending.splice(random(pending.length), 1)[0]()
                if (run % 2) await tick()
            }
            await Promise.all(work)
            const message = `seed=${startSeed}, array=${array}, captures=${captures}: ${JSON.stringify(trace)}`
            for (const check of checks) {
                const failures = Object.values(check.snapshot).filter(value => typeof value === "object")
                    .map(error => [error.turn, error.kind]).sort((a, b) => a[0] - b[0])
                assert.deepEqual(errors(await check.errors), failures, message)
                const output = await check.output
                if (failures.length) assert.deepEqual(errors(output), failures, message)
                else {
                    assert.deepEqual(output, check.snapshot, message)
                    assert.deepEqual(Object.keys(output), Object.keys(check.snapshot), message)
                }
                if (array) assert.equal(await check.length, check.snapshot.length, message)
            }
            assert.equal(ctx.execution.fatalError, null, message)
            verifyRefCounts(ctx, chain._state)
        }
    })

    it("matches native command prefixes across mixed entry routes and settlement orders", async function () {
        this.timeout(10000)
        let seed = 0x9fc
        const random = n => Math.floor(((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32) * n)
        for (const array of [false, true]) for (const drainEach of [false, true]) {
            for (let schedule = 0; schedule < 24; schedule++) {
                const startSeed = seed, ctx = context(), expected = array ? [0, 1, 2] : { k0: 0, k1: 1 }
                const copy = () => array ? expected.slice() : { ...expected }
                const initial = copy(), chain = new r.Chain(schedule % 2 ? r.import(initial, ctx) : initial, ctx)
                const pending = [], work = [], observations = [], trace = []
                const defer = value => {
                    const task = Promise.withResolvers()
                    pending.push(() => task.resolve(value))
                    return task.promise
                }
                const capture = () => {
                    observations.push({ value: r.export(chain, [], ctx), expected: copy() })
                    if (array) observations.push({ value: r.lookupPath(chain, ["length"], ctx), expected: expected.length })
                }
                for (let turn = 0; turn < 10; turn++) {
                    const kind = random(array ? 6 : 3), route = random(4)
                    const key = array ? random(7) : `k${random(5)}`, value = random(100)
                    const path = kind === 3 ? ["length"] : kind >= 4 ? [] : [key]
                    const input = (kind === 0 || kind === 4) && random(2) ? defer(value) : value
                    const hold = route && random(2) ? defer() : undefined
                    const command = (target, path) => {
                        if (kind === 0) return r.assignPath(target, path, input, ctx)
                        if (kind === 1) return r.deletePath(target, path, ctx)
                        if (kind === 3) return r.assignPath(target, path, value % 7, ctx)
                        if (kind >= 4) return r.run(target, path, kind === 4 ? "push" : "pop",
                            kind === 4 ? [input] : [], ctx, { mutationScopeDepth: path.length })
                    }
                    const execute = (target, path) => hold ? hold.then(() => command(target, path)) : command(target, path)
                    // No-op entries may be readonly. Actual mutation routes all
                    // issue the same native command at their sequence position.
                    const mutable = kind !== 2 || Boolean(random(2))
                    trace.push({ kind, route, path, value, delayed: Boolean(hold), pendingInput: input instanceof Promise, mutable })
                    const result = route === 0 ? command(chain, path)
                        : route === 1 ? r.enter(chain, path, ctx, mutable, inside => execute(inside, []))
                            : r.enter(chain, [], ctx, mutable, inside => route === 2 ? execute(inside, path)
                                : r.enter(inside, path, ctx, mutable, nested => execute(nested, [])))
                    work.push(result)
                    if (kind === 0) expected[key] = value
                    else if (kind === 1) delete expected[key]
                    else if (kind === 3) expected.length = value % 7
                    else if (kind === 4) expected.push(value)
                    else if (kind === 5) expected.pop()
                    if (schedule % 2) capture()
                }
                capture()
                while (pending.length) {
                    pending.splice(random(pending.length), 1)[0]()
                    if (drainEach) await tick()
                }
                await Promise.all(work)
                const message = `seed ${startSeed}, array=${array}, drainEach=${drainEach}: ${JSON.stringify(trace)}`
                for (const observation of observations) {
                    const value = await observation.value
                    assert.deepEqual(value, observation.expected, message)
                    if (!array && typeof value === "object") assert.deepEqual(Object.keys(value), Object.keys(observation.expected), message)
                }
                assert.deepEqual(await r.export(chain, [], ctx), expected, message)
                assert.equal(ctx.execution.fatalError, null, message)
                verifyRefCounts(ctx, chain._state)
            }
        }
    })

    it("matches a prefix oracle through real entry creation, completion, forks, and queries", async () => {
        const generator = createRandom(31)
        const random = n => randomInteger(generator, n)
        const coverage = new Set()
        for (let schedule = 0; schedule < 60; schedule++) {
            const ctx = context(), chain = new r.Chain([], ctx), sources = [], questions = []
            for (let turn = 0; turn < 12; turn++) {
                if (turn < 3 || random(3) === 0) {
                    const index = sources.length * 2 + 1
                    const hold = Promise.withResolvers(), source = { bound: index + 1, hold }
                    source.result = r.enter(chain, [index], ctx, true, inside => { source.inside = inside; return hold.promise })
                    sources.push(source)
                } else if (random(2)) {
                    const source = sources[random(sources.length)]
                    if (source.value === undefined) {
                        source.value = random(2) ? source.bound : 0
                        if (source.value) r.assignPath(source.inside, [], sync(source.value), ctx)
                        source.hold.resolve()
                        await source.result
                    }
                } else {
                    const sourceArray = r.lookupPath(chain, [], ctx)
                    const copy = new r.Chain(sourceArray, ctx)
                    const work = new OperationOwner(ctx)
                    const index = random(2) ? random(18) : undefined
                    const question = { prefix: [...sources], index, work }
                    questions.push(question)
                    const result = index === undefined ? r.lookupPath(copy, ["length"], ctx) : ArrayView.resolveInRange(sourceArray, index, work, v => v)
                    coverage.add(`${index === undefined ? "length" : index % 2 ? "odd" : "even"}:${result instanceof Promise ? "pending" : "ready"}`)
                    if (result instanceof Promise) result.then(v => question.answer = v)
                    else question.answer = result
                }
                await tick()
                for (const q of questions) {
                    if (q.expected !== undefined) continue
                    const min = Math.max(0, ...q.prefix.map(s => s.value ?? 0))
                    const max = Math.max(min, ...q.prefix.map(s => s.value ?? s.bound))
                    q.expected = q.index === undefined ? min === max ? min : undefined : q.index < min ? true : q.index >= max ? false : undefined
                    assert.equal(q.answer, q.expected, `schedule ${schedule}, turn ${turn}`)
                }
            }
            for (const source of sources) source.hold.resolve()
            await Promise.all(sources.map(source => source.result))
            for (const q of questions) q.work.close()
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state)
        }
        for (const kind of ["length", "even", "odd"]) for (const readiness of ["ready", "pending"])
            assert(coverage.has(`${kind}:${readiness}`), `missing ${kind} ${readiness} question`)
    })
})
