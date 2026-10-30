import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { ready, OrderedThenable, ChainedThenable } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new r.Execution(), errorContext: {} })
const tick = () => new Promise(resolve => setImmediate(resolve))
const methods = ["includes", "indexOf", "lastIndexOf"]

function signal(delivery) {
    if (delivery === "ready") return { promise: undefined, resolve() {} }
    if (delivery === "synchronous") return { promise: ready(undefined), resolve() {} }
    if (delivery === "native") return Promise.withResolvers()
    const source = delivery === "ordered" ? new OrderedThenable() : new ChainedThenable()
    return { promise: source, resolve: value => source.resolve(value) }
}

function arrayChain(representation, ctx, initial) {
    if (representation === "imported") return new r.Chain({ list: r.import(initial, ctx) }, ctx)
    if (representation === "view") {
        const source = new r.Chain([99, ...initial, 99], ctx)
        return new r.Chain({ list: r.run(source, [], "slice", [1, -1], ctx, {}) }, ctx)
    }
    return new r.Chain({ list: initial }, ctx)
}

function searches(chain, ctx, expected) {
    return methods.map(method => r.run(chain, ["list"], method, [expected], ctx, {}))
}

const invalidations = {
    overwrite: (chain, ctx, key) => r.assignPath(chain, ["list", key], 9, ctx),
    delete: (chain, ctx, key) => r.deletePath(chain, ["list", key], ctx),
    pop: (chain, ctx) => r.run(chain, ["list"], "pop", [], ctx, { mutationScopeDepth: 1 }),
    splice: (chain, ctx) => r.run(chain, ["list"], "splice", [1, 1, 9], ctx, { mutationScopeDepth: 1 }),
    truncate: (chain, ctx) => r.assignPath(chain, ["list", "length"], 1, ctx),
}

