import { prepareInputs } from "./input-collection.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as conversion from "./language-conversion.js"
import * as errorUtils from "./error.js"
import { exportManyValues } from "./export.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"

const RETURN_RECEIVER = Symbol()
const PASS_AS_PAYLOAD = Symbol()
const arrayConcat = Array.prototype.concat
const arrayFlat = Array.prototype.flat
const arraySort = Array.prototype.sort

// Dispatch precedence is view, direct observation, remap producer, then the
// captured intrinsic on a property remap. methodResult is absent for pure
// observations, RETURN_RECEIVER for receiver-returning mutators, or a result
// publisher. viewMethodResult reconstructs a view mutation's method result.
// leaseReceiverThroughResult protects placements captured by delayed observations.
// PASS_AS_PAYLOAD retains logical data without resolving, converting, or exporting.
const ARRAY_METHODS = {
    __proto__: null,
    at: { inputs: [numericInput], observe: observeAt },
    concat: {
        prepare: prepareConcatArguments,
        remap: createConcatRemap,
        view: tryConcatArrayView,
    },
    copyWithin: {
        inputs: [numericInput, numericInput, numericInput],
        intrinsic: Array.prototype.copyWithin,
        methodResult: RETURN_RECEIVER,
    },
    fill: {
        inputs: [PASS_AS_PAYLOAD, numericInput, numericInput],
        intrinsic: Array.prototype.fill,
        methodResult: RETURN_RECEIVER,
    },
    flat: {
        inputs: [numericInput],
        leaseReceiverThroughResult: true,
        remap: flatRemap,
    },
    includes: { prepare: prepareSearchArguments, observe: includes },
    indexOf: {
        leaseReceiverThroughResult: true,
        prepare: prepareSearchArguments,
        observe: indexOf,
    },
    join: { inputs: [stringInput], observe: join },
    lastIndexOf: {
        leaseReceiverThroughResult: true,
        prepare: prepareSearchArguments,
        observe: lastIndexOf,
    },
    pop: {
        intrinsic: Array.prototype.pop,
        methodResult: publishElement,
        view: tryPopArrayView,
        viewMethodResult: getLastElementPlacement,
    },
    push: {
        intrinsic: Array.prototype.push,
        remainingArgsAsPayload: true,
        methodResult: publishValue,
        view: tryAppendArrayView,
        viewMethodResult: getViewLength,
    },
    reverse: {
        intrinsic: Array.prototype.reverse,
        methodResult: RETURN_RECEIVER,
    },
    shift: {
        intrinsic: Array.prototype.shift,
        methodResult: publishElement,
        view: tryShiftArrayView,
        viewMethodResult: getFirstElementPlacement,
    },
    slice: { inputs: [numericInput, numericInput], observe: slice },
    sort: {
        leaseReceiverThroughResult: true,
        prepare: prepareSortArguments,
        remap: prepareSortedRemap,
        methodResult: RETURN_RECEIVER,
    },
    splice: {
        inputs: [numericInput, numericInput],
        intrinsic: Array.prototype.splice,
        remainingArgsAsPayload: true,
        methodResult: publishArray,
    },
    toReversed: { intrinsic: Array.prototype.toReversed },
    toSorted: {
        leaseReceiverThroughResult: true,
        prepare: prepareSortArguments,
        remap: prepareToSortedRemap,
    },
    toSpliced: {
        inputs: [numericInput, numericInput],
        intrinsic: Array.prototype.toSpliced,
        remainingArgsAsPayload: true,
    },
    // No prepared arguments makes join use its default separator.
    toString: { observe: join },
    unshift: {
        intrinsic: Array.prototype.unshift,
        remainingArgsAsPayload: true,
        methodResult: publishValue,
    },
    with: {
        inputs: [numericInput, PASS_AS_PAYLOAD],
        intrinsic: Array.prototype.with,
    },
}

function observeAt([index = 0], invocationContext) {
    const thisValue = invocationContext.receiver
    const length = arrayViews.logicalArrayLength(thisValue, invocationContext.operationContext)
    index = index >= 0 ? index : length + index
    if (index < 0 || index >= length) return undefined
    return retainElement(
        propertyVersions.getPropertyPlacement(
            thisValue,
            String(index),
            invocationContext.operationContext,
        ),
        invocationContext,
    )
}

function numericInput(value, invocationContext) {
    return languageValues.consumeValue(
        value,
        invocationContext.operationContext,
        errorUtils.ERROR_KIND.OperationInputFailed,
        resolved => {
            if (errorUtils.isPoisonError(resolved)) return resolved

            // Let each position apply its own undefined default.
            return resolved === undefined
                ? undefined
                : conversion.toIntegerOrInfinity(resolved, invocationContext)
        },
        invocationContext,
    )
}

