import assert from "node:assert/strict"
import * as runtime from "../src/index.js"
import * as refcounts from "../src/refcounts.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { OrderedThenable } from "./ordered-thenable.js"

const context = () => ({ execution: new runtime.Execution(), errorContext: {} })

for (const route of ["assignment", "deferred assignment", "imported fulfillment", "indexed replacement"]) {
    describe("index recovery through " + route, () => {
        it("leaves retained cycles and existing parent edges valid after late reflection fails", async () => {
            const ctx = context()
            const cause = new Error("late reflection failed")
            let fail = false
            const existing = { value: 1 }
            const indexed = { existing }
            const indexedChain = new runtime.Chain(indexed, ctx)
            runtime.hasError(indexedChain, [], ctx)
            const a = { existing }
            const b = { back: a }
            a.b = b
            a.bad = new Proxy({}, {
                ownKeys(target) {
                    if (fail) throw cause
                    return Reflect.ownKeys(target)
                },
            })
            if (route === "imported fulfillment") runtime.import(a, ctx)
            const retained = [new runtime.Chain(a, ctx), new runtime.Chain(b, ctx)]
            const pending = Promise.withResolvers()
            const root = { slot: route === "imported fulfillment" ? pending.promise : 0 }
            if (route === "imported fulfillment" || route === "indexed replacement") runtime.import(root, ctx)
            const destination = new runtime.Chain(root, ctx)
            runtime.hasError(destination, [], ctx)

            fail = true
            if (route === "imported fulfillment") pending.resolve(a)
            else runtime.assignPath(destination, ["slot"], route === "deferred assignment" ? pending.promise : a, ctx)
            if (route === "deferred assignment") pending.resolve(a)
            const failure = await runtime.lookupPath(destination, ["slot"], ctx)
            assert.equal(
                failure.kind,
                runtime.ERROR_KIND.PropertyMutationFailed,
            )
            assert.equal(failure.cause, cause)
            assert.equal(ctx.execution.fatalError, null)
            assert.equal(refcounts.getRefCounter(a, ctx), undefined)
            assert.equal(refcounts.getRefCounter(b, ctx), undefined)
            assert.deepEqual([...refcounts.getRefCounter(existing, ctx).parents.keys()], [indexed])

            fail = false
            for (const chain of retained) {
                assert.equal(runtime.hasError(chain, [], ctx), false)
                assert.deepEqual(runtime.getErrors(chain, [], ctx), [])
                runtime.assignPath(chain, ["repaired"], true, ctx)
                assert.equal(runtime.lookupPath(chain, ["repaired"], ctx), true)
                verifyRefCounts(ctx, chain._state)
            }
            verifyRefCounts(ctx, a, b, indexed, destination._state)
            assert.equal(ctx.execution.fatalError, null)
        })
    })
}

describe("index preparation", () => {
    for (const indexedFirst of [false, true]) {
        it("counts captured versions advanced during later subscription" + (indexedFirst ? " in an existing index" : ""), () => {
            const ctx = context()
            const bad = new Error("revealed failure")
            class DeliveredOnSecondSubscription extends OrderedThenable {
                then(onFulfilled, onRejected) {
                    if (this.subscriptions === 1) {
                        this.flushOnSubscribe = true
                        this.resolve({ bad })
                    }
                    return super.then(onFulfilled, onRejected)
                }
            }
            const source = new DeliveredOnSecondSubscription()
            const first = { value: source }
            if (indexedFirst) {
                runtime.hasError(new runtime.Chain(first, ctx), [], ctx)
            }
            const root = { first, later: source }
            const chain = new runtime.Chain(root, ctx)
            assert.equal(runtime.hasError(chain, [], ctx), true)
            assert.equal(refcounts.getRefCounts(root, ctx).promiseCount, 0)
            verifyRefCounts(ctx, root)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const query of [runtime.hasError, runtime.getErrors])
        for (const pending of [false, true]) {
            it(
                query.name +
                    " abandons query indexing before propagating " +
                    (pending ? "deferred" : "ready") +
                    " reflection failure",
                async () => {
                    const ctx = context()
                    const cause = new Error("query reflection failed")
                    let fail = true
                    const a = {}
                    const b = { back: a }
                    a.b = b
                    a.bad = new Proxy({}, {
                        ownKeys(target) {
                            if (fail) throw cause
                            return Reflect.ownKeys(target)
                        },
                    })
                    const chain = new runtime.Chain(pending ? Promise.resolve(a) : a, ctx)
                    const result = query(chain, [], ctx)
                    const failure = pending
                        ? await result.catch(error => error)
                        : result
                    assert.equal(failure.cause, cause)
                    assert.equal(
                        failure.kind,
                        runtime.ERROR_KIND.QueryReflectionFailed,
                    )
                    assert.equal(ctx.execution.fatalError, null)
                    assert.equal(refcounts.getRefCounter(a, ctx), undefined)
                    assert.equal(refcounts.getRefCounter(b, ctx), undefined)
                    fail = false
                    assert.equal(runtime.hasError(chain, [], ctx), false)
                    const retained = new runtime.Chain(
                        runtime.lookupPath(chain, ["b"], ctx),
                        ctx,
                    )
                    runtime.assignPath(chain, ["b", "value"], 2, ctx)
                    assert.equal(
                        runtime.lookupPath(chain, ["b", "value"], ctx),
                        2,
                    )
                    assert.equal(
                        runtime.lookupPath(retained, ["value"], ctx),
                        undefined,
                    )
                    verifyRefCounts(ctx, a, b, chain._state.value)
                },
            )
        }

    it("keeps adjacent corrupt bookkeeping fatal", () => {
        const ctx = context()
        const root = { value: 1 }
        const chain = new runtime.Chain(root, ctx)
        runtime.hasError(chain, [], ctx)
        // Simulate a broken internal reverse edge, not a supported host trap.
        refcounts.getRefCounter(root, ctx).parents.set(root, 1)
        assert.throws(() => runtime.assignPath(chain, ["value"], new Error("data"), ctx), runtime.isFatalError)
        assert.equal(ctx.execution.fatalError.cause.message, "Ref-count parent graph contains a cycle")
    })
})
