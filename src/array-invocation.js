import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as invocation from "./invocation.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import {
    ARRAY_METHODS,
    RETURN_RECEIVER,
    PASS_AS_PAYLOAD,
} from "./array-methods.js"

function getArrayMethodDescription(
    receiver,
    method,
    mutation,
    mutationContext,
    invocationContext,
) {
    const methodDefinition = ARRAY_METHODS[method]
    if (!methodDefinition) {
        return errorUtils.validationError(`Unsupported Array method: ${method}`)
    }
    if (mutation && methodDefinition.mutationResult === undefined) {
        return errorUtils.validationError(
            `Array method ${method} cannot be used as a mutation`,
        )
    }
    return {
        receiverToLease: mutation ? undefined : receiver,
        leaseReceiverThroughResult: !mutation &&
            methodDefinition.leaseReceiverThroughResult,
        prepareArguments: (args, invocationContext) =>
            prepareArrayMethodArguments(
                methodDefinition,
                args,
                invocationContext,
            ),
        invoke(preparedArguments, invocationContext) {
            if (!mutation) return invokeArrayObservationMethod(
                receiver,
                methodDefinition,
                preparedArguments,
                invocationContext,
            )
            const sourceSurvives = mutationContext.mustPreserveValue ||
                arrayViews.requiresArrayMaterialization(
                    receiver,
                    invocationContext.operationContext,
                )
            return invokeArrayMutationMethod(
                receiver,
                methodDefinition,
                preparedArguments,
                sourceSurvives,
                invocationContext,
            )
        },
    }
}

function prepareArrayMethodArguments(
    methodDefinition,
    args,
    invocationContext,
) {
    if (methodDefinition.prepare) {
        return methodDefinition.prepare(args, invocationContext)
    }

    const inputs = methodDefinition.inputs ?? []
    const fixedCount = Math.min(inputs.length, args.length)
    // The prepared length preserves omission and every remaining argument.
    const prepared = new Array(methodDefinition.remainingArgsAsPayload
        ? args.length
        : fixedCount)
    const readiness = []
    for (let index = 0; index < fixedCount; index++) {
        const input = inputs[index]
        if (input === PASS_AS_PAYLOAD) {
            prepared[index] = invocationContext.retainArgument(args[index])
            continue
        }
        const result = input(args[index], invocationContext)
        readiness.push(operationLifecycle.continuePrepared(
            invocationContext,
            result,
            value => {
                prepared[index] = value
            },
        ))
    }
    if (methodDefinition.remainingArgsAsPayload) {
        for (let index = inputs.length; index < args.length; index++) {
            prepared[index] = invocationContext.retainArgument(args[index])
        }
    }
    return operationLifecycle.continuePreparedAll(
        invocationContext,
        readiness,
        () => prepared,
    )
}

// view, observe, remap, and intrinsic fallback are distinct because each avoids
// progressively more representation work.
function invokeArrayObservationMethod(
    thisValue,
    methodDefinition,
    preparedArgs,
    invocationContext,
) {
    if (methodDefinition.view) {
        const view = methodDefinition.view(thisValue, preparedArgs, invocationContext)
        if (view !== undefined) return view
    }
    if (methodDefinition.observe) {
        return methodDefinition.observe(thisValue, preparedArgs, invocationContext)
    }

    let remap
    if (methodDefinition.remap) {
        remap = methodDefinition.remap(thisValue, preparedArgs, invocationContext)
    } else {
        remap = arrayRemaps.createRemap(thisValue, invocationContext.operationContext)
        const result = invocation.invokeHostFunction(
            methodDefinition.intrinsic,
            remap,
            preparedArgs,
        )
        // Mutators change the receiver remap; observations return one.
        if (methodDefinition.mutationResult === undefined) remap = result
    }
    return operationLifecycle.continuePrepared(
        invocationContext,
        remap,
        remap => arrayRemaps.createArrayFromRemap(
            remap,
            invocationContext.operationContext,
        ),
    )
}

function invokeArrayMutationMethod(
    thisValue,
    methodDefinition,
    preparedArguments,
    sourceSurvives,
    invocationContext,
) {
    if (sourceSurvives && methodDefinition.view) {
        const view = methodDefinition.view(
            thisValue,
            preparedArguments,
            invocationContext,
        )
        if (view !== undefined) {
            return {
                mutatedValue: view,
                result: methodDefinition.mutationResult(
                    methodDefinition.viewOperationResult(
                        thisValue,
                        view,
                        invocationContext,
                    ),
                    sourceSurvives,
                    invocationContext,
                ),
            }
        }
    }

    if (methodDefinition.remap) {
        return operationLifecycle.continuePrepared(
            invocationContext,
            methodDefinition.remap(thisValue, preparedArguments, invocationContext),
            remap => finishMutation(remap, undefined, remap),
        )
    }

    const { remap, working, operations } = arrayRemaps.traceMutation(
        thisValue,
        invocationContext.operationContext,
    )
    const nativeResult = invocation.invokeHostFunction(
        methodDefinition.intrinsic,
        working,
        preparedArguments,
    )
    return finishMutation(remap, operations, nativeResult)

    function finishMutation(remap, operations, nativeResult) {
        const representationCopy = sourceSurvives
            ? false
            : arrayRemaps.mutationRequiresCopy(
                thisValue,
                remap,
                operations,
                invocationContext.operationContext,
            )
        const copiesReceiver = sourceSurvives || representationCopy
        if (copiesReceiver && operations) {
            remap = arrayRemaps.materializeMutationRemap(
                thisValue,
                operations,
                invocationContext.operationContext,
            )
        }
        const returnsReceiver = methodDefinition.mutationResult === RETURN_RECEIVER
        // Capture removed property versions before committing the receiver.
        const result = returnsReceiver
            ? undefined
            : methodDefinition.mutationResult(
                nativeResult,
                sourceSurvives,
                invocationContext,
            )

        const mutatedValue = copiesReceiver
            ? arrayRemaps.createArrayFromRemap(
                remap,
                invocationContext.operationContext,
                undefined,
                sourceSurvives,
            )
            : thisValue
        if (!copiesReceiver) {
            arrayRemaps.applyRemapToArray(
                thisValue,
                remap,
                operations,
                invocationContext.operationContext,
            )
        }
        return {
            mutatedValue,
            result: returnsReceiver ? mutatedValue : result,
        }
    }
}

export { getArrayMethodDescription }