function stringInput(value, invocationContext) {
    return languageValues.consumeValue(
        value,
        invocationContext.operationContext,
        errorUtils.ERROR_KIND.OperationInputFailed,
        resolved => {
            if (errorUtils.isPoisonError(resolved)) return resolved

            return resolved === undefined
                ? undefined
                : conversion.toStringValue(resolved, undefined, invocationContext)
        },
        invocationContext,
    )
}

function slice(args, invocationContext) {
    const thisValue = invocationContext.receiver
    const length = arrayViews.logicalArrayLength(thisValue, invocationContext.operationContext)
    const start = toRelativeIndex(args[0], length, 0)
    const end = Math.max(start, toRelativeIndex(args[1], length, length))
    return deriveArrayView(start, end, invocationContext) ??
        arrayRemaps.createArrayFromRemap(
            arrayRemaps.createRemap(thisValue, invocationContext.operationContext, start, end),
            invocationContext.operationContext,
        )
}

function publishValue(value) {
    return value
}

function publishElement(element, sourceSurvives, invocationContext) {
    return sourceSurvives
        ? retainElement(element, invocationContext)
        : transferElement(element, invocationContext)
}

function publishArray(remap, sourceSurvives, invocationContext) {
    return arrayRemaps.createArrayFromRemap(
        remap,
        invocationContext.operationContext,
        undefined,
        sourceSurvives,
    )
}

function transferElement(element, invocationContext) {
    const result = propertyVersions.isPropertyPlacement(element)
        ? element.resolveValue()
        : element
    return operationLifecycle.continueOperation(
        result,
        invocationContext.operationContext,
        value => value,
        undefined,
        invocationContext,
    )
}

function retainElement(element, invocationContext) {
    const result = propertyVersions.isPropertyPlacement(element)
        ? element.resolveValue()
        : element
    return operationLifecycle.continueOperation(
        result,
        invocationContext.operationContext,
        value => {
            metadata.markShared(value, invocationContext.operationContext)
            return value
        },
        undefined,
        invocationContext,
    )
}

function getFirstElementPlacement(_view, invocationContext) {
    const thisValue = invocationContext.receiver
    return propertyVersions.getPropertyPlacement(
        thisValue,
        "0",
        invocationContext.operationContext,
    )
}

function getLastElementPlacement(_view, invocationContext) {
    const thisValue = invocationContext.receiver
    const length = arrayViews.logicalArrayLength(thisValue, invocationContext.operationContext)
    return length === 0
        ? undefined
        : propertyVersions.getPropertyPlacement(
            thisValue,
            String(length - 1),
            invocationContext.operationContext,
        )
}

function getViewLength(view) {
    return view.length
}

// Every Array step consumes exact host escapes before its continuation returns
// to the fatal envelope. The same rule applies to ready and resumed work.
function runArrayStep(invocationContext, work) {
    return errorUtils.catchExternalThrow(
        work,
        invocationContext.operationContext,
        errorUtils.ERROR_KIND.InvalidArrayOperation,
    )
}

function prepareConcatArguments(invocationContext) {
    const parts = invocationContext.args.map(item =>
        languageValues.consumeValue(
            item,
            invocationContext.operationContext,
            errorUtils.ERROR_KIND.OperationInputFailed,
            value =>
                runArrayStep(invocationContext, () => {
                    if (errorUtils.isPoisonError(value)) return value
                    invocationContext.retainArgument(value)
                    return arrayViews.isLogicalArray(value, invocationContext.operationContext)
                        ? captureRemap(value, invocationContext.operationContext)
                        : [value]
                }),
            invocationContext,
        ),
    )
    return prepareInputs(
        parts,
        invocationContext.operationContext,
        values => values,
        invocationContext,
    )
}

function captureRemap(array, operationContext) {
    const remap = arrayRemaps.createRemap(array, operationContext)
    remap.forEach(placement => placement?.captureVersion())
    return remap
}

function createConcatRemap(parts, invocationContext) {
    return invocation.invokeHostFunction(
        arrayConcat,
        captureRemap(
            invocationContext.receiver,
            invocationContext.operationContext,
        ),
        parts,
        invocationContext.operationContext,
    )
}

function flatRemap([depth = 1], invocationContext) {
    depth = Math.max(depth, 0)
    return operationLifecycle.continueOperation(
        prepareFlatArray(
            invocationContext.receiver,
            depth,
            undefined,
            invocationContext,
        ),
        invocationContext.operationContext,
        prepared => {
            if (errorUtils.isPoisonError(prepared)) return prepared
            return invocation.invokeHostFunction(
                arrayFlat,
                prepared,
                [depth],
                invocationContext.operationContext,
            )
        },
        undefined,
        invocationContext,
    )
}

