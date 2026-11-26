import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { ready } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new r.Execution(), errorContext: "partial splice" })
const mutation = { mutationScopeDepth: 0 }

describe("captured splice regions", () => {
    it("preserves surviving occurrences and their ranks through reversal of an open insertion", async () => {
        const ctx = context(), start = Promise.withResolvers(), size = Promise.withResolvers(), wrap = v => new r.Chain(v, ctx)
        const source = wrap(r.run(wrap(["A", "B", "C"]), [], "toSpliced", [2, size.promise], ctx, {}))
        const inserted = wrap(r.run(source, [], "toSpliced", [start.promise, 0, "X"], ctx, {}))
        const result = wrap(r.run(inserted, [], "toReversed", [], ctx, {}))
        assert.equal(r.run(result, [], "includes", ["X"], ctx, {}), true)
        const cursor = r.iterate(result, [], ctx)
        const pulls = [await cursor.next(), await cursor.next(), await cursor.next()]
        const values = pulls.map(s => r.lookupPath(s.value, [], ctx))
        assert.deepEqual(values.toSorted(), ["A", "B", "X"])
        start.resolve(-1)
        assert.equal(await pulls[values.indexOf("X")].index, 1)
        size.resolve(1)
        const ordered = ["B", "X", "A"]
        for (const [i, pull] of pulls.entries()) assert.equal(await pull.index, ordered.indexOf(values[i]))
        assert((await cursor.next()).done)
        assert.deepEqual(await r.export(result, [], ctx), ordered)
    })
    it("delivers the insertion before an unknown deletion, and releases old items when the count proves zero", async () => {
        const ctx = context(), cut = Promise.withResolvers(), count = Promise.withResolvers()
        const wrap = v => new r.Chain(v, ctx)
        const copy = wrap(r.run(wrap(["A", "B"]), [], "toSpliced", [cut.promise, count.promise, "X"], ctx, {}))
        const cursor = r.iterate(copy, [], ctx)
        assert.equal(r.lookupPath((await cursor.next()).value, [], ctx), "X")
        assert.equal(r.run(copy, [], "includes", ["X"], ctx, {}), true)
        const old = r.run(copy, [], "includes", ["A"], ctx, {})
        assert(r.isPending(old, ctx))
        count.resolve(0)
        assert.equal(await old, true)
        assert.equal(await r.lookupPath(copy, ["length"], ctx), 3)
        const items = [await cursor.next(), await cursor.next()]
        assert.deepEqual(items.map(i => r.lookupPath(i.value, [], ctx)).sort(), ["A", "B"])
        assert((await cursor.next()).done)
        cut.resolve(1)
        assert.deepEqual(await r.export(copy, [], ctx), ["A", "X", "B"])
    })
    it("finishes a pure insertion when an open source proves empty and its cut never arrives", async () => {
        for (const mode of Object.values(r.CHAIN_MODE)) {
            const ctx = context(), count = Promise.withResolvers(), wrap = v => new r.Chain(v, ctx, mode)
            const base = wrap(r.run(wrap(["A"]), [], "toSpliced", [0, count.promise], ctx, {}))
            const copy = wrap(r.run(base, [], "toSpliced", [new Promise(() => {}), 0, "X"], ctx, {}))
            const exported = r.export(copy, [], ctx)
            count.resolve(1)
            assert.deepEqual(await exported, ["X"])
        }
    })
    it("discovers a pure insertion on an open source before either control settles", async () => {
        for (const succeeds of [false, true]) for (const countFirst of [false, true]) {
            const ctx = context(), count = Promise.withResolvers(), start = Promise.withResolvers()
            const wrap = value => new r.Chain(value, ctx, r.CHAIN_MODE.Unordered)
            const base = wrap(r.run(wrap(["A", "B", "C"]), [], "toSpliced", [2, count.promise], ctx, {}))
            const copy = wrap(r.run(base, [], "toSpliced", [start.promise, 0, "X"], ctx, {}))
            assert.equal(r.run(copy, [], "includes", ["X"], ctx, {}), true)
            assert.equal(r.run(copy, [], "includes", ["B"], ctx, {}), true)
            const cursor = r.iterate(copy, [], ctx, { windowEnd: 4, metadata: ["index0", "length"] })
            const steps = [await cursor.next(), await cursor.next(), await cursor.next()]
            const values = steps.map(step => r.lookupPath(step.value, [], ctx))
            assert.deepEqual(values.toSorted(), ["A", "B", "X"])
            const limited = r.iterate(copy, [], ctx, { windowEnd: 1 })
            let delivered = false
            const first = limited.next().then(s => { delivered = true; return s })
            await new Promise(setImmediate)
            assert.equal(delivered, false)
            const cut = () => start.resolve(succeeds ? -1 : r.validationError("start", ctx, r.ERROR_KIND.OperationInputFailed))
            if (countFirst) {
                count.resolve(1)
                assert.equal(await steps[0].metadata.length, 3)
                cut()
            } else { cut(); count.resolve(1) }
            const expected = succeeds ? ["A", "X", "B"] : ["A", "B", "X"]
            assert.deepEqual(await r.export(copy, [], ctx), expected)
            assert.equal(r.lookupPath((await first).value, [], ctx), "A")
            for (const [i, step] of steps.entries()) assert.equal(await step.metadata.index0, expected.indexOf(values[i]))
            assert((await cursor.next()).done)
            await limited.return()
        }
    })
    for (const mode of Object.values(r.CHAIN_MODE)) it(`ignores descriptors discarded by a structural copy in mode ${mode}`, () => {
        const ctx = { execution: new r.Execution(), errorContext: "unused placement" }
        let armed = false
        const input = new Proxy(Array.from({ length: 67 }, (_, i) => i), {
            getOwnPropertyDescriptor(target, key) {
                if (armed && key === "1") throw new Error("discarded descriptor")
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        const source = new r.Chain(r.import(input, ctx), ctx, mode)
        armed = true
        for (const method of ["splice", "toSpliced", "with", "fill"]) {
            const args = method === "fill" ? [9, 1, 66] : method === "with" ? [1, 9] : [1, 1, 9]
            const output = new r.Chain(r.run(source, [], method, args, ctx, {}), ctx, mode)
            assert.equal(r.lookupPath(output, [1], ctx), 9, method)
            assert.equal(r.lookupPath(output, [66], ctx), 66, method)
        }
    })
    for (const prepend of [false, true]) it(`searches a sparse run split by a pending insertion, prepend=${prepend}`, async () => {
        const ctx = context(), start = Promise.withResolvers(), length = 2 ** 18
        const source = new r.Chain(new Array(length), ctx)
        const copy = new r.Chain(r.run(source, [], "splice", [start.promise, 0, "X"], ctx, {}), ctx)
        assert.equal(r.run(copy, [], "includes", ["X"], ctx, {}), true)
        assert.equal(r.run(copy, [], "includes", [undefined, length - 1], ctx, {}), true)
        const tail = r.run(copy, [], "includes", [undefined, length], ctx, {})
        assert(r.isPending(tail, ctx))
        start.resolve(prepend ? 0 : length)
        assert.equal(await tail, prepend)
    })
    it("shares an unresolved insertion cut across searches and independent cursor windows", async () => {
        const ctx = context(), start = Promise.withResolvers()
        const source = new r.Chain(["A", "B"], ctx)
        const copy = new r.Chain(r.run(source, [], "toSpliced", [start.promise, 0, "X"], ctx, {}), ctx)
        const bounded = r.iterate(copy, [], ctx, { windowEnd: 1 }), first = bounded.next()
        const unbounded = r.iterate(copy, [], ctx)
        const item = await unbounded.next()
        assert.equal(r.lookupPath(item.value, [], ctx), "A")
        await unbounded.return()
        assert.equal(r.run(copy, [], "includes", ["X"], ctx, {}), true)
        const afterZero = r.run(copy, [], "includes", ["A", 1], ctx, {})
        assert(r.isPending(afterZero, ctx))
        start.resolve(0)
        assert.equal(await afterZero, true)
        assert.equal(await item.index, 1)
        assert.equal(r.lookupPath((await first).value, [], ctx), "X")
        bounded.setWindow(1, 3)
        for (const expected of ["A", "B"]) assert.equal(r.lookupPath((await bounded.next()).value, [], ctx), expected)
        assert.equal((await bounded.next()).done, true)
    })
    for (const cut of [0, 1, 2]) it(`preserves insertion membership and bounded indexes through concat at cut ${cut}`, async () => {
        const ctx = context(), start = Promise.withResolvers()
        const chain = value => new r.Chain(value, ctx, r.CHAIN_MODE.Unordered)
        const inside = chain(r.run(chain(["A", "B"]), [], "toSpliced", [start.promise, 0, "X"], ctx, {}))
        const joined = chain(r.run(chain(["P"]), [], "concat", [r.lookupPath(inside, [], ctx), ["Z"]], ctx, {}))
        assert.equal(r.run(joined, [], "includes", ["X", 1], ctx, {}), true)
        const cursor = r.iterate(joined, [], ctx, { windowEnd: 1, metadata: ["first", "last"] })
        assert.equal(r.lookupPath((await cursor.next()).value, [], ctx), "P")
        cursor.setWindow(1, 4)
        const steps = [await cursor.next(), await cursor.next(), await cursor.next()]
        const values = steps.map(step => r.lookupPath(step.value, [], ctx))
        assert.deepEqual(values.toSorted(), ["A", "B", "X"])
        for (const step of steps) {
            assert.equal(step.metadata.first, false)
            assert.equal(step.metadata.last, false)
        }
        start.resolve(cut)
        const expected = ["P", ...["A", "B"].toSpliced(cut, 0, "X"), "Z"]
        for (const [i, step] of steps.entries()) assert.equal(await step.index, expected.indexOf(values[i]))
        await cursor.return()
        assert.deepEqual(await r.export(joined, [], ctx), expected)
    })
    for (const cut of [0, 2]) it(`projects a nested insertion at the native boundary at cut ${cut}`, async () => {
        const ctx = context(), start = Promise.withResolvers(), max = 0xffffffff
        const chain = value => new r.Chain(value, ctx, r.CHAIN_MODE.Unordered)
        const inside = chain(r.run(chain(["A", "B"]), [], "toSpliced", [start.promise, 0, "X"], ctx, {}))
        const joined = chain(r.run(chain(new Array(max - 2)), [], "concat", [r.lookupPath(inside, [], ctx)], ctx, {}))
        assert.equal(r.run(joined, [], "includes", ["A", max - 2], ctx, {}), true)
        const x = r.run(joined, [], "includes", ["X", max - 2], ctx, {})
        assert(r.isPending(x, ctx))
        start.resolve(cut)
        assert.equal(await x, cut === 0 ? true : await r.lookupPath(joined, [max], ctx))
        assert.equal((await r.lookupPath(joined, [max], ctx)).kind, r.ERROR_KIND.InvalidArrayLength)
    })
    for (const cutFirst of [false, true]) for (const grows of [false, true])
        it(`refines an insertion at capacity from either end, cutFirst=${cutFirst}, grows=${grows}`, async () => {
            const ctx = context(), cut = Promise.withResolvers(), hold = Promise.withResolvers(), max = 0xffffffff
            const chain = value => new r.Chain(value, ctx, r.CHAIN_MODE.Unordered)
            const prefix = chain([])
            let inside
            const issued = r.enter(prefix, [], ctx, { maximumCount: 1, mayPoisonScope: false },
                ref => { inside = ref; return hold.promise })
            const inserted = r.run(chain(["A", "B"]), [], "toSpliced", [cut.promise, 0, "X"], ctx, {})
            const joined = chain(r.run(prefix, [], "concat", [new Array(max - 3), inserted], ctx, {}))
            const search = r.run(joined, [], "includes", ["X", max - 3], ctx, {})
            assert(r.isPending(search, ctx))
            if (cutFirst) {
                cut.resolve(0)
                assert.equal(await search, true)
            }
            if (grows) r.run(inside, [], "push", ["P"], ctx, mutation)
            hold.resolve()
            await issued
            if (!cutFirst) {
                if (!grows) assert.equal(await search, true)
                cut.resolve(2)
            }
            if (grows && !cutFirst) {
                const failure = await r.lookupPath(joined, [max], ctx)
                assert.equal(failure.kind, r.ERROR_KIND.InvalidArrayLength)
                assert.equal(await search, failure)
            } else assert.equal(await search, true)
        })
    for (const at of [0, 3]) it(`collects only eligible structural causes across a pending insertion at ${at}`, async () => {
        const ctx = context(), cut = Promise.withResolvers()
        const chain = value => new r.Chain(value, ctx, r.CHAIN_MODE.Unordered)
        const source = chain(["A"])
        const causes = ["first", "second"].map(label => r.validationError(label, ctx, r.ERROR_KIND.OperationInputFailed))
        for (const cause of causes) r.appendMissingOutput(source, cause, ctx)
        const copy = chain(r.run(source, [], "toSpliced", [cut.promise, 0, "X"], ctx, {}))
        const any = r.run(copy, [], "includes", ["absent", 2], ctx, {})
        const last = r.run(copy, [], "includes", ["absent", 3], ctx, {})
        cut.resolve(at)
        if (at === 0) {
            assert.deepEqual(new Set((await any).errors), new Set(causes))
            assert.equal(await last, causes[1])
        } else {
            assert.equal(await any, causes[1])
            assert.equal(await last, false)
        }
    })
    it("releases an indexed splice position when its captured source proves to be a hole", async () => {
        const ctx = context(), start = Promise.withResolvers()
        const chain = new r.Chain([1, , 3], ctx)
        const removed = r.run(chain, [], "splice", [start.promise, 0, "X"], ctx, mutation)
        const errors = r.hasError(chain, [], ctx), selected = r.lookupPath(chain, [1], ctx)
        start.resolve(3)
        await removed
        assert.equal(await selected, undefined)
        assert.equal(await errors, false)
        assert.deepEqual(r.export(chain, [], ctx), [1, , 3, "X"])
        verifyRefCounts(ctx, chain._state)
    })
    it("retires an unowned splice backing while a selected position is pending", async () => {
        const ctx = context(), child = { x: 1 }, count = Promise.withResolvers()
        const retained = new r.Chain(child, ctx), chain = new r.Chain([child, 1, 2], ctx)
        const removed = r.run(chain, [], "splice", [1, count.promise], ctx, mutation)
        const point = r.lookupPath(chain, [1], ctx)
        r.assignPath(chain, [], null, ctx)
        verifyRefCounts(ctx, retained._state)
        count.resolve(0)
        await removed
        assert.equal(await point, 1)
        assert.deepEqual(r.export(retained, [], ctx), { x: 1 })
    })
    for (const method of ["splice", "toSpliced"]) for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
        it(`refines an already requested ${method} position when only start settles in mode ${mode}`, async () => {
            const ctx = context(), start = Promise.withResolvers(), count = Promise.withResolvers()
            const source = new r.Chain([, "B", "C"], ctx, mode)
            const copy = new r.Chain(r.run(source, [], method, [start.promise, count.promise, "X"], ctx, {}), ctx, mode)
            const item = r.lookupPath(copy, [1], ctx), first = r.iterate(copy, [], ctx, { windowEnd: 1 }).next()
            start.resolve(1)
            assert.equal(await item, "X")
            assert.equal(r.lookupPath((await first).value, [], ctx), undefined)
            count.resolve(1)
            assert.deepEqual(await r.export(copy, [], ctx), method === "toSpliced" ? [undefined, "X", "C"] : [, "X", "C"])
        })
    for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
        it(`publishes an established concat part while a later part remains open in mode ${mode}`, async () => {
            const ctx = context(), first = Promise.withResolvers(), later = Promise.withResolvers()
            const source = new r.Chain(["A"], ctx, mode)
            const copy = new r.Chain(r.run(source, [], "concat", [first.promise, later.promise], ctx, {}), ctx, mode)
            const old = r.lookupPath(copy, [1], ctx), cursor = r.iterate(copy, [], ctx)
            assert.equal(r.lookupPath((await cursor.next()).value, [], ctx), "A")
            const next = cursor.next(), errors = r.getErrors(copy, [], ctx)
            first.resolve(["B"])
            assert.equal(await old, "B")
            assert.equal(r.lookupPath((await next).value, [], ctx), "B")
            r.assignPath(copy, [1], "new", ctx)
            later.resolve([])
            assert.equal(await errors, null)
            assert.deepEqual(await r.export(copy, [], ctx), ["A", "new"])
            assert((await cursor.next()).done)
        })
    for (const reject of [false, true]) it(`delivers guaranteed insert survivors with independently settling coordinates (${reject})`, async () => {
        const ctx = context(), start = Promise.withResolvers()
        const chain = new r.Chain(["A", "B"], ctx, r.CHAIN_MODE.Unordered)
        const cause = r.validationError("position", ctx, r.ERROR_KIND.InvalidArrayOperation)
        const result = r.run(chain, [], "splice", [start.promise, 0, "X"], ctx, mutation)
        assert.equal(r.lookupPath(chain, ["length"], ctx), 3)
        assert.equal(r.hasError(chain, [], ctx), false)
        assert.equal(r.getErrors(chain, [], ctx), null)
        const cursor = r.iterate(chain, [], ctx)
        const received = []
        for (let i = 0; i < 3; i++) {
            const step = await cursor.next()
            received.push([step.index, r.lookupPath(step.value, [], ctx)])
            assert(r.isPending(step.index, ctx))
        }
        assert((await cursor.next()).done)
        start.resolve(reject ? cause : 1)
        const sorted = []
        for (const [index, value] of received) sorted[await index] = value
        assert.deepEqual(sorted, reject ? ["A", "B", "X"] : ["A", "X", "B"])
        assert.deepEqual(r.export(chain, [], ctx), sorted)
        const removed = await result
        if (reject) assert.equal(removed, cause)
        else assert.deepEqual(r.export(new r.Chain(removed, ctx), [], ctx), [])
    })

    it("uses full index bounds for admission and preserves an outstanding bounded request through close", async () => {
        const ctx = context(), start = Promise.withResolvers()
        const chain = new r.Chain(["A", "B"], ctx, r.CHAIN_MODE.Unordered)
        r.run(chain, [], "splice", [start.promise, 0, "X"], ctx, mutation)
        const cursor = r.iterate(chain, [], ctx, { windowEnd: 2 })
        const a = await cursor.next()
        assert.equal(r.lookupPath(a.value, [], ctx), "A")
        const held = cursor.next()
        await cursor.return()
        assert((await cursor.next()).done)
        start.resolve(1)
        const x = await held
        assert.equal(x.index, 1)
        assert.equal(r.lookupPath(x.value, [], ctx), "X")
    })

    it("retains a sequential positional flag across an unordered handoff and repairs the original hole", async () => {
        const ctx = context(), start = Promise.withResolvers()
        const chain = new r.Chain([, "B"], ctx, r.CHAIN_MODE.Sequential)
        const cause = r.validationError("position", ctx, r.ERROR_KIND.InvalidArrayOperation)
        const result = r.run(chain, [], "splice", [start.promise, 0, "X"], ctx, mutation)
        const handoff = new r.Chain(r.lookupPath(chain, [], ctx), ctx, r.CHAIN_MODE.Unordered)
        const first = r.iterate(handoff, [], ctx).next()
        start.resolve(cause)
        assert.equal(await result, cause)
        await assert.rejects(first, error => error === cause)
        for (const index of [0, 1, 2]) r.repairPath(chain, [index], ctx)
        assert.deepEqual(r.export(chain, [], ctx), [, "B", "X"])
        assert.equal(r.getErrors(handoff, [], ctx), cause)
    })
    it("collects and skips a large sparse failed span without expanding its holes", async () => {
        const ctx = context(), count = Promise.withResolvers(), length = 2 ** 27
        const source = new r.Chain(new Array(length), ctx, r.CHAIN_MODE.Unordered)
        const result = r.run(source, [], "splice", [0, count.promise], ctx, mutation)
        const cause = r.validationError("cut", ctx, r.ERROR_KIND.InvalidArrayOperation)
        const exported = r.export(source, [], ctx), errors = r.getErrors(source, [], ctx)
        r.assignPath(source, [length - 1], "retained", ctx)
        count.resolve(cause)
        assert.equal(await result, cause)
        assert.equal(await errors, cause)
        assert.equal(await exported, cause)
        assert.equal(r.hasError(source, [], ctx), true)
        assert.equal(r.getErrors(source, [], ctx), cause)
        const skipped = []
        const cursor = r.iterate(source, [], ctx, { windowEnd: 1, onSkip(first, end, failure) {
            skipped.push([first, end, failure])
            cursor.setWindow(end, end + 1)
        } })
        const item = await cursor.next()
        assert.equal(item.index, length - 1)
        assert.equal(r.lookupPath(item.value, [], ctx), "retained")
        assert.deepEqual(skipped, [[0, length - 1, cause]])
        await assert.rejects(cursor.next(), error => error === cause)
    })
    for (const resize of [false, true]) for (const remove of [false, true])
        it(`supersedes a pending inherited slot without losing its old selection (${resize}, ${remove})`, async () => {
            const ctx = context(), count = Promise.withResolvers()
            const source = new r.Chain(["A", "B"], ctx, r.CHAIN_MODE.Sequential)
            const removed = r.run(source, [], "splice", [1, count.promise], ctx, mutation)
            const before = r.lookupPath(source, [1], ctx)
            if (resize) {
                r.assignPath(source, ["length"], 2, ctx)
                assert.equal(r.lookupPath(source, ["length"], ctx), 2)
            }
            if (remove) r.deletePath(source, [1], ctx)
            else r.assignPath(source, [1], "new", ctx)
            assert.equal(r.lookupPath(source, [1], ctx), remove ? undefined : "new")
            count.resolve(1)
            assert.equal(await before, undefined)
            assert.deepEqual(r.export(new r.Chain(await removed, ctx), [], ctx), ["B"])
            const expected = remove ? resize ? ["A", ,] : ["A"] : ["A", "new"]
            assert.deepEqual(r.export(source, [], ctx), expected)
        })
    for (const failed of [false, true]) it(`captures deep queries, searches and a later overwrite separately (${failed})`, async () => {
        const ctx = context(), count = Promise.withResolvers()
        const cause = r.validationError("bad cut", ctx, r.ERROR_KIND.InvalidArrayOperation)
        const source = new r.Chain(["A", "B", "C", "D"], ctx, r.CHAIN_MODE.Sequential)
        const result = r.run(source, [], "splice", [2, count.promise, "X"], ctx, mutation)
        const direct = r.lookupPath(source, [3], ctx)
        const exported = r.export(source, [], ctx)
        const any = r.hasError(source, [], ctx), errors = r.getErrors(source, [], ctx)
        const miss = r.run(source, [], "includes", ["Z"], ctx, {})
        const hit = r.run(source, [], "includes", ["D"], ctx, {})
        for (const dependency of [direct, exported, any, errors, miss, hit]) assert(r.isPending(dependency, ctx))
        assert.equal(r.isPoisoned(source, [], ctx), false)
        r.assignPath(source, [0], "later", ctx)
        assert.equal(r.lookupPath(source, [0], ctx), "later")
        count.resolve(failed ? cause : 1)
        await result
        assert.equal(await direct, failed ? cause : "D")
        assert.deepEqual(await exported, failed ? cause : ["A", "B", "X", "D"])
        assert.equal(await any, failed)
        assert.equal(await errors, failed ? cause : null)
        assert.equal(await miss, failed ? cause : false)
        assert.equal(await hit, failed ? cause : true)
    })
    for (const mode of [r.CHAIN_MODE.Complete, r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) {
        for (const delayed of [false, true]) it(`uses a failed concat part at its captured position (${mode}, deferred=${delayed})`, async () => {
            const ctx = context(), gate = Promise.withResolvers()
            const failure = r.validationError("part", ctx, r.ERROR_KIND.OperationInputFailed)
            const chain = new r.Chain(["A"], ctx, mode)
            const result = r.run(chain, [], "concat", [delayed ? gate.promise : failure, "Z"], ctx, {})
            if (mode === r.CHAIN_MODE.Complete) {
                assert.equal(r.isPending(result, ctx), delayed)
                gate.resolve(failure)
                assert.equal(await result, failure)
                return
            }
            assert(!r.isPending(result, ctx))
            const out = new r.Chain(result, ctx, mode)
            assert.equal(r.lookupPath(out, [0], ctx), "A")
            gate.resolve(failure)
            assert.equal(await r.lookupPath(out, ["length"], ctx), 3)
            assert.equal(await r.lookupPath(out, [1], ctx), failure)
            assert.equal(await r.lookupPath(out, [2], ctx), mode === r.CHAIN_MODE.Sequential ? failure : "Z")
            r.repairPath(out, [2], ctx)
            assert.equal(r.lookupPath(out, [2], ctx), "Z")
            assert.deepEqual(r.export(chain, [], ctx), ["A"])
        })
        for (const failed of [false, true]) it(`composes splice, push and reverse from both captured ends (${mode}, ${failed})`, async () => {
            const ctx = context(), count = Promise.withResolvers()
            const failure = r.validationError("deletion", ctx, r.ERROR_KIND.InvalidArrayOperation)
            const chain = new r.Chain(["A", "B"], ctx, mode)
            const cut = r.run(chain, [], "splice", [0, count.promise], ctx, mutation)
            const pushed = r.run(chain, [], "push", ["Z"], ctx, mutation)
            const last = r.run(chain, [], "at", [-1], ctx, {})
            const suffix = r.run(chain, [], "slice", [-1], ctx, {})
            const reverse = r.run(chain, [], "reverse", [], ctx, mutation)
            const first = r.lookupPath(chain, [0], ctx)
            const length = r.lookupPath(chain, ["length"], ctx)
            if (mode === r.CHAIN_MODE.Complete) assert(r.isPending(first, ctx))
            else {
                assert.equal(last, "Z")
                assert.deepEqual(r.export(new r.Chain(suffix, ctx), [], ctx), ["Z"])
                assert.equal(first, "Z")
            }
            assert(r.isPending(length, ctx))
            count.resolve(failed ? failure : 1)
            await cut
            await reverse
            if (failed && mode === r.CHAIN_MODE.Complete) {
                assert.equal(await first, failure)
                assert.equal(await pushed, failure)
                r.repairPath(chain, [], ctx)
                assert.deepEqual(r.export(chain, [], ctx), ["A", "B"])
            } else {
                assert.equal(await pushed, failed ? 3 : 2)
                assert.equal(await last, "Z")
                assert.equal(await first, "Z")
                assert.equal(await length, failed ? 3 : 2)
                if (failed) assert.equal(r.lookupPath(chain, [2], ctx), failure)
                else assert.deepEqual(r.export(chain, [], ctx), ["Z", "B"])
            }
        })
        it(`narrows a deferred receiver only after its Array target is selected (${mode})`, async () => {
            const ctx = context(), receiver = Promise.withResolvers(), comparator = Promise.withResolvers()
            const chain = new r.Chain({ a: receiver.promise, tag: 0 }, ctx, mode)
            const sorting = r.run(chain, ["a"], "sort", [comparator.promise], ctx, mutation)
            const pull = r.iterate(chain, ["a"], ctx).next()
            const rejection = pull.then(() => assert.fail("failed sort delivered an item"), error => error)
            r.assignPath(chain, ["tag"], 7, ctx)
            const tag = r.lookupPath(chain, ["tag"], ctx)
            assert(r.isPending(tag, ctx))
            receiver.resolve([2, 1])
            await new Promise(setImmediate)
            if (mode !== r.CHAIN_MODE.Complete) assert.equal(await tag, 7)
            comparator.resolve(42)
            const failure = await sorting
            assert.equal(await rejection, failure)
            if (mode === r.CHAIN_MODE.Complete) {
                assert.equal(await tag, failure)
                r.repairPath(chain, [], ctx)
                assert.equal(r.lookupPath(chain, ["tag"], ctx), 0)
            } else {
                r.repairPath(chain, ["a"], ctx)
                assert.deepEqual(r.export(chain, [], ctx), { a: [2, 1], tag: 7 })
            }
        })
        it(`orders a sibling write around a broad-scope sort failure in mode ${mode}`, async () => {
            const ctx = context(), comparator = Promise.withResolvers()
            const chain = new r.Chain({ a: [2, 1], tag: 0 }, ctx, mode)
            const result = r.run(chain, ["a"], "sort", [comparator.promise], ctx, mutation)
            const cursor = r.iterate(chain, ["a"], ctx)
            const first = cursor.next()
            r.assignPath(chain, ["a", 0], 9, ctx)
            r.assignPath(chain, ["tag"], 9, ctx)
            const tag = r.lookupPath(chain, ["tag"], ctx)
            if (mode === r.CHAIN_MODE.Complete) assert(r.isPending(tag, ctx))
            else assert.equal(tag, 9)
            comparator.resolve(42)
            const failure = await result
            await assert.rejects(first, error => error === failure)
            await r.repairPath(chain, [], ctx)
            assert.equal(r.lookupPath(chain, ["tag"], ctx), mode === r.CHAIN_MODE.Complete ? 0 : 9)
            if (mode !== r.CHAIN_MODE.Complete) {
                assert.equal(r.lookupPath(chain, ["a", 0], ctx), failure)
                r.repairPath(chain, ["a"], ctx)
            }
            assert.deepEqual(r.export(chain, ["a"], ctx), [2, 1])
        })
        for (const reject of [false, true]) for (const schedule of ["ready", "synchronous", "deferred"]) {
            it(`publishes the same receiver, removed result and occurrences (${mode}, ${schedule}, ${reject})`, async () => {
                const ctx = context(), control = Promise.withResolvers()
                const cause = r.validationError("delete count", ctx, r.ERROR_KIND.InvalidArrayOperation)
                const input = reject ? cause : 1
                const source = new r.Chain(["A", "B", "C", "D"], ctx, mode)
                const earlier = r.iterate(source, [], ctx)
                const result = r.run(source, [], "splice", [2, schedule === "ready" ? input :
                    schedule === "synchronous" ? ready(input) : control.promise, "X"], ctx, mutation)
                const cursor = r.iterate(source, [], ctx)
                const first = r.lookupPath(source, [0], ctx), length = r.lookupPath(source, ["length"], ctx)
                if (schedule === "deferred") {
                    assert(r.isPending(length, ctx))
                    if (mode === r.CHAIN_MODE.Complete) assert(r.isPending(first, ctx))
                    else {
                        assert.equal(first, "A")
                        assert.equal(r.lookupPath(source, [2], ctx), "X")
                        assert.equal(r.run(source, [], "includes", ["X"], ctx, {}), true)
                    }
                }
                control.resolve(input)
                const removed = await result
                if (reject) assert.equal(removed, cause)
                else assert.deepEqual(r.export(new r.Chain(removed, ctx), [], ctx), ["C"])
                const items = []
                try {
                    for await (const item of cursor) items.push(r.lookupPath(item, [], ctx))
                    assert.equal(reject, false)
                } catch (failure) { assert.equal(failure, cause) }
                if (reject && mode === r.CHAIN_MODE.Complete) {
                    assert.equal(await length, cause)
                    assert.deepEqual(items, [])
                    r.repairPath(source, [], ctx)
                    assert.deepEqual(r.export(source, [], ctx), ["A", "B", "C", "D"])
                } else {
                    assert.equal(await length, reject ? 5 : 4)
                    assert.deepEqual(items, reject ? ["A", "B", "X"] : ["A", "B", "X", "D"])
                    if (reject) {
                        assert.equal(r.lookupPath(source, [3], ctx), cause)
                        r.repairPath(source, [3], ctx)
                        assert.equal(r.lookupPath(source, [3], ctx), cause)
                        r.assignPath(source, [3], "R", ctx)
                        assert.equal(r.lookupPath(source, [3], ctx), "R")
                    }
                }
                const old = []
                for await (const item of earlier) old.push(r.lookupPath(item, [], ctx))
                assert.deepEqual(old, ["A", "B", "C", "D"])
            })
        }
    }
})
