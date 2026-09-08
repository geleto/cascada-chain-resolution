import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import { ready, rejected, OrderedThenable, ChainedThenable } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = (execution = new runtime.Execution()) => Object.freeze({
    execution,
    errorContext: Object.freeze({ operation: "expression boundary" }),
})
const poison = ctx => runtime.createPoisonError(
    new Error("native cause"), ctx, runtime.ERROR_KIND.InvocationFailed,
)

describe("expression boundary", () => {
    it("keeps repeatable synchronous rejection separate from native Errors", async () => {
        const ctx = context()
        const first = poison(ctx)
        const compound = runtime.combineErrors([first, poison(ctx)], "both")
        for (const error of [first, compound]) {
            const value = runtime.createPoisonedValue(error)
            assert.equal(Error.isError(value), false)
            assert.equal(runtime.isPoisonedValue(value), true)
            assert.equal(runtime.isPoisonedValue(error), false)
            assert.equal(runtime.isPoisonedValue(Promise.resolve(1)), false)
            assert.equal(runtime.isPoisonedValue(1), false)
            assert.equal(value.error, error)
            assert(Object.isFrozen(value))
            assert.equal(Object.hasOwn(value, "then"), false)
            assert.equal(value.then(), value)
            assert.equal(value.then(undefined, 1), value)
            assert.equal(value.catch, undefined)
            assert.equal(value.finally, undefined)
            for (let i = 0; i < 2; i++) {
                assert.equal(value.then(() => assert.fail("fulfilled"), e => e), error)
            }
            const thrown = new Error("callback escape")
            assert.throws(() => value.then(undefined, () => { throw thrown }), e => e === thrown)
            await assert.rejects(Promise.resolve(value), e => e === error)
            assert.equal(await Promise.resolve(value).catch(e => e), error)
            await assert.rejects(Promise.resolve(value).catch(() => value), e => e === error)
            assert.equal(error.then, undefined)
            assert.equal(await Promise.resolve(error), error)
        }
    })

    for (const [mode, deliver] of Object.entries({
        ready: value => value,
        synchronous: ready,
        pending: value => Promise.resolve(value),
    })) {
        it(`extracts exactly the accepted types, ${mode}`, async () => {
            const ctx = context()
            for (const value of ["", "text", 0, -0, NaN, Infinity, true, false, 9007199254740993n]) {
                const chain = new runtime.Chain({ value: deliver(value) }, ctx)
                const result = runtime.lookupPathForExpression(chain, ["value"], ctx)
                assert.equal(result instanceof Promise, mode === "pending")
                assert(Object.is(await result, value))
                assert(Object.is(runtime.lookupPath(chain, ["value"], ctx), value))
            }
        })

        it(`rejects unsupported types without coercion, mutation, or descendant waits, ${mode}`, async () => {
            const ctx = context()
            let coerced = 0
            const record = {
                pending: new Promise(() => {}),
                [Symbol.toPrimitive]() { coerced++; throw new Error("coercion") },
            }
            for (const value of [null, undefined, Symbol("value"), Object(1), () => {}, [], record, new Date()]) {
                const chain = new runtime.Chain({ value: deliver(value) }, ctx)
                const result = runtime.lookupPathForExpression(chain, ["value"], ctx)
                let error
                if (mode === "pending") {
                    assert(result instanceof Promise)
                    await assert.rejects(result, failure => { error = failure; return true })
                } else {
                    assert(runtime.isPoisonedValue(result))
                    error = result.error
                }
                assert(runtime.isPoisonError(error))
                assert.equal(error.kind, runtime.ERROR_KIND.InvalidExpressionValue)
                assert.equal(error.errorContext, ctx.errorContext)
                assert.equal(Object.hasOwn(error, "cause"), false)
                assert.equal(runtime.lookupPath(chain, ["value"], ctx), value)
                assert.equal(ctx.execution.fatalError, null)
            }
            assert.equal(coerced, 0)
        })

        it(`preserves existing leaf and compound attribution, ${mode}`, async () => {
            const introduced = context()
            const consumer = context(introduced.execution)
            const first = poison(introduced)
            for (const error of [first, runtime.combineErrors([first, poison(introduced)], "both")]) {
                const chain = new runtime.Chain(deliver(error), introduced)
                const result = runtime.lookupPathForExpression(chain, [], consumer)
                if (mode === "pending") await assert.rejects(result, e => e === error)
                else assert.equal(result.error, error)
                assert.equal(runtime.getErrors(chain, [], consumer).errorContext, introduced.errorContext)
            }
        })

        it(`consumes failure containers at every supported input boundary, ${mode}`, async () => {
            const ctx = context()
            const error = poison(ctx)
            const failure = runtime.createPoisonedValue(error)
            const input = () => mode === "synchronous" ? rejected(error) : deliver(failure)
            assert.equal(await runtime.import(input(), ctx), error)
            assert.equal(await runtime.importMethodResult(input(), ctx), error)
            const root = new runtime.Chain(input(), ctx)
            assert.equal(await runtime.lookupPath(root, [], ctx), error)
            const chain = new runtime.Chain({ value: input() }, ctx)
            assert.equal(await runtime.lookupPath(chain, ["value"], ctx), error)
            runtime.assignPath(chain, ["assigned"], input(), ctx)
            assert.equal(await runtime.lookupPath(chain, ["assigned"], ctx), error)
            const methods = new runtime.Chain({
                get() { return input() },
                accept() { assert.fail("failed arguments must suppress invocation") },
            }, ctx)
            assert.equal(await runtime.run(methods, [], "get", [], ctx, {}), error)
            assert.equal(await runtime.run(methods, [], "accept", [input()], ctx, {}), error)
            assert.equal(ctx.execution._metadata.get(failure), undefined)
            assert.equal(runtime.lookupPath(chain, ["value"], ctx), error)
            verifyRefCounts(ctx, chain._state.value)
        })
    }

    for (const [mode, Thenable] of Object.entries({
        native: undefined,
        ordered: OrderedThenable,
        chained: ChainedThenable,
    })) {
        for (const rootPending of [false, true]) {
            for (const initial of [1, null]) {
                it(`captures expression lookup before later assignment, ${mode}, rootPending=${rootPending}, initial=${initial}`, async () => {
                    const ctx = context()
                    const source = Thenable ? new Thenable() : Promise.withResolvers()
                    const pending = source.promise ?? source
                    const chain = new runtime.Chain(rootPending ? pending : { value: pending }, ctx)
                    const before = runtime.lookupPathForExpression(chain, ["value"], ctx)
                    const checkBefore = initial === null
                        ? assert.rejects(Promise.resolve(before), {
                            kind: runtime.ERROR_KIND.InvalidExpressionValue,
                            errorContext: ctx.errorContext,
                        })
                        : Promise.resolve(before).then(value => assert.equal(value, initial))

                    runtime.assignPath(chain, ["value"], 2, ctx)
                    const after = runtime.lookupPathForExpression(chain, ["value"], ctx)
                    source.resolve(rootPending ? { value: initial } : initial)

                    await checkBefore
                    assert.equal(await after, 2)
                    assert.equal(runtime.lookupPathForExpression(chain, ["value"], ctx), 2)
                    assert.equal(ctx.execution.fatalError, null)
                    verifyRefCounts(ctx, chain._state.value)
                })
            }
        }
    }

    it("keeps missing-terminal validation distinct from existing path failure", () => {
        const ctx = context()
        const chain = new runtime.Chain({}, ctx)
        assert.equal(runtime.lookupPath(chain, ["missing"], ctx), undefined)
        assert.equal(runtime.lookupPathForExpression(chain, ["missing"], ctx).error.kind,
            runtime.ERROR_KIND.InvalidExpressionValue)
        assert.equal(runtime.lookupPathForExpression(chain, ["missing", "child"], ctx).error.kind,
            runtime.ERROR_KIND.NullLookup)
        assert.deepEqual(runtime.lookupPath(chain, [], ctx), {})
    })

    for (const pending of [false, true]) {
        it(`retains lookup reflection attribution, pending=${pending}`, async () => {
            const ctx = context()
            const cause = new Error("lookup reflection")
            let fail = false
            const root = new Proxy({ value: 1 }, {
                getOwnPropertyDescriptor(target, key) {
                    if (fail && key === "value") throw cause
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const chain = new runtime.Chain(pending ? Promise.resolve(root) : root, ctx)
            fail = true
            await assert.rejects(Promise.resolve(runtime.lookupPathForExpression(chain, ["value"], ctx)), error => {
                assert.equal(error.cause, cause)
                assert.equal(error.kind, runtime.ERROR_KIND.LookupReflectionFailed)
                assert.equal(error.errorContext, ctx.errorContext)
                return true
            })
            fail = false
            assert.equal(runtime.lookupPathForExpression(chain, ["value"], ctx), 1)
            assert.equal(ctx.execution.fatalError, null)
        })

        it(`extracts successful hasError Booleans and propagates its query failure, pending=${pending}`, async () => {
            const ctx = context()
            for (const input of [{ clean: 1 }, { failure: poison(ctx) }]) {
                const chain = new runtime.Chain(pending ? Promise.resolve(input) : input, ctx)
                const query = runtime.hasError(chain, [], ctx)
                const result = runtime.lookupPathForExpression(new runtime.Chain(query, ctx), [], ctx)
                assert.equal(await result, "failure" in input)
            }
            const cause = new Error("query reflection")
            const root = new Proxy({}, {
                ownKeys() { throw cause },
            })
            const chain = new runtime.Chain(pending ? Promise.resolve(root) : root, ctx)
            const query = runtime.hasError(chain, [], ctx)
            const result = runtime.lookupPathForExpression(new runtime.Chain(query, ctx), [], ctx)
            await assert.rejects(Promise.resolve(result), error => {
                assert.equal(error.kind, runtime.ERROR_KIND.QueryReflectionFailed)
                assert.equal(error.cause, cause)
                return true
            })
            assert.equal(ctx.execution.fatalError, null)
        })

        it(`finishes entered callback rejection with ordinary Error and releases its lease, pending=${pending}`, async () => {
            const ctx = context()
            const error = poison(ctx)
            const root = { value: 1 }
            const chain = new runtime.Chain(root, ctx)
            const result = runtime.enter(chain, [], ctx, false, () =>
                pending ? Promise.reject(error) : runtime.createPoisonedValue(error),
            )
            assert.equal(await result, error)
            assert.equal(ctx.execution._metadata.get(root).readLeaseCount, undefined)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("preserves causal raw rejection before expression extraction", async () => {
        for (const deliver of [rejected, reason => Promise.reject(reason)]) {
            const introduced = context()
            const consumer = context(introduced.execution)
            const cause = new Error("rejected input")
            const chain = new runtime.Chain(deliver(cause), introduced)
            const result = runtime.lookupPathForExpression(chain, [], consumer)
            await assert.rejects(Promise.resolve(result), error => {
                assert.equal(error.cause, cause)
                assert.equal(error.errorContext, introduced.errorContext)
                assert.equal(error.kind, runtime.ERROR_KIND.ChainValueFailed)
                return true
            })
        }
    })

    it("rejects declaration thenables without admitting their containers", () => {
        const ctx = context()
        const value = runtime.createPoisonedValue(poison(ctx))
        for (const declare of [runtime.externalState, runtime.managedState]) {
            const error = declare(value)
            assert(Error.isError(error))
            assert.equal(runtime.isPoisonError(error), false)
        }
        assert.equal(ctx.execution._metadata.get(value), undefined)
    })

    it("does not introduce prototype reflection while consuming supported thenables", async () => {
        const ctx = context()
        const source = Promise.resolve(7)
        const then = source.then.bind(source)
        const value = new Proxy({}, {
            get(_target, key) { return key === "then" ? then : undefined },
            getPrototypeOf() { assert.fail("unused prototype reflection") },
        })
        const chain = new runtime.Chain(value, ctx)
        assert.equal(await runtime.lookupPathForExpression(chain, [], ctx), 7)
    })

    it("owns one pending fatal obligation and none for synchronous failure", async () => {
        const ctx = context()
        const register = ctx.execution.registerFatalResultRejection.bind(ctx.execution)
        let registrations = 0
        let active = 0
        ctx.execution.registerFatalResultRejection = reject => {
            registrations++
            active++
            const remove = register(reject)
            return () => { active--; remove() }
        }
        runtime.lookupPathForExpression(new runtime.Chain(null, ctx), [], ctx)
        assert.equal(registrations, 0)
        const source = Promise.withResolvers()
        const chain = new runtime.Chain(source.promise, ctx)
        const result = runtime.lookupPathForExpression(chain, [], ctx)
        assert.equal(registrations, 1)
        assert.equal(active, 1)
        source.resolve(null)
        await assert.rejects(result, e => e.kind === runtime.ERROR_KIND.InvalidExpressionValue)
        assert.equal(active, 0)

        const blocked = runtime.lookupPathForExpression(new runtime.Chain(new Promise(() => {}), ctx), [], ctx)
        assert.equal(registrations, 2)
        let fatal
        assert.throws(() => runtime.failExecution(ctx, new Error("runtime defect")), e => { fatal = e; return true })
        await assert.rejects(blocked, e => e === fatal)
        assert.throws(() => runtime.lookupPathForExpression(chain, [], ctx), e => e === fatal)
    })

    it("preserves a fatal committed before outward delivery", async () => {
        const ctx = context()
        const source = Promise.withResolvers()
        const chain = new runtime.Chain(source.promise, ctx)
        let fatal
        source.promise.then(() => {
            try { runtime.failExecution(ctx, new Error("between settlement and delivery")) }
            catch (error) { fatal = error }
        })
        const result = runtime.lookupPathForExpression(chain, [], ctx)
        source.resolve(1)
        await assert.rejects(result, e => e === fatal)
    })
})