function prepareFlatArray(array, depth, ancestry, invocationContext) {
    return runArrayStep(invocationContext, () => {
        if (
            depth === Infinity &&
            arrayViews.hasArrayAncestor(ancestry, array)
        ) {
            return errorUtils.validationError(
                "Cannot flat an Array cycle to unlimited depth",
                invocationContext.operationContext,
                errorUtils.ERROR_KIND.InvalidArrayOperation,
            )
        }
        const source = arrayRemaps.createRemap(array, invocationContext.operationContext)
        const keys = Object.keys(source)
        const nestedAncestry = depth === Infinity
            ? { array, parent: ancestry }
            : undefined
        const parts = keys.map(key =>
            prepareFlatProperty(
                source[key],
                depth,
                nestedAncestry,
                invocationContext,
            ),
        )
        return prepareInputs(
            parts,
            invocationContext.operationContext,
            values => {
                const output = new Array(source.length)
                for (let index = 0; index < keys.length; index++)
                    output[keys[index]] = values[index]
                return output
            },
            invocationContext,
        )
    })
}

function prepareFlatProperty(placement, depth, ancestry, invocationContext) {
    return runArrayStep(invocationContext, () => {
        if (depth === 0) return placement
        return operationLifecycle.continueOperation(
            placement.resolveValue(),
            invocationContext.operationContext,
            value => arrayViews.isLogicalArray(value, invocationContext.operationContext)
                ? prepareFlatArray(value, depth - 1, ancestry, invocationContext)
                : placement,
            undefined,
            invocationContext,
        )
    })
}

function prepareSearchArguments(invocationContext) {
    const { args } = invocationContext
    const searchResult = languageValues.consumeValue(
        args[0],
        invocationContext.operationContext,
        errorUtils.ERROR_KIND.OperationInputFailed,
        value => value,
        invocationContext,
    )
    const fromResult = args.length > 1
        ? conversion.toIntegerOrInfinity(args[1], invocationContext)
        : undefined
    return prepareInputs(
        [searchResult, fromResult],
        invocationContext.operationContext,
        readyValues => {
            const [searchValue, fromIndex] = readyValues
            return { searchValue, fromIndex }
        },
        invocationContext,
    )
}

function join([separator], invocationContext) {
    return conversion.joinLogicalArray(
        invocationContext.receiver,
        separator,
        undefined,
        invocationContext,
    )
}

function prepareSortArguments(invocationContext) {
    const { args } = invocationContext
    if (args[0] === undefined) return undefined
    return languageValues.consumeValue(
        args[0],
        invocationContext.operationContext,
        errorUtils.ERROR_KIND.OperationInputFailed,
        value => {
            if (errorUtils.isPoisonError(value)) return value

            if (value === undefined || typeof value === "function") return value
            return errorUtils.validationError(
                "Array sort comparator must be callable or undefined",
                invocationContext.operationContext,
                errorUtils.ERROR_KIND.NotAFunction,
            )
        },
        invocationContext,
    )
}

function prepareToSortedRemap(comparator, invocationContext) {
    return prepareSortedRemap(comparator, invocationContext, true)
}

function prepareSortedRemap(comparator, invocationContext, denseHoles = false) {
    const thisValue = invocationContext.receiver
    const source = arrayRemaps.createRemap(thisValue, invocationContext.operationContext)
    const records = []
    for (const placement of source) {
        if (!placement) continue
        records.push(
            runArrayStep(invocationContext, () =>
                operationLifecycle.continueOperation(
                    placement.resolveValue(),
                    invocationContext.operationContext,
                    value => ({ placement, value }),
                    undefined,
                    invocationContext,
                ),
            ),
        )
    }
    return prepareInputs(
        records,
        invocationContext.operationContext,
        ready => {
            const sortable = []
            const undefinedPlacements = []
            for (const record of ready) {
                if (record.value === undefined) {
                    undefinedPlacements.push(record.placement)
                } else {
                    sortable.push(record)
                }
            }
            if (sortable.length < 2) {
                return finish(sortable)
            }
            return prepareAndSortRecords(sortable, comparator, invocationContext, finish)

            function finish(sorted) {
                return finishSortedRemap(
                    sorted,
                    undefinedPlacements,
                    denseHoles,
                    source.length,
                )
            }
        },
        invocationContext,
    )
}

