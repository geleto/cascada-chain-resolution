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

function getArrayMethodDescription(invocationContext) {
    const { method, mutation, receiver } = invocationContext
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
        prepareArguments: () =>
            prepareArrayMethodArguments(
                methodDefinition,
                invocationContext,
            ),
        invoke(preparedArguments) {
            if (!mutation) return invokeArrayObservationMethod(
                methodDefinition,
                preparedArguments,
                invocationContext,
            )
            return invokeArrayMutationMethod(
                methodDefinition,
                preparedArguments,
                invocationContext,
            )
        },
    }
}

function prepareArrayMethodArguments(
    methodDefinition,
    invocationContext,
) {
    const { args } = invocationContext
    if (methodDefinition.prepare) {
        return methodDefinition.prepare(invocationContext)
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
    methodDefinition,
    preparedArgs,
    invocationContext,
) {
    if (methodDefinition.view) {
        const view = methodDefinition.view(preparedArgs, invocationContext)
        if (view !== undefined) return view
    }
    if (methodDefinition.observe) {
        return methodDefinition.observe(preparedArgs, invocationContext)
    }

    let remap
    if (methodDefinition.remap) {
        remap = methodDefinition.remap(preparedArgs, invocationContext)
    } else {
        const thisValue = invocationContext.receiver
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
    methodDefinition,
    preparedArguments,
    invocationContext,
) {
    const thisValue = invocationContext.receiver
    const sourceSurvives = invocationContext.preserveReceiver ||
        arrayViews.requiresArrayMaterialization(
            thisValue,
            invocationContext.operationContext,
        )
    if (sourceSurvives && methodDefinition.view) {
        const view = methodDefinition.view(
            preparedArguments,
            invocationContext,
        )
        if (view !== undefined) {
            return {
                mutatedValue: view,
                result: methodDefinition.mutationResult(
                    methodDefinition.viewOperationResult(
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
            methodDefinition.remap(preparedArguments, invocationContext),
            remap => finishMutation(
                new arrayRemaps.ArrayMutation(
                    thisValue,
                    remap,
                    invocationContext.operationContext,
                ),
                remap,
            ),
        )
    }

    const mutation = arrayRemaps.ArrayMutation.trace(
        thisValue,
        invocationContext.operationContext,
    )
    const nativeResult = invocation.invokeHostFunction(
        methodDefinition.intrinsic,
        mutation.working,
        preparedArguments,
    )
    return finishMutation(mutation, nativeResult)

    function finishMutation(mutation, nativeResult) {
        const representationCopy = sourceSurvives
            ? false
            : mutation.requiresCopy()
        const copiesReceiver = sourceSurvives || representationCopy
        if (copiesReceiver) mutation.materialize()
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
                mutation.remap,
                invocationContext.operationContext,
                undefined,
                sourceSurvives,
            )
            : thisValue
        if (!copiesReceiver) mutation.apply()
        return {
            mutatedValue,
            result: returnsReceiver ? mutatedValue : result,
        }
    }
}

export { getArrayMethodDescription }
