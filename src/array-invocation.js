import { createMutationOutcome } from "./mutations.js"
import { ArrayView } from "./array-view.js"
import * as internalSteps from "./internal-step.js"
import * as arrayRemaps from "./array-remap.js"
import * as errorUtils from "./error.js"
import { inheritIdentity, IdentityPublication } from "./captured-identity.js"
import { assembleExternalSnapshot } from "./external-snapshot.js"
import {
    ARRAY_METHODS,
    RETURN_RECEIVER,
    PASS_AS_PAYLOAD,
    runArrayStep,
    searchFromIndex,
    resolveArrayLength,
    resolveArrayInRange,
} from "./array-methods.js"

function selectArrayMethodDescription(invocationWork) {
    const { method, mutation } = invocationWork
    const methodDefinition = ARRAY_METHODS[method]
    if (!methodDefinition) {
        return errorUtils.validationError(
            `Unsupported Array method: ${method}`,
            invocationWork.operationContext,
            errorUtils.ERROR_KIND.MissingFunction,
        )
    }
    if (mutation && methodDefinition.methodResult === undefined) {
        return errorUtils.validationError(
            `Array method ${method} cannot be used as a mutation`,
            invocationWork.operationContext,
            errorUtils.ERROR_KIND.InvalidArrayOperation,
        )
    }
    if (invocationWork.receiverCapture)
        invocationWork.arrayLength = invocationWork.receiverCapture.roots[0].shape.length
    return {
        receiverToLease: mutation ? undefined : invocationWork.receiver,
        leaseInputsThroughResult: !mutation &&
            methodDefinition.leaseInputsThroughResult,
        prepareArguments: () => runArrayStep(invocationWork, () => internalSteps.continueGraphTransition(
            prepareArrayMethodArguments(methodDefinition, invocationWork),
            invocationWork.operationContext, args => {
                if (errorUtils.isPoisonError(args)) return args
                const prepared = methodDefinition.prepare ? methodDefinition.prepare(args, invocationWork) : args
                return internalSteps.continueGraphTransition(prepared, invocationWork.operationContext,
                    args => errorUtils.isPoisonError(args) ? args :
                        prepareArrayReceiver(methodDefinition, args, invocationWork),
                    undefined, invocationWork)
            },
            undefined, invocationWork)),
        invoke(preparedArguments) {
            try {
                return runArrayStep(invocationWork, () =>
                    invokeArrayMethod(methodDefinition, preparedArguments, invocationWork))
            } finally { preparedArguments = undefined }
        },
    }
}

// Intrinsics require an exact remap length. Controlled algorithms prepare
// their own bounds or capture shape alongside their required placements.
function prepareArrayReceiver(methodDefinition, args, work) {
    return runArrayStep(work, () => methodDefinition.intrinsic
        ? resolveArrayLength(work, length => { work.arrayLength = length; return finish() })
        : finish())

    function finish() {
        const failure = validateArrayOperation(args, work)
        if (failure || !work.receiverCapture) {
            try { return failure ?? args }
            finally { args = undefined }
        }
        return internalSteps.continueGraphTransition(assembleExternalSnapshot(work.receiverCapture),
            work.operationContext, receiver => {
                try {
                    work.receiverCapture = undefined
                    work.setReceiver(receiver, true)
                    work.leaseReceiver(receiver)
                    return args
                } finally { args = undefined }
            }, undefined, work)
    }
}

function prepareArrayMethodArguments(methodDefinition, invocationWork) {
    let { args } = invocationWork
    const inputs = methodDefinition.inputs ?? []
    // Capture the bound's shape dependency before any converted input can
    // discard the receiver. Its pending question retains no receiver data.
    if (inputs[1] === searchFromIndex && args.length > 1)
        invocationWork.searchHasElements = resolveArrayInRange(0, invocationWork, present => present)
    const count = inputs[1] === searchFromIndex && invocationWork.searchHasElements === false
        ? 1 : methodDefinition.restInput ? args.length : inputs.length
    invocationWork.prepareArgumentFrontier(count)
    // The prepared length preserves omission and every remaining argument.
    let prepared = new Array(methodDefinition.restInput
        ? args.length
        : Math.min(inputs.length, args.length))
    const length = prepared.length
    invocationWork.discardPreparedOutput = () => {
        prepared = undefined
        for (let index = 0; index < length; index++)
            if ((inputs[index] ?? methodDefinition.restInput) === PASS_AS_PAYLOAD)
                invocationWork.discardArgument(index)
    }
    const readiness = []
    for (let index = 0; index < length; index++) {
        const input = inputs[index] ?? methodDefinition.restInput
        if (input === PASS_AS_PAYLOAD) {
            if (prepared) prepared[index] = args[index]
            continue
        }
        const result = input(args[index], invocationWork)
        // Scalar, identity and executable conversion capture their source on
        // reception. Concat retains payloads; a search bound first awaits shape.
        if (methodDefinition !== ARRAY_METHODS.concat && input !== searchFromIndex)
            invocationWork.releaseArgument(index)
        readiness.push(
            internalSteps.continueGraphTransition(
                result,
                invocationWork.operationContext,
                value => {
                    if (errorUtils.isPoisonError(value)) {
                        invocationWork.preparationFailed()
                        return value
                    }

                    if (prepared) prepared[index] = value
                },
                undefined,
                invocationWork,
            ),
        )
    }
    args = undefined
    return internalSteps.prepareInputs(
        readiness,
        invocationWork.operationContext,
        () => {
            invocationWork.discardPreparedOutput = undefined
            return prepared
        },
        invocationWork,
    )
}