function prepareAndSortRecords(
    sortable,
    comparator,
    invocationContext,
    finish,
) {
    if (comparator === undefined) {
        const records = sortable.map(record =>
            operationLifecycle.continueOperation(
                conversion.toStringValue(record.value, undefined, invocationContext),
                invocationContext.operationContext,
                key => {
                    if (errorUtils.isPoisonError(key)) return key

                    record.key = key
                    return record
                },
                undefined,
                invocationContext,
            ),
        )
        return prepareInputs(
            records,
            invocationContext.operationContext,
            ready => {
                return sortRecords(
                    ready,
                    comparePreparedKeys,
                    invocationContext.operationContext,
                    finish,
                )
            },
            invocationContext,
        )
    }

    const snapshot = sortable.map(record => record.value)
    return operationLifecycle.continueOperation(
        exportManyValues([snapshot], invocationContext),
        invocationContext.operationContext,
        readyValues => {
            if (errorUtils.isPoisonError(readyValues)) return readyValues
            const [exported] = readyValues

            for (let index = 0; index < sortable.length; index++) {
                sortable[index].exported = exported[index]
            }
            return sortRecords(
                sortable,
                (left, right) => compareExported(
                    comparator,
                    left.exported,
                    right.exported,
                    invocationContext.operationContext,
                ),
                invocationContext.operationContext,
                finish,
            )
        },
        undefined,
        invocationContext,
    )
}

function sortRecords(sortable, compare, operationContext, finish) {
    // The records and native sort are runtime-owned. Only the comparator's
    // explicit poison escape aborts sorting recoverably; internal throws are fatal.
    let sorted
    try {
        sorted = Reflect.apply(arraySort, sortable, [compare])
    } catch (reason) {
        if (!errorUtils.isPoisonError(reason)) throw reason
        return reason
    }
    return finish(sorted)
}

function finishSortedRemap(
    sorted,
    undefinedPlacements,
    denseHoles,
    length,
) {
    const remap = new Array(length)
    let index = 0
    for (const record of sorted) remap[index++] = record.placement
    for (const placement of undefinedPlacements) remap[index++] = placement
    if (denseHoles) {
        while (index < length) remap[index++] = undefined
    }
    return remap
}

function comparePreparedKeys(left, right) {
    if (left.key < right.key) return -1
    if (left.key > right.key) return 1
    return 0
}

function compareExported(comparator, left, right, operationContext) {
    const result = invocation.invokeHostFunction(
        comparator,
        undefined,
        [left, right],
        operationContext,
        errorUtils.ERROR_KIND.ControlledCallbackFailed,
    )
    if (errorUtils.isPoisonError(result)) throw result
    const pending = errorUtils.runHostBoundary(
        operationContext,
        errorUtils.ERROR_KIND.ThenAccessFailed,
        () => languageValues.isPending(result, operationContext),
    )
    if (errorUtils.isPoisonError(pending)) throw pending
    if (pending) {
        const observed = operationLifecycle.continueOperation(
            result,
            operationContext,
            () => undefined,
            () => undefined,
        )
        markPromiseHandled(observed, operationContext)
        throw errorUtils.validationError(
            "Promise-returning Array sort comparators are unsupported",
            operationContext,
            errorUtils.ERROR_KIND.InvalidCallbackResult,
        )
    }
    if (typeof result !== "number") {
        throw errorUtils.validationError(
            "Array sort comparator must return a Number",
            operationContext,
            errorUtils.ERROR_KIND.InvalidCallbackResult,
        )
    }
    return result
}

function includes({ searchValue, fromIndex = 0 }, invocationContext) {
    const thisValue = invocationContext.receiver
    const length = arrayViews.logicalArrayLength(thisValue, invocationContext.operationContext)
    if (length === 0) return false
    const start = normalizeForwardStart(fromIndex, length)
    if (start >= length) return false
    const pending = []
    for (let index = start; index < length; index++) {
        const branch = operationLifecycle.continueOperation(
            propertyVersions.resolvePropertyValueAtKey(thisValue, String(index), invocationContext.operationContext),
            invocationContext.operationContext,
            matches,
            undefined,
            invocationContext,
        )
        if (languageValues.isPending(branch, invocationContext.operationContext)) pending.push(branch)
        else if (branch) {
            for (const wait of pending) markPromiseHandled(wait, invocationContext.operationContext)
            return true
        }
    }
    if (pending.length === 0) return false

    let remaining = pending.length
    const { promise: result, resolve: resolveResult } = Promise.withResolvers()
    for (const wait of pending) {
        const branch = operationLifecycle.continueOperation(
            wait,
            invocationContext.operationContext,
            found => {
                if (found) return finish(true)
                if (--remaining === 0) finish(false)
            },
            undefined,
            invocationContext,
        )
        markPromiseHandled(branch, invocationContext.operationContext)
    }
    return result

    function finish(value) {
        operationLifecycle.close(invocationContext)
        resolveResult(value)
    }

    function matches(value) {
        return value === searchValue || Object.is(value, searchValue)
    }
}

