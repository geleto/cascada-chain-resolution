import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { ready } from "./ordered-thenable.js"

describe("captured Array interval selection", () => {
    it("matches native copyWithin on both sides of mixed-sign coordinate crossings", async () => {
        const facts = { mutationScopeDepth: 0 }
        for (const mode of Object.values(r.CHAIN_MODE)) for (const count of [0, 1, 2])
        for (const args of [[1, -3, 3], [-3, 1, 3], [4, -3, 4], [-3, 2, -1]]) {
            const ctx = { execution: new r.Execution(), errorContext: "mixed signs" }, hold = Promise.withResolvers()
            const input = [0, 1, 2, 3, 4, 5], chain = new r.Chain(input, ctx, mode)
            r.run(chain, [], "splice", [4, hold.promise], ctx, facts)
            const result = new r.Chain(r.run(chain, [], "copyWithin", args, ctx, facts), ctx, mode)
            const observed = r.export(chain, [], ctx)
            const expected = input.toSpliced(4, count).copyWithin(...args)
            hold.resolve(count)
            assert.deepEqual(await observed, expected)
            assert.deepEqual(await r.export(result, [], ctx), expected)
        }
    })
    for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
        it(`keeps distinct equal-valued slots separate after a failed copyWithin in mode ${mode}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "copyWithin selector" }
            const cause = r.validationError("end", ctx, r.ERROR_KIND.OperationInputFailed)
            for (const input of [v => v, ready, v => Promise.resolve(v)]) {
                const chain = new r.Chain([input("b"), input("b")], ctx, mode)
                assert.equal(await r.run(chain, [], "copyWithin", [1, 0, input(cause)], ctx, { mutationScopeDepth: 0 }), cause)
                assert.equal(await r.lookupPath(chain, [0], ctx), "b")
                assert.equal(await r.lookupPath(chain, [1], ctx), cause)
            }
        })

    for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
        it(`uses predecessor positions through fills and copies in mode ${mode}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "copyWithin positions" }
            const wrap = value => new r.Chain(value, ctx, mode), mutate = { mutationScopeDepth: 0 }
            const cause = r.validationError("end", ctx, r.ERROR_KIND.OperationInputFailed)
            for (const width of [3, 96]) for (const input of [v => v, ready, v => Promise.resolve(v)]) {
                const source = wrap(new Array(width))
                await r.run(source, [], "fill", ["b", 0, input(width)], ctx, mutate)
                for (const [method, args] of [["slice", []], ["with", [2, "x"]], ["toReversed", []], ["toSpliced", [2, 0]]]) {
                    const copied = wrap(r.run(source, [], method, args, ctx, {})), end = Promise.withResolvers()
                    const direct = r.run(copied, [], "copyWithin", [1, 0, end.promise], ctx, mutate)
                    const slot = r.lookupPath(copied, [1], ctx)
                    assert.equal(r.isPending(slot, ctx), true)
                    assert.equal(r.lookupPath(copied, [0], ctx), "b")
                    end.resolve(cause)
                    assert.equal(await slot, cause)
                    assert.equal(await direct, cause)
                }
            }
            const sparse = wrap(new Array(4)), end = Promise.withResolvers()
            const copy = wrap(r.run(sparse, [], "copyWithin", [1, 0, end.promise], ctx, {}))
            assert.equal(r.lookupPath(copy, [1], ctx), undefined)
            end.resolve(cause)
            assert.deepEqual(await r.export(copy, [], ctx), new Array(4))

            for (const failed of [false, true]) {
                const firstEnd = Promise.withResolvers(), secondEnd = Promise.withResolvers()
                const first = wrap(r.run(wrap([, , "x"]), [], "copyWithin", [0, 2, firstEnd.promise], ctx, {}))
                const second = wrap(r.run(first, [], "copyWithin", [1, 0, failed ? cause : secondEnd.promise], ctx, {}))
                const slot = r.lookupPath(second, [1], ctx)
                firstEnd.resolve(2)
                assert.equal(await slot, undefined)
                secondEnd.resolve(0)
            }
        })

    for (const mode of Object.values(r.CHAIN_MODE)) it(`returns the captured receiver for a deferred no-write sort in mode ${mode}`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: "empty sort" }, cut = Promise.withResolvers()
        const wrap = v => new r.Chain(v, ctx, mode)
        const source = wrap(r.run(wrap(["b", "c"]), [], "toSpliced", [cut.promise], ctx, {}))
        const result = wrap(r.run(source, [], "sort", [], ctx, { mutationScopeDepth: 0 }))
        const later = r.run(source, [], "push", [7], ctx, { mutationScopeDepth: 0 })
        cut.resolve(0)
        assert.deepEqual(await r.export(result, [], ctx), [])
        assert.equal(await later, 1)
        assert.deepEqual(await r.export(source, [], ctx), [7])
    })

    for (const mode of Object.values(r.CHAIN_MODE)) it(`preserves a pending copyWithin result across a later write in mode ${mode}`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: "copyWithin result" }
        const chain = new r.Chain([1, 2], ctx, mode), target = Promise.withResolvers()
        const result = r.run(chain, [], "copyWithin", [target.promise, 0, 1], ctx, { mutationScopeDepth: 0 })
        const holder = new r.Chain(result, ctx, mode)
        const write = r.assignPath(chain, [0], 9, ctx)
        target.resolve(1)
        await write
        assert.deepEqual(await r.export(holder, [], ctx), [1, 1])
        assert.deepEqual(await r.export(chain, [], ctx), [9, 1])
    })

    for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
        it(`selects a known suffix independently of optional earlier appends in mode ${mode}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "relative endpoints" }
            const chain = new r.Chain(["A", "B"], ctx, mode), hold = Promise.withResolvers()
            let inside
            const entry = r.enter(chain, [], ctx, { maximumCount: 2, mayPoisonScope: false },
                ref => { inside = ref; return hold.promise })
            const push = (source, value) => r.run(source, [], "push", [value], ctx, { mutationScopeDepth: 0 })
            const later = push(chain, "Z")
            const copy = (method, args) => new r.Chain(r.run(chain, [], method, args, ctx, {}), ctx, mode)
            const last = source => r.run(source, [], "at", [-1], ctx, {})
            const sliced = copy("slice", [-1]), copied = copy("copyWithin", [-2, -1])
            assert.deepEqual(r.export(sliced, [], ctx), ["Z"])
            assert.equal(r.run(copied, [], "at", [-2], ctx, {}), "Z")
            const filled = r.run(chain, [], "fill", ["Y", -1], ctx, { mutationScopeDepth: 0 })
            assert(!r.isPending(filled, ctx))
            assert.equal(last(chain), "Y")
            assert.equal(r.lookupPath(chain, [0], ctx), "A")
            assert.equal(push(inside, "M"), 3)
            hold.resolve()
            await entry
            assert.equal(await later, 4)
            assert.deepEqual(await r.export(chain, [], ctx), ["A", "B", "M", "Y"])
            assert.deepEqual(await r.export(copied, [], ctx), ["A", "B", "Z", "Z"])
        })
    for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
    for (const timing of ["ready", "sync", "deferred"])
    for (const method of ["fill", "copyWithin", "slice"]) {
        it(`${method} limits a failed endpoint to its selected region in mode ${mode}, ${timing}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: method }
            const source = new r.Chain(["A", "B", "C", "D"], ctx, mode), bound = Promise.withResolvers()
            const cause = r.validationError("bound", ctx, r.ERROR_KIND.OperationInputFailed)
            const input = timing === "ready" ? cause : timing === "sync" ? ready(cause) : bound.promise
            const args = method === "slice" ? [1, input] : method === "copyWithin" ? [1, 2, input] : ["X", 1, input]
            const mutation = method !== "slice"
            const result = r.run(source, [], method, args, ctx, mutation ? { mutationScopeDepth: 0 } : {})
            const output = mutation ? source : new r.Chain(result, ctx, mode)
            assert.equal(r.isPoisoned(output, [], ctx), false)
            if (mutation) assert.equal(r.lookupPath(output, [0], ctx), "A")
            if (method === "copyWithin") assert.equal(r.lookupPath(output, [3], ctx), "D")
            const earlier = r.lookupPath(output, [1], ctx)
            r.assignPath(output, [1], "later", ctx)
            if (timing === "deferred") bound.resolve(cause)
            if (mutation) assert.equal(await result, cause)
            assert.equal(await earlier, cause)
            assert.equal(await r.lookupPath(output, [1], ctx), "later")
            assert.equal(await r.lookupPath(output, ["length"], ctx), method === "slice" ? 3 : 4)
            assert.equal(await r.lookupPath(output, [2], ctx), cause)
            r.repairPath(output, [2], ctx)
            assert.equal(r.lookupPath(output, [2], ctx), cause)
        })
    }
    for (const method of ["fill", "copyWithin"]) it(`${method} publishes an unaffected suffix before a pending start`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: method }
        const source = new r.Chain(["a", "b", "c", "d"], ctx, r.CHAIN_MODE.Unordered), start = Promise.withResolvers()
        const copy = new r.Chain(r.run(source, [], method, method === "fill" ? ["x", start.promise, 2] : [0, start.promise, 2],
            ctx, {}), ctx, r.CHAIN_MODE.Unordered)
        assert.equal(r.lookupPath(copy, [3], ctx), "d")
        start.resolve(1)
        assert.deepEqual(await r.export(copy, [], ctx), method === "fill" ? ["a", "x", "c", "d"] : ["b", "b", "c", "d"])
    })
})
