import {
    Chain,
    assignPath,
    export as exportValue,
    getErrors,
    import as importValue,
    lookupPath,
    run,
    Execution,
} from "../src/index.js"
import { metaOf } from "../src/meta.js"
import { errorCause, expect } from "./support.js"
import * as errorUtils from "../src/error.js"
import * as internalSteps from "../src/internal-step.js"
import * as runtime from "../src/index.js"

describe("causal Error attribution", () => {
    it("exports the complete shared Error-kind vocabulary", () => {
        expect(runtime.ERROR_KIND).to.be(errorUtils.ERROR_KIND)
        expect(Object.keys(runtime.ERROR_KIND).sort()).to.eql([
            "AssignmentValueFailed",
            "ChainValueFailed",
            "ContextValueFailed",
            "ControlledCallbackFailed",
            "DivideByZero",
            "ExportReflectionFailed",
            "ExternalCapabilityEscape",
            "ExternalLocationConflict",
            "ExternalPropertyDeleteFailed",
            "ExternalPropertyReadFailed",
            "ExternalPropertyWriteFailed",
            "ImportBindingMissing",
            "ImportReflectionFailed",
            "IncompatibleOperands",
            "InvalidArrayLength",
            "InvalidArrayOperation",
            "InvalidCallbackResult",
            "InvalidConcurrentLimit",
            "InvalidExpressionValue",
            "InvalidExternalSnapshot",
            "InvalidManagedReceiver",
            "InvalidPathSegment",
            "InvalidTextValue",
            "InvocationFailed",
            "IteratorFailed",
            "LoadFailed",
            "LookupReflectionFailed",
            "MissingFunction",
            "Multiple",
            "NaNResult",
            "NotAFunction",
            "NotDestructurable",
            "NotIterable",
            "NullLookup",
            "OperationInputFailed",
            "PathSegmentFailed",
            "PropertyMutationFailed",
            "PropertyValidation",
            "QueryReflectionFailed",
            "ScalarConversionFailed",
            "ScalarLookup",
            "ThenAccessFailed",
            "ThenInvocationFailed",
            "UnknownVariable",
            "UnsupportedMutation",
        ])
        for (const [name, value] of Object.entries(runtime.ERROR_KIND)) {
            expect(value).to.be(name)
        }
    })

    it("keeps a producer's source and kind through later consumers", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const reason = new Error("late failure")
        const value = importValue(
            Promise.reject(reason),
            { ...testContext, errorContext: "producer import" },
        )
        const chain = new Chain(value, testContext)

        const failure = await lookupPath(chain, [], testContext)

        expect(failure).to.be.a(runtime.PoisonError)
        expect(failure.cause).to.be(reason)
        expect(failure.errorContext).to.be("producer import")
        expect(failure.kind).to.be(errorUtils.ERROR_KIND.ContextValueFailed)
        expect(lookupPath(chain, [], testContext)).to.be(failure)
    })

    it("attributes assignment and lookup failures to their own operations", () => {
        const executionContext = { execution: new Execution(), errorContext: "Chain initialization" }
        const chain = new runtime.Chain({}, executionContext)
        const native = new Error("assigned")
        const assignmentContext = { execution: executionContext.execution, errorContext: "assignment source" }

        runtime.assignPath(chain, ["failure"], native, assignmentContext)
        const assigned = runtime.lookupPath(
            chain,
            ["failure"],
            { execution: executionContext.execution, errorContext: "later lookup" },
        )
        const missing = runtime.lookupPath(
            chain,
            ["missing", "child"],
            { execution: executionContext.execution, errorContext: "invalid lookup" },
        )

        expect(assigned.cause).to.be(native)
        expect(assigned.errorContext).to.be("assignment source")
        expect(assigned.kind).to.be(errorUtils.ERROR_KIND.AssignmentValueFailed)
        expect(missing.errorContext).to.be("invalid lookup")
        expect(missing.kind).to.be(errorUtils.ERROR_KIND.NullLookup)
    })

    it("creates one wrapper per native-Error occurrence", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const native = new Error("shared native failure")
        const source = { first: native, second: native }
        const imported = importValue(source, { ...testContext, errorContext: "native Error import" })

        const first = lookupPath(new Chain(imported, testContext), ["first"], testContext)
        const second = lookupPath(new Chain(imported, testContext), ["second"], testContext)

        expect(source.first).to.be(native)
        expect(source.second).to.be(native)
        expect(metaOf(native, testContext)).to.be(undefined)
        expect(first).not.to.be(second)
        for (const occurrence of [first, second]) {
            expect(occurrence.cause).to.be(native)
            expect(occurrence.errorContext).to.be("native Error import")
            expect(occurrence.kind).to.be(
                errorUtils.ERROR_KIND.ContextValueFailed,
            )
        }
        expect(errorUtils.combineErrors(
            [first, second],
            "combined",
        )).to.be(first)
    })

    it("deduplicates equivalent Error occurrences in queries and export", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const native = new Error("shared native failure")
        const chain = new Chain(importValue({
            first: native,
            second: native,
        }, { ...testContext, errorContext: "shared native Error import" }), testContext)

        const occurrences = getErrors(chain, [], testContext)
        const exported = exportValue(chain, [], testContext)

        expect(occurrences.errors).to.be(undefined)
        expect(occurrences.cause).to.be(native)
        expect(exported).to.be(occurrences)
    })

    it("attributes reuse of one native Error to each consuming boundary", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const native = new Error("reused")

        const first = importValue(native, { ...testContext, errorContext: "first import" })
        const second = importValue(native, { ...testContext, errorContext: "second import" })

        expect(first).not.to.be(second)
        expect(first.cause).to.be(native)
        expect(first.errorContext).to.be("first import")
        expect(second.cause).to.be(native)
        expect(second.errorContext).to.be("second import")
    })

    it("detaches an imported Error overlay when its placement changes", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const native = new Error("old value")
        const imported = importValue({ value: native }, { ...testContext, errorContext: "fixed Error import" })
        const chain = new Chain(imported, testContext)

        const occurrence = lookupPath(chain, ["value"], testContext)
        assignPath(chain, ["value"], 1, testContext)

        expect(occurrence.cause).to.be(native)
        expect(lookupPath(chain, ["value"], testContext)).to.be(1)
        expect(metaOf(chain._state.value, testContext).placementVersions?.value)
            .to.be(undefined)
    })

    it("preserves an imported Error occurrence through copy-on-write", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const native = new Error("copied occurrence")
        const source = importValue({
            branch: { failure: native, value: 1 },
        }, { ...testContext, errorContext: "fixed Error import" })
        const chain = new Chain(source, testContext)
        lookupPath(chain, [], testContext)
        const before = lookupPath(chain, ["branch", "failure"], testContext)

        assignPath(chain, ["branch", "value"], 2, testContext)
        const after = lookupPath(chain, ["branch", "failure"], testContext)

        expect(chain._state.value).not.to.be(source)
        expect(after).to.be(before)
        expect(after.cause).to.be(native)
        expect(after.errorContext).to.be("fixed Error import")
    })

    it("attributes then acquisition and invocation to first sampling", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const acquisition = new Error("then getter failed")
        const acquisitionValue = Object.defineProperty({}, "then", {
            get() {
                throw acquisition
            },
        })
        const acquisitionContext = { ...testContext, errorContext: "then acquisition" }
        const acquisitionChain = new runtime.Chain(
            acquisitionValue,
            acquisitionContext,
        )

        const acquired = await runtime.lookupPath(
            acquisitionChain,
            [],
            { execution: acquisitionContext.execution, errorContext: "later acquisition consumer" },
        )
        expect(acquired.cause).to.be(acquisition)
        expect(acquired.errorContext).to.be("then acquisition")
        expect(acquired.kind).to.be(errorUtils.ERROR_KIND.ThenAccessFailed)

        const invocation = new Error("then invocation failed")
        const invocationContext = { ...testContext, errorContext: "then invocation" }
        const invocationChain = new runtime.Chain({
            then() {
                throw invocation
            },
        }, invocationContext)
        const invoked = await runtime.lookupPath(
            invocationChain,
            [],
            { execution: invocationContext.execution, errorContext: "later invocation consumer" },
        )
        expect(invoked.cause).to.be(invocation)
        expect(invoked.errorContext).to.be("then invocation")
        expect(invoked.kind).to.be(errorUtils.ERROR_KIND.ThenInvocationFailed)
    })

    it("commits no Error overlay when an import segment fails", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const native = new Error("nested")
        let fail = true
        const source = new Proxy({ failure: native, broken: true }, {
            getOwnPropertyDescriptor(target, key) {
                if (fail && key === "broken") throw new Error("reflection failed")
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })

        const failed = importValue(source, { ...testContext, errorContext: "failed import" })
        expect(errorCause(failed).message).to.be("reflection failed")
        expect(metaOf(source, testContext)).to.be(undefined)

        fail = false
        const imported = importValue(source, { ...testContext, errorContext: "successful import" })
        const occurrence = lookupPath(new Chain(imported, testContext), ["failure"], testContext)
        expect(occurrence.cause).to.be(native)
        expect(occurrence.errorContext).to.be("successful import")
    })

    it("distinguishes host throws, returned Errors, and rejections", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
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

        const thrownResult = run(new Chain(receiver, testContext), [], "throwFailure", [], { ...testContext, errorContext: "test run" }, { repair: false })
        const returnedResult = run(
            new Chain(receiver, testContext),
            [],
            "returnFailure",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )
        const fulfilledResult = await run(
            new Chain(receiver, testContext),
            [],
            "fulfillFailure",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )
        const rejectedResult = await run(
            new Chain(receiver, testContext),
            [],
            "rejectFailure",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        ).catch(error => error)

        expect(errorCause(thrownResult)).to.be(thrown)
        expect(thrownResult.kind).to.be(errorUtils.ERROR_KIND.InvocationFailed)
        expect(thrownResult.errorContext).to.be("test run")
        expect(errorCause(returnedResult)).to.be(returned)
        expect(returnedResult.kind).to.be(errorUtils.ERROR_KIND.InvocationFailed)
        expect(errorCause(fulfilledResult)).to.be(fulfilled)
        expect(fulfilledResult.kind).to.be(errorUtils.ERROR_KIND.InvocationFailed)
        expect(errorCause(rejectedResult)).to.be(rejected)
        expect(rejectedResult.kind).to.be(errorUtils.ERROR_KIND.InvocationFailed)
    })

    it("preserves an imported Promise's source through copy-on-write", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const cause = new Error("copied pending failure")
        let reject
        const pending = new Promise((_resolve, rejectPromise) => {
            reject = rejectPromise
        })
        const imported = importValue(
            { branch: { pending, sibling: 0 } },
            { ...testContext, errorContext: "copied Promise import" },
        )
        const chain = new Chain(imported, testContext)

        lookupPath(chain, [], testContext)
        assignPath(chain, ["branch", "sibling"], 1, testContext)
        const result = lookupPath(chain, ["branch", "pending"], testContext)
        reject(cause)
        const failure = await result

        expect(errorCause(failure)).to.be(cause)
        expect(failure.errorContext).to.be("copied Promise import")
        expect(failure.kind).to.be(errorUtils.ERROR_KIND.ContextValueFailed)
    })

    it("attributes Errors nested in a host result to that result boundary", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
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

        const result = run(new Chain(receiver, testContext), [], "result", [], { ...testContext, errorContext: "test run" }, { repair: false })
        const chain = new Chain(result, testContext)
        const ready = lookupPath(chain, ["ready"], testContext)
        const pending = await lookupPath(chain, ["pending"], testContext)

        expect(ready.cause).to.be(readyCause)
        expect(ready.errorContext).to.be("test run")
        expect(ready.kind).to.be(errorUtils.ERROR_KIND.InvocationFailed)
        expect(pending.cause).to.be(rejectionCause)
        expect(pending.errorContext).to.be("test run")
        expect(pending.kind).to.be(errorUtils.ERROR_KIND.InvocationFailed)
    })

    it("flattens compounds and retains different causal kinds", () => {
        const firstCause = new Error("first")
        const secondCause = new Error("second")
        const context = { execution: new Execution(), errorContext: "compound" }
        const first = errorUtils.createPoisonError(
            firstCause,
            context,
            errorUtils.ERROR_KIND.LookupReflectionFailed,
        )
        const duplicate = errorUtils.createPoisonError(
            firstCause,
            context,
            errorUtils.ERROR_KIND.InvocationFailed,
        )
        const second = errorUtils.createPoisonError(
            secondCause,
            context,
            errorUtils.ERROR_KIND.InvocationFailed,
        )
        const nested = errorUtils.combineErrors([duplicate, second], "nested")

        const combined = errorUtils.combineErrors([first, nested], "combined")

        expect(combined).to.be.a(runtime.CompoundPoisonError)
        expect(new Set(combined.errors)).to.eql(
            new Set([first, duplicate, second]),
        )
        expect(combined.kinds).to.be(undefined)
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

        const failure = errorUtils.createPoisonError(
            native,
            { execution: new Execution(), errorContext: "host failure" },
            errorUtils.ERROR_KIND.InvocationFailed,
        )

        expect(reads).to.be(0)
        expect(failure.message).to.be(
            "External action failed with a non-Error value",
        )
        expect(failure.cause).to.be(native)
    })

    it("wraps and reports a fatal failure once", () => {
        const cause = new Error("runtime failure")
        const reported = []
        const execution = new runtime.Execution(error => reported.push(error))
        const context = { execution, errorContext: "fatal operation" }
        let failure
        try {
            internalSteps.runInternalStep(context, () => {
                throw cause
            })
        } catch (error) {
            failure = error
        }
        expect(failure).to.be.a(runtime.FatalError)
        expect(failure.cause).to.be(cause)
        expect(failure.errorContext).to.be("fatal operation")
        expect(failure.kind).to.be(undefined)
        expect(errorUtils.isFatalError(failure)).to.be(true)
        expect(errorUtils.isPoisonError(failure)).to.be(false)
        expect(() =>
            errorUtils.createPoisonError(
                failure,
                context,
                errorUtils.ERROR_KIND.OperationInputFailed,
            ),
        ).to.throwException(error => expect(error).to.be(failure))
        try {
            internalSteps.runInternalStep(context, () => {
                throw failure
            })
        } catch (error) {
            expect(error).to.be(failure)
        }
        expect(reported).to.eql([failure])
    })

})
