import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { watch } from "../src/array-sequence.js"
import { captureOrder } from "../src/array-sequence.js"
import { ready } from "./ordered-thenable.js"

const context = () => ({ execution: new r.Execution(), errorContext: "stream flat" })
const flatten = (value, depth, ctx, mode) => new r.Chain(r.run(new r.Chain(value, ctx, mode), [],
    "flat", [depth], ctx, {}), ctx, mode)

describe("streaming flat contributions", () => {
    for (const mode of Object.values(r.CHAIN_MODE)) for (const compact of [false, true])
        it(`collects every nested descriptor failure in mode ${mode}, compact=${compact}`, async () => {
            const ctx = context(), causes = [0, 1, 2].map(i => new Error(String(i)))
            let armed = false
            const nested = new Proxy([1, 2, 3], {
                getOwnPropertyDescriptor(target, key) {
                    if (armed && Object.hasOwn(causes, key) && key !== "length") throw causes[key]
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            let source = new r.Chain(Array(65).fill(nested), ctx, mode)
            if (compact) source = new r.Chain(r.run(source, [], "fill", [nested], ctx, {}), ctx, mode)
            armed = true
            const result = r.run(source, [], "flat", [1], ctx, {})
            assert.equal(r.isPoisonError(result), mode === r.CHAIN_MODE.Complete)
            const failure = mode === r.CHAIN_MODE.Complete ? result : await r.getErrors(new r.Chain(result, ctx, mode), [], ctx)
            assert.deepEqual(new Set(failure.errors.map(error => error.cause)), new Set(causes))
        })
    for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) {
        it(`keeps published bounds valid when one of two pending roots reveals a cycle in mode ${mode}`, async () => {
            const ctx = context(), edge = Promise.withResolvers(), other = Promise.withResolvers()
            const branch = [1, 2, 3, 4, 5, edge.promise, other.promise], parent = [branch]
            const result = flatten([branch, parent], Infinity, ctx, mode)
            const order = captureOrder(r.lookupPath(result, [], ctx), ctx)
            let largestMinimum = order.minimum
            const stop = watch(order, minimum => { largestMinimum = Math.max(largestMinimum, minimum) }, ctx)
            edge.resolve(parent)
            assert.equal((await r.lookupPath(result, [5], ctx)).kind, r.ERROR_KIND.InvalidArrayOperation)
            other.resolve([])
            assert.equal(await r.lookupPath(result, ["length"], ctx), 12)
            assert.equal((await r.lookupPath(result, [11], ctx)).kind, r.ERROR_KIND.InvalidArrayOperation)
            stop?.()
            assert(largestMinimum <= 12, `published a guaranteed width of ${largestMinimum} for twelve slots`)
        })
        for (const [depth, warm, write, whole] of [[9, false, false], [Infinity, true, false], [Infinity, true, true],
            [Infinity, false, false, true], [Infinity, false, true, true]])
            it(`uses the occurrence's logical ancestors only at unlimited depth in mode ${mode}, depth=${depth}, write=${write}, whole=${!!whole}`, async () => {
                const ctx = context(), gate = Promise.withResolvers(), failedRead = new Error("old index")
                let armed = false, failedInspections = 0
                const storage = [], original = new Proxy(storage, {
                    ownKeys(target) {
                        if (armed && whole) { failedInspections++; throw failedRead }
                        return Reflect.ownKeys(target)
                    },
                    getOwnPropertyDescriptor(target, key) {
                        if (armed && key === "0") throw failedRead
                        return Reflect.getOwnPropertyDescriptor(target, key)
                    },
                })
                const shared = ["s", original]
                storage.push(shared, 7)
                const source = new r.Chain(original, ctx, mode)
                const snapshot = new r.Chain(r.lookupPath(source, [], ctx), ctx, mode)
                const entry = r.enter(source, [1], ctx, true, inside => gate.promise.then(() => {
                    if (write) r.assignPath(inside, [], 8, ctx)
                }))
                const entered = r.lookupPath(source, [], ctx)
                const root = new r.Chain(warm ? [r.lookupPath(snapshot, [0], ctx), entered] : [entered], ctx, mode)
                armed = true
                const output = new r.Chain(r.run(root, [], "flat", [depth], ctx, {}), ctx, mode)
                const item = r.lookupPath(output, [warm ? 4 : 1], ctx)
                assert.equal(r.lookupPath(output, [0], ctx), "s")
                if (whole) assert.equal(failedInspections, 0)
                if (depth === Infinity) assert(r.isPending(item, ctx))
                else assert.equal(item.cause, failedRead, "finite discovery already has the physical descriptor failure")
                gate.resolve()
                await entry
                const value = await item
                if (depth === Infinity && !write && warm && mode === r.CHAIN_MODE.Sequential) {
                    assert.equal(value.cause, failedRead)
                    await r.repairPath(output, [4], ctx)
                    assert.equal((await r.lookupPath(output, [4], ctx)).kind, r.ERROR_KIND.InvalidArrayOperation)
                } else if (depth === Infinity && !write) assert.equal(value.kind, r.ERROR_KIND.InvalidArrayOperation)
                else assert.equal(value.cause, failedRead)
                if (whole) assert.equal(failedInspections, Number(write))
                assert.equal(await r.lookupPath(output, ["length"], ctx), whole ? 3 : warm ? write ? 7 : 6 : 4)
            })
        for (const timing of ["ready", "sync", "deferred"]) {
            it(`keeps each occurrence's depth after shared discovery in mode ${mode}, ${timing}`, async () => {
                const ctx = context(), gate = Promise.withResolvers(), value = { id: 1 }, delivered = [[value]]
                const shared = [timing === "ready" ? delivered : timing === "sync" ? ready(delivered) : gate.promise]
                const source = new r.Chain(["prefix", [shared], shared, shared], ctx, mode)
                const result = new r.Chain(r.run(source, [], "flat", [3], ctx, {}), ctx, mode)
                assert.equal(r.lookupPath(result, [0], ctx), "prefix")
                r.assignPath(source, [1], [], ctx)
                gate.resolve(delivered)
                const expected = ["prefix", [[delivered]], [delivered], [delivered]].flat(3)
                const output = await r.export(result, [], ctx)
                assert.deepEqual(output, expected)
                assert.equal(output[1][0], output[2])
                assert.equal(output[2], output[3])
            })
            it(`cuts a newly discovered back-edge at its own ancestry in mode ${mode}, ${timing}`, async () => {
                const ctx = context(), gate = Promise.withResolvers(), shared = ["k"], outer = ["x", shared]
                shared.push(timing === "ready" ? outer : timing === "sync" ? ready(outer) : gate.promise)
                const result = flatten([outer, shared], Infinity, ctx, mode)
                assert.equal(r.lookupPath(result, [0], ctx), "x")
                gate.resolve(outer)
                assert.equal(await r.lookupPath(result, ["length"], ctx), 6)
                assert.equal(await r.lookupPath(result, [1], ctx), "k")
                for (const at of [2, 5]) assert.equal((await r.lookupPath(result, [at], ctx)).kind, r.ERROR_KIND.InvalidArrayOperation)
                for (const [at, value] of [[3, "k"], [4, "x"]]) {
                    if (mode === r.CHAIN_MODE.Sequential) {
                        assert.equal((await r.lookupPath(result, [at], ctx)).kind, r.ERROR_KIND.InvalidArrayOperation)
                        r.repairPath(result, [at], ctx)
                    }
                    assert.equal(await r.lookupPath(result, [at], ctx), value)
                }
            })
        }
        for (const reverse of [false, true])
            it(`resumes on the first relevant discovery in mode ${mode}, reverse=${reverse}`, async () => {
                const ctx = context(), gates = [Promise.withResolvers(), Promise.withResolvers()]
                const shared = gates.map(g => g.promise), result = flatten([shared, [shared]], 10, ctx, mode)
                const first = r.lookupPath(result, [0], ctx), length = r.lookupPath(result, ["length"], ctx)
                assert(r.isPending(first, ctx) && r.isPending(length, ctx))
                if (reverse) gates[1].resolve([2])
                gates[0].resolve([1])
                const turn = new Promise(resolve => setImmediate(() => resolve("still waiting for the other branch")))
                assert.equal(await Promise.race([first, turn]), 1)
                if (!reverse) gates[1].resolve([2])
                assert.equal(await length, 4)
                assert.deepEqual(await r.export(result, [], ctx), [1, 2, 1, 2])
            })
        it(`retains a prefix while another branch still needs discovery in mode ${mode}`, async () => {
            const ctx = context(), pending = Promise.withResolvers()
            const copy = flatten([1, [2, pending.promise], 4], Infinity, ctx, mode)
            const cursor = r.iterate(copy, [], ctx)
            for (const value of [1, 2]) assert.equal(r.lookupPath((await cursor.next()).value, [], ctx), value)
            pending.resolve([3])
            assert.deepEqual(await r.export(copy, [], ctx), [1, 2, 3, 4])
            await cursor.return()
        })
        it(`cuts only recursive edges and flattens repeated nonrecursive aliases in mode ${mode}`, () => {
            const ctx = context(), child = ["X"]
            child.push(child)
            const copy = flatten(["A", child, "B"], Infinity, ctx, mode)
            assert.equal(r.lookupPath(copy, ["length"], ctx), 4)
            assert.equal(r.lookupPath(copy, [1], ctx), "X")
            assert.equal(r.lookupPath(copy, [2], ctx).kind, r.ERROR_KIND.InvalidArrayOperation)
            if (mode === r.CHAIN_MODE.Sequential) r.repairPath(copy, [3], ctx)
            assert.equal(r.lookupPath(copy, [3], ctx), "B")
            const alias = [1, 2]
            assert.deepEqual(r.export(flatten([alias, alias], Infinity, ctx, mode), [], ctx), [1, 2, 1, 2])
        })
        for (const timing of ["ready", "sync", "deferred"])
            it(`uses the depth-zero failure skeleton in mode ${mode}, ${timing}`, async () => {
                const ctx = context(), cause = r.validationError("depth", ctx, r.ERROR_KIND.OperationInputFailed)
                const gate = Promise.withResolvers()
                const d = timing === "ready" ? cause : timing === "sync" ? ready(cause) : gate.promise
                const output = flatten(["a", ["x", "y"], "z"], d, ctx, mode)
                assert.equal(r.lookupPath(output, [0], ctx), "a")
                if (timing === "deferred") gate.resolve(cause)
                assert.equal(await r.lookupPath(output, [1], ctx), cause)
                assert.equal(await r.lookupPath(output, [2], ctx), mode === r.CHAIN_MODE.Sequential ? cause : "z")
                if (mode === r.CHAIN_MODE.Sequential) r.repairPath(output, [2], ctx)
                assert.equal(r.lookupPath(output, [2], ctx), "z")
            })
        it(`retains an Error payload at zero depth and skips failed discovery at positive depth in mode ${mode}`, async () => {
            const ctx = context(), cause = r.validationError("item", ctx, r.ERROR_KIND.OperationInputFailed)
            const depth = Promise.withResolvers()
            const output = flatten([cause], depth.promise, ctx, mode), step = r.iterate(output, [], ctx).next()
            depth.resolve(0)
            assert.equal(r.lookupPath((await step).value, [], ctx), cause)
            await assert.rejects(r.iterate(flatten([cause], 1, ctx, mode), [], ctx).next(), e => e === cause)
        })
    }
    it("computes finite cyclic counts and depth parity above the safe subtraction range", () => {
        const ctx = context(), mode = r.CHAIN_MODE.Unordered, K = Number.MAX_SAFE_INTEGER, MAX = 0xffffffff
        const a = [], b = []
        a.push(b); b.push(a)
        const result = flatten(a, 2 ** 54, ctx, mode)
        assert.equal(r.lookupPath(result, ["length"], ctx), 1)
        assert.equal(r.lookupPath(result, [0], ctx), b)
        const emitting = []
        emitting.push("x", emitting)
        const long = flatten(emitting, Number.MAX_VALUE, ctx, mode)
        assert.equal(r.lookupPath(long, ["length"], ctx), K)
        assert.equal(r.lookupPath(long, [MAX - 1], ctx), "x")
        assert.equal(r.lookupPath(long, [K - 1], ctx).kind, r.ERROR_KIND.InvalidArrayLength)
    })
    for (const pending of [false, true])
        it(`keeps a branching cycle compact across lookup, mutation and Error collection, deferred=${pending}`, async () => {
            const ctx = context(), cycle = []
            cycle.push(cycle, cycle)
            const depth = Promise.withResolvers(), max = 0xffffffff
            const result = flatten(cycle, pending ? depth.promise : 31, ctx, r.CHAIN_MODE.Unordered)
            const length = r.lookupPath(result, ["length"], ctx), first = r.lookupPath(result, [0], ctx)
            const whole = { ...ctx, errorContext: "consume branching result" }
            const collected = r.getErrors(result, [], whole), exported = r.export(result, [], whole)
            depth.resolve(31)
            assert.equal(await length, max + 1)
            assert.equal(await first, cycle)
            assert.equal(r.lookupPath(result, [max - 1], ctx), cycle)
            const cause = r.lookupPath(result, [max], ctx)
            assert.equal(cause.kind, r.ERROR_KIND.InvalidArrayLength)
            for (const report of await Promise.all([collected, exported])) {
                assert.equal(report.kind, r.ERROR_KIND.InvalidArrayLength)
                assert.equal(report.errorContext, whole.errorContext)
            }
            r.assignPath(result, [0, 0], "edited", ctx)
            assert.equal(r.lookupPath(result, [0, 0], ctx), "edited")
            assert.equal(r.lookupPath(result, [1, 0], ctx), cycle)
            assert.equal(r.lookupPath(result, [max - 1], ctx), cycle)
            assert.equal(cycle[0], cycle)
        })
})
