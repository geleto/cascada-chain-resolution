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
    const definition = ARRAY_METHODS[method]
    if (!definition) {
        return errorUtils.validationError(`Unsupported Array method: ${method}`)
    }
    if (mutation && definition.mutationResult === undefined) {
        return errorUtils.validationError(
            `Array method ${method} cannot be used as a mutation`,
        )
    }
    return {
        leaseReceiver: mutation ? undefined : receiver,
        leaseReceiverThroughResult: !mutation &&
            definition.leaseReceiverThroughResult,
        prepareInputs: (args, invocationContext) =>
            prepareArrayMethodArguments(
                definition,
                args,
                invocationContext,
            ),
        invoke(preparedArguments, invocationContext) {
            if (!mutation) return invokeArrayObservationMethod(
                receiver,
                definition,
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
                definition,
                preparedArguments,
                sourceSurvives,
                invocationContext,
            )
        },
    }
}

function prepareArrayMethodArguments(
    definition,
    args,
    invocationContext,
) {
    if (definition.prepare) {
        return definition.prepare(args, invocationContext)
    }

    const inputs = definition.inputs ?? []
    const fixedCount = Math.min(inputs.length, args.length)
    // The prepared length preserves omission and every remaining argument.
    const prepared = new Array(definition.remainingArgsAsPayload
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
    if (definition.remainingArgsAsPayload) {
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
    definition,
    preparedArgs,
    invocationContext,
) {
    if (definition.view) {
        const view = definition.view(thisValue, preparedArgs, invocationContext)
        if (view !== undefined) return view
    }
    if (definition.observe) {
        return definition.observe(thisValue, preparedArgs, invocationContext)
    }

    let remap
    if (definition.remap) {
        remap = definition.remap(thisValue, preparedArgs, invocationContext)
    } else {
        remap = arrayRemaps.createRemap(thisValue, invocationContext.operationContext)
        const result = invocation.invokeDataFunction(
            definition.intrinsic,
            remap,
            preparedArgs,
        )
        // Mutators change the receiver remap; observations return one.
        if (definition.mutationResult === undefined) remap = result
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
    definition,
    preparedArguments,
    sourceSurvives,
    invocationContext,
) {
    if (sourceSurvives && definition.view) {
        const view = definition.view(
            thisValue,
            preparedArguments,
            invocationContext,
        )
        if (view !== undefined) {
            return {
                mutatedValue: view,
                result: definition.mutationResult(
                    definition.viewOperationResult(
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

    if (definition.remap) {
        return operationLifecycle.continuePrepared(
            invocationContext,
            definition.remap(thisValue, preparedArguments, invocationContext),
            remap => finishMutation(remap, undefined, remap),
        )
    }

    const { remap, working, operations } = arrayRemaps.traceMutation(
        thisValue,
        invocationContext.operationContext,
    )
    const nativeResult = invocation.invokeDataFunction(
        definition.intrinsic,
        working,
        preparedArguments,
    )
    return finishMutation(remap, operations, nativeResult)

    function finishMutation(remap, operations, operationResult) {
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
        const returnsReceiver = definition.mutationResult === RETURN_RECEIVER
        // Capture removed property versions before committing the receiver.
        const result = returnsReceiver
            ? undefined
            : definition.mutationResult(
                operationResult,
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
