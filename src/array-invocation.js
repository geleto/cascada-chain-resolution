import * as arrayRemaps from "./array-remap.js"
import * as invocation from "./invocation.js"
import * as languageValues from "./language-values.js"
import { ARRAY_METHODS, RECEIVER_RESULT } from "./array-methods.js"
import { exportArgument } from "./observations.js"
import * as resolution from "./resolution.js"

function isArrayMutator(method) {
    return ARRAY_METHODS[method]?.mutationResult !== undefined
}

function isArrayMethod(method) {
    return ARRAY_METHODS[method] !== undefined
}

function prepareArrayMethodArguments(method, args) {
    const definition = ARRAY_METHODS[method]
    return args.find(languageValues.isError) ??
        (definition.prepare
            ? definition.prepare(args)
            : prepareDeclaredArguments())

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
                    resolution.continueOperationUnlessPoison(
                        exportArgument(args[index]),
                        value => {
                            prepared[index] = value
                        },
                    ),
                )
            } else {
                prepared[index] = args[index]
            }
        }
        if (definition.restValues) {
            for (let index = mask.length; index < args.length; index++) {
                prepared[index] = args[index]
            }
        }
        return resolution.continueOperationsUnlessPoison(
            results,
            () => prepared,
        )
    }
}

function invokeArrayObservationMethod(thisValue, method, args) {
    const definition = ARRAY_METHODS[method]
    return resolution.continueOperationUnlessPoison(
        prepareArrayMethodArguments(method, args),
        preparedArgs => {
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
                const result = invocation.invokeDataFunctionOrPoison(
                    Array.prototype[method],
                    remap,
                    preparedArgs,
                )
                if (languageValues.isError(result)) return result
                // Mutators change the receiver remap; other methods return one.
                if (!definition.mutationResult) remap = result
            }
            return resolution.continueOperationUnlessPoison(
                remap,
                arrayRemaps.createArrayFromRemap,
            )
        },
    )
}

function invokeArrayMutationMethod(
    thisValue,
    method,
    preparedArguments,
    sourceSurvives,
) {
    if (languageValues.isError(preparedArguments)) return preparedArguments
    const definition = ARRAY_METHODS[method]
    if (sourceSurvives && definition.view) {
        const view = definition.view(thisValue, preparedArguments)
        if (view !== undefined) {
            if (languageValues.isError(view)) return view
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
        return resolution.continueOperationUnlessPoison(
            definition.remap(thisValue, preparedArguments),
            remap => finishMutation(remap, undefined, remap),
        )
    }

    const { remap, working, operations } =
        arrayRemaps.createMutationRemap(thisValue, !sourceSurvives)
    const nativeResult = invocation.invokeDataFunctionOrPoison(
        Array.prototype[method],
        working,
        preparedArguments,
    )
    return languageValues.isError(nativeResult)
        ? nativeResult
        : finishMutation(remap, operations, nativeResult)

    function finishMutation(remap, operations, operationResult) {
        const returnsReceiver =
            definition.mutationResult === RECEIVER_RESULT
        // Capture removed property versions before committing the receiver.
        const result = returnsReceiver
            ? undefined
            : definition.mutationResult(operationResult, sourceSurvives)

        const mutatedValue = sourceSurvives
            ? arrayRemaps.createArrayFromRemap(remap)
            : thisValue
        const error = sourceSurvives
            ? undefined
            : arrayRemaps.applyRemapToArray(
                thisValue,
                remap,
                operations,
            )
        return {
            mutatedValue,
            result: error ?? (returnsReceiver ? mutatedValue : result),
        }
    }
}

export {
    invokeArrayObservationMethod,
    invokeArrayMutationMethod,
    isArrayMethod,
    isArrayMutator,
    prepareArrayMethodArguments,
}
