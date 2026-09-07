import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import * as kernel from "cascada-chain-resolution/integration"
import * as errors from "../src/error.js"
import * as values from "../src/language-values.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { ready, rejected } from "./ordered-thenable.js"

const context = (source = Object.freeze({ operation: "test" })) =>
    Object.freeze({
        execution: new runtime.Execution(),
        errorContext: source,
    })
const leaves = error =>
    error instanceof runtime.CompoundPoisonError ? error.errors : [error]
const flush = async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve()
}
const capture = action => {
    try {
        action()
    } catch (error) {
        return error
    }
    assert.fail("Expected a throw")
}

// The higher runtime owns one causal body and one outward result boundary.
function hostStep(ctx, kind, action) {
    return kernel.runInternalStep(ctx, () => {
        const result = kernel.runHostBoundary(ctx, kind, action)
        return kernel.continueOperation(
            result,
            ctx,
            value =>
                Error.isError(value)
                    ? kernel.createPoisonError(value, ctx, kind)
                    : value,
            reason => kernel.createPoisonError(reason, ctx, kind),
        )
    })
}

describe("causal failure architecture", () => {
    it("re-exports core operations and the single outward completion implementation", async () => {
        for (const [file, names] of [
            ["import", ["import", "importMethodResult"]],
            ["mutations", ["assignPath", "deletePath"]],
            ["observations", ["lookupPath", "hasError", "getErrors"]],
            ["run", ["run"]],
            ["enter", ["enter"]],
            ["operation-result", ["returnOperationResult"]],
        ]) {
            const core = await import("../src/" + file + ".js")
            for (const name of names) assert.equal(kernel[name], core[name])
        }
        assert.notEqual(runtime.import, kernel.import)
        assert.equal(kernel.createPoisonError, errors.createPoisonError)
    })

    it("exports standalone-call arguments and attributes nested host results", async () => {
        function callHost(operationContext, callable, args) {
            const result = kernel.runInternalStep(operationContext, () => {
                const inputs = kernel.export(
                    new kernel.Chain(args, operationContext),
                    [],
                    operationContext,
                )
                return kernel.continueOperation(inputs, operationContext, prepared => {
                    if (kernel.isPoisonError(prepared)) return prepared
                    const result = kernel.runHostBoundary(
                        operationContext,
                        kernel.ERROR_KIND.HostCallFailed,
                        () => Reflect.apply(callable, undefined, prepared),
                    )
                    return kernel.importMethodResult(result, operationContext)
                })
            })
            return kernel.returnOperationResult(operationContext, result)
        }

        const ctx = context()
        const argument = runtime.import({ value: 1 }, ctx)
        const cause = new Error("nested host failure")
        const output = callHost(
            ctx,
            function (copy) {
                assert.equal(this, undefined)
                copy.value = 2
                return { value: copy.value, failed: Promise.reject(cause) }
            },
            [argument],
        )
        assert.equal(argument.value, 1)
        assert.equal(output.value, 2)
        const failure = await runtime.lookupPath(
            new runtime.Chain(output, ctx),
            ["failed"],
            ctx,
        )
        assert.equal(failure.cause, cause)
        assert.equal(failure.kind, kernel.ERROR_KIND.HostCallFailed)
        assert.equal(failure.errorContext, ctx.errorContext)
    })
    it("uses private brands, native inheritance, and immutable complete wrappers", () => {
        const ctx = context()
        const native = new Error("native")
        const first = kernel.createPoisonError(
            native,
            ctx,
            kernel.ERROR_KIND.HostCallFailed,
        )
        const second = errors.validationError(
            "invalid",
            ctx,
            kernel.ERROR_KIND.PropertyValidation,
        )
        const input = [first, second]
        const compound = kernel.combineErrors(input, "combined")
        input.length = 0
        assert.equal(
            Object.getPrototypeOf(runtime.PoisonError.prototype),
            Error.prototype,
        )
        assert.equal(
            Object.getPrototypeOf(runtime.FatalError.prototype),
            Error.prototype,
        )
        assert.equal(
            Object.getPrototypeOf(runtime.CompoundPoisonError.prototype),
            runtime.PoisonError.prototype,
        )
        for (const error of [first, compound]) {
            assert(Error.isError(error))
            assert(runtime.isPoisonError(error))
            assert(Object.isFrozen(error))
            assert.equal(error.then, undefined)
        }
        assert(Object.isFrozen(compound.errors))
        assert.deepEqual(new Set(compound.errors), new Set([first, second]))
        assert.equal(compound.kinds, undefined)
        assert.equal(
            runtime.isPoisonError(Object.create(runtime.PoisonError.prototype)),
            false,
        )
        assert.equal(
            runtime.isFatalError(Object.create(runtime.FatalError.prototype)),
            false,
        )
        for (const Type of [
            runtime.PoisonError,
            runtime.CompoundPoisonError,
            runtime.FatalError,
        ])
            assert.throws(
                () => new Type("forged", ctx.errorContext, "forged"),
                TypeError,
            )
        assert.equal(
            kernel.createPoisonError(
                first,
                context(),
                kernel.ERROR_KIND.PropertyValidation,
            ),
            first,
        )
    })

    for (const cause of [
        undefined,
        null,
        false,
        0,
        -0,
        NaN,
        "failure",
        new Error("singleton"),
    ]) {
        it("deduplicates present causes, including " + String(cause), () => {
            const source = {}
            const ctx = context(source)
            const first = kernel.createPoisonError(
                cause,
                ctx,
                kernel.ERROR_KIND.HostCallFailed,
            )
            const same = kernel.createPoisonError(
                cause,
                context(source),
                kernel.ERROR_KIND.HostCallFailed,
            )
            const otherSource = kernel.createPoisonError(
                cause,
                context(),
                kernel.ERROR_KIND.HostCallFailed,
            )
            const otherKind = kernel.createPoisonError(
                cause,
                ctx,
                kernel.ERROR_KIND.IteratorFailed,
            )
            const missingA = errors.validationError(
                "missing",
                ctx,
                kernel.ERROR_KIND.HostCallFailed,
            )
            const missingB = errors.validationError(
                "missing",
                ctx,
                kernel.ERROR_KIND.HostCallFailed,
            )
            assert(Object.hasOwn(first, "cause"))
            assert.equal(kernel.combineErrors([first, same], "same"), first)
            const expected = new Set([
                first,
                otherSource,
                otherKind,
                missingA,
                missingB,
            ])
            const compound = kernel.combineErrors(
                [first, same, otherSource, otherKind, missingA, missingB],
                "distinct",
            )
            assert.deepEqual(new Set(compound.errors), expected)
            const chain = new runtime.Chain({ first, same, compound }, ctx)
            assert.deepEqual(
                new Set(runtime.getErrors(chain, [], ctx)),
                expected,
            )
            assert.deepEqual(
                new Set(leaves(runtime.export(chain, [], ctx))),
                expected,
            )
        })
    }

    it("keeps distinct operations on one source line separate through collection", async () => {
        const execution = new runtime.Execution()
        const source = Object.freeze({ path: "script.csc", line: 3, operation: "call" })
        const otherSource = Object.freeze({ ...source })
        const firstContext = Object.freeze({ execution, errorContext: source })
        const secondContext = Object.freeze({ execution, errorContext: otherSource })
        const consumer = Object.freeze({ execution, errorContext: "later consumer" })
        const cause = new Error("reused native failure")
        const first = hostStep(
            firstContext,
            runtime.ERROR_KIND.HostCallFailed,
            () => { throw cause },
        )
        const second = await hostStep(
            secondContext,
            runtime.ERROR_KIND.HostCallFailed,
            () => Promise.reject(cause),
        )
        const chain = new runtime.Chain({ first, second, repeated: first }, consumer)
        const collected = runtime.getErrors(chain, [], consumer)
        assert.equal(collected.length, 2)
        assert(collected.includes(first))
        assert(collected.includes(second))
        assert.equal(first.cause, cause)
        assert.equal(second.cause, cause)
        assert.equal(first.errorContext, source)
        assert.equal(second.errorContext, otherSource)
        assert.equal(execution.fatalError, null)
    })

    it("retains exact native diagnostics and the complete opaque Cascada source without reading hooks", async () => {
        const source = Object.freeze({
            path: "script.csc",
            line: 3,
            column: 7,
            operation: "read",
            route: ["caller"],
        })
        const ctx = context(source)
        const cause = new Error("native", { cause: new Error("nested") })
        cause.code = "E_NATIVE"
        cause.line = 999
        let reads = 0
        Object.defineProperty(cause, "stack", {
            get() {
                reads++
                throw new Error("stack read")
            },
        })
        for (const result of [
            cause,
            Promise.resolve(cause),
            Promise.reject(cause),
        ]) {
            const failure = await hostStep(
                ctx,
                kernel.ERROR_KIND.HostCallFailed,
                () => result,
            )
            assert.equal(failure.cause, cause)
            assert.equal(failure.errorContext, source)
            assert.equal(failure.line, undefined)
            assert.equal(reads, 0)
        }
    })

    it("treats raw Error admission as a missed causal boundary", () => {
        const ctx = context()
        const failure = capture(() =>
            kernel.runInternalStep(ctx, () =>
                values.admitReadyValue(new Error("raw"), ctx),
            ),
        )
        assert(runtime.isFatalError(failure))
        assert.equal(failure, ctx.execution.fatalError)
        assert.match(failure.cause.message, /causal boundary/)
    })

    for (const [missing, supplied] of [
        ["omitted operation context", undefined],
        ["null operation context", null],
        ["execution in an empty operation context", {}],
        ["execution in a source-only context", { errorContext: "source" }],
        ["execution in an unbound operation context", { execution: null }],
    ]) {
        it(`rejects ${missing} at the common entry before any work`, () => {
            let calls = 0
            const first = capture(() =>
                kernel.runInternalStep(supplied, () => calls++),
            )
            const second = capture(
                () =>
                    new runtime.Chain(
                        new Proxy(
                            {},
                            {
                                get() {
                                    calls++
                                },
                            },
                        ),
                        supplied,
                    ),
            )
            assert(runtime.isFatalError(first))
            assert(runtime.isFatalError(second))
            assert.match(first.cause.message, /operation context.*execution/i)
            assert.match(first.errorContext.problem, /execution binding/)
            assert.equal(calls, 0)
            const ctx = context()
            assert.equal(
                capture(() =>
                    kernel.createPoisonError(
                        first,
                        ctx,
                        kernel.ERROR_KIND.HostCallFailed,
                    ),
                ),
                first,
            )
            assert.equal(ctx.execution.fatalError, first)
            const enclosing = context()
            const propagated = capture(() =>
                kernel.runInternalStep(enclosing, () =>
                    kernel.runInternalStep(supplied, () => calls++),
                ),
            )
            assert(runtime.isFatalError(propagated))
            assert.equal(enclosing.execution.fatalError, propagated)
            assert.equal(calls, 0)
        })
    }

    it("distinguishes an Error-valued then property from failure reading then", () => {
        const ctx = context()
        const cause = new Error("then")
        const ordinary = { then: cause }
        assert.equal(new runtime.Chain(ordinary, ctx)._state.value, ordinary)
        const failed = new runtime.Chain(
            Object.defineProperty({}, "then", {
                get() {
                    throw cause
                },
            }),
            ctx,
        )._state.value
        assert.equal(failed.cause, cause)
        assert.equal(failed.kind, kernel.ERROR_KIND.ThenAccessFailed)
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const [mode, outcome] of [
        [
            "thrown",
            cause => {
                throw cause
            },
        ],
        ["returned", cause => cause],
        ["synchronous custom fulfillment", ready],
        ["synchronous custom rejection", rejected],
        ["fulfilled", cause => Promise.resolve(cause)],
        ["rejected", cause => Promise.reject(cause)],
    ]) {
        it(
            "uses the same direct mutation failure effect when " + mode,
            async () => {
                const ctx = context()
                const cause = new Error(mode)
                const receiver = {
                    change() {
                        this.changed = true
                        return outcome(cause)
                    },
                }
                const chain = new runtime.Chain(receiver, ctx)
                const failure = await runtime.run(
                    chain,
                    [],
                    "change",
                    [],
                    ctx,
                    { mutationScopeDepth: 0 },
                )
                assert.equal(failure.cause, cause)
                assert.equal(failure.kind, kernel.ERROR_KIND.HostCallFailed)
                assert.equal(runtime.lookupPath(chain, [], ctx), failure)
                assert.equal(ctx.execution.fatalError, null)
            },
        )
    }

    for (const [mode, deliver] of [
        ["ready", value => value],
        ["synchronous custom", ready],
        ["pending", value => Promise.resolve(value)],
    ]) {
        it(
            "composes standalone calls and iterator advancement with " +
                mode +
                " delivery",
            async () => {
                const ctx = context()
                const call = hostStep(
                    ctx,
                    kernel.ERROR_KIND.HostCallFailed,
                    () => deliver(3),
                )
                assert.equal(kernel.isPending(call, ctx), mode === "pending")
                assert.equal(await kernel.returnOperationResult(ctx, call), 3)
                const cause = new Error("iterator")
                const iterator = {
                    next() {
                        return deliver(cause)
                    },
                }
                const advance = hostStep(
                    ctx,
                    kernel.ERROR_KIND.IteratorFailed,
                    () => iterator.next(),
                )
                const failure = await kernel.returnOperationResult(ctx, advance)
                assert.equal(failure.cause, cause)
                assert.equal(failure.kind, kernel.ERROR_KIND.IteratorFailed)
                assert.equal(failure.errorContext, ctx.errorContext)
            },
        )
    }

    it("keeps the first fatal when host code catches re-entry and returns successfully", async () => {
        const ctx = context()
        const chain = new runtime.Chain({ value: 1 }, ctx)
        const waiting = runtime.import(new Promise(() => {}), ctx)
        let nested
        const failure = capture(() =>
            hostStep(ctx, kernel.ERROR_KIND.HostCallFailed, () => {
                nested = capture(() =>
                    runtime.lookupPath(chain, ["value"], ctx),
                )
                return 4
            }),
        )
        assert(runtime.isFatalError(failure))
        assert.equal(failure, nested)
        await assert.rejects(waiting, error => error === failure)
    })

    for (const reverse of [false, true]) {
        it(
            "collects the complete required receiver and argument frontier, reverse=" +
                reverse,
            async () => {
                const ctx = context()
                const receiverPending = Promise.withResolvers()
                const argumentPending = Promise.withResolvers()
                const causes = [
                    new Error("ready"),
                    new Error("receiver"),
                    new Error("argument"),
                ]
                let calls = 0
                const receiver = runtime.import(
                    {
                        ready: causes[0],
                        pending: receiverPending.promise,
                        call() {
                            calls++
                        },
                    },
                    ctx,
                )
                const argument = runtime.import(
                    { pending: argumentPending.promise },
                    ctx,
                )
                const chain = new runtime.Chain(receiver, ctx)
                let done = false
                const result = runtime
                    .run(chain, [], "call", [argument], ctx, {})
                    .then(value => {
                        done = true
                        return value
                    })
                const pending = reverse
                    ? [argumentPending, receiverPending]
                    : [receiverPending, argumentPending]
                const failures = reverse
                    ? [causes[2], causes[1]]
                    : [causes[1], causes[2]]
                pending[0].reject(failures[0])
                await flush()
                assert.equal(done, false)
                pending[1].reject(failures[1])
                const failure = await result
                assert.deepEqual(
                    new Set(leaves(failure).map(error => error.cause)),
                    new Set(causes),
                )
                assert(
                    leaves(failure).every(
                        error => error.errorContext === ctx.errorContext,
                    ),
                )
                assert.equal(calls, 0)
                assert.equal(ctx.execution.fatalError, null)
                verifyRefCounts(ctx, receiver, argument)
            },
        )
    }

    it("preserves ordinary contextless declaration errors and existing fatals", () => {
        const cause = new Error("declaration")
        const opaque = Object.defineProperty({}, "then", {
            get() {
                throw cause
            },
        })
        assert.equal(runtime.managedState(opaque), cause)
        const ctx = context()
        const poison = runtime.import(cause, ctx)
        assert.equal(poison.cause, cause)
        assert.equal(ctx.execution.fatalError, null)
        const fatal = capture(() =>
            kernel.failExecution(context(), new Error("fatal")),
        )
        const proxy = new Proxy(
            {},
            {
                getPrototypeOf() {
                    throw fatal
                },
            },
        )
        assert.equal(
            capture(() => new runtime.Chain(proxy, ctx)),
            fatal,
        )
        assert.equal(ctx.execution.fatalError, fatal)
        for (const declare of [
            runtime.managedState,
            runtime.externalState,
            runtime.managedStateClass,
        ])
            assert.equal(
                capture(() => declare(fatal)),
                fatal,
            )
    })
})
