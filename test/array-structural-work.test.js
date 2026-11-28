import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import * as r from "../src/index.js"
import { join, placementCounts, span } from "../src/array-layout.js"
import { fixed, valueSignal } from "../src/array-sequence.js"
import { readSequenceLayout, selectSequenceLayout } from "../src/array-sequence-layout.js"
import { ArrayView } from "../src/array-view.js"
import { requireMeta } from "../src/meta.js"
import { getParentPlacements } from "../src/parent-placements.js"
import { buildRefIndex } from "../src/refcounts.js"
import { OrderedThenable, ready, rejected } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const mutate = { mutationScopeDepth: 0 }

function measured(size, mode, data = Array.from({ length: size }, (_, i) => i)) {
    const ctx = { execution: new r.Execution(), errorContext: "Array work" }
    const count = { slots: 0, lists: 0 }
    const source = new r.Chain(new Proxy(data, {
        ownKeys(target) { count.lists++; return Reflect.ownKeys(target) },
        getOwnPropertyDescriptor(target, key) {
            if (key !== "length") count.slots++
            return Reflect.getOwnPropertyDescriptor(target, key)
        },
    }), ctx, mode)
    count.slots = count.lists = 0
    return { source, ctx, count }
}

describe("Array structural work", () => {
    it("publishes a deferred length through a resolved root and a later-selected key", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "selected length" }
        const key = Promise.withResolvers(), length = Promise.withResolvers()
        const array = new r.Chain(Promise.resolve(["A", "B"]), ctx)
        await r.lookupPath(array, [], ctx)
        const old = r.capturePath(array, [], ctx)
        const write = r.assignPath(array, [key.promise], length.promise, ctx)
        const capture = r.export(array, [], ctx)
        let delivered = false
        Promise.resolve(capture).then(() => { delivered = true })
        key.resolve("length")
        await new Promise(setImmediate)
        assert.equal(delivered, false)
        length.resolve(1)
        await write
        assert.deepEqual(await capture, ["A"])
        assert.deepEqual(await r.export(old, [], ctx), ["A", "B"])
    })
    it("counts the same placement reached through unequal layout branches", () => {
        const a = { present: true, value: "A" }, b = { present: true, value: "B" }
        const shared = join(span(1, a), span(1, b))
        const layout = join(shared, join(span(1, b), shared))
        assert.deepEqual(placementCounts(layout), new Map([[a, 2], [b, 3]]))
    })
    it("releases a requested point gate when its selection settles", async () => {
        const ctx = { execution: new r.Execution(() => {}), errorContext: "point count" }
        const cut = Promise.withResolvers(), source = new r.Chain(["A", "B"], ctx)
        const copy = new r.Chain(r.run(source, [], "toSpliced", [0, cut.promise], ctx, {}), ctx)
        const pending = r.lookupPath(copy, [0], ctx)
        const region = ArrayView.region(r.lookupPath(copy, [], ctx), ctx)
        verifyRefCounts(ctx, copy._state)
        assert(region.gates.size > 0)
        cut.resolve(1)
        assert.equal(await pending, "B")
        assert.equal(region.gates?.size ?? 0, 0)
        verifyRefCounts(ctx, copy._state)
    })

    it("releases data held only for a numeric shape and protects outstanding data captures", function () {
        this.timeout(30000)
        const result = execFileSync(process.execPath, [...process.execArgv, "--expose-gc", "--unhandled-rejections=strict",
            "test/fixtures/array-sequence-lifetimes.mjs"], { encoding: "utf8", timeout: 25000 })
        assert.match(result, /Array shape and data lifetimes verified/)
    })

    it("keeps each fixed child's parent and failure visible across width settlement", async () => {
        for (const indexed of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: "fixed children" }
            const width = Promise.withResolvers(), child = Promise.withResolvers(), rejected = Promise.withResolvers()
            const source = new r.Chain(["A", "B"], ctx)
            r.run(source, [], "splice", [1, width.promise], ctx, mutate)
            r.run(source, [], "unshift", [child.promise, rejected.promise], ctx, mutate)
            const snapshot = r.capturePath(source, [], ctx)
            const raw = r.lookupPath(snapshot, [], ctx), region = ArrayView.region(raw, ctx)
            const observed = indexed && r.hasError(snapshot, [], ctx)
            child.resolve({ n: 1 })
            rejected.reject(new Error("bad payload"))
            await new Promise(setImmediate)
            const item = r.lookupPath(snapshot, [0], ctx), error = r.lookupPath(snapshot, [1], ctx)
            assert(r.isPoisonError(error))
            assert(getParentPlacements(item, ctx).some(p => p.parent === raw && p.key === "0"))
            assert.equal(region.gates?.size ?? 0, 0)
            if (indexed) assert.equal(await observed, true)
            r.assignPath(source, [1], "fixed", ctx)
            width.resolve(1)
            assert.deepEqual(await r.export(source, [], ctx), [{ n: 1 }, "fixed", "A"])
            assert.equal(await r.lookupPath(snapshot, [1], ctx), error)
            assert.equal(r.hasError(source, [], ctx), false)
            verifyRefCounts(ctx, source._state, snapshot._state)
        }
    })

    it("reads shared rejected data through indexed, overridden and unreplaced point captures", async () => {
        for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) for (const requested of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: "shared rejected payload" }
            const width = Promise.withResolvers(), payload = Promise.withResolvers()
            const source = new r.Chain(["A", "B"], ctx, mode)
            r.run(source, [], "splice", [1, width.promise], ctx, mutate)
            r.run(source, [], "unshift", [payload.promise], ctx, mutate)
            const held = r.capturePath(source, [], ctx, mode)
            const has = r.hasError(held, [], ctx), all = r.getErrors(held, [], ctx)
            const point = requested ? r.lookupPath(held, [0], ctx) : undefined
            if (requested) assert(r.isPending(point, ctx))
            r.assignPath(source, [0], "replacement", ctx)
            const cause = r.validationError("payload", ctx, r.ERROR_KIND.OperationInputFailed)
            payload.reject(cause)
            assert.equal(await has, true)
            assert(r.isPending(all, ctx))
            if (requested) assert.equal(await point, cause)
            assert.equal(r.lookupPath(held, [0], ctx), cause)
            assert.equal(r.lookupPath(source, [0], ctx), "replacement")
            await r.repairPath(held, [0], ctx)
            assert.equal(r.lookupPath(held, [0], ctx), cause)
            verifyRefCounts(ctx, source._state, held._state)
            width.resolve(1)
            assert.equal(await all, cause)
            assert.deepEqual(await r.export(source, [], ctx), ["replacement", "A"])
            verifyRefCounts(ctx, source._state, held._state)
        }
    })

    it("indexes a rejected shared placement for every newly indexed backing owner", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "late shared Error index" }
        const width = Promise.withResolvers(), payload = Promise.withResolvers()
        const source = new r.Chain(["A", "B"], ctx)
        r.run(source, [], "splice", [1, width.promise], ctx, mutate)
        r.run(source, [], "unshift", [payload.promise], ctx, mutate)
        const held = r.capturePath(source, [], ctx)
        r.assignPath(source, [1], "replacement", ctx)
        const earlier = r.lookupPath(held, [], ctx), live = r.lookupPath(source, [], ctx)
        assert.notEqual(earlier, live)
        assert.equal(ArrayView.region(earlier, ctx), ArrayView.region(live, ctx))
        const cause = r.validationError("payload", ctx, r.ERROR_KIND.OperationInputFailed)
        payload.reject(cause)
        await new Promise(setImmediate)
        const pair = new r.Chain([earlier, live], ctx)
        buildRefIndex(r.lookupPath(pair, [], ctx), ctx)
        assert.equal(requireMeta(earlier, ctx).errorCount, 1)
        assert.equal(requireMeta(live, ctx).errorCount, 1)
        assert.equal(r.hasError(pair, [], ctx), true)
        const all = r.getErrors(pair, [], ctx)
        assert(r.isPending(all, ctx))
        verifyRefCounts(ctx, pair._state, source._state, held._state)
        width.resolve(1)
        assert.equal(await all, cause)
        verifyRefCounts(ctx, pair._state, source._state, held._state)
    })

    it("preserves a movable splice child through derived snapshots and later writes", async () => {
        for (const mode of [r.CHAIN_MODE.Unordered, r.CHAIN_MODE.Sequential])
            for (const method of ["toReversed", "with", "push"])
                for (const deferred of [false, true]) {
                    const ctx = { execution: new r.Execution(), errorContext: method }
                    const wrap = value => new r.Chain(value, ctx, mode)
                    const start = new OrderedThenable(), payload = new OrderedThenable()
                    const owner = wrap({ n: 0 }), source = wrap(["a", "b"])
                    r.assignPath(owner, ["n"], 1, ctx)
                    const child = () => r.lookupPath(owner, [], ctx)
                    r.run(source, [], "splice", [deferred ? start : 1, 0, deferred ? payload : child()], ctx, mutate)
                    const saved = method === "push" ? r.capturePath(source, [], ctx, mode) :
                        wrap(r.run(source, [], method, method === "with" ? [0, "x"] : [], ctx, {}))
                    if (method === "push") r.run(saved, [], method, ["x"], ctx, mutate)
                    r.assignPath(source, [], undefined, ctx)
                    if (deferred) payload.resolve(child())
                    // Finish the immediate handoff. Only the derived snapshot
                    // now protects the captured generation against this write.
                    await new Promise(setImmediate)
                    r.assignPath(owner, ["n"], 9, ctx)
                    if (deferred) start.resolve(1)
                    const expected = method === "push" ? ["a", { n: 1 }, "b", "x"] :
                        method === "with" ? ["x", { n: 1 }, "b"] : ["b", { n: 1 }, "a"]
                    assert.deepEqual(await r.export(saved, [], ctx), expected)
                    assert.equal(r.lookupPath(owner, ["n"], ctx), 9)
                    verifyRefCounts(ctx, owner._state, saved._state)
                }
    })

    it("retains a fixed concat child while an earlier part is pending", async () => {
        for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) {
            const ctx = { execution: new r.Execution(), errorContext: "fixed concat child" }
            const child = new r.Chain({ n: 0 }, ctx, mode)
            r.assignPath(child, ["n"], 1, ctx)
            const first = Promise.withResolvers()
            const source = new r.Chain([], ctx, mode)
            const copy = new r.Chain(r.run(source, [], "concat",
                [first.promise, [r.lookupPath(child, [], ctx)]], ctx, {}), ctx, mode)
            r.assignPath(child, ["n"], 9, ctx)
            assert.equal(r.lookupPath(child, ["n"], ctx), 9)
            first.resolve(["prefix"])
            assert.deepEqual(await r.export(copy, [], ctx), ["prefix", { n: 1 }])
            verifyRefCounts(ctx, copy._state, child._state)
        }
    })

    it("publishes a selected splice range while an earlier cut or an unused start stays pending", async () => {
        for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) {
            const ctx = { execution: new r.Execution(), errorContext: "independent cuts" }
            const wrap = value => new r.Chain(value, ctx, mode)
            const earlier = Promise.withResolvers(), at = Promise.withResolvers()
            const source = wrap(["a", "b", "c"])
            const first = wrap(r.run(source, [], "splice", [1, earlier.promise], ctx, mutate))
            const copy = wrap(r.run(source, [], "toSpliced", [at.promise, Infinity, "new"], ctx, {}))
            const output = r.export(copy, [], ctx)
            at.resolve(1)
            await new Promise(setImmediate)
            assert.deepEqual(await output, ["a", "new"])
            verifyRefCounts(ctx, source._state, copy._state)

            const unused = Promise.withResolvers(), count = Promise.withResolvers()
            const removed = wrap(r.run(source, [], "splice", [unused.promise, count.promise], ctx, mutate))
            count.resolve(undefined)
            await new Promise(setImmediate)
            assert.deepEqual(await r.export(removed, [], ctx), [])
            assert.equal(r.lookupPath(source, [0], ctx), "a")
            earlier.resolve(1)
            assert.deepEqual(await r.export(first, [], ctx), ["b"])
            assert.deepEqual(await r.export(source, [], ctx), ["a", "c"])
            unused.reject(new Error("unused start"))
            await new Promise(setImmediate)
            assert.deepEqual(await r.export(source, [], ctx), ["a", "c"])
        }
    })

    it("keeps a probed index outside the shortened splice copy absent from an earlier export", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "shortened splice copy" }
        const wrap = value => new r.Chain(value, ctx, r.CHAIN_MODE.Unordered)
        const source = wrap(["A", "B", "C"])
        const width = Promise.withResolvers(), start = Promise.withResolvers(), count = Promise.withResolvers()
        r.run(source, [], "splice", [1, width.promise], ctx, mutate)
        const out = wrap(r.run(source, [], "toSpliced", [start.promise, count.promise, "X"], ctx, {}))
        const probe = r.lookupPath(out, [3], ctx), early = r.export(out, [], ctx)
        count.resolve(1)
        await new Promise(setImmediate)
        width.resolve(2)
        await new Promise(setImmediate)
        start.resolve(-1)
        assert.equal(await probe, undefined)
        assert.deepEqual(await early, ["X"])
        assert.deepEqual(await r.export(out, [], ctx), ["X"])
    })

    it("finishes a selected layout already assembled by a re-entered reader", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "selected layout" }
        const at = Promise.withResolvers(), choice = valueSignal(at.promise, ctx)
        const selected = fixed(span(1, { value: "kept", present: true })), output = {}
        const current = selectSequenceLayout(output, selected.operands, choice, () => selected, ctx)
        const early = choice.pending.then(() => {
            assert.equal(current(), selected)
            assert.equal(readSequenceLayout(output.layoutSource, true), selected.node)
        })
        const layout = output.ready
        at.resolve(0)
        await early
        assert.equal(await layout, selected.node)
        assert.equal(ctx.execution.fatalError, null)
    })

    it("shares fixed ranges and releases superseded publication destinations", function () {
        this.timeout(30000)
        const args = [...process.execArgv, "--expose-gc", "--unhandled-rejections=strict", "test/fixtures/array-region-memory.mjs"]
        const options = { encoding: "utf8", timeout: 25000, stdio: "pipe" }
        assert.throws(() => execFileSync(process.execPath, [...args, "16", "--without-counters"], options),
            error => error.status === 1 && error.stderr.includes("Array region memory counters"))
        assert.match(execFileSync(process.execPath, args, options), /Shared Array ranges and retired destinations verified/)
    })

    it("bounds copied producers, leases and notifications through mixed Array histories", function () {
        this.timeout(30000)
        const result = execFileSync(process.execPath, [...process.execArgv, "--expose-gc", "--unhandled-rejections=strict",
            "test/fixtures/array-history-depth.mjs"], { encoding: "utf8", timeout: 25000 })
        assert.match(result, /Array history depth and work verified/)
    })
    it("publishes managed parents through copied ranges while another payload stays pending", async () => {
        for (const mode of Object.values(r.CHAIN_MODE)) {
            const ctx = { execution: new r.Execution(), errorContext: "copied producer" }
            const wrap = value => new r.Chain(value, ctx, mode)
            const a = Promise.withResolvers(), b = Promise.withResolvers()
            const child = { n: 1 }, original = wrap(["x", a.promise])
            const copy = wrap(r.run(original, [], "toSpliced", [1, 0, b.promise], ctx, {}))
            const reverse = wrap(r.run(copy, [], "toReversed", [], ctx, {}))
            const query = r.getErrors(reverse, [], ctx), exported = r.export(copy, [], ctx)
            b.resolve(child)
            await new Promise(setImmediate)
            const owners = getParentPlacements(child, ctx)
            for (const holder of [copy, reverse])
                assert(owners.some(({ parent, key }) => parent === r.lookupPath(holder, [], ctx) && key === "1"))
            assert.equal(r.lookupPath(reverse, [1, "n"], ctx), 1)
            verifyRefCounts(ctx, reverse._state)
            r.assignPath(reverse, [1, "n"], 2, ctx)
            assert.equal(r.lookupPath(reverse, [1, "n"], ctx), 2)
            assert.equal(r.lookupPath(copy, [1, "n"], ctx), 1)
            assert(r.isPending(r.lookupPath(copy, [2], ctx), ctx))
            a.resolve("end")
            assert.equal(await query, null)
            assert.deepEqual(await exported, ["x", { n: 1 }, "end"])
            assert.deepEqual(await r.export(reverse, [], ctx), ["end", { n: 2 }, "x"])
            verifyRefCounts(ctx, reverse._state, copy._state)
        }
    })

    it("publishes prefix aliases and failure to an indexed snapshot independently of the width and remaining data", async () => {
        for (const mode of Object.values(r.CHAIN_MODE)) for (const widthFirst of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: "fixed prefix" }
            const source = new r.Chain(["A", , "C"], ctx, mode), cut = Promise.withResolvers()
            const slow = Promise.withResolvers(), incoming = new OrderedThenable(), failed = Promise.withResolvers()
            const child = { n: 1 }, cause = r.validationError("bad input", ctx, r.ERROR_KIND.OperationInputFailed)
            child.self = child
            r.run(source, [], "splice", [1, cut.promise], ctx, mutate)
            r.run(source, [], "unshift", [slow.promise, incoming, failed.promise, ready(child)], ctx, mutate)
            const held = r.capturePath(source, [], ctx, mode)
            const has = r.hasError(held, [], ctx), all = r.getErrors(held, [], ctx)
            if (widthFirst) { cut.resolve(1); await new Promise(setImmediate) }
            incoming.resolve(child)
            failed.reject(cause)
            await new Promise(setImmediate)
            function checkParents() {
                const raw = r.lookupPath(held, [], ctx)
                const keys = getParentPlacements(child, ctx).filter(p => p.parent === raw).map(p => p.key).sort()
                assert.deepEqual(keys, ["1", "3"])
                assert.equal(r.hasError(held, [], ctx), true)
                verifyRefCounts(ctx, held._state, source._state)
            }
            if (widthFirst || mode !== r.CHAIN_MODE.Complete) checkParents()
            if (!widthFirst) { cut.resolve(1); await new Promise(setImmediate) }
            checkParents()
            assert.equal(await has, true)
            assert.equal(r.lookupPath(held, [2], ctx), cause)
            assert(r.isPending(r.lookupPath(held, [0], ctx), ctx))
            r.deletePath(source, [2], ctx)
            r.assignPath(source, [1, "n"], 9, ctx)
            assert.equal(r.lookupPath(held, [1, "self", "n"], ctx), 1)
            assert.equal(r.lookupPath(source, [1, "n"], ctx), 9)
            slow.resolve("ok")
            assert.equal(await all, cause)
            assert.equal(await r.getErrors(source, [], ctx), null)
            const output = await r.export(source, [], ctx)
            assert.equal(output.length, 6)
            assert.equal(2 in output, false)
            assert.equal(output[3].self, output[3])
            assert.deepEqual(output.slice(4), ["A", "C"])
            verifyRefCounts(ctx, held._state, source._state)
        }
    })

    it("keeps exact primitive values, holes and own undefined in successive snapshots", async () => {
        for (const widthFirst of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: "fixed primitive histories" }
            const source = new r.Chain(["A", , "C"], ctx), width = Promise.withResolvers()
            const values = [-0, NaN, 1n << 100n, Symbol("slot"), undefined, false, "", null]
            const inputs = values.map(() => Promise.withResolvers()), snapshots = []
            r.run(source, [], "splice", [2, width.promise], ctx, mutate)
            for (const input of inputs) {
                r.run(source, [], "push", [input.promise], ctx, mutate)
                snapshots.push(r.capturePath(source, [], ctx))
            }
            const deliver = () => { for (let i = values.length - 1; i >= 0; i--) inputs[i].resolve(values[i]) }
            if (widthFirst) width.resolve(1)
            else deliver()
            await new Promise(setImmediate)
            if (widthFirst) deliver()
            else width.resolve(1)
            for (const [i, held] of snapshots.entries()) {
                const out = await r.export(held, [], ctx)
                assert.deepEqual(out, ["A", , ...values.slice(0, i + 1)])
            }
        }
    })

    it("repairs a copied flag while its underlying value and an independent sibling are pending", async () => {
        for (const mode of Object.values(r.CHAIN_MODE)) for (const prepend of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: "copied flag" }
            const data = Promise.withResolvers(), slow = Promise.withResolvers(), cut = Promise.withResolvers()
            const source = new r.Chain([data.promise, "last"], ctx, mode)
            const error = r.validationError("flag", ctx, r.ERROR_KIND.OperationInputFailed)
            r.poisonPath(source, [0], error, ctx)
            let output = source
            if (prepend) {
                r.run(source, [], "splice", [1, cut.promise], ctx, mutate)
                r.run(source, [], "unshift", [slow.promise], ctx, mutate)
            } else output = new r.Chain(r.run(source, [], "toSpliced", [1, 0, slow.promise], ctx, {}), ctx, mode)
            cut.resolve(0)
            await new Promise(setImmediate)
            const key = prepend ? 1 : 0
            assert.equal(r.lookupPath(output, [key], ctx), error)
            assert.equal(r.hasError(output, [], ctx), true)
            const repaired = r.repairPath(output, [key], ctx), read = r.lookupPath(output, [key, "n"], ctx)
            assert(r.isPending(read, ctx))
            data.resolve({ n: 7 })
            await repaired
            assert.equal(await read, 7)
            if (!prepend) assert.equal(r.lookupPath(source, [0], ctx), error)
            slow.resolve("end")
            assert.equal(await r.hasError(output, [], ctx), false)
            verifyRefCounts(ctx, source._state, output._state)
        }
    })

    it("restores a retired copy before or after its captured cut and payloads settle", async () => {
        for (const delayedCut of [false, true]) for (const complete of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: "fixed copy re-entry" }
            const first = Promise.withResolvers(), last = Promise.withResolvers(), child = { n: 1 }
            const cut = Promise.withResolvers(), source = new r.Chain([first.promise, "old"], ctx)
            const chain = new r.Chain(r.run(source, [], "toSpliced", [delayedCut ? cut.promise : 1, 1, last.promise], ctx, {}), ctx)
            const raw = r.lookupPath(chain, [], ctx)
            r.assignPath(chain, [], 0, ctx)
            cut.resolve(1)
            await new Promise(setImmediate)
            first.resolve(child)
            if (complete) last.resolve("end")
            await new Promise(setImmediate)
            const parents = () => getParentPlacements(child, ctx).filter(({ parent }) => parent === raw)
            assert.deepEqual(parents(), [])
            const restored = new r.Chain(raw, ctx)
            assert.deepEqual(parents().map(({ key }) => key), ["0"])
            assert.equal(r.lookupPath(restored, [0, "n"], ctx), 1)
            if (!complete) {
                assert(r.isPending(r.lookupPath(restored, [1], ctx), ctx))
                last.resolve("end")
            }
            assert.deepEqual(await r.export(restored, [], ctx), [{ n: 1 }, "end"])
        }
    })

    it("keeps earlier concat widths and indexed growth independent of later parts", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "prefix widths" }
        const parts = Array.from({ length: 9 }, () => Promise.withResolvers()), snapshots = []
        let array = new r.Chain(["A"], ctx)
        for (const part of parts) {
            array = new r.Chain(r.run(array, [], "concat", [part.promise], ctx, {}), ctx)
            snapshots.push(array)
        }
        const length = source => r.lookupPath(source, ["length"], ctx)
        const first = length(snapshots[0]), middle = length(snapshots[3]), final = length(array)
        const saved = r.capturePath(array, [], ctx)
        r.assignPath(array, [14], "grown", ctx)
        for (const i of [7, 3, 1, 2]) parts[i].resolve([i])
        await new Promise(setImmediate)
        assert(r.isPending(first, ctx))
        parts[0].resolve([])
        assert.equal(await first, 1)
        assert.equal(await middle, 4)
        assert.equal(r.lookupPath(snapshots[3], [3], ctx), 3)
        for (const i of [8, 6, 5, 4]) parts[i].resolve(i % 2 ? [] : [i])
        assert.equal(await final, 8)
        assert.equal(await length(array), 15)
        assert.equal(await length(saved), 8)
        assert.equal(r.lookupPath(array, [14], ctx), "grown")
        assert.equal(r.lookupPath(saved, [14], ctx), undefined)
    })
    it("bounds live reader work and releases completed readers behind a held control", function () {
        this.timeout(20000)
        const result = execFileSync(process.execPath, [...process.execArgv, "--expose-gc", "--unhandled-rejections=strict",
            "test/fixtures/array-pending-history.mjs"], { encoding: "utf8", timeout: 15000 })
        assert.match(result, /pending Array reader work and release verified/)
    })
    it("searches both ends of a deep history of unresolved insertions", function () {
        this.timeout(12000)
        const ctx = { execution: new r.Execution(), errorContext: "insertion history" }, cut = new Promise(() => {})
        const wrap = value => new r.Chain(value, ctx)
        let source = wrap(r.run(wrap(["A", "B"]), [], "toSpliced", [1, cut], ctx, {}))
        for (let i = 0; i < 2500; i++)
            source = wrap(r.run(source, [], "toSpliced", [cut, 0, i], ctx, {}))
        assert.equal(r.run(source, [], "includes", ["A"], ctx, {}), true)
        assert.equal(r.run(source, [], "includes", [2499], ctx, {}), true)
    })
    it("keeps issued ranks and independent endpoint proofs after insertion cursors close", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "insertion coordinates" }
        for (const order of [[2, 0, 1], [0, 1, 2], [1, 2, 0]]) {
            const source = new r.Chain(["A", "a"], ctx), native = ["A", "a"]
            const starts = [1, 0, 3], groups = [["B", "b"], ["C", "c"], ["D", "d"]]
            const controls = groups.map(() => Promise.withResolvers())
            for (const [i, values] of groups.entries()) {
                r.run(source, [], "splice", [controls[i].promise, 0, ...values], ctx, mutate)
                native.splice(starts[i], 0, ...values)
            }
            const fields = ["index0", "index", "first", "last", "revindex0", "revindex", "length"]
            const cursor = r.iterate(source, [], ctx, { metadata: fields }), steps = new Map()
            for (let i = 0; i < native.length; i++) {
                const item = await cursor.next()
                steps.set(r.lookupPath(item.value, [], ctx), item)
            }
            assert.equal(steps.size, native.length)
            await cursor.return()
            const window = r.iterate(source, [], ctx, { windowEnd: 1 }), pull = window.next()
            const match = r.run(source, [], "includes", ["D", 4], ctx, {})
            for (const i of order) {
                controls[i].resolve(starts[i])
                await new Promise(setImmediate)
                if (i === 2) {
                    for (const [offset, value] of groups[2].entries())
                        assert.equal(await Promise.race([steps.get(value).index, Promise.resolve("pending")]), 3 + offset)
                }
                if (i === 1) assert.equal(await Promise.race([steps.get("A").metadata.first, Promise.resolve("pending")]), false)
            }
            assert.equal(await match, false)
            assert.equal(r.lookupPath((await pull).value, [], ctx), native[0])
            await window.return()
            for (const [i, value] of native.entries()) {
                const step = steps.get(value), after = native.length - 1 - i
                assert.equal(await step.index, i)
                assert.deepEqual(await Promise.all(fields.map(name => step.metadata[name])),
                    [i, i + 1, i === 0, after === 0, after, after + 1, native.length])
            }
            assert.deepEqual(await r.export(source, [], ctx), native)
        }
    })
    it("settles insertion coordinates from either edge of an open predecessor", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "open insertion coordinates" }
        const source = new r.Chain(["A", "B", "C"], ctx)
        const count = Promise.withResolvers(), left = Promise.withResolvers(), right = Promise.withResolvers()
        for (const args of [[1, count.promise], [left.promise, 0, "X"], [right.promise, 0, "Y"]])
            r.run(source, [], "splice", args, ctx, mutate)
        const window = r.iterate(source, [], ctx, { windowEnd: 1 }), first = window.next()
        const cursor = r.iterate(source, [], ctx, { metadata: ["index0", "revindex0", "first", "last"] }), steps = new Map()
        for (let i = 0; i < 3; i++) {
            const step = await cursor.next()
            steps.set(r.lookupPath(step.value, [], ctx), step)
        }
        await cursor.return()
        right.resolve(-1)
        await new Promise(setImmediate)
        const y = steps.get("Y"), x = steps.get("X")
        const seen = value => Promise.race([value, Promise.resolve("pending")])
        assert.equal(await seen(y.metadata.revindex0), 1)
        assert.equal(await seen(y.index), "pending")
        left.resolve(0)
        await new Promise(setImmediate)
        assert.equal(await seen(x.index), 0)
        assert.equal(await seen(x.metadata.first), true)
        assert.equal(r.lookupPath((await first).value, [], ctx), "X")
        await window.return()
        count.resolve(1)
        assert.equal(await y.index, 2)
        assert.deepEqual(await r.export(source, [], ctx), ["X", "A", "Y", "C"])
    })
    it("settles a range-filtered match while its exact rank still depends on a later cut", async () => {
        for (const start of [0, 1, 2]) {
            const ctx = { execution: new r.Execution(), errorContext: "fromIndex" }
            const source = new r.Chain(["A", "B"], ctx), first = Promise.withResolvers(), last = Promise.withResolvers()
            for (const [cut, value] of [[first, "X"], [last, "Y"]])
                r.run(source, [], "splice", [cut.promise, 0, value], ctx, mutate)
            const matches = [1, 2, 3].map(bound => r.run(source, [], "includes", ["X", bound], ctx, {}))
            first.resolve(start)
            await new Promise(setImmediate)
            for (const [i, answer] of matches.entries())
                assert.equal(await Promise.race([answer, Promise.resolve("pending")]),
                    start >= i + 1 ? true : start + 1 < i + 1 ? false : "pending")
            last.resolve(0)
            assert.deepEqual(await Promise.all(matches), [1, 2, 3].map(bound => start + 1 >= bound))
        }
    })
    it("wakes earlier readers as an open crop exposes each guaranteed end occurrence", async () => {
        for (const front of [true, false]) {
            const ctx = { execution: new r.Execution(), errorContext: "progressive crop" }, hold = Promise.withResolvers()
            const wrap = value => new r.Chain(value, ctx), open = wrap([]), abc = ["A", "B", "C"]
            const call = (chain, method, args) => r.run(chain, [], method, args, ctx, {})
            let inside
            const entry = r.enter(open, [], ctx, { maximumCount: 3, mayPoisonScope: false }, inner => {
                inside = inner
                return hold.promise
            })
            const combined = front ? wrap(call(open, "concat", [abc])) :
                wrap(call(wrap(abc), "concat", [r.lookupPath(open, [], ctx)]))
            const cropped = wrap(call(combined, "slice", front ? [3] : [0, -3]))
            const end = front ? "C" : "A", last = call(cropped, "at", [front ? -1 : 0])
            const firstMatch = call(cropped, "includes", [end]), secondMatch = call(cropped, "includes", ["B"])
            const cursor = r.iterate(cropped, [], ctx), first = cursor.next()
            const seen = value => Promise.race([value, Promise.resolve("pending")])
            r.run(inside, [], "push", [1], ctx, mutate)
            await new Promise(setImmediate)
            assert.equal(await seen(firstMatch), true)
            assert.equal(await seen(secondMatch), "pending")
            assert.equal(await seen(last), end)
            const item = await seen(first)
            assert.equal(r.lookupPath(item.value, [], ctx), end)
            const second = cursor.next()
            r.run(inside, [], "push", [2], ctx, mutate)
            await new Promise(setImmediate)
            assert.equal(await seen(secondMatch), true)
            const next = await seen(second)
            assert.equal(r.lookupPath(next.value, [], ctx), "B")
            hold.resolve()
            await entry
            assert.equal(await item.index, front ? 1 : 0)
            assert.equal(await next.index, front ? 0 : 1)
            assert((await cursor.next()).done)
            assert.deepEqual(await r.export(cropped, [], ctx), front ? ["B", "C"] : ["A", "B"])
        }
    })
    it("combines an open prefix and independent insertion cuts for bounded search", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "joined insertion positions" }, hold = Promise.withResolvers()
        const wrap = value => new r.Chain(value, ctx), prefix = wrap([]), part = wrap(["A", "B"])
        let inside
        const entry = r.enter(prefix, [], ctx, { maximumCount: 3, mayPoisonScope: false }, inner => {
            inside = inner
            return hold.promise
        })
        const first = Promise.withResolvers(), last = Promise.withResolvers()
        for (const [cut, value] of [[first, "X"], [last, "Y"]])
            r.run(part, [], "splice", [cut.promise, 0, value], ctx, mutate)
        const joined = wrap(r.run(prefix, [], "concat", [r.lookupPath(part, [], ctx)], ctx, {}))
        const answers = [1, 3].map(i => r.run(joined, [], "includes", ["X", i], ctx, {}))
        const one = wrap(["A", "B"]), singleCut = Promise.withResolvers()
        r.run(one, [], "splice", [singleCut.promise, 0, "X"], ctx, mutate)
        const single = wrap(r.run(prefix, [], "concat", [r.lookupPath(one, [], ctx)], ctx, {}))
        const singleMatch = r.run(single, [], "includes", ["X", 2], ctx, {})
        const seen = value => Promise.race([value, Promise.resolve("pending")])
        first.resolve(1)
        await new Promise(setImmediate)
        assert.equal(await seen(answers[0]), true)
        assert.equal(await seen(answers[1]), "pending")
        r.run(inside, [], "push", ["P", "Q"], ctx, mutate)
        await new Promise(setImmediate)
        assert.equal(await seen(answers[1]), true)
        assert.equal(await seen(singleMatch), true)
        hold.resolve(); last.resolve(0); singleCut.resolve(0)
        await entry
        assert.deepEqual(await r.export(joined, [], ctx), ["P", "Q", "Y", "A", "X", "B"])
    })
    for (const method of ["shift", "pop"]) it(`shares pending survivors across repeated ${method} cuts`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: method }
        const inputs = Array.from({ length: 192 }, () => Promise.withResolvers())
        const chain = new r.Chain(inputs.map(input => input.promise), ctx)
        const removed = []
        for (let i = 0; i < 20; i++) removed.push(r.run(chain, [], method, [], ctx, mutate))
        const snapshot = r.capturePath(chain, [], ctx)
        const captured = r.lookupPath(snapshot, [], ctx)
        for (let i = 20; i < 48; i++) removed.push(r.run(chain, [], method, [], ctx, mutate))
        const cut = r.lookupPath(chain, [], ctx)
        const survivor = ArrayView.backingVersion(cut, "0", ctx)
        assert(survivor)
        assert.equal(survivor, ArrayView.backingVersion(captured, method === "shift" ? "28" : "0", ctx))
        const retained = r.lookupPath(chain, [0], ctx)
        r.assignPath(chain, [0], "later", ctx)
        const values = inputs.map((_, i) => i)
        for (let i = inputs.length - 1; i >= 0; i--) inputs[i].resolve(i)
        const ordered = method === "shift" ? values : values.toReversed()
        assert.deepEqual(await Promise.all(removed), ordered.slice(0, 48))
        assert.equal(await retained, method === "shift" ? 48 : 0)
        assert.deepEqual(await r.export(snapshot, [], ctx), method === "shift" ? values.slice(20) : values.slice(0, -20))
        assert.equal(await r.lookupPath(chain, [0], ctx), "later")
    })

    for (const mode of Object.values(r.CHAIN_MODE))
        it(`clips a captured range to the delivered length in mode ${mode}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "trim" }
            const wrap = value => new r.Chain(value, ctx, mode)
            const cause = r.validationError("excluded", ctx, r.ERROR_KIND.OperationInputFailed)
            for (const value of [7, cause]) for (const timing of ["ready", "sync", "deferred"]) {
                const hold = Promise.withResolvers(), tail = [value]
                const input = timing === "ready" ? tail : timing === "sync" ? ready(tail) : hold.promise
                const source = wrap(r.run(wrap([]), [], "concat", [input], ctx, {}))
                const cut = wrap(r.run(source, [], "slice", [3], ctx, {}))
                const early = r.export(cut, [], ctx), errors = r.hasError(cut, [], ctx)
                let calls = 0
                const sorted = wrap(r.run(cut, [], "toSorted", [() => { calls++; return 0 }], ctx, {}))
                r.run(source, [], "splice", [0, 3], ctx, mutate)
                const remaining = r.export(source, [], ctx)
                hold.resolve(tail)
                assert.deepEqual(await early, [])
                assert.equal(await errors, false)
                assert.deepEqual(await r.export(sorted, [], ctx), [])
                assert.equal(calls, 0)
                assert.deepEqual(await remaining, [])
                assert.deepEqual(await r.export(cut, [], ctx), [])
            }
        })

    it("reads each consumed slot at most once for at and join", () => {
        for (const mode of Object.values(r.CHAIN_MODE)) {
            const { source, ctx, count } = measured(4, mode)
            assert.equal(r.run(source, [], "at", [2], ctx, {}), 2)
            assert(count.slots <= 1)
            count.slots = 0
            assert.equal(r.run(source, [], "join", [], ctx, {}), "0,1,2,3")
            assert(count.slots <= 4)
        }
    })

    it("opens a push-only entry without recapturing its dense prefix", async () => {
        for (const mode of Object.values(r.CHAIN_MODE)) {
            const { source, ctx, count } = measured(4096, mode), close = Promise.withResolvers()
            const entry = r.enter(source, [], ctx, { mayPoisonScope: false, maximumCount: 1 }, () => close.promise)
            assert(count.slots < 10)
            assert.equal(r.lookupPath(source, [4000], ctx), 4000)
            close.resolve()
            await entry
            assert.equal(r.lookupPath(source, ["length"], ctx), 4096)
        }
    })

    it("searches the stored keys of a sparse prefix and resumes at its open suffix", async () => {
        const size = 4096
        for (const mode of Object.values(r.CHAIN_MODE)) for (const entry of [true, false]) {
            if (!entry && mode === r.CHAIN_MODE.Complete) continue
            const data = new Array(size), tail = Promise.withResolvers()
            data[1] = "first"
            data[size - 2] = "last"
            const { source, ctx, count } = measured(size, mode, data)
            let inside, opened, output = source
            if (entry) opened = r.enter(source, [], ctx, { mayPoisonScope: false, maximumCount: 1 }, ref => {
                inside = ref
                return tail.promise
            })
            else output = new r.Chain(r.run(source, [], "concat", [tail.promise], ctx, {}), ctx, mode)
            count.slots = 0
            const search = (method, ...args) => r.run(output, [], method, args, ctx, {})
            assert.equal(search("indexOf", "last"), size - 2)
            assert.equal(search("lastIndexOf", "first", size - 1), 1)
            assert.equal(search("includes", "last"), true)
            assert.equal(search("includes", undefined), true)
            const found = search("indexOf", "tail")
            assert(r.isPending(found, ctx))
            assert(count.slots < 30, `read ${count.slots} slots for two stored keys`)
            if (entry) r.run(inside, [], "push", ["tail"], ctx, mutate)
            tail.resolve(entry ? undefined : ["tail"])
            await opened
            assert.equal(await found, size)
        }
    })

    it("limits concat position failures to the call that lost an argument", async () => {
        for (const inputMode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
            for (const timing of ["ready", "synchronous", "deferred"]) {
                const ctx = { execution: new r.Execution(), errorContext: "concat handoff" }, tail = Promise.withResolvers()
                const chain = (value, mode = r.CHAIN_MODE.Sequential) => new r.Chain(value, ctx, mode)
                const concat = (source, ...args) => r.run(source, [], "concat", args, ctx, {})
                const failure = message => r.validationError(message, ctx, r.ERROR_KIND.OperationInputFailed)
                const innerFailure = failure("inner"), outerFailure = failure("outer")
                const input = timing === "ready" ? innerFailure : timing === "synchronous" ? rejected(innerFailure) : tail.promise
                const inner = concat(chain(["A"], inputMode), input, ["B"])
                const complete = concat(chain([], r.CHAIN_MODE.Complete), inner)
                const outputs = [concat(chain(inner), ["C"]), concat(chain([]), inner, ["C"]), concat(chain(complete), ["C"])]
                const later = chain(concat(chain([]), inner, outerFailure, ["D"]))
                const reads = outputs.map(value => {
                    const output = chain(value)
                    return Promise.all([1, 2, 3].map(index => r.lookupPath(output, [index], ctx)))
                })
                if (timing === "deferred") tail.reject(innerFailure)
                for (const [marker, previous, appended] of await Promise.all(reads)) {
                    assert.equal(marker, innerFailure)
                    assert.equal(previous, inputMode === r.CHAIN_MODE.Sequential ? innerFailure : "B")
                    assert.equal(appended, "C")
                }
                assert.equal(await r.lookupPath(later, [4], ctx), outerFailure)
                r.repairPath(later, [4], ctx)
                assert.equal(await r.lookupPath(later, [4], ctx), "D")
            }
    })

    for (const [name, mode] of Object.entries(r.CHAIN_MODE)) {
        it(`uses logical presence when reversing a dense backing with masked slots in ${name}`, () => {
            const ctx = { execution: new r.Execution(), errorContext: name }
            const wrap = value => new r.Chain(value, ctx, mode)
            const input = [0, 1, 2, 3]
            input.length = 7
            const source = wrap(input.slice())
            for (const count of [2, 3]) {
                const masked = r.run(source, [], "copyWithin", [0, 4, 4 + count], ctx, {})
                const receiver = wrap(masked), prior = wrap([masked])
                const expected = input.slice().copyWithin(0, 4, 4 + count)
                const reversed = r.run(receiver, [], "reverse", [], ctx, mutate)
                // With three holes copied, only the unpaired center remains.
                assert.equal(r.run(prior, [], "includes", [reversed], ctx, {}), count === 3)
                assert.deepEqual(r.export(prior, [0], ctx), expected)
                assert.deepEqual(r.export(receiver, [], ctx), expected.reverse())
            }
            assert.deepEqual(r.export(source, [], ctx), input)
        })

        it(`copies dense physical ranges with holes, pending values and shared children in ${name}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: name }, pending = Promise.withResolvers()
            const wrap = value => new r.Chain(value, ctx, mode)
            const child = { n: 1 }, values = Array.from({ length: 32 }, (_, i) => i)
            delete values[4]
            values[1] = pending.promise
            values[5] = values[6] = child
            const model = values.slice()
            model[1] = "delivered"
            const source = wrap(r.import(values, ctx)), earlier = wrap(r.lookupPath(source, [], ctx))
            const replaced = wrap(r.run(source, [], "with", [-1, 9], ctx, {}))
            const reversed = wrap(r.run(source, [], "toReversed", [], ctx, {}))
            const removed = wrap(r.run(source, [], "splice", [1, 5, 8], ctx, mutate))
            const expected = model.slice(), cut = expected.splice(1, 5, 8)
            const captured = r.export(source, [], ctx)
            r.assignPath(source, [2, "n"], 7, ctx)
            pending.resolve("delivered")
            assert.deepEqual(await captured, expected)
            assert.deepEqual(await r.export(earlier, [], ctx), model)
            assert.deepEqual(await r.export(removed, [], ctx), cut)
            assert.deepEqual(await r.export(replaced, [], ctx), model.with(-1, 9))
            const result = await r.export(reversed, [], ctx)
            assert.deepEqual(result, model.toReversed())
            assert.equal(result[25], result[26])
            assert.equal(r.lookupPath(source, [2, "n"], ctx), 7)
            verifyRefCounts(ctx, ...[source, earlier, removed, replaced, reversed].map(c => c._state))
        })

        it(`captures a failed dense splice in source order before publication in ${name}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: name }
            for (const failListing of [false, true]) {
                const first = new Error("first"), second = new Error("cut")
                let armed = false
                const raw = Array.from({ length: 24 }, (_, i) => i)
                const source = new r.Chain(r.import(new Proxy(raw, {
                    ownKeys(target) {
                        if (armed && failListing) throw first
                        return Reflect.ownKeys(target)
                    },
                    getOwnPropertyDescriptor(target, key) {
                        if (armed && key === "2") throw first
                        if (armed && key === "9") throw second
                        return Reflect.getOwnPropertyDescriptor(target, key)
                    },
                }), ctx), ctx, mode)
                armed = true
                const failure = await r.run(source, [], "splice", [8, 8], ctx, mutate)
                armed = false
                assert.equal(failure.cause, first)
                assert.equal(r.lookupPath(source, [], ctx), failure)
                r.repairPath(source, [], ctx)
                assert.deepEqual(r.export(source, [], ctx), raw)
            }
        })

        it(`preserves the first required backing inspection failure on a dense slice in ${name}`, () => {
            const ctx = { execution: new r.Execution(), errorContext: name }, cause = new Error("backing length")
            let armed = false, reads = 0
            const source = new r.Chain(new Proxy(Array.from({ length: 24 }, (_, i) => i), {
                get(target, key, receiver) {
                    if (armed && key === "length" && ++reads === 1) throw cause
                    return Reflect.get(target, key, receiver)
                },
            }), ctx, mode)
            const slice = new r.Chain(r.run(source, [], "slice", [2, 18], ctx, {}), ctx, mode)
            armed = true
            const failure = r.run(slice, [], "toReversed", [], ctx, {})
            assert.equal(failure.cause, cause)
            assert.equal(reads, 1)
            assert.equal(r.lookupPath(slice, [0], ctx), 2)
        })

        it(`skips discarded concat slots and recovers required read failures in ${name}`, async () => {
            for (const timing of ["ready", "synchronous", "deferred"]) for (const [method, args, slot, expected] of [
                ["with", [0, 9], 0, [9, 20, 30, 40]],
                ["slice", [1], 0, [20, 30, 40]],
                ["fill", [9, 0, 1], 0, [9, 20, 30, 40]],
                ["splice", [1, 1], 1, [10, 30, 40]],
                ["toSpliced", [0, 1, 9], 0, [9, 20, 30, 40]],
                ["with", [0, 9], 2],
                ["toReversed", [], 2],
            ]) {
                const ctx = { execution: new r.Execution(), errorContext: method }, tail = Promise.withResolvers()
                const cause = new Error(`slot ${slot}`)
                let armed = false, failures = 0
                const source = new r.Chain(new Proxy([10, 20, 30], {
                    getOwnPropertyDescriptor(target, key) {
                        if (armed && key === String(slot)) { failures++; throw cause }
                        return Reflect.getOwnPropertyDescriptor(target, key)
                    },
                }), ctx, r.CHAIN_MODE.Unordered)
                const part = timing === "deferred" ? tail.promise : timing === "synchronous" ? ready([40]) : [40]
                const joined = new r.Chain(r.run(source, [], "concat", [part], ctx, {}), ctx, mode)
                armed = true
                const result = r.run(joined, [], method, args, ctx, {})
                if (method === "with" && mode !== r.CHAIN_MODE.Complete) {
                    assert.equal(r.isPending(result, ctx), false)
                    if (expected) assert.equal(r.lookupPath(new r.Chain(result, ctx, mode), [0], ctx), 9)
                }
                tail.resolve([40])
                const value = await result
                if (expected) {
                    assert.deepEqual(await r.export(new r.Chain(value, ctx, mode), [], ctx), expected)
                    assert.equal(failures, 0)
                } else {
                    assert.equal(value.kind, r.ERROR_KIND.InvocationFailed)
                    assert.equal(value.cause, cause)
                    assert.equal(failures, 1)
                }
                armed = false
                assert.deepEqual(await r.export(joined, [], ctx), [10, 20, 30, 40])
            }
        })

        for (const delivery of ["ready", "synchronous", "deferred"])
            it(`keeps concat prefix work bounded in ${name} with a ${delivery} suffix`, async () => {
                for (const size of [1024, 8192]) {
                    const { source, ctx, count } = measured(size, mode), signal = Promise.withResolvers()
                    const suffix = delivery === "deferred" ? signal.promise :
                        delivery === "synchronous" ? ready([42]) : [42]
                    const result = r.run(source, [], "concat", [suffix], ctx, {})
                    let copy
                    if (!r.isPending(result, ctx)) {
                        copy = new r.Chain(result, ctx, mode)
                        assert.equal(r.lookupPath(copy, [0], ctx), 0)
                        assert.equal(r.run(copy, [], "includes", [0], ctx, {}), true)
                        const cursor = r.iterate(copy, [], ctx, { windowEnd: 1 })
                        assert.equal(r.lookupPath((await cursor.next()).value, [], ctx), 0)
                        await cursor.return()
                    } else assert.equal(mode, r.CHAIN_MODE.Complete)
                    signal.resolve([42])
                    copy ??= new r.Chain(await result, ctx, mode)
                    assert.equal(await r.lookupPath(copy, [size], ctx), 42)
                    assert.equal(await r.lookupPath(copy, ["length"], ctx), size + 1)
                    assert.equal(r.lookupPath(source, ["length"], ctx), size)
                    assert.equal(count.lists, 0)
                    assert(count.slots < 20, `read ${count.slots} slots of a ${size}-element prefix`)
                }
            })

        it(`bounds endpoint splices and selected writes in ${name}`, () => {
            for (const size of [1024, 4096]) for (const [method, args, width, at, value] of [
                ["unshift", [], 0, 0, 0], ["splice", [], 0, 0, 0],
                ["splice", [0, 1], 1, 0, 1], ["splice", [size - 1, 1], 1, size - 1, undefined],
                ["splice", [size, 0, -1], 1, size, -1], ["splice", [10, 1, -1], 1, 10, -1],
                ["fill", [-1, 0, 65], 65, 64, -1], ["copyWithin", [13, 0, 65], 65, 77, 64],
                ["copyWithin", [size - 1, 0, size], 1, size - 1, 0],
            ]) {
                const { source, ctx, count } = measured(size, mode)
                const result = r.run(source, [], method, args, ctx, mutate)
                assert(!r.isPoisonError(result) && !r.isPending(result, ctx))
                assert.equal(r.lookupPath(source, [at], ctx), value)
                assert.equal(count.lists, 0, method)
                assert(count.slots <= 8 * width + 12, `${method} read ${count.slots} slots for a width of ${width}`)
            }
        })

        it(`preserves prefix sharing across chained concat calls handed to ${name}`, async () => {
            for (const settled of [false, true]) {
                const { source, ctx, count } = measured(8192, r.CHAIN_MODE.Unordered)
                const signal = Promise.withResolvers()
                const first = new r.Chain(r.run(source, [], "concat", [signal.promise], ctx, {}), ctx, mode)
                if (settled) { signal.resolve([9]); await signal.promise }
                const second = new r.Chain(r.run(first, [], "concat", [[11]], ctx, {}), ctx, mode)
                const third = new r.Chain(r.run(second, [], "concat", [[12]], ctx, {}), ctx, mode)
                const head = r.lookupPath(third, [1], ctx), tail = r.run(third, [], "at", [-1], ctx, {})
                r.assignPath(first, [1], -1, ctx)
                signal.resolve([9])
                assert.equal(await head, 1)
                assert.equal(await tail, 12)
                assert.equal(await r.lookupPath(third, [8192], ctx), 9)
                assert.equal(await r.lookupPath(third, [8193], ctx), 11)
                assert.equal(count.lists, 0)
                assert(count.slots < 20, `chained concat read ${count.slots} prefix slots`)
            }
        })

        it(`keeps small edits and slices on a concat result bounded in ${name}`, async () => {
            const size = 1024
            for (const open of [false, true]) for (const [method, args, at, expected] of [
                ["slice", [0, size - 2], 1, 1], ["fill", [42, 1, 2], 1, 42],
                ["copyWithin", [1, 2, 3], 1, 2], ["splice", [5, 1, 8], 5, 8], ["push", [4], size, 4],
                ["shift", [], 0, 1], ["pop", [], size - 2, size - 2],
            ]) {
                const { source, ctx, count } = measured(size, r.CHAIN_MODE.Unordered), suffix = Promise.withResolvers()
                const prefix = new r.Chain(r.run(source, [], "slice", [0, -1], ctx, {}), ctx)
                const copy = new r.Chain(r.run(prefix, [], "concat", [open ? suffix.promise : [10]], ctx, {}), ctx, mode)
                const answer = r.run(copy, [], method, args, ctx, method === "slice" ? {} : mutate)
                suffix.resolve([10])
                const result = await answer
                if (method === "splice") assert.deepEqual(await r.export(new r.Chain(result, ctx), [], ctx), [5])
                const output = method === "slice" ? new r.Chain(result, ctx) : copy
                assert.equal(await r.lookupPath(output, [at], ctx), expected)
                assert.equal(await r.lookupPath(source, [1], ctx), 1)
                assert.equal(count.lists, 0)
                assert(count.slots < 20, `${method} read ${count.slots} prefix slots, open=${open}`)
            }
        })
    }

    it("shares a ready prefix when the physical tail belongs to a different view", () => {
        for (const mode of Object.values(r.CHAIN_MODE)) {
            const { source, ctx, count } = measured(8192, mode)
            const middle = new r.Chain(r.run(source, [], "slice", [2, 8002], ctx, {}), ctx, mode)
            const copy = new r.Chain(r.run(middle, [], "concat", [[42]], ctx, {}), ctx, mode)
            assert.equal(r.lookupPath(copy, [7999], ctx), 8001)
            assert.equal(r.lookupPath(copy, [8000], ctx), 42)
            assert.equal(r.lookupPath(source, [8002], ctx), 8002)
            assert.equal(count.lists, 0)
            assert(count.slots < 12)
        }
    })

    it("observes a replacement without inspecting the overwritten physical slot", async () => {
        for (const method of ["fill", "splice"]) for (const pending of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: method }
            let armed = false
            const source = new r.Chain(new Proxy([0, 1, 2], {
                getOwnPropertyDescriptor(target, key) {
                    if (armed && key === "1") throw new Error("read overwritten slot")
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            }), ctx)
            armed = true
            const value = pending ? Promise.resolve(7) : 7
            const args = method === "splice" ? [1, 1, value] : [value, 1, 2]
            const copy = new r.Chain(r.run(source, [], method, args, ctx, {}), ctx)
            assert.deepEqual(await r.export(copy, [], ctx), [0, 7, 2])
        }
    })

    it("keeps borrowed subrange children, holes and producer versions isolated across settlement", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "borrowed prefix" }
        const child = { n: 1 }, payload = Promise.withResolvers(), suffix = Promise.withResolvers()
        const source = new r.Chain(["outside", child, , payload.promise, child, "outside"], ctx)
        const window = new r.Chain(r.run(source, [], "slice", [1, 5], ctx, {}), ctx)
        const joined = new r.Chain(r.run(window, [], "concat", [suffix.promise], ctx, {}), ctx)
        const read = r.lookupPath(joined, [2], ctx)
        const exported = r.export(joined, [], ctx)
        r.assignPath(source, [1, "n"], 9, ctx)
        r.assignPath(window, [1], "new", ctx)
        r.assignPath(joined, [3, "n"], 3, ctx)
        payload.resolve({ n: 2 })
        suffix.resolve(["after"])
        assert.deepEqual(await read, { n: 2 })
        const before = await exported
        assert.deepEqual(before, [{ n: 1 }, , { n: 2 }, { n: 1 }, "after"])
        assert.equal(before[0], before[3])
        assert.deepEqual(await r.export(joined, [], ctx), [{ n: 1 }, , { n: 2 }, { n: 3 }, "after"])
        assert.deepEqual(await r.export(window, [], ctx), [{ n: 1 }, "new", { n: 2 }, { n: 1 }])
        verifyRefCounts(ctx, source._state, window._state, joined._state)
    })

    it("captures the actual prefix when a later method consumes a chain of open concats", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "consume chained prefix" }
        const signal = Promise.withResolvers(), source = new r.Chain(["a", , "b"], ctx)
        const first = new r.Chain(r.run(source, [], "concat", [signal.promise], ctx, {}), ctx)
        const second = new r.Chain(r.run(first, [], "concat", [["last"]], ctx, {}), ctx)
        const reversed = new r.Chain(r.run(second, [], "toReversed", [], ctx, {}), ctx)
        const output = r.export(reversed, [], ctx)
        r.assignPath(first, [0], "later", ctx)
        signal.resolve(["middle"])
        assert.deepEqual(await output, ["last", "middle", "b", undefined, "a"])
    })

    it("keeps the removed child and the surviving edge stable while a concat suffix is open", async () => {
        for (const method of ["shift", "pop"]) for (const extra of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: "open endpoint" }, suffix = Promise.withResolvers()
            const source = new r.Chain([{ n: 0 }, { n: 1 }, { n: 2 }], ctx)
            const copy = new r.Chain(r.run(source, [], "concat", [suffix.promise], ctx, {}), ctx)
            const removed = new r.Chain(r.run(copy, [], method, [], ctx, mutate), ctx)
            const output = r.export(copy, [], ctx)
            for (const index of [0, 2]) r.assignPath(source, [index, "n"], 12, ctx)
            const expected = [{ n: 0 }, { n: 1 }, { n: 2 }]
            if (extra) expected.push({ n: 3 })
            suffix.resolve(extra ? [{ n: 3 }] : [])
            assert.deepEqual(await r.export(removed, [], ctx), expected[method]())
            assert.deepEqual(await output, expected)
        }
    })
})
