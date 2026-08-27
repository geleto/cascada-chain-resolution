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

function selectArrayCall(receiver, method, mutation, mutationContext) {
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
        prepareInputs: (args, invocation) =>
            prepareArrayMethodArguments(
                definition,
                args,
                invocation,
            ),
        invoke(preparedArguments, invocation) {
            if (!mutation) return invokeArrayObservationMethod(
                receiver,
                definition,
                preparedArguments,
                invocation,
            )
            const sourceSurvives = mutationContext.mustPreserveValue ||
                arrayViews.requiresArrayMaterialization(receiver)
            return invokeArrayMutationMethod(
                receiver,
                definition,
                preparedArguments,
                sourceSurvives,
                invocation,
            )
        },
    }
}

function prepareArrayMethodArguments(
    definition,
    args,
    invocation,
) {
    if (definition.prepare) {
        return definition.prepare(args, invocation)
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
            prepared[index] = invocation.retainArgument(args[index])
            continue
        }
        const result = input(args[index], invocation)
        readiness.push(operationLifecycle.continuePrepared(
            invocation,
            result,
            value => {
                prepared[index] = value
            },
        ))
    }
    if (definition.remainingArgsAsPayload) {
        for (let index = inputs.length; index < args.length; index++) {
            prepared[index] = invocation.retainArgument(args[index])
        }
    }
    return operationLifecycle.continuePreparedAll(
        invocation,
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
    operation,
) {
    if (definition.view) {
        const view = definition.view(thisValue, preparedArgs)
        if (view !== undefined) return view
    }
    if (definition.observe) {
        return definition.observe(thisValue, preparedArgs, operation)
    }

    let remap
    if (definition.remap) {
        remap = definition.remap(thisValue, preparedArgs, operation)
    } else {
        remap = arrayRemaps.createRemap(thisValue)
        const result = invocation.invokeDataFunction(
            definition.intrinsic,
            remap,
            preparedArgs,
        )
        // Mutators change the receiver remap; observations return one.
        if (definition.mutationResult === undefined) remap = result
    }
    return operationLifecycle.continuePrepared(
        operation,
        remap,
        arrayRemaps.createArrayFromRemap,
    )
}

function invokeArrayMutationMethod(
    thisValue,
    definition,
    preparedArguments,
    sourceSurvives,
    operation,
) {
    if (sourceSurvives && definition.view) {
        const view = definition.view(thisValue, preparedArguments)
        if (view !== undefined) {
            return {
                mutatedValue: view,
                result: definition.mutationResult(
                    definition.viewOperationResult(thisValue, view),
                    sourceSurvives,
                    operation,
                ),
            }
        }
    }

    if (definition.remap) {
        return operationLifecycle.continuePrepared(
            operation,
            definition.remap(thisValue, preparedArguments, operation),
            remap => finishMutation(remap, undefined, remap),
        )
    }

    const { remap, working, operations } = arrayRemaps.traceMutation(thisValue)
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
            )
        const copiesReceiver = sourceSurvives || representationCopy
        if (copiesReceiver && operations) {
            remap = arrayRemaps.materializeMutationRemap(
                thisValue,
                operations,
            )
        }
        const returnsReceiver = definition.mutationResult === RETURN_RECEIVER
        // Capture removed property versions before committing the receiver.
        const result = returnsReceiver
            ? undefined
            : definition.mutationResult(
                operationResult,
                sourceSurvives,
                operation,
            )

        const mutatedValue = copiesReceiver
            ? arrayRemaps.createArrayFromRemap(
                remap,
                undefined,
                sourceSurvives,
            )
            : thisValue
        if (!copiesReceiver) {
            arrayRemaps.applyRemapToArray(thisValue, remap, operations)
        }
        return {
            mutatedValue,
            result: returnsReceiver ? mutatedValue : result,
        }
    }
}

export { selectArrayCall }