describe("Array search issuance ordering", () => {
    for (const representation of ["runtime", "imported", "view"]) {
        for (const delivery of ["ready", "synchronous", "native", "ordered", "chained"]) {
            it(`captures searches around queued append invalidation: ${representation}, ${delivery}`, async () => {
                for (const [name, invalidate] of Object.entries(invalidations)) {
                    for (const deferredKey of name === "overwrite" || name === "delete" ? [false, true] : [false]) {
                        for (const keyFirst of deferredKey ? [false, true] : [false]) {
                            const ctx = context(), hold = signal(delivery), key = Promise.withResolvers()
                            const chain = arrayChain(representation, ctx, [1])
                            const entry = r.enter(chain, ["list"], ctx, true, () => hold.promise)
                            const append = r.run(chain, ["list"], "push", [7], ctx, { mutationScopeDepth: 1 })
                            const before = searches(chain, ctx, 7)
                            const write = invalidate(chain, ctx, deferredKey ? key.promise : 1)
                            const after = searches(chain, ctx, 7)
                            let beforeSettled = false, afterSettled = false
                            Promise.all(before).then(() => { beforeSettled = true })
                            Promise.all(after).then(() => { afterSettled = true })
                            if (delivery === "native" || delivery === "ordered" || delivery === "chained") {
                                await tick()
                                assert.equal(beforeSettled, false, name)
                                assert.equal(afterSettled, false, name)
                            }
                            if (keyFirst) key.resolve(1)
                            hold.resolve()
                            await tick()
                            if (deferredKey && !keyFirst) {
                                assert.equal(afterSettled, false, name)
                                // A later unresolved index must not delay the earlier search.
                                assert.equal(beforeSettled, true, name)
                            }
                            key.resolve(1)
                            assert.deepEqual(await Promise.all(before), [true, 1, 1], name)
                            assert.deepEqual(await Promise.all(after), [false, -1, -1], name)
                            await Promise.all([entry, append, write])
                            assert.equal(ctx.execution.fatalError, null)
                            verifyRefCounts(ctx, chain._state)
                        }
                    }
                }
            })
        }
    }

    for (const delivery of ["native", "ordered", "chained"]) {
        it(`orders an overwrite whose last index comes from the pending push result: ${delivery}`, async () => {
            for (const representation of ["runtime", "imported", "view"]) {
                const ctx = context(), hold = signal(delivery), chain = arrayChain(representation, ctx, [1])
                const entry = r.enter(chain, ["list"], ctx, true, () => hold.promise)
                const append = r.run(chain, ["list"], "push", [7], ctx, { mutationScopeDepth: 1 })
                const lastIndex = append.then(length => length - 1)
                const before = searches(chain, ctx, 7)
                const write = r.assignPath(chain, ["list", lastIndex], 9, ctx)
                const after = searches(chain, ctx, 7)
                hold.resolve()
                assert.deepEqual(await Promise.all(before), [true, 1, 1])
                assert.deepEqual(await Promise.all(after), [false, -1, -1])
                await Promise.all([entry, write])
                verifyRefCounts(ctx, chain._state)
            }
        })

        it(`does not use an intermediate match inside an earlier unfinished entry: ${delivery}`, async () => {
            const ctx = context(), hold = signal(delivery), chain = arrayChain("runtime", ctx, [1])
            const entry = r.enter(chain, ["list"], ctx, true, inside => {
                r.run(inside, [], "push", [7], ctx, { mutationScopeDepth: 0 })
                return hold.promise.then(() => r.assignPath(inside, [1], 9, ctx))
            })
            const result = searches(chain, ctx, 7)
            let settled = false
            Promise.all(result).then(() => { settled = true })
            await tick()
            assert.equal(settled, false)
            hold.resolve()
            assert.deepEqual(await Promise.all(result), [false, -1, -1])
            await entry
            verifyRefCounts(ctx, chain._state)
        })

        it(`keeps a delayed search argument on its captured array version: ${delivery}`, async () => {
            for (const argument of ["needle", "fromIndex"]) {
                const ctx = context(), hold = signal(delivery), input = signal(delivery)
                const chain = arrayChain("runtime", ctx, [1])
                const entry = r.enter(chain, ["list"], ctx, true, () => hold.promise)
                const append = r.run(chain, ["list"], "push", [7], ctx, { mutationScopeDepth: 1 })
                const before = methods.map(method => r.run(chain, ["list"], method,
                    argument === "needle" ? [input.promise] : [7, input.promise], ctx, {}))
                const write = r.assignPath(chain, ["list", 1], 9, ctx)
                const after = searches(chain, ctx, 7)
                hold.resolve()
                let earlier, later
                Promise.all(before).then(value => { earlier = value })
                Promise.all(after).then(value => { later = value })
                await tick()
                assert.equal(earlier, undefined)
                assert.deepEqual(later, [false, -1, -1])
                input.resolve(argument === "needle" ? 7 : 1)
                assert.deepEqual(await Promise.all(before), [true, 1, 1])
                await Promise.all([entry, append, write])
                verifyRefCounts(ctx, chain._state)
            }
        })

        it(`does not wait for an overwritten payload behind an earlier gate: ${delivery}`, async () => {
            const ctx = context(), hold = signal(delivery), payload = signal(delivery)
            const chain = arrayChain("runtime", ctx, [1])
            const entry = r.enter(chain, ["list"], ctx, true, () => hold.promise)
            const append = r.run(chain, ["list"], "push", [payload.promise], ctx, { mutationScopeDepth: 1 })
            const before = searches(chain, ctx, 7)
            const write = r.assignPath(chain, ["list", 1], 9, ctx)
            const after = searches(chain, ctx, 7)
            hold.resolve()
            let earlier, later
            Promise.all(before).then(value => { earlier = value })
            Promise.all(after).then(value => { later = value })
            await tick()
            assert.equal(earlier, undefined)
            assert.deepEqual(later, [false, -1, -1])
            payload.resolve(7)
            assert.deepEqual(await Promise.all(before), [true, 1, 1])
            await Promise.all([entry, append, write])
            verifyRefCounts(ctx, chain._state)
        })

        it(`allows a stable match while another earlier candidate can still change: ${delivery}`, async () => {
            const ctx = context(), hold = signal(delivery), chain = arrayChain("runtime", ctx, [7, 7])
            const entry = r.enter(chain, ["list", 0], ctx, true, inside =>
                hold.promise.then(() => r.assignPath(inside, [], 9, ctx)))
            assert.equal(r.run(chain, ["list"], "includes", [7], ctx, {}), true)
            const first = r.run(chain, ["list"], "indexOf", [7], ctx, {})
            let settled = false
            Promise.resolve(first).then(() => { settled = true })
            await tick()
            assert.equal(settled, false)
            hold.resolve()
            assert.equal(await first, 1)
            await entry
            verifyRefCounts(ctx, chain._state)
        })
    }
})
