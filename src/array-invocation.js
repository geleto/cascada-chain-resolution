import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as metadata from "./meta.js"
import { ARRAY_METHODS, RECEIVER_RESULT } from "./array-methods.js"
import { exportArgument } from "./observations.js"
import * as resolution from "./resolution.js"

function isArrayMutator(method) {
    return ARRAY_METHODS[method]?.mutationResult !== undefined
}

function isArrayMethod(method) {
    return ARRAY_METHODS[method] !== undefined
}

function selectArrayCall(receiver, method, mutation, mutationContext) {
    const mutator = isArrayMutator(method)
    if (mutation || mutator) {
        if (!mutator) {
            return errorUtils.validationError(
                "Array mutation supports only Array mutators",
            )
        }
        return getControlledCallDescription(
            receiver,
            method,
            mutation,
            mutationContext,
        )
    }
    if (languageProperties.hasLanguageProperty(receiver, method)) {
        return errorUtils.validationError(
            `Language property shadows method: ${method}`,
        )
    }

    const methodTarget = arrayViews.backingOf(receiver)
    const entry = invocation.findPropertyDescriptor(methodTarget, method)
    if (
        entry &&
        (
            entry.descriptor.value === Array.prototype[method] ||
            (
                Array.isArray(entry.owner) &&
                isBaseArrayPrototype(entry.owner)
            )
        )
    ) {
        return isArrayMethod(method)
            ? getControlledCallDescription(receiver, method, false)
            : errorUtils.validationError(
                `Unsupported Array method: ${method}`,
            )
    }

    const materializes = arrayViews.requiresArrayMaterialization(receiver)
    const hostReceiver = materializes
        ? arrayRemaps.createArrayFromRemap(
            arrayRemaps.createRemap(receiver),
            undefined,
            false,
        )
        : receiver
    return invocation.getHostCallDescription(
        methodTarget,
        method,
        hostReceiver,
        materializes ? undefined : receiver,
    )
}

function getControlledCallDescription(
    receiver,
    method,
    mutation,
    mutationContext,
) {
    return {
        leaseReceiver: mutation ? undefined : receiver,
        prepareArguments: (args, retainSource) =>
            prepareArrayMethodArguments(method, args, retainSource),
        invoke(preparedArguments) {
            if (!mutation) return invokeArrayObservationMethod(
                receiver,
                method,
                preparedArguments,
            )
            const sourceSurvives = mutationContext.mustPreserveValue ||
                arrayViews.requiresArrayMaterialization(receiver)
            return invokeArrayMutationMethod(
                receiver,
                method,
                preparedArguments,
                sourceSurvives,
            )
        },
    }
}

function isBaseArrayPrototype(value) {
    if (!Array.isArray(value)) return false
    // Cross-realm Array recognition may invoke a Proxy getPrototypeOf trap.
    const prototype = errorUtils.runUserCode(
        () => Object.getPrototypeOf(value),
    )
    return metadata.isPlainObjectPrototype(prototype)
}

function prepareArrayMethodArguments(method, args, retainSource) {
    const definition = ARRAY_METHODS[method]
    return definition.prepare
        ? definition.prepare(args, retainSource)
        : prepareDeclaredArguments()

    function prepareDeclaredArguments() {
        const mask = definition.exportArgs ?? []
        const fixedCount = Math.min(mask.length, args.length)
        const prepared = new Array(
            definition.restValues ? args.length : fixedCount,
        )
        const results = []
        for (let index = 0; index < fixedCount; index++) {
            if (mask[index]) {
                results.push(
                    resolution.continuePreparedValueUnlessPoison(
                        exportArgument(args[index], retainSource),
                        value => {
                            prepared[index] = value
                        },
                    ),
                )
            } else {
                prepared[index] = retainSource(args[index])
            }
        }
        if (definition.restValues) {
            for (let index = mask.length; index < args.length; index++) {
                prepared[index] = retainSource(args[index])
            }
        }
        return resolution.continuePreparedValuesUnlessPoison(
            results,
            () => prepared,
        )
    }
}

// Callers resolve preparation first. These functions receive a direct prepared
// value or Error, never a pending Promise.
function invokeArrayObservationMethod(thisValue, method, preparedArgs) {
    const definition = ARRAY_METHODS[method]
    if (definition.view) {
        const view = definition.view(thisValue, preparedArgs)
        if (view !== undefined) return view
    }
    if (definition.observe) {
        return definition.observe(thisValue, preparedArgs)
    }

    let remap
    if (definition.remap) {
        remap = definition.remap(thisValue, preparedArgs)
    } else {
        remap = arrayRemaps.createRemap(thisValue)
        const result = invocation.invokeDataFunction(
            Array.prototype[method],
            remap,
            preparedArgs,
        )
        // Mutators change the receiver remap; other methods return one.
        if (!definition.mutationResult) remap = result
    }
    return resolution.continuePreparedValueUnlessPoison(
        remap,
        arrayRemaps.createArrayFromRemap,
    )
}

function invokeArrayMutationMethod(
    thisValue,
    method,
    preparedArguments,
    sourceSurvives,
) {
    const definition = ARRAY_METHODS[method]
    if (sourceSurvives && definition.view) {
        const view = definition.view(thisValue, preparedArguments)
        if (view !== undefined) {
            return {
                mutatedValue: view,
                result: definition.mutationResult(
                    definition.viewOperationResult(thisValue, view),
                    sourceSurvives,
                ),
            }
        }
    }

    if (definition.remap) {
        return resolution.continuePreparedValueUnlessPoison(
            definition.remap(thisValue, preparedArguments),
            remap => finishMutation(remap, undefined, remap),
        )
    }

    const { remap, working, operations } =
        arrayRemaps.traceMutation(thisValue)
    const nativeResult = invocation.invokeDataFunction(
        Array.prototype[method],
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
        const returnsReceiver =
            definition.mutationResult === RECEIVER_RESULT
        // Capture removed property versions before committing the receiver.
        const result = returnsReceiver
            ? undefined
            : definition.mutationResult(operationResult, sourceSurvives)

        const mutatedValue = copiesReceiver
            ? arrayRemaps.createArrayFromRemap(
                remap,
                undefined,
                sourceSurvives,
            )
            : thisValue
        if (!copiesReceiver) {
            arrayRemaps.applyRemapToArray(
                thisValue,
                remap,
                operations,
            )
        }
        return {
            mutatedValue,
            result: returnsReceiver ? mutatedValue : result,
        }
    }
}

export {
    invokeArrayObservationMethod,
    invokeArrayMutationMethod,
    prepareArrayMethodArguments,
    selectArrayCall,
}
