import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { ready, OrderedThenable } from "./ordered-thenable.js"

const context = () => ({ execution: new r.Execution(), errorContext: "controlled Array demand" })

describe("controlled Array input demand", () => {
    for (const mode of Object.values(r.CHAIN_MODE))
        it(`drops fill payload demand while a failed bound still collects Errors in mode ${mode}`, async () => {
            const ctx = context(), source = new r.Chain([1, 2], ctx, mode)
            const payload = Promise.withResolvers(), rest = Promise.withResolvers()
            const cause = r.validationError("bound", ctx, r.ERROR_KIND.OperationInputFailed)
            const result = r.run(source, [], "fill", [payload.promise, 0, [cause, rest.promise]], ctx, { mutationScopeDepth: 0 })
            let inspections = 0
            payload.resolve(new Proxy({}, { ownKeys() { inspections++; return [] } }))
            await new Promise(setImmediate)
            assert.equal(inspections, 0)
            rest.resolve(1)
            assert.equal(await result, cause)
        })
    it("includes compares a sparse hole range once and respects its captured start", async () => {
        const ctx = context(), sparse = new Array(0xffffffff)
        sparse[sparse.length - 1] = 7
        const source = new r.Chain(sparse, ctx)
        assert.equal(r.run(source, [], "includes", [8, 3000000000], ctx, {}), false)
        assert.equal(r.run(source, [], "includes", [7], ctx, {}), true)
        const from = Promise.withResolvers(), result = r.run(source, [], "includes", [undefined, from.promise], ctx, {})
        from.resolve(-1)
        assert.equal(await result, false)
    })
    it("flat keeps depth conditional until a top-level occurrence needs discovery", async () => {
        const ctx = context(), source = new r.Chain([1, , 2], ctx, r.CHAIN_MODE.Complete), unused = new OrderedThenable()
        const result = r.run(source, [], "flat", [unused], ctx, {})
        assert.deepEqual(r.export(new r.Chain(result, ctx), [], ctx), [1, 2])
        assert.equal(unused.subscriptions, 0)
        const value = Promise.withResolvers(), depth = Promise.withResolvers()
        const conditional = r.run(new r.Chain([value.promise, 2], ctx, r.CHAIN_MODE.Complete), [], "flat", [depth.promise], ctx, {})
        value.resolve(1)
        assert.deepEqual(r.export(new r.Chain(await conditional, ctx), [], ctx), [1, 2])
        const poison = r.validationError("root", ctx, r.ERROR_KIND.OperationInputFailed)
        const failed = new r.Chain([poison], ctx, r.CHAIN_MODE.Complete)
        assert.equal(r.run(failed, [], "flat", [1], ctx, {}), poison)
        const leaf = r.run(failed, [], "flat", [0], ctx, {})
        assert.equal(r.lookupPath(new r.Chain(leaf, ctx), [0], ctx), poison)
    })
    for (const method of ["includes", "indexOf", "lastIndexOf"]) {
        const miss = method === "includes" ? false : -1
        it(`${method} captures the relative bound's length before releasing the source`, async () => {
            const ctx = context(), source = new r.Chain([1, 2], ctx), bound = Promise.withResolvers()
            const result = r.run(source, [], method, [2, bound.promise], ctx, {})
            r.assignPath(source, ["length"], 0, ctx)
            bound.resolve(-1)
            assert.equal(await result, method === "includes" ? true : 1)
        })
        it(`${method} drops a failed or unfinished range on a proved mismatch`, async () => {
            const ctx = context(), source = new r.Chain([1], ctx)
            const unused = new OrderedThenable()
            const failure = r.validationError("range", ctx, r.ERROR_KIND.OperationInputFailed)
            for (const bound of [unused, failure, ready(failure)])
                assert.equal(r.run(source, [], method, [2, bound], ctx, {}), miss)
            assert.equal(unused.subscriptions, 0)
            const value = Promise.withResolvers(), bound = Promise.withResolvers()
            const result = r.run(new r.Chain([value.promise], ctx), [], method, [2, bound.promise], ctx, {})
            bound.resolve(failure)
            value.resolve(1)
            assert.equal(await result, miss)
        })
        it(`${method} drops a failed comparison once its position is excluded`, async () => {
            const ctx = context(), source = new r.Chain([1], ctx), bound = Promise.withResolvers()
            const failure = r.validationError("needle", ctx, r.ERROR_KIND.OperationInputFailed)
            const result = r.run(source, [], method, [failure, bound.promise], ctx, {})
            bound.resolve(method === "lastIndexOf" ? -2 : 2)
            assert.equal(await result, miss)
            if (method !== "includes") {
                const unused = new OrderedThenable()
                assert.equal(r.run(new r.Chain(new Array(1000000), ctx), [], method, [unused, unused], ctx, {}), -1)
                assert.equal(unused.subscriptions, 0)
            }
        })
    }

    it("slice ignores the opposite bound when a reached endpoint proves the range empty", async () => {
        for (const deliver of [value => value, ready, value => Promise.resolve(value)]) {
            const ctx = context()
            const chain = new r.Chain([1, 2], ctx, r.CHAIN_MODE.Complete)
            for (const args of [[new OrderedThenable(), deliver(0)], [new OrderedThenable(), deliver(-2)],
                [deliver(2), new OrderedThenable()]]) {
                const copy = await r.run(chain, [], "slice", args, ctx, {})
                assert.deepEqual(r.export(new r.Chain(copy, ctx), [], ctx), [])
            }
            const failed = r.validationError("unusable bound", ctx, r.ERROR_KIND.OperationInputFailed)
            assert.deepEqual(r.export(new r.Chain(await r.run(chain, [], "slice", [failed, deliver(0)], ctx, {}), ctx), [], ctx), [])
            assert.equal(await r.run(chain, [], "slice", [failed, deliver(1)], ctx, {}), failed)
        }
    })

    for (const method of ["sort", "toSorted"]) {
        for (const input of [() => 42, () => ready(42), () => new OrderedThenable()])
            it(`${method} transfers a sole sortable placement without consuming its comparator`, async () => {
                const ctx = context(), comparator = input(), pending = Promise.withResolvers()
                for (const source of [[7, undefined], [pending.promise], [, , pending.promise]]) {
                    const result = r.run(new r.Chain(source, ctx), [], method, [comparator], ctx, {})
                    assert(!r.isPending(result, ctx) && !r.isPoisonError(result))
                    const copy = new r.Chain(result, ctx)
                    assert.equal(r.lookupPath(copy, ["length"], ctx), source.length)
                    assert.equal(r.isPending(r.lookupPath(copy, [0], ctx), ctx), source.includes(pending.promise))
                }
                if (comparator instanceof OrderedThenable) assert.equal(comparator.subscriptions, 0)
            })

        it(`${method} selects a required invalid comparator independently of unrelated payloads`, async () => {
            const ctx = context(), wait = Promise.withResolvers()
            const direct = r.run(new r.Chain([2, 1, wait.promise], ctx), [], method, [42], ctx, {})
            assert(r.isPoisonError(direct))
            assert.equal(direct.kind, r.ERROR_KIND.NotAFunction)
            const conditional = r.run(new r.Chain([2, wait.promise], ctx), [], method, [42], ctx, {})
            assert(r.isPending(conditional, ctx))
            wait.resolve(undefined)
            assert.deepEqual(r.export(new r.Chain(await conditional, ctx), [], ctx), [2, undefined])
        })
    }
})