function indexOf(prepared, invocationContext) {
    return orderedIndexSearch(prepared, false, invocationContext)
}

function lastIndexOf(prepared, invocationContext) {
    return orderedIndexSearch(prepared, true, invocationContext)
}

function orderedIndexSearch(
    { searchValue, fromIndex },
    backwards,
    invocationContext,
) {
    const thisValue = invocationContext.receiver
    fromIndex ??= backwards ? Infinity : 0
    const length = arrayViews.logicalArrayLength(thisValue, invocationContext.operationContext)
    if (length === 0) return -1
    let index = backwards
        ? normalizeBackwardStart(fromIndex, length)
        : normalizeForwardStart(fromIndex, length)
    return next()

    function next() {
        return runArrayStep(invocationContext, () => {
            while (index >= 0 && index < length) {
                const current = index
                index += backwards ? -1 : 1
                const key = String(current)
                if (!languageProperties.hasLanguageProperty(
                    thisValue,
                    key,
                    invocationContext.operationContext,
                )) {
                    continue
                }
                const value = languageProperties.readLanguageProperty(
                    thisValue,
                    key,
                    invocationContext.operationContext,
                )
                if (
                    languageValues.isPending(value, invocationContext.operationContext)
                ) {
                    return operationLifecycle.continueOperation(
                        propertyVersions.resolvePropertyValueAtKey(
                            thisValue,
                            key,
                            invocationContext.operationContext,
                        ),
                        invocationContext.operationContext,
                        resolved => resolved === searchValue ? current : next(),
                        undefined,
                        invocationContext,
                    )
                }
                if (value === searchValue) return current
            }
            return -1
        })
    }
}

function normalizeForwardStart(fromIndex, length) {
    return fromIndex === Infinity
        ? length
        : fromIndex >= 0 ? fromIndex : Math.max(length + fromIndex, 0)
}

function normalizeBackwardStart(fromIndex, length) {
    return fromIndex === -Infinity
        ? -1
        : fromIndex >= 0 ? Math.min(fromIndex, length - 1) : length + fromIndex
}

function toRelativeIndex(value, length, defaultValue) {
    if (value === undefined) return defaultValue
    return value < 0
        ? Math.max(length + value, 0)
        : Math.min(value, length)
}

function tryShiftArrayView(_args, invocationContext) {
    const thisValue = invocationContext.receiver
    const length = arrayViews.logicalArrayLength(thisValue, invocationContext.operationContext)
    return deriveArrayView(
        Math.min(1, length),
        length,
        invocationContext,
    )
}

function tryPopArrayView(_args, invocationContext) {
    const thisValue = invocationContext.receiver
    const length = arrayViews.logicalArrayLength(thisValue, invocationContext.operationContext)
    return deriveArrayView(
        0,
        Math.max(0, length - 1),
        invocationContext,
    )
}

function deriveArrayView(start, end, invocationContext) {
    const { operationContext, receiver: thisValue } = invocationContext
    if (start === end) return arrayRemaps.createArrayFromRemap([], operationContext)
    const projection = arrayViews.ArrayView.tryAttachTo(thisValue, operationContext)
    if (!projection) return undefined

    const view = new arrayViews.ArrayView(projection, operationContext, start, end)
    propertyVersions.prepareRetainedArrayProperties(
        thisValue,
        view,
        operationContext,
        start,
        end,
        -start,
    )
    return view
}

function tryConcatArrayView(parts, invocationContext) {
    const suffix = invocation.invokeHostFunction(
        arrayConcat,
        [],
        parts,
        invocationContext.operationContext,
    )
    return tryAppendArrayView(suffix, invocationContext)
}

function tryAppendArrayView(suffix, invocationContext) {
    const thisValue = invocationContext.receiver
    const view = arrayViews.ArrayView.tryExtendEnd(
        thisValue,
        suffix.length,
        derived => propertyVersions.prepareRetainedArrayProperties(
            thisValue,
            derived,
            invocationContext.operationContext,
        ),
        invocationContext.operationContext,
    )
    if (!view) return undefined
    const start = view.length - suffix.length
    arrayRemaps.placeRemap(view, suffix, invocationContext.operationContext, start)
    return view
}

export { ARRAY_METHODS, RETURN_RECEIVER, PASS_AS_PAYLOAD, runArrayStep }
