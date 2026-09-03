import {
    Chain,
    assignPath,
    errorCause,
    expect,
    exportValue,
    getErrors,
    importValue,
    languageValues,
    lookupPath,
    metaOf,
    run,
    testOperationContext,
} from "./support.js"
import * as errorUtils from "../src/error.js"
import * as runtime from "../src/index.js"

describe("causal Error attribution", () => {
    it("exports the complete shared Error-kind vocabulary", () => {
        expect(runtime.ERROR_KIND).to.be(errorUtils.ERROR_KIND)
        expect(Object.keys(runtime.ERROR_KIND).sort()).to.eql([
            "AssignmentValueError",
            "AssignmentValueRejected",
            "AsyncCallback",
            "ChainValueError",
            "ChainValueRejected",
            "ContextValueError",
            "ContextValueRejected",
            "ConversionThrew",
            "DivideByZero",
            "ExportThrew",
            "ExportValueError",
            "ImportBindingMissing",
            "ImportThrew",
            "IncompatibleOperands",
            "InvalidArrayLength",
            "InvalidArrayOperation",
            "InvalidCallbackResult",
            "InvalidConcurrentLimit",
            "InvalidImportValue",
            "InvalidManagedReceiver",
            "InvalidPathSegment",
            "InvalidTextValue",
            "IteratorThrew",
            "LoadFailed",
            "LookupThrew",
            "MissingFunction",
            "Multiple",
            "NaNResult",
            "NotAFunction",
            "NotDestructurable",
            "NotIterable",
            "NullLookup",
            "OperationInputError",
            "OperationInputRejected",
            "PropertyMutationThrew",
            "PropertyValidation",
            "ScalarLookup",
            "ThenAccessThrew",
            "ThenInvocationThrew",
            "UnknownVariable",
            "UnsupportedMutation",
            "UserCallThrew",
        ])
        for (const [name, value] of Object.entries(runtime.ERROR_KIND)) {
            expect(value).to.be(name)
        }
    })

    it("keeps a producer's source and kind through later consumers", async () => {
        const reason = new Error("late failure")
        const value = importValue(
            Promise.reject(reason),
            "producer import",
        )
        const chain = new Chain(value)

        const failure = await lookupPath(chain, [])

        expect(failure).to.be.a(runtime.PoisonError)
        expect(failure.cause).to.be(reason)
        expect(failure.errorContext).to.be("producer import")
        expect(failure.kind).to.be(errorUtils.ERROR_KIND.ContextValueRejected)
        expect(lookupPath(chain, [])).to.be(failure)
    })

    it("attributes assignment and lookup failures to their own operations", () => {
        const executionContext = testOperationContext("Chain initialization")
        const chain = new runtime.Chain({}, executionContext)
        const native = new Error("assigned")
        const assignmentContext = testOperationContext(
            "assignment source",
            executionContext.execution,
        )

        runtime.assignPath(chain, ["failure"], native, assignmentContext)
        const assigned = runtime.lookupPath(
            chain,
            ["failure"],
            testOperationContext("later lookup", executionContext.execution),
        )
        const missing = runtime.lookupPath(
            chain,
            ["missing", "child"],
            testOperationContext("invalid lookup", executionContext.execution),
        )

        expect(assigned.cause).to.be(native)
        expect(assigned.errorContext).to.be("assignment source")
        expect(assigned.kind).to.be(errorUtils.ERROR_KIND.AssignmentValueError)
        expect(missing.errorContext).to.be("invalid lookup")
        expect(missing.kind).to.be(errorUtils.ERROR_KIND.NullLookup)
    })

    it("creates one wrapper per native-Error occurrence", () => {
        const native = new Error("shared native failure")
        const source = { first: native, second: native }
        const imported = importValue(source, "native Error import")

        const first = lookupPath(new Chain(imported), ["first"])
        const second = lookupPath(new Chain(imported), ["second"])

        expect(source.first).to.be(native)
        expect(source.second).to.be(native)
        expect(metaOf(native)).to.be(undefined)
        expect(first).not.to.be(second)
        for (const occurrence of [first, second]) {
            expect(occurrence.cause).to.be(native)
            expect(occurrence.errorContext).to.be("native Error import")
            expect(occurrence.kind).to.be(errorUtils.ERROR_KIND.ContextValueError)
        }
        expect(errorUtils.combineErrors(
            [first, second],
            "combined",
        )).to.be(first)
    })

    it("preserves Error occurrences in queries and groups their shared cause on export", () => {
        const native = new Error("shared native failure")
        const chain = new Chain(importValue({
            first: native,
            second: native,
        }, "shared native Error import"))

        const occurrences = getErrors(chain, [])
        const exported = exportValue(chain, [])

        expect(occurrences.length).to.be(2)
        expect(occurrences[0]).not.to.be(occurrences[1])
        expect(occurrences.map(error => error.cause)).to.eql([native, native])
        expect(exported).to.be(occurrences[0])
    })

    it("attributes reuse of one native Error to each consuming boundary", () => {
        const native = new Error("reused")

        const first = importValue(native, "first import")
        const second = importValue(native, "second import")

        expect(first).not.to.be(second)
        expect(first.cause).to.be(native)
        expect(first.errorContext).to.be("first import")
        expect(second.cause).to.be(native)
        expect(second.errorContext).to.be("second import")
    })

    it("detaches an imported Error overlay when its placement changes", () => {
        const native = new Error("old value")
        const imported = importValue({ value: native }, "fixed Error import")
        const chain = new Chain(imported)

        const occurrence = lookupPath(chain, ["value"])
        assignPath(chain, ["value"], 1)

        expect(occurrence.cause).to.be(native)
        expect(lookupPath(chain, ["value"])).to.be(1)
        expect(metaOf(chain._state.value).placementVersions?.value)
            .to.be(undefined)
    })

    it("preserves an imported Error occurrence through copy-on-write", () => {
        const native = new Error("copied occurrence")
        const source = importValue({
            branch: { failure: native, value: 1 },
        }, "fixed Error import")
        const chain = new Chain(source)
        lookupPath(chain, [])
        const before = lookupPath(chain, ["branch", "failure"])

        assignPath(chain, ["branch", "value"], 2)
        const after = lookupPath(chain, ["branch", "failure"])

        expect(chain._state.value).not.to.be(source)
        expect(after).to.be(before)
        expect(after.cause).to.be(native)
        expect(after.errorContext).to.be("fixed Error import")
    })

    it("attributes then acquisition and invocation to first sampling", async () => {
        const acquisition = new Error("then getter failed")
        const acquisitionValue = Object.defineProperty({}, "then", {
            get() {
                throw acquisition
            },
        })
        const acquisitionContext = testOperationContext("then acquisition")
        const acquisitionChain = new runtime.Chain(
            acquisitionValue,
            acquisitionContext,
        )

        const acquired = await runtime.lookupPath(
            acquisitionChain,
            [],
            testOperationContext("later acquisition consumer", acquisitionContext.execution),
        )
        expect(acquired.cause).to.be(acquisition)
        expect(acquired.errorContext).to.be("then acquisition")
        expect(acquired.kind).to.be(errorUtils.ERROR_KIND.ThenAccessThrew)

        const invocation = new Error("then invocation failed")
        const invocationContext = testOperationContext("then invocation")
        const invocationChain = new runtime.Chain({
            then() {
                throw invocation
            },
        }, invocationContext)
        const invoked = await runtime.lookupPath(
            invocationChain,
            [],
            testOperationContext("later invocation consumer", invocationContext.execution),
        )
        expect(invoked.cause).to.be(invocation)
        expect(invoked.errorContext).to.be("then invocation")
        expect(invoked.kind).to.be(errorUtils.ERROR_KIND.ThenInvocationThrew)
    })

    it("ignores a custom then throw after its first settlement", async () => {
        const laterThrow = new Error("too late")
        const chain = new Chain({
            then(resolve) {
                resolve("settled")
                throw laterThrow
            },
        })

        expect(await lookupPath(chain, [])).to.be("settled")
    })

    it("commits no Error overlay when an import segment fails", () => {
        const native = new Error("nested")
        let fail = true
        const source = new Proxy({ failure: native, broken: true }, {
            getOwnPropertyDescriptor(target, key) {
                if (fail && key === "broken") throw new Error("reflection failed")
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })

        const failed = importValue(source, "failed import")
        expect(errorCause(failed).message).to.be("reflection failed")
        expect(metaOf(source)).to.be(undefined)

        fail = false
        const imported = importValue(source, "successful import")
        const occurrence = lookupPath(new Chain(imported), ["failure"])
        expect(occurrence.cause).to.be(native)
        expect(occurrence.errorContext).to.be("successful import")
    })

    it("distinguishes host throws, returned Errors, and rejections", async () => {
        const thrown = new Error("thrown")
        const returned = new Error("returned")
        const fulfilled = new Error("fulfilled")
        const rejected = new Error("rejected")
        const receiver = {
            throwFailure() {
                throw thrown
            },
            returnFailure() {
                return returned
            },
            fulfillFailure() {
                return Promise.resolve(fulfilled)
            },
            rejectFailure() {
                return Promise.reject(rejected)
            },
        }

        const thrownResult = run(new Chain(receiver), [], "throwFailure", [], {})
        const returnedResult = run(new Chain(receiver), [], "returnFailure", [], {})
        const fulfilledResult = await run(
            new Chain(receiver),
            [],
            "fulfillFailure",
            [],
            {},
        )
        const rejectedResult = await run(
            new Chain(receiver),
            [],
            "rejectFailure",
            [],
            {},
        ).catch(error => error)

        expect(errorCause(thrownResult)).to.be(thrown)
        expect(thrownResult.kind).to.be(errorUtils.ERROR_KIND.UserCallThrew)
        expect(thrownResult.errorContext).to.be("test run")
        expect(errorCause(returnedResult)).to.be(returned)
        expect(returnedResult.kind).to.be(errorUtils.ERROR_KIND.UserCallThrew)
        expect(errorCause(fulfilledResult)).to.be(fulfilled)
        expect(fulfilledResult.kind).to.be(errorUtils.ERROR_KIND.UserCallThrew)
        expect(errorCause(rejectedResult)).to.be(rejected)
        expect(rejectedResult.kind).to.be(errorUtils.ERROR_KIND.UserCallThrew)
    })

    it("preserves an imported Promise's source through copy-on-write", async () => {
        const cause = new Error("copied pending failure")
        let reject
        const pending = new Promise((_resolve, rejectPromise) => {
            reject = rejectPromise
        })
        const imported = importValue(
            { branch: { pending, sibling: 0 } },
            "copied Promise import",
        )
        const chain = new Chain(imported)

        lookupPath(chain, [])
        assignPath(chain, ["branch", "sibling"], 1)
        const result = lookupPath(chain, ["branch", "pending"])
        reject(cause)
        const failure = await result

        expect(errorCause(failure)).to.be(cause)
        expect(failure.errorContext).to.be("copied Promise import")
        expect(failure.kind).to.be(errorUtils.ERROR_KIND.ContextValueRejected)
    })

    it("attributes Errors nested in a host result to that result boundary", async () => {
        const readyCause = new Error("nested ready")
        const rejectionCause = new Error("nested rejection")
        const receiver = {
            result() {
                return {
                    ready: readyCause,
                    pending: Promise.reject(rejectionCause),
                }
            },
        }

        const result = run(new Chain(receiver), [], "result", [], {})
        const chain = new Chain(result)
        const ready = lookupPath(chain, ["ready"])
        const pending = await lookupPath(chain, ["pending"])

        expect(ready.cause).to.be(readyCause)
        expect(ready.errorContext).to.be("test run")
        expect(ready.kind).to.be(errorUtils.ERROR_KIND.UserCallThrew)
        expect(pending.cause).to.be(rejectionCause)
        expect(pending.errorContext).to.be("test run")
        expect(pending.kind).to.be(errorUtils.ERROR_KIND.UserCallThrew)
    })

    it("flattens compounds, preserves order, and deduplicates causes", () => {
        const firstCause = new Error("first")
        const secondCause = new Error("second")
        const context = testOperationContext("compound")
        const first = errorUtils.toPoison(
            firstCause,
            context,
            errorUtils.ERROR_KIND.LookupThrew,
        )
        const duplicate = errorUtils.toPoison(
            firstCause,
            context,
            errorUtils.ERROR_KIND.UserCallThrew,
        )
        const second = errorUtils.toPoison(
            secondCause,
            context,
            errorUtils.ERROR_KIND.UserCallThrew,
        )
        const nested = errorUtils.combineErrors([duplicate, second], "nested")

        const combined = errorUtils.combineErrors([first, nested], "combined")

        expect(combined).to.be.a(runtime.CompoundPoisonError)
        expect(combined.errors).to.eql([first, second])
        expect(combined.kinds).to.eql([
            errorUtils.ERROR_KIND.LookupThrew,
            errorUtils.ERROR_KIND.UserCallThrew,
        ])
        expect(combined.kind).to.be(errorUtils.ERROR_KIND.Multiple)
        expect(combined.errorContext).to.be("compound")
    })

    it("does not invoke Error message accessors while contextualizing", () => {
        const native = new Error()
        let reads = 0
        Object.defineProperty(native, "message", {
            get() {
                reads++
                throw new Error("message getter ran")
            },
        })

        const failure = errorUtils.toPoison(
            native,
            testOperationContext("host failure"),
            errorUtils.ERROR_KIND.UserCallThrew,
        )

        expect(reads).to.be(0)
        expect(failure.message).to.be("User code failed with a non-Error value")
        expect(failure.cause).to.be(native)
    })

    it("wraps and reports a fatal failure once", () => {
        const cause = new Error("runtime failure")
        const context = testOperationContext("fatal operation")
        const reported = []
        errorUtils.setFatalErrorReporter(error => reported.push(error))
        try {
            let failure
            try {
                errorUtils.runFatal(context, () => {
                    throw cause
                })
            } catch (error) {
                failure = error
            }
            expect(failure).to.be.a(runtime.RuntimeError)
            expect(failure.cause).to.be(cause)
            expect(failure.errorContext).to.be("fatal operation")
            expect(failure.kind).to.be(undefined)
            expect(errorUtils.isFatalError(failure)).to.be(true)
            expect(languageValues.isError(failure)).to.be(false)
            expect(errorUtils.toPoison(
                failure,
                context,
                errorUtils.ERROR_KIND.OperationInputError,
            )).to.be(failure)
            try {
                errorUtils.runFatal(context, () => {
                    throw failure
                })
            } catch (error) {
                expect(error).to.be(failure)
            }
            expect(reported).to.eql([failure])
        } finally {
            errorUtils.setFatalErrorReporter()
        }
    })

    it("reports an invalid PoisonError definition as fatal", () => {
        const context = testOperationContext("invalid poison")
        let reported
        errorUtils.setFatalErrorReporter(error => {
            reported = error
        })
        try {
            let failure
            try {
                errorUtils.runFatal(context, () => new errorUtils.PoisonError(
                    "invalid",
                    undefined,
                    "",
                ))
            } catch (error) {
                failure = error
            }

            expect(failure).to.be.a(runtime.RuntimeError)
            expect(failure.cause).to.be.a(TypeError)
            expect(failure.errorContext).to.be("invalid poison")
            expect(reported).to.be(failure)
        } finally {
            errorUtils.setFatalErrorReporter()
        }
    })
})
