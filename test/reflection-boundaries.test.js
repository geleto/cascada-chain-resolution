import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const routes = [
    ["assign", (chain, ctx) => r.assignPath(chain, ["item", "x"], 2, ctx), true],
    ["delete", (chain, ctx) => r.deletePath(chain, ["item", "x"], ctx), true],
    ["enter", (chain, ctx) => r.enter(chain, ["item"], ctx, true, inside => { r.assignPath(inside, ["x"], 2, ctx) }), true],
    ["call", (chain, ctx) => r.run(chain, ["item"], "bump", [], ctx, { mutationScopeDepth: 1 }), true],
    ["lookup", (chain, ctx) => r.lookupPath(chain, ["item", "x"], ctx)],
    ["expression", (chain, ctx) => r.lookupPathForExpression(chain, ["item", "x"], ctx)],
    ["export", (chain, ctx) => r.export(chain, [], ctx)],
    ["getErrors", (chain, ctx) => r.getErrors(chain, [], ctx)],
    ["hasError", (chain, ctx) => r.hasError(chain, [], ctx)],
    ["result import", (chain, ctx) => r.importMethodResult(r.lookupPath(chain, [], ctx), ctx)],
]

function fixture(failAt, source = { x: 1, bump() { this.x++ } }) {
    const ctx = { execution: new r.Execution(), errorContext: {} }
    const calls = []
    let armed = false
    const proxy = new Proxy(source, Object.fromEntries(
        ["getOwnPropertyDescriptor", "ownKeys", "getPrototypeOf", "isExtensible"].map(trap => [trap, (...args) => {
            if (armed) {
                calls.push(`${trap}:${String(args[1] ?? "")}`)
                if (calls.length === failAt) throw new Error(`injected reflection failure at ${failAt}: ${calls.at(-1)}`)
            }
            return Reflect[trap](...args)
        }]),
    ))
    const chain = new r.Chain(r.import({ item: proxy }, ctx), ctx)
    return { ctx, chain, source, calls, arm() { armed = true }, disarm() { armed = false } }
}

describe("supported reflection boundary sweeps", () => {
    for (const method of ["flat", "join", "toSorted", "sort", "concat", "slice"]) {
        it(`${method} keeps reflection failure recoverable across pending inputs`, async () => {
            async function run(failAt) {
                const hold = Promise.withResolvers()
                const test = fixture(failAt, [hold.promise, 3])
                const { ctx, chain } = test
                const args = method === "concat" || method === "slice" ? [hold.promise] : []
                test.arm()
                const result = r.run(chain, ["item"], method, args, ctx, {})
                hold.resolve([2, 1])
                const value = await result
                await new Promise(setImmediate)
                test.disarm()
                assert.equal(ctx.execution.fatalError, null)
                verifyRefCounts(ctx, chain._state.value)
                return { ...test, value }
            }
            const baseline = await run(Infinity)
            const args = method === "concat" || method === "slice" ? [[2, 1]] : []
            assert.deepStrictEqual(
                await r.export(new r.Chain(baseline.value, baseline.ctx), [], baseline.ctx),
                Reflect.apply(Array.prototype[method], [[2, 1], 3], args),
            )
            assert(baseline.calls.length > 0)
            for (let failAt = 1; failAt <= baseline.calls.length; failAt++) {
                const { calls } = await run(failAt)
                assert(calls.length >= failAt, `${method}: fault site was not reached`)
            }
        })
    }

    for (const entered of [false, true]) {
        it(`keeps deferred structural owner failures recoverable, entered=${entered}`, async () => {
            async function run(failAt) {
                const test = fixture(failAt, [1, 2, 3])
                const { chain, ctx } = test, hold = Promise.withResolvers()
                test.arm()
                r.assignPath(chain, ["item", "length"], hold.promise, ctx)
                const entry = entered
                    ? r.enter(chain, ["item", 1], ctx, true, inner => { r.assignPath(inner, [], 9, ctx) })
                    : r.assignPath(chain, ["item", 1], 9, ctx)
                const result = r.run(chain, ["item"], "push", [5], ctx, { mutationScopeDepth: 1 })
                hold.resolve(1)
                await Promise.all([entry, result])
                await new Promise(setImmediate)
                test.disarm()
                return test
            }
            const baseline = await run(Infinity)
            assert.deepStrictEqual(await r.export(baseline.chain, [], baseline.ctx), { item: [1, 9, 5] })
            assert(baseline.calls.length > 0)
            for (let failAt = 1; failAt <= baseline.calls.length; failAt++) {
                const { chain, ctx, source, calls } = await run(failAt)
                assert(calls.length >= failAt)
                assert.equal(ctx.execution.fatalError, null, baseline.calls[failAt - 1])
                assert.deepStrictEqual(source, [1, 2, 3])
                assert(r.isPoisonError(await r.getErrors(chain, [], ctx)))
                const path = r.isPoisonError(await r.lookupPath(chain, [], ctx)) ? [] : ["item"]
                assert.equal(await r.repairPath(chain, path, ctx), undefined)
                const { item } = await r.export(chain, [], ctx)
                assert([[1, 2, 3], [1], [1, 9]].some(value => JSON.stringify(value) === JSON.stringify(item)), "Repair must restore a completed earlier command's baseline")
                verifyRefCounts(ctx, chain._state.value)
            }
        })
    }

    for (const [name, action, mutation] of routes) {
        for (const deferred of [false, true]) {
            it(`${name}, deferred selection=${deferred}`, async () => {
                async function run(failAt) {
                    const test = fixture(failAt)
                    const hold = Promise.withResolvers()
                    const entry = deferred ? r.enter(test.chain, [], test.ctx, true, () => hold.promise) : undefined
                    test.arm()
                    // Expression extraction deliberately rejects ordinary poison.
                    const result = Promise.resolve(action(test.chain, test.ctx)).catch(error => {
                        assert(r.isPoisonError(error), `${name}: reflection escaped as fatal`)
                        return error
                    })
                    hold.resolve()
                    await Promise.all([entry, result])
                    await new Promise(setImmediate)
                    test.disarm()
                    return test
                }
                const baseline = await run(Infinity)
                for (let failAt = 1; failAt <= baseline.calls.length; failAt++) {
                    const { ctx, chain, source, calls } = await run(failAt)
                    assert(calls.length >= failAt, `${name}: fault site was not reached`)
                    assert.equal(ctx.execution.fatalError, null, `${name}: ${baseline.calls[failAt - 1]}`)
                    assert.equal(source.x, 1, "Imported storage changed")
                    if (mutation) {
                        // Repair the actual poisoned placement, not a healthy
                        // ancestor: managed repair does not erase child Errors.
                        let repaired = false
                        for (const path of [[], ["item"], ["item", "x"]]) {
                            if (r.isPoisonError(await r.lookupPath(chain, path, ctx))) {
                                assert.equal(await r.repairPath(chain, path, ctx), undefined)
                                repaired = true
                                break
                            }
                        }
                        assert(repaired, `${name}: supported mutation failure did not poison its owner`)
                    }
                    assert.deepStrictEqual(await r.export(chain, [], ctx), { item: source })
                    verifyRefCounts(ctx, chain._state.value)
                }
            })
        }
    }
})