// Views and direct observations avoid remap materialization. All remaining
// methods produce one remap; mutation additionally captures the native result
// before publishing the new receiver.
function invokeArrayMethod(methodDefinition, preparedArguments, invocationWork) {
    const { mutation, operationContext } = invocationWork
    if (methodDefinition.view) {
        const view = methodDefinition.view(preparedArguments, invocationWork)
        if (view !== undefined) {
            if (!mutation) return invocationWork.retainOutput(view)
            // Publication already owns the view when consuming the independent
            // removed element may remain pending or fail during capture.
            const outcome = createMutationOutcome(view, undefined, operationContext)
            try {
                outcome.result = methodDefinition.methodResult(
                    methodDefinition.viewNativeResult(view, invocationWork), invocationWork)
                return outcome
            } catch (failure) {
                outcome.releasePublication()
                throw failure
            }
        }
    }
    if (methodDefinition.observe) return methodDefinition.observe(preparedArguments, invocationWork)

    let remap, nativeResult
    let published = true
    if (methodDefinition.remap) {
        remap = methodDefinition.remap(preparedArguments, invocationWork, writes => { published = writes })
    } else {
        remap = arrayRemaps.createRemap(invocationWork.receiver, operationContext, 0, invocationWork.arrayLength)
        nativeResult = Reflect.apply(methodDefinition.intrinsic, remap, preparedArguments)
        // Dense observations consume only the placements selected by the native
        // mapping. Removed inputs create no presence dependency.
        if (methodDefinition.methodResult === undefined)
            remap = arrayRemaps.resolveDenseRemapPresence(nativeResult, invocationWork)
    }
    return internalSteps.continueGraphTransition(remap, operationContext,
        remap => {
            try { return runArrayStep(invocationWork, () => {
                if (errorUtils.isPoisonError(remap)) return remap
                if (mutation && !published) return unchanged()
                // Only intrinsic mutators have a separate native result. Capture
                // removed placements before materializing the new receiver.
                let result = mutation && methodDefinition.methodResult !== RETURN_RECEIVER
                    ? methodDefinition.methodResult(nativeResult, invocationWork) : undefined
                const output = runArrayStep(invocationWork, () =>
                    remap instanceof arrayRemaps.ArrayRangeRemap ? remap.createOutput(invocationWork) :
                        arrayRemaps.createArrayFromRemap(remap, operationContext))
                if (!mutation) return invocationWork.retainOutput(output)
                // A range write may reuse its receiver. Its captured old identity
                // still belongs to earlier searches and the recovery snapshot.
                if (output === invocationWork.receiver && published === true) {
                    published = new IdentityPublication(operationContext)
                    published.record(true)
                }
                if (published instanceof IdentityPublication) {
                    if (errorUtils.isPoisonError(output)) published.finish(true)
                    else {
                        inheritIdentity(invocationWork.receiver, output, operationContext)
                        published.capture(output)
                        published.finish()
                    }
                    published = published.outcome()
                }
                if (methodDefinition.methodResult === RETURN_RECEIVER) result = invocationWork.retainOutput(output)
                else if (errorUtils.isPoisonError(output)) {
                    // Publish receiver failure now; only the independent result waits.
                    result = internalSteps.continueGraphTransition(result, operationContext,
                        value => errorUtils.isPoisonError(value)
                            ? errorUtils.combineErrors([output, value]) : output,
                        undefined, invocationWork)
                }
                return createMutationOutcome(output, result, operationContext, published)
            }) } finally { remap = nativeResult = undefined }
        }, undefined, invocationWork)

    function unchanged() {
        return createMutationOutcome(invocationWork.receiver,
            invocationWork.retainOutput(invocationWork.receiver), operationContext, false)
    }
}

function validateArrayOperation(args, { arrayLength: length, method, operationContext }) {
    const appends = method === "push" || method === "unshift"
    const splices = method === "splice" || method === "toSpliced"
    if (!appends && !splices) return
    let nextLength = length
    if (appends) nextLength += args.length
    else if (splices) {
        const relativeStart = args[0] ?? 0
        const start =
            relativeStart < 0
                ? Math.max(length + relativeStart, 0)
                : Math.min(relativeStart, length)
        const removed =
            args.length === 0
                ? 0
                : args.length === 1
                  ? length - start
                  : Math.min(Math.max(args[1] ?? 0, 0), length - start)
        nextLength += Math.max(args.length - 2, 0) - removed
    }
    if (nextLength > 0xffffffff) {
        return errorUtils.validationError(
            "Invalid Array length",
            operationContext,
            errorUtils.ERROR_KIND.InvalidArrayLength,
        )
    }
}

export { selectArrayMethodDescription }
