import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as invocation from "./invocation.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as methods from "./array-methods.js"
import { exportArgument } from "./observations.js"
import * as propertyOrigins from "./property-capture.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as resolution from "./resolution.js"

function isArrayMutator(method) {
    return methods.ARRAY_METHODS[method]?.mutate === true
}

function isArrayMethod(method) {
    return methods.ARRAY_METHODS[method] !== undefined
}

function prepareArrayMethodArguments(method, args) {
    const definition = methods.ARRAY_METHODS[method]
    return args.find(languageValues.isError) ??
        (definition.prepare
            ? definition.prepare(args)
            : getExportedArrayArguments())

    function getExportedArrayArguments() {
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

function invokeArrayObservationMethod(
    thisValue,
    method,
    args,
    importBoundary,
) {
    const definition = methods.ARRAY_METHODS[method]
    const preparedArguments = prepareArrayMethodArguments(method, args)
    return resolution.continueOperationUnlessPoison(
        preparedArguments,
        preparedArgs => {
            if (definition.view) {
                const arrayView = tryArrayViewMethod(
                    thisValue,
                    method,
                    preparedArgs,
                    importBoundary,
                )
                if (arrayView !== undefined) return arrayView
            }

            const implementation = definition.implementation ?? methods[method]
            if (implementation) {
                return implementation(thisValue, preparedArgs)
            }
            const remap = arrayRemaps.createInitialRemap(thisValue)
            const nativeResult = invocation.invokeDataFunctionOrPoison(
                Array.prototype[method],
                remap,
                preparedArgs,
            )
            if (languageValues.isError(nativeResult)) return nativeResult
            if (definition.mutate) {
                return arrayRemaps.createArrayFromRemap(remap)
            }
            return definition.transformResult
                ? definition.transformResult(nativeResult)
                : nativeResult
        },
    )
}

function invokeArrayMutationMethod(
    thisValue,
    method,
    preparedArguments,
    importBoundary,
    replaceReceiver,
) {
    const definition = methods.ARRAY_METHODS[method]
    if (languageValues.isError(preparedArguments)) return preparedArguments
    if (definition.view && replaceReceiver) {
        const arrayView = tryArrayViewMethod(
            thisValue,
            method,
            preparedArguments,
            importBoundary,
        )
        if (arrayView !== undefined) {
            let result = arrayView.length
            if (definition.transformResult) {
                const length = arrayViews.logicalArrayLength(thisValue)
                const origin = length > 0
                    ? propertyOrigins.getOrigin(
                        thisValue,
                        String(method === "shift" ? 0 : length - 1),
                    )
                    : undefined
                result = definition.transformResult(origin)
            }
            return { mutatedValue: arrayView, result }
        }
    }

    if (definition.mutationRemap) {
        return resolution.continueOperationUnlessPoison(
            definition.mutationRemap(thisValue, preparedArguments),
            remap => commitArrayMutation(remap),
        )
    }
    const { remap, working, operations } =
        arrayRemaps.createMutationRemap(thisValue, !replaceReceiver)
    const nativeResult = invocation.invokeDataFunctionOrPoison(
        Array.prototype[method],
        working,
        preparedArguments,
    )
    if (languageValues.isError(nativeResult)) return nativeResult

    let result = nativeResult
    if (nativeResult !== working && definition.transformResult) {
        result = definition.transformResult(nativeResult, replaceReceiver)
    }
    const outcome = commitArrayMutation(remap, operations)
    if (languageValues.isError(outcome.result) || nativeResult === working) {
        return outcome
    }
    return { mutatedValue: outcome.mutatedValue, result }

    function commitArrayMutation(remap, operations) {
        if (replaceReceiver) {
            const mutatedValue = arrayRemaps.createArrayFromRemap(remap)
            return { mutatedValue, result: mutatedValue }
        }

        const error = arrayRemaps.applyRemapToArray(
            thisValue, remap, operations,
        )
        return { mutatedValue: thisValue, result: error ?? thisValue }
    }
}

// thisValue can be an Array, ArrayView, or Array with an attached ArrayView.
function tryArrayViewMethod(
    thisValue,
    method,
    args,
    importBoundary,
) {
    // Imported Arrays materialize; ArrayView backing is always runtime-owned.
    if (metadata.nodeImportBoundary(thisValue, importBoundary)) {
        return undefined
    }
    if (method === "slice") return trySliceArrayView(thisValue, args)
    if (method === "concat") return tryConcatArrayView(thisValue, args)
    if (method === "push") return tryAppendArrayView(thisValue, args)
    if (method === "unshift") return tryPrependArrayView(thisValue, args)

    // The remaining endpoint methods are shift and pop.
    const length = arrayViews.logicalArrayLength(thisValue)
    return method === "shift"
        ? deriveArrayView(thisValue, Math.min(1, length), length)
        : deriveArrayView(thisValue, 0, Math.max(0, length - 1))
}

function relativeIndex(value, length, defaultValue) {
    if (value === undefined) return defaultValue
    value = Number.isNaN(value) ? 0 : Math.trunc(value)
    return value < 0
        ? Math.max(length + value, 0)
        : Math.min(value, length)
}

function trySliceArrayView(thisValue, args) {
    if (args.some(value => {
        return value !== undefined && typeof value !== "number"
    })) return undefined

    const length = arrayViews.logicalArrayLength(thisValue)
    const start = relativeIndex(args[0], length, 0)
    const end = Math.max(start, relativeIndex(args[1], length, length))
    return deriveArrayView(thisValue, start, end)
}

function deriveArrayView(thisValue, start, end) {
    if (start === end) return []
    const projection = arrayViews.ArrayView.attachTo(thisValue)
    const view = new arrayViews.ArrayView(projection, start, end)
    promiseMirrors.prepareRetainedArrayProperties(
        thisValue,
        view,
        key => {
            const index = Number(key)
            return index >= start && index < end
                ? String(index - start)
                : undefined
        },
    )
    return view
}

function tryConcatArrayView(thisValue, items) {
    const suffix = methods.createConcatRemap([], items)
    if (languageValues.isError(suffix)) return suffix
    return tryAppendArrayView(thisValue, suffix)
}

function tryAppendArrayView(thisValue, suffix) {
    const view = arrayViews.ArrayView.tryExtendEnd(
        thisValue,
        suffix.length,
        derived => promiseMirrors.prepareRetainedArrayProperties(
            thisValue, derived,
        ),
    )
    if (!view) return undefined
    const start = view.length - suffix.length
    arrayRemaps.placeRemap(view, suffix, start)
    return view
}

function tryPrependArrayView(thisValue, values) {
    const offset = values.length
    const view = arrayViews.ArrayView.tryPrepend(
        thisValue,
        values,
        derived => promiseMirrors.prepareRetainedArrayProperties(
            thisValue,
            derived,
            key => String(Number(key) + offset),
        ),
    )
    if (!view) return undefined
    arrayRemaps.placeRemap(view, values)
    return view
}

export {
    invokeArrayObservationMethod,
    invokeArrayMutationMethod,
    isArrayMethod,
    isArrayMutator,
    prepareArrayMethodArguments,
}
