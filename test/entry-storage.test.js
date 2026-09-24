import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { isArrayView } from "../src/array-view.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new r.Execution(), errorContext: {} })

describe("entry publication and shared backing", () => {
    for (const shape of ["record", "hole", "growth"]) {
        for (const payload of ["value", "object", "prefix failure", "rejection"]) {
            const poisoned = payload === "prefix failure" || payload === "rejection"
            // Rejected assigned data is an ordinary Error, without a rollback
            // baseline. Only the failed mutation can be repaired to absence.
            for (const cleanup of payload === "prefix failure" ? ["delete", "repair"] : ["delete"]) {
                it(`${cleanup} after ${payload} creation stays absent in a ${shape}`, async () => {
                    for (const following of ["ready", "nested", "pending"]) for (const captures of [false, true]) {
                        const ctx = context(), hold = Promise.withResolvers(), last = Promise.withResolvers()
                        const initial = shape === "record" ? { p: 1 } : [1, , 3]
                        const key = shape === "record" ? "k" : shape === "hole" ? 1 : 5
                        const expected = shape === "record" ? { p: 1 } : [1, , 3]
                        if (shape === "growth") expected.length = 6
                        const chain = new r.Chain({ data: initial, sibling: 0 }, ctx)
                        assert.equal(r.hasError(chain, [], ctx), false) // Keep the live index active through every transition.
                        const value = payload === "object" ? { n: 5 } : 5
                        const cause = new Error("rejected creation")
                        const first = r.enter(chain, ["data", key], ctx, true, inside => hold.promise.then(() => {
                            if (payload === "prefix failure") return r.assignPath(inside, ["x"], value, ctx)
                            return r.assignPath(inside, [], payload === "rejection" ? Promise.reject(cause) : value, ctx)
                        }))
                        const created = captures ? r.export(chain, ["data"], ctx) : undefined
                        const removed = cleanup === "delete" ? r.deletePath(chain, ["data", key], ctx)
                            : r.repairPath(chain, ["data", key], ctx)
                        const afterRemoval = captures ? r.export(chain, ["data"], ctx) : undefined
                        const noop = r.enter(chain, ["data", key], ctx, true, inside => following === "nested"
                            ? r.enter(inside, [], ctx, true, () => undefined)
                            : following === "pending" ? last.promise : undefined)
                        r.assignPath(chain, ["sibling"], 9, ctx)
                        verifyRefCounts(ctx, chain._state)
                        hold.resolve()
                        await first
                        last.resolve()
                        await Promise.all([removed, noop])
                        const label = `${following} no-op; captures=${captures}`
                        assert.equal(r.hasError(chain, [], ctx), false, label)
                        assert.equal(r.getErrors(chain, [], ctx), null, label)
                        assert.deepEqual(await r.export(chain, [], ctx), { data: expected, sibling: 9 }, label)
                        verifyRefCounts(ctx, chain._state)
                        if (captures) {
                            const earlier = await created
                            if (poisoned) {
                                assert(r.isPoisonError(earlier), label)
                                assert.equal(earlier.errorContext, ctx.errorContext)
                                if (payload === "rejection") assert.equal(earlier.cause, cause)
                            } else {
                                const withValue = shape === "record" ? { ...expected } : expected.slice()
                                withValue[key] = value
                                assert.deepEqual(earlier, withValue, label)
                            }
                            assert.deepEqual(await afterRemoval, expected, label)
                        }
                        // A subsequent real writer must remain authoritative too.
                        await r.assignPath(chain, ["data", key], 11, ctx)
                        expected[key] = 11
                        assert.deepEqual(await r.export(chain, ["data"], ctx), expected, label)
                        assert.equal(ctx.execution.fatalError, null)
                        verifyRefCounts(ctx, chain._state)
                    }
                })
            }
        }
    }

    const methods = [
        ["slice", [0], false], ["slice", [1, 4], false], ["concat", [[]], false],
        ["push", [9], false], ["pop", [], false], ["shift", [], false],
        ["push", [9], true], ["pop", [], true], ["shift", [], true],
    ]
    for (const [method, args, mutation] of methods) for (const payload of ["value", "object", "error"]) {
        it(`${method}(${args}) preserves an absent overlay over ${payload} backing, mutation=${mutation}`, async () => {
            for (const nested of [false, true]) {
                const ctx = context(), hold = Promise.withResolvers()
                const stale = payload === "object" ? { n: 7 } : payload === "error" ? new Error("deleted poison") : 7
                const chain = new r.Chain({ data: [11, stale, 33, 44] }, ctx)
                r.hasError(chain, [], ctx)
                const entry = r.enter(chain, ["data", 1], ctx, true, () => hold.promise)
                const deletion = r.deletePath(chain, ["data", 1], ctx)
                const noop = r.enter(chain, ["data", 1], ctx, true, inside => nested
                    ? r.enter(inside, [], ctx, true, () => undefined) : undefined)
                hold.resolve()
                await Promise.all([entry, deletion, noop])
                const expected = [11, , 33, 44]
                const nativeResult = expected[method](...args)
                const outputExpected = method === "slice" || method === "concat" ? nativeResult : expected
                const result = r.run(chain, ["data"], method, args, ctx, mutation ? { mutationScopeDepth: 1 } : {})
                const output = mutation ? r.lookupPath(chain, ["data"], ctx) : result
                assert(isArrayView(output, ctx), "exercise the backing-sharing path")
                const copy = new r.Chain(output, ctx)
                assert.equal(r.hasError(copy, [], ctx), false)
                assert.equal(r.getErrors(copy, [], ctx), null)
                assert.deepEqual(await r.export(copy, [], ctx), outputExpected)
                assert.deepEqual(await r.export(chain, ["data"], ctx), mutation ? expected : [11, , 33, 44])
                verifyRefCounts(ctx, chain._state, copy._state)

                // Deriving from a derived view must transfer the same absence.
                const derived = new r.Chain(r.run(copy, [], "concat", [[55]], ctx, {}), ctx)
                await r.assignPath(chain, ["data", 1], 99, ctx)
                assert.deepEqual(await r.export(copy, [], ctx), outputExpected)
                assert.deepEqual(await r.export(derived, [], ctx), outputExpected.concat(55))
                assert.equal(ctx.execution.fatalError, null)
                verifyRefCounts(ctx, chain._state, copy._state, derived._state)
            }
        })
    }

    // A view derived while an element is pending keeps its own pending version.
    // Its later publication must not change storage its source still governs:
    // the source's installed version would then describe absent storage over a
    // physical value, and a later absent completion could retire over it.
    // Reduced from array-sequences program 9345 (CASCADA_SEQUENCE_SEEDS=2000).
    it("keeps source storage facts when a derived view publishes a pending element", async () => {
        const ctx = context(), created = Promise.withResolvers(), payload = Promise.withResolvers()
        const observation = Promise.withResolvers(), sparse = Promise.withResolvers()
        payload.promise.catch(() => {})
        sparse.promise.catch(() => {})
        const chain = new r.Chain({ data: [] }, ctx)
        r.hasError(chain, [], ctx)
        const work = [r.assignPath(chain, ["data", 6], sparse.promise, ctx)]
        sparse.reject(new Error("rejected at 6"))
        work.push(r.enter(chain, ["data", 4], ctx, true, inside => created.promise
            .then(() => r.assignPath(inside, [], payload.promise, ctx))))
        work.push(r.repairPath(chain, ["data", 4], ctx)) // Rejected data has no baseline to restore.
        work.push(r.enter(chain, ["data", 4], ctx, true, () => undefined))
        created.resolve()
        for (let turn = 0; turn < 3; turn++) await Promise.resolve()
        // The concatenation runs before the payload settles, so a[4] is still pending in its result.
        const view = r.enter(chain, ["data"], ctx, false, inside => observation.promise
            .then(() => r.run(inside, [], "concat", [[9]], ctx, {})))
        observation.resolve()
        for (let turn = 0; turn < 2; turn++) await new Promise(setImmediate)
        payload.reject(new Error("rejected at 4"))
        await Promise.all([...work, view])
        const copy = new r.Chain(await view, ctx)
        for (let turn = 0; turn < 6; turn++) await new Promise(setImmediate)

        assert(r.isPoisonError(await r.lookupPath(chain, ["data", 4], ctx)))
        assert(r.isPoisonError(await r.lookupPath(chain, ["data", 6], ctx)))
        assert.equal(await r.lookupPath(chain, ["data", 5], ctx), undefined)
        assert.equal(await r.lookupPath(chain, ["data", "length"], ctx), 7)
        assert(r.isPoisonError(await r.lookupPath(copy, [4], ctx)))
        assert.equal(await r.lookupPath(copy, [7], ctx), 9)
        assert.equal(await r.lookupPath(copy, ["length"], ctx), 8)
        assert.equal(ctx.execution.fatalError, null)
        verifyRefCounts(ctx, chain._state, copy._state)
    })
})
