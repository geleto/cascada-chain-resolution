import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import { ready } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const deliveries = {
    ready: value => value,
    synchronous: ready,
    pending: value => Promise.resolve(value),
}
const context = () =>
    Object.freeze({
        execution: new runtime.Execution(),
        errorContext: Object.freeze({ operation: "Array preparation" }),
    })
const leaves = error => error.errors ?? [error]

function unreadableArray(cause) {
    return new Proxy([1], {
        ownKeys() {
            throw cause
        },
    })
}

describe("Array preparation boundaries", () => {
    for (const [delivery, deliver] of Object.entries(deliveries)) {
        for (const method of ["flat", "concat"]) {
            it(`${method} attributes nested reflection failure with ${delivery} input`, async () => {
                const ctx = context()
                const cause = new Error("Array reflection")
                const input = deliver(unreadableArray(cause))
                const chain = new runtime.Chain(
                    method === "flat" ? [input] : [],
                    ctx,
                )
                const result = runtime.run(
                    chain,
                    [],
                    method,
                    method === "flat" ? [1] : [input],
                    ctx,
                    {},
                )
                if (delivery !== "pending")
                    assert(runtime.isPoisonError(result))
                const failure = await result
                assert.equal(failure.cause, cause)
                assert.equal(failure.errorContext, ctx.errorContext)
                assert.equal(
                    failure.kind,
                    runtime.ERROR_KIND.InvalidArrayOperation,
                )
                assert.equal(ctx.execution.fatalError, null)
            })
        }

        it(`flat collects both cyclic branches with ${delivery} input`, async () => {
            const ctx = context()
            const cycles = [[], []]
            for (const cycle of cycles) cycle.push(cycle)
            const chain = new runtime.Chain(cycles.map(deliver), ctx)
            const result = runtime.run(chain, [], "flat", [Infinity], ctx, {})
            if (delivery !== "pending") assert(runtime.isPoisonError(result))
            const failure = await result
            assert.equal(leaves(failure).length, 2)
            for (const error of leaves(failure)) {
                assert.equal(
                    error.kind,
                    runtime.ERROR_KIND.InvalidArrayOperation,
                )
                assert.equal(error.errorContext, ctx.errorContext)
            }
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state.value)
        })

        it(`join collects nested conversion failures with ${delivery} input`, async () => {
            const ctx = context()
            const causes = [
                new Error("first element"),
                new Error("second element"),
            ]
            const inputs = causes.map(cause =>
                deliver(
                    new Proxy([1], {
                        getOwnPropertyDescriptor(target, key) {
                            if (key === "0") throw cause
                            return Reflect.getOwnPropertyDescriptor(target, key)
                        },
                    }),
                ),
            )
            const chain = new runtime.Chain(inputs, ctx)
            const failure = await runtime.run(chain, [], "join", [], ctx, {})
            assert.deepEqual(
                new Set(leaves(failure).map(error => error.cause)),
                new Set(causes),
            )
            for (const error of leaves(failure)) {
                assert.equal(
                    error.kind,
                    runtime.ERROR_KIND.ScalarConversionFailed,
                )
                assert.equal(error.errorContext, ctx.errorContext)
            }
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const method of ["flat", "concat"]) {
        it(`${method} keeps collecting after a ready branch fails`, async () => {
            const ctx = context()
            const later = Promise.withResolvers()
            const causes = [
                new Error("ready branch"),
                new Error("later branch"),
            ]
            const inputs = [unreadableArray(causes[0]), later.promise]
            const chain = new runtime.Chain(
                method === "flat" ? inputs : [],
                ctx,
            )
            let completed = false
            const result = runtime.run(
                chain,
                [],
                method,
                method === "flat" ? [1] : inputs,
                ctx,
                {},
            )
            assert(result instanceof Promise)
            const outcome = result.then(value => {
                completed = true
                return value
            })
            await Promise.resolve()
            assert.equal(completed, false)
            later.resolve(unreadableArray(causes[1]))
            const failure = await outcome
            assert.deepEqual(
                new Set(leaves(failure).map(error => error.cause)),
                new Set(causes),
            )
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const pending of [false, true]) {
        it(`indexOf recovers reflection failure in its next step, pending=${pending}`, async () => {
            const ctx = context()
            const cause = new Error("next element")
            let fail = true
            const receiver = new Proxy([pending ? Promise.resolve(1) : 1, 2], {
                getOwnPropertyDescriptor(target, key) {
                    if (fail && key === "1") throw cause
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const chain = new runtime.Chain(receiver, ctx)
            const failure = await runtime.run(
                chain,
                [],
                "indexOf",
                [3],
                ctx,
                {},
            )
            assert.equal(failure.cause, cause)
            assert.equal(failure.kind, runtime.ERROR_KIND.InvalidArrayOperation)
            assert.equal(failure.errorContext, ctx.errorContext)
            assert.equal(ctx.execution.fatalError, null)
            fail = false
            verifyRefCounts(ctx, chain._state.value)
        })
    }

    it("keeps an adjacent internal failure fatal in nested preparation", () => {
        const ctx = context()
        const child = runtime.import([1], ctx)
        const chain = new runtime.Chain([child], ctx)
        const cause = new Error("corrupt admission facts")
        Object.defineProperty(ctx.execution._metadata.get(child), "type", {
            get() {
                throw cause
            },
        })
        assert.throws(
            () => runtime.run(chain, [], "flat", [1], ctx, {}),
            failure => {
                assert(runtime.isFatalError(failure))
                assert.equal(failure.cause, cause)
                assert.equal(ctx.execution.fatalError, failure)
                return true
            },
        )
    })
})
