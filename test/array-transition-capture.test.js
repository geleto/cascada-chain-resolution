import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new r.Execution(), errorContext: {} })
const methods = [
    ["pop", []], ["shift", []], ["push", [8]], ["unshift", [8]], ["unshift", []],
    ["reverse", []], ["fill", [9, 2]], ["copyWithin", [2, 0, 1]],
    ["splice", [2, 1]], ["splice", [2, 1, 8]], ["splice", [2, 0, 8]], ["splice", []],
]

describe("Array methods capture unfinished placements", () => {
    for (const [method, args] of methods) for (const representation of ["owned", "imported", "shared", "view"]) {
        it(`${method}(${args}) preserves progress and history on ${representation} storage`, async () => {
            for (const captures of [false, true]) for (const index of [0, 1, 2]) for (const action of ["noop", "set", "delete", "pending"]) {
                const ctx = context(), hold = Promise.withResolvers(), data = Promise.withResolvers()
                const source = [10, , 30]
                const initial = representation === "view"
                    ? r.run(new r.Chain([99, 10, , 30, 99], ctx), [], "slice", [1, 4], ctx, {})
                    : representation === "imported" ? r.import(source, ctx) : source
                const chain = new r.Chain({ list: initial, sibling: 4 }, ctx)
                const retained = representation === "shared" ? new r.Chain(r.lookupPath(chain, ["list"], ctx), ctx) : undefined
                assert.equal(r.hasError(chain, [], ctx), false) // Maintain a live index throughout.
                const expected = [10, , 30]
                if (action === "set" || action === "pending") expected[index] = 50
                if (action === "delete") delete expected[index]
                const before = expected.slice()
                const nativeResult = expected[method](...args)
                const expectedResult = Array.isArray(nativeResult) ? nativeResult.slice() : nativeResult
                const entry = r.enter(chain, ["list", index], ctx, true, inside => hold.promise.then(() => {
                    if (action === "set" || action === "pending") r.assignPath(inside, [], action === "pending" ? data.promise : 50, ctx)
                    if (action === "delete") r.deletePath(inside, [], ctx)
                }))
                const earlier = captures ? r.export(chain, ["list"], ctx) : undefined
                const result = r.run(chain, ["list"], method, args, ctx, { mutationScopeDepth: 1 })
                const label = `${method}(${args}); ${representation}; index=${index}; ${action}; captures=${captures}`
                // The new shape is known even if a removed-element result or a
                // transferred element still depends on the open entry.
                assert.equal(r.lookupPath(chain, ["list", "length"], ctx), expected.length, label)
                const scalarWait = method === "pop" && index === 2 || method === "shift" && index === 0
                assert.equal(r.isPending(result, ctx), scalarWait, label)
                verifyRefCounts(ctx, chain._state)
                // Both overwrite and growth occur before the old entry publishes.
                // Its old storage authority must not clobber either new placement.
                const write = r.assignPath(chain, ["list", 0], 77, ctx)
                const tail = expected.length + 2
                const grow = r.assignPath(chain, ["list", tail], 88, ctx)
                expected[0] = 77
                expected[tail] = 88
                hold.resolve()
                await entry
                data.resolve(50)
                await Promise.all([write, grow])
                assert.deepEqual(await r.export(new r.Chain(await result, ctx), [], ctx), expectedResult, label)
                assert.deepEqual(await r.export(chain, ["list"], ctx), expected, label)
                if (captures) assert.deepEqual(await earlier, before, label)
                if (retained) assert.deepEqual(await r.export(retained, [], ctx), [10, , 30], label)
                if (representation === "imported") assert.deepEqual(source, [10, , 30], label)
                assert.equal(r.getErrors(chain, [], ctx), null, label)
                assert.equal(ctx.execution.fatalError, null, label)
                verifyRefCounts(ctx, chain._state, ...(retained ? [retained._state] : []))
            }
        })
    }

    for (const [method, args] of methods) {
        it(`${method}(${args}) keeps only the poison selected by its mapping`, async () => {
            for (const index of [0, 1, 2]) {
                const ctx = context(), hold = Promise.withResolvers()
                const poison = r.createPoisonError(new Error("entered value"), ctx, r.ERROR_KIND.InvocationFailed)
                const chain = new r.Chain([10, , 30], ctx)
                const expected = [10, , 30]
                expected[index] = poison
                const nativeResult = expected[method](...args)
                const entry = r.enter(chain, [index], ctx, true, inside => hold.promise.then(() => r.assignPath(inside, [], poison, ctx)))
                const result = r.run(chain, [], method, args, ctx, { mutationScopeDepth: 0 })
                assert.equal(r.lookupPath(chain, ["length"], ctx), expected.length)
                hold.resolve()
                await entry
                const resultChain = new r.Chain(await result, ctx)
                assert.equal(await r.getErrors(chain, [], ctx), expected.includes(poison) ? poison : null)
                const resultPoisoned = nativeResult === poison || Array.isArray(nativeResult) && nativeResult.includes(poison)
                assert.equal(await r.getErrors(resultChain, [], ctx), resultPoisoned ? poison : null)
                verifyRefCounts(ctx, chain._state, resultChain._state)
            }
        })

        it(`${method}(${args}) preserves its earlier baseline when publication fails`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), cause = new Error("publication refused")
            const source = [10, , 30]
            let refuse = false
            const root = new Proxy({ list: source, sibling: 4 }, {
                set(target, key, value, receiver) {
                    if (refuse && key === "list") throw cause
                    return Reflect.set(target, key, value, receiver)
                },
            })
            const chain = new r.Chain(root, ctx)
            assert.equal(r.hasError(chain, [], ctx), false)
            const entry = r.enter(chain, ["list", 0], ctx, true, inside => hold.promise.then(() => r.assignPath(inside, [], 50, ctx)))
            refuse = true
            const result = r.run(chain, ["list"], method, args, ctx, { mutationScopeDepth: 1 })
            const failure = r.lookupPath(chain, ["list"], ctx)
            assert(r.isPoisonError(failure), "Publication failure must not wait for an unrelated entry")
            assert.equal(failure.cause, cause)
            assert.equal(r.lookupPath(chain, ["sibling"], ctx), 4)
            verifyRefCounts(ctx, chain._state)
            refuse = false
            assert.equal(r.repairPath(chain, ["list"], ctx), undefined)
            assert.equal(r.lookupPath(chain, ["list", "length"], ctx), 3)
            hold.resolve()
            await entry
            assert.equal((await result).cause, cause)
            assert.deepEqual(await r.export(chain, [], ctx), { list: [50, , 30], sibling: 4 })
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("transfers a failed entry's recovery to its remapped placement", async () => {
        const ctx = context(), hold = Promise.withResolvers(), chain = new r.Chain([10, 20], ctx)
        const entry = r.enter(chain, [0], ctx, true, inside => hold.promise.then(() =>
            r.assignPath(inside, ["missing", "child"], 1, ctx)))
        const result = r.run(chain, [], "reverse", [], ctx, { mutationScopeDepth: 0 })
        assert.equal(r.lookupPath(chain, [0], ctx), 20)
        const repair = r.repairPath(chain, [1], ctx)
        hold.resolve()
        await entry
        await repair
        assert.deepEqual(await r.export(chain, [], ctx), [20, 10])
        assert.equal((await r.export(new r.Chain(result, ctx), [], ctx)).kind, r.ERROR_KIND.ScalarLookup)
        verifyRefCounts(ctx, chain._state)
    })

    it("waits for arguments and consumed values, but not unrelated entry completion", async () => {
        const ctx = context(), hold = Promise.withResolvers(), end = Promise.withResolvers()
        const chain = new r.Chain([10, 20, 30], ctx)
        const entry = r.enter(chain, [0], ctx, true, () => hold.promise)
        const fill = r.run(chain, [], "fill", [9, 1, end.promise], ctx, { mutationScopeDepth: 0 })
        let filled = false
        Promise.resolve(fill).then(() => { filled = true })
        assert.equal(filled, false)
        end.resolve(3)
        await new Promise(setImmediate)
        assert.equal(filled, true)
        assert.equal(r.lookupPath(chain, ["length"], ctx), 3)
        assert.equal(r.lookupPath(chain, [2], ctx), 9)
        const sorted = r.run(chain, [], "sort", [], ctx, { mutationScopeDepth: 0 })
        let completed = false
        Promise.resolve(sorted).then(() => { completed = true })
        await new Promise(setImmediate)
        assert.equal(completed, false, "Sorting consumes the still-gated element")
        hold.resolve()
        await Promise.all([entry, sorted])
        assert.deepEqual(await r.export(chain, [], ctx), [10, 9, 9])
        verifyRefCounts(ctx, chain._state)
    })

    for (const [method, args] of [["pop", []], ["shift", []], ["reverse", []], ["fill", [9]], ["copyWithin", [1, 0]], ["splice", [1, 1, 7]]]) {
        it(`${method} handles failure at each source reflection without losing recovery`, async () => {
            async function exercise(failAt) {
                const ctx = context(), hold = Promise.withResolvers(), cause = new Error("source inspection")
                let active = false, reads = 0, injected = false
                const inspect = () => { if (active && ++reads === failAt) { injected = true; throw cause } }
                const source = new Proxy([10, , 30], {
                    getOwnPropertyDescriptor(target, key) { inspect(); return Reflect.getOwnPropertyDescriptor(target, key) },
                    ownKeys(target) { inspect(); return Reflect.ownKeys(target) },
                    isExtensible(target) { inspect(); return Reflect.isExtensible(target) },
                    get(target, key, receiver) { if (key === "length") inspect(); return Reflect.get(target, key, receiver) },
                })
                const chain = new r.Chain({ list: source, sibling: 4 }, ctx)
                assert.equal(r.hasError(chain, [], ctx), false)
                const entry = r.enter(chain, ["list", 0], ctx, true, inside => hold.promise.then(() => r.assignPath(inside, [], 50, ctx)))
                active = true
                let result
                try { result = r.run(chain, ["list"], method, args, ctx, { mutationScopeDepth: 1 }) }
                finally { active = false; hold.resolve() }
                await entry
                result = await result
                assert.equal(injected, failAt > 0, `injection ${failAt} reached`)
                assert.equal(ctx.execution.fatalError, null)
                assert.equal(r.lookupPath(chain, ["sibling"], ctx), 4)
                verifyRefCounts(ctx, chain._state)
                const failedReceiver = r.isPoisonError(r.lookupPath(chain, ["list"], ctx))
                const expected = [50, , 30]
                if (injected) assert((result.errors ?? [result]).some(error => error.cause === cause))
                if (failedReceiver) await r.repairPath(chain, ["list"], ctx)
                else expected[method](...args)
                assert.deepEqual(await r.export(chain, ["list"], ctx), expected)
                verifyRefCounts(ctx, chain._state)
                return reads
            }
            const count = await exercise(0)
            assert(count > 0)
            for (let failAt = 1; failAt <= count; failAt++) await exercise(failAt)
        })
    }
})
