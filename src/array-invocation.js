import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as helpers from "./helpers.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as methods from "./array-methods.js"
import { exportArgument } from "./observations.js"
import * as propertyCaptures from "./property-capture.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as resolution from "./resolution.js"

function isArrayMutator(method) {
    return methods.ARRAY_METHODS[method]?.mutate === true
}

function isArrayMethod(method) {
    return methods.ARRAY_METHODS[method] !== undefined
}

function prepareArrayArguments(method, args) {
    const definition = methods.ARRAY_METHODS[method]
    return resolution.continueUnlessAnyPoison(args, () => {
        return definition.prepare
            ? definition.prepare(args)
            : getExportedArrayArguments()
    })

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

function invokeArrayObservation(
    thisValue,
    method,
    preparedArguments,
    importBoundary,
) {
    const definition = methods.ARRAY_METHODS[method]
    return resolution.continueOperationUnlessPoison(
        preparedArguments,
        preparedArgs => {
            if (definition.endpoint) {
                const arrayView = tryArrayViewOperation(
                    thisValue,
                    method,
                    preparedArgs,
                    importBoundary,
                )
                if (arrayView !== undefined) return arrayView
            }

            const implementation = methods[method]
            if (implementation) {
                return implementation(thisValue, preparedArgs)
            }
            const remap = arrayRemaps.capture(thisValue)
            const nativeResult = helpers.invokeDataFunctionOrPoison(
                Array.prototype[method],
                remap,
                preparedArgs,
            )
            if (languageValues.isError(nativeResult)) return nativeResult
            if (definition.mutate) return arrayRemaps.materialize(remap)
            return definition.result
                ? definition.result(nativeResult)
                : nativeResult
        },
    )
}

function invokeArrayMutation(
    thisValue,
    method,
    preparedArguments,
    importBoundary,
    replaceReceiver,
) {
    const definition = methods.ARRAY_METHODS[method]
    if (languageValues.isError(preparedArguments)) return preparedArguments
    if (definition.endpoint && replaceReceiver) {
        const arrayView = tryArrayViewOperation(
            thisValue,
            method,
            preparedArguments,
            importBoundary,
        )
        if (arrayView !== undefined) {
            let result = arrayView.length
            if (definition.result) {
                const length = arrayViews.logicalArrayLength(thisValue)
                const property = length > 0
                    ? propertyCaptures.capture(
                        thisValue,
                        String(method === "shift" ? 0 : length - 1),
                    )
                    : undefined
                result = definition.result(property)
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
    // TODO: Bypass remapping when owned native storage has no placement-sensitive state.
    const remap = arrayRemaps.capture(thisValue)
    let working = remap
    let operations
    if (!replaceReceiver) {
        ({ working, operations } = arrayRemaps.trace(remap))
    }
    const nativeResult = helpers.invokeDataFunctionOrPoison(
        Array.prototype[method],
        working,
        preparedArguments,
    )
    if (languageValues.isError(nativeResult)) return nativeResult

    const outcome = commitArrayMutation(remap, operations)
    if (languageValues.isError(outcome.result) || nativeResult === working) {
        return outcome
    }
    const result = definition.result
        ? definition.result(nativeResult, replaceReceiver)
        : nativeResult
    return { mutatedValue: outcome.mutatedValue, result }

    function commitArrayMutation(remap, operations) {
        if (replaceReceiver) {
            const mutatedValue = arrayRemaps.materialize(remap)
            return { mutatedValue, result: mutatedValue }
        }

        const error = arrayRemaps.apply(thisValue, remap, operations)
        return { mutatedValue: thisValue, result: error ?? thisValue }
    }
}

function tryArrayViewOperation(
    thisValue,
    method,
    args,
    importBoundary,
) {
    if (metadata.nodeImportBoundary(thisValue, importBoundary)) {
        return undefined
    }
    const adding = method === "push" || method === "unshift"
    const atStart = method === "shift" || method === "unshift"
    const length = arrayViews.logicalArrayLength(thisValue)
    const retainedStart = !adding && atStart ? 1 : 0
    const retainedEnd = !adding && !atStart
        ? Math.max(length - 1, 0)
        : length
    if (!viewOverlapIsEligible()) {
        return undefined
    }
    if (
        adding &&
        !arrayViews.ArrayView.canExtendBacking(
            thisValue,
            atStart,
            args.length,
        )
    ) {
        return undefined
    }

    let projection = arrayViews.projectionOf(thisValue)
    if (!arrayViews.isArrayView(projection)) {
        projection = arrayViews.ArrayView.attachTo(thisValue)
        if (!projection) return undefined
    }

    let arrayView
    if (adding) {
        if (!projection.canExtend(atStart)) return undefined
        arrayView = projection.extend(
            atStart,
            args,
            addArrayViewPromiseMirrors,
        )
    } else {
        arrayView = projection.contract(atStart)
    }

    shareLogicalArrayValues(arrayView)
    return arrayView

    function viewOverlapIsEligible() {
        return languageProperties.enumerableLanguageKeys(thisValue).every(key => {
            if (arrayViews.isArrayIndex(key)) {
                const index = Number(key)
                if (index < retainedStart || index >= retainedEnd) return true
            }
            return !languageValues.isPromise(
                languageProperties.readLanguageProperty(thisValue, key),
            )
        })
    }

    function shareLogicalArrayValues(array) {
        for (const key of languageProperties.enumerableLanguageKeys(array)) {
            const value = languageProperties.readLanguageProperty(array, key)
            if (!languageValues.isPromise(value)) metadata.markShared(value)
        }
    }

    function addArrayViewPromiseMirrors(view) {
        const start = atStart ? 0 : length
        for (let index = 0; index < args.length; index++) {
            const value = args[index]
            if (!languageValues.isPromise(value)) continue
            const key = String(start + index)
            const mirror = promiseMirrors.createAssignedPromiseMirror(
                view,
                key,
                value,
            )
            promiseMirrors.installPromiseMirror(view, key, mirror)
        }
    }
}

export {
    invokeArrayObservation,
    invokeArrayMutation,
    isArrayMethod,
    isArrayMutator,
    prepareArrayArguments,
}
