import { createMutationOutcome } from "./mutations.js"
import * as internalSteps from "./internal-step.js"
import * as errorUtils from "./error.js"
import { isPending } from "./language-values.js"
import { advanceEntryIdentity, inheritIdentity, IdentityPublication } from "./captured-identity.js"
import { assembleExternalSnapshot } from "./external-snapshot.js"
import { fixed } from "./array-sequence.js"
import { span, missingOutputMarker } from "./array-layout.js"
import { CHAIN_MODE } from "./chain.js"
import { PendingFailure, resolvePlacementTransition, structuralFailure } from "./property-versions.js"
import {
    ARRAY_METHODS,
    RETURN_RECEIVER,
    PASS_AS_PAYLOAD,
    runArrayStep,
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
    invocationWork.controlledArray = true
    if (invocationWork.receiverOwnsFailure) invocationWork.narrowScope?.()
    return {
        receiverToLease: mutation ? undefined : invocationWork.receiver,
        leaseInputsThroughResult: !mutation &&
            methodDefinition.leaseInputsThroughResult,
        prepareArguments: () => runArrayStep(invocationWork, () => internalSteps.continueGraphTransition(
            prepareArrayMethodArguments(methodDefinition, invocationWork),
            invocationWork.operationContext, args => {
                if (errorUtils.isPoisonError(args) || args instanceof PendingFailure) return args
                const prepared = methodDefinition.prepare ? methodDefinition.prepare(args, invocationWork) : args
                return internalSteps.continueGraphTransition(prepared, invocationWork.operationContext,
                    args => errorUtils.isPoisonError(args) || args instanceof PendingFailure || !invocationWork.receiverCapture ? args :
                        prepareArrayReceiver(args, invocationWork),
                    undefined, invocationWork)
            },
            undefined, invocationWork)),
        invoke(preparedArguments) {
            if (preparedArguments instanceof PendingFailure) return preparedArguments.outcome(invocationWork.mutation)
            try {
                return runArrayStep(invocationWork, () =>
                    invokeArrayMethod(methodDefinition, preparedArguments, invocationWork))
            } finally { preparedArguments = undefined }
        },
    }
}

function prepareArrayReceiver(args, work) {
    return runArrayStep(work, () => internalSteps.continueGraphTransition(assembleExternalSnapshot(work.receiverCapture),
        work.operationContext, receiver => {
            try {
                work.receiverCapture = undefined
                work.setReceiver(receiver, true)
                work.leaseReceiver(receiver)
                return args
            } finally { args = undefined }
        }, undefined, work))
}

function prepareArrayMethodArguments(methodDefinition, invocationWork) {
    const markers = invocationWork.missingOutput
    if (markers) {
        // The first owed cause blocks a Complete Array. Streaming Arrays
        // append every owed position, including repeated causes.
        if (invocationWork.mode === CHAIN_MODE.Complete) {
            const ctx = invocationWork.operationContext
            const cause = markers === true ? invocationWork.prepareArgument(0) :
                resolvePlacementTransition(markers.point(0, false), ctx, structuralFailure)
            return isPending(cause, ctx) ? new PendingFailure(cause, ctx) : cause
        }
        return markers === true ? fixed(span(1, missingOutputMarker(invocationWork.prepareArgument(0), invocationWork.operationContext))) : markers
    }
    if (methodDefinition.prepareArguments) return methodDefinition.prepareArguments(invocationWork)
    const { operationContext } = invocationWork
    let args = invocationWork.args
    const { argumentIndex } = methodDefinition
    // A separator needs a second occurrence; a search or index needs a first.
    // A ready absolute at() already names its placement without reading length.
    if (args.length && argumentIndex !== undefined &&
        !(methodDefinition === ARRAY_METHODS.at && typeof args[0] === "number" && args[0] >= 0)) {
        const needed = runArrayStep(invocationWork, () => resolveArrayInRange(argumentIndex, invocationWork, present => present))
        if (isPending(needed, operationContext))
            invocationWork.prepareArgumentFrontier(methodDefinition.inputs.length, args)
        return internalSteps.continueGraphTransition(needed, operationContext, present => {
            try {
                if (present === false) {
                    invocationWork.prepareArgumentFrontier(0, args)
                    return []
                }
                // A shape probe for at() is optional until its index is known.
                if (errorUtils.isPoisonError(present) && methodDefinition !== ARRAY_METHODS.at) return present
                return prepareConversions(methodDefinition, invocationWork, args)
            } finally { args = undefined }
        }, undefined, invocationWork)
    }
    return prepareConversions(methodDefinition, invocationWork, args)
}

function prepareConversions(methodDefinition, invocationWork, args) {
    const inputs = methodDefinition.inputs ?? []
    invocationWork.prepareArgumentFrontier(methodDefinition.restInput ? args.length : inputs.length, args)
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
        // reception. A search bound first awaits shape.
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

function invokeArrayMethod(methodDefinition, preparedArguments, invocationWork) {
    const { mutation, operationContext } = invocationWork
    let published = true
    return methodDefinition.apply(preparedArguments, invocationWork, finish, reportWrites)

    function reportWrites(writes) {
        if (isPending(writes, operationContext)) {
            published = new IdentityPublication(operationContext)
            published.addPending(writes)
        } else published = writes
    }

    function finish(output, readResult, directFailure) {
        if (!mutation) return invocationWork.retainOutput(output)
        if (!published) {
            const receiver = invocationWork.receiver
            return createMutationOutcome(receiver, directFailure ?? invocationWork.retainOutput(receiver), operationContext, false)
        }
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
        } else if (invocationWork.appendOnly && published && !errorUtils.isPoisonError(output))
            advanceEntryIdentity(invocationWork.receiver, output, operationContext)
        // Publication owns the output before consuming an independent removed
        // element; that consumption can remain pending or fail during capture.
        const outcome = createMutationOutcome(output, undefined, operationContext, published)
        try {
            // A later command can mutate the published receiver while the
            // independent direct-failure decision is still pending.
            const returnsReceiver = methodDefinition.methodResult === RETURN_RECEIVER
            if (returnsReceiver && !errorUtils.isPoisonError(directFailure)) invocationWork.retainOutput(output)
            const success = () => returnsReceiver ? output : readResult()
            let result = directFailure === undefined ? success() : internalSteps.continueGraphTransition(
                directFailure, operationContext, failure => failure ?? runArrayStep(invocationWork, success))
            if (methodDefinition.methodResult !== RETURN_RECEIVER && errorUtils.isPoisonError(output)) {
                // Publish receiver failure now; only the independent result waits.
                result = internalSteps.continueGraphTransition(result, operationContext,
                    value => errorUtils.isPoisonError(value)
                        ? errorUtils.combineErrors([output, value]) : output,
                    undefined, invocationWork)
            }
            outcome.result = result
            return outcome
        } catch (failure) {
            outcome.releasePublication()
            throw failure
        }
    }
}

export { selectArrayMethodDescription }
