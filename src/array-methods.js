import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as conversion from "./language-conversion.js"
import * as errorUtils from "./error.js"
import { exportValue } from "./export.js"
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
// captured intrinsic on a property remap. mutationResult is absent for pure
// observations, RETURN_RECEIVER for receiver-returning mutators, or a result
// publisher. viewOperationResult reconstructs a view mutation's result.
// leaseReceiverThroughResult protects origins captured by delayed observations.
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
        mutationResult: RETURN_RECEIVER,
    },
    fill: {
        inputs: [PASS_AS_PAYLOAD, numericInput, numericInput],
        intrinsic: Array.prototype.fill,
        mutationResult: RETURN_RECEIVER,
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
        mutationResult: publishElement,
        view: tryPopArrayView,
        viewOperationResult: getLastElementOrigin,
    },
    push: {
        intrinsic: Array.prototype.push,
        remainingArgsAsPayload: true,
        mutationResult: publishValue,
        view: tryAppendArrayView,
        viewOperationResult: getViewLength,
    },
    reverse: {
        intrinsic: Array.prototype.reverse,
        mutationResult: RETURN_RECEIVER,
    },
    shift: {
        intrinsic: Array.prototype.shift,
        mutationResult: publishElement,
        view: tryShiftArrayView,
        viewOperationResult: getFirstElementOrigin,
    },
    slice: { inputs: [numericInput, numericInput], observe: slice },
    sort: {
        leaseReceiverThroughResult: true,
        prepare: prepareSortArguments,
        remap: prepareAndSortAndRemap,
        mutationResult: RETURN_RECEIVER,
    },
    splice: {
        inputs: [numericInput, numericInput],
        intrinsic: Array.prototype.splice,
        remainingArgsAsPayload: true,
        mutationResult: publishArray,
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
        mutationResult: publishValue,
    },
    with: {
        inputs: [numericInput, PASS_AS_PAYLOAD],
        intrinsic: Array.prototype.with,
    },
}

function observeAt(thisValue, [index = 0], operation) {
    const length = arrayViews.logicalArrayLength(thisValue)
    index = index >= 0 ? index : length + index
    if (index < 0 || index >= length) return undefined
    return retainElement(
        propertyVersions.getPropertyPlacement(thisValue, String(index)),
        operation,
    )
}

function numericInput(value, operation) {
    return operationLifecycle.continueInitial(operation, value, resolved => {
        // Let each position apply its own undefined default.
        return resolved === undefined
            ? undefined
            : conversion.toIntegerOrInfinity(resolved, operation)
    })
}

function stringInput(value, operation) {
    return operationLifecycle.continueInitial(operation, value, resolved => {
        return resolved === undefined
            ? undefined
            : conversion.toStringValue(resolved, undefined, operation)
    })
}

function slice(thisValue, args) {
    const length = arrayViews.logicalArrayLength(thisValue)
    const start = toRelativeIndex(args[0], length, 0)
    const end = Math.max(start, toRelativeIndex(args[1], length, length))
    return deriveArrayView(thisValue, start, end) ??
        arrayRemaps.createArrayFromRemap(
            arrayRemaps.createRemap(thisValue, start, end),
        )
}

function publishValue(value) {
    return value
}

function publishElement(element, sourceSurvives, operation) {
    return sourceSurvives
        ? retainElement(element, operation)
        : transferElement(element, operation)
}

function publishArray(remap, sourceSurvives) {
    return arrayRemaps.createArrayFromRemap(remap, undefined, sourceSurvives)
}

function transferElement(element, operation) {
    const result = propertyVersions.isPropertyPlacement(element)
        ? propertyVersions.resolvePropertyValue(element)
        : element
    return operationLifecycle.continueInternal(operation, result, value => value)
}

function retainElement(element, operation) {
    const result = propertyVersions.isPropertyPlacement(element)
        ? propertyVersions.resolvePropertyValue(element)
        : element
    return operationLifecycle.continueInternal(
        operation,
        result,
        value => {
            metadata.markShared(value)
            return value
        },
    )
}

function getFirstElementOrigin(thisValue) {
    return propertyVersions.getPropertyPlacement(thisValue, "0")
}

function getLastElementOrigin(thisValue) {
    const length = arrayViews.logicalArrayLength(thisValue)
    return length === 0
        ? undefined
        : propertyVersions.getPropertyPlacement(thisValue, String(length - 1))
}

function getViewLength(_thisValue, view) {
    return view.length
}

function prepareConcatArguments(args, invocation) {
    const parts = args.map(item => operationLifecycle.continueInitial(
        invocation,
        item,
        value => {
            if (arrayViews.isLogicalArray(value)) {
                invocation.retainArgument(value)
                return captureRemap(value)
            }
            return [invocation.retainArgument(value)]
        },
    ))
    return operationLifecycle.continuePreparedAll(
        invocation,
        parts,
        values => values,
    )
}

function captureRemap(array) {
    const remap = arrayRemaps.createRemap(array)
    remap.forEach(propertyVersions.capturePropertyVersion)
    return remap
}

function createConcatRemap(thisValue, parts) {
    return invocation.invokeDataFunction(
        arrayConcat,
        captureRemap(thisValue),
        parts,
    )
}

function flatRemap(thisValue, [depth = 1], operation) {
    depth = Math.max(depth, 0)
    return operationLifecycle.continuePrepared(
        operation,
        prepareFlatArray(thisValue, depth, undefined, operation),
        prepared => invocation.invokeDataFunction(
            arrayFlat,
            prepared,
            [depth],
        ),
    )
}

function prepareFlatArray(array, depth, ancestry, operation) {
    if (
        depth === Infinity &&
        arrayViews.hasArrayAncestor(ancestry, array)
    ) {
        return new RangeError(
            "Cannot flat an Array cycle to unlimited depth",
        )
    }
    const source = arrayRemaps.createRemap(array)
    const output = new Array(source.length)
    const pending = []
    const nestedAncestry = depth === Infinity
        ? { array, parent: ancestry }
        : undefined
    for (let index = 0; index < source.length; index++) {
        const origin = source[index]
        if (!origin) continue
        const prepared = prepareFlatProperty(
            origin,
            depth,
            nestedAncestry,
            operation,
        )
        if (languageValues.isError(prepared)) return prepared
        if (languageValues.isPromise(prepared)) {
            pending.push(operationLifecycle.continuePrepared(
                operation,
                prepared,
                value => ({ index, value }),
            ))
        } else {
            output[index] = prepared
        }
    }
    return operationLifecycle.continuePreparedAll(operation, pending, entries => {
        for (const { index, value } of entries) output[index] = value
        return output
    })
}

function prepareFlatProperty(origin, depth, ancestry, operation) {
    if (depth === 0) return origin
    return operationLifecycle.continueInternal(
        operation,
        propertyVersions.resolvePropertyValue(origin),
        value => arrayViews.isLogicalArray(value)
            ? prepareFlatArray(value, depth - 1, ancestry, operation)
            : origin,
    )
}

function prepareSearchArguments(args, invocation) {
    const searchResult = operationLifecycle.continueInitial(
        invocation,
        args[0],
        value => value,
    )
    const fromResult = args.length > 1
        ? conversion.toIntegerOrInfinity(args[1], invocation)
        : undefined
    return operationLifecycle.continuePreparedAll(
        invocation,
        [searchResult, fromResult],
        ([searchValue, fromIndex]) => ({ searchValue, fromIndex }),
    )
}

function join(thisValue, [separator], operation) {
    return conversion.joinLogicalArray(
        thisValue,
        separator,
        undefined,
        operation,
    )
}

function prepareSortArguments(args, invocation) {
    if (args[0] === undefined) return undefined
    return operationLifecycle.continueInitial(invocation, args[0], value => {
        if (value === undefined || typeof value === "function") return value
        return errorUtils.validationError(
            "Array sort comparator must be callable or undefined",
        )
    })
}

function prepareToSortedRemap(thisValue, comparator, operation) {
    return prepareAndSortAndRemap(thisValue, comparator, operation, true)
}

function prepareAndSortAndRemap(
    thisValue,
    comparator,
    operation,
    denseHoles = false,
) {
    const source = arrayRemaps.createRemap(thisValue)
    const records = []
    for (const origin of source) {
        if (!origin) continue
        records.push(operationLifecycle.continueInternal(
            operation,
            propertyVersions.resolvePropertyValue(origin),
            value => ({ origin, value }),
        ))
    }
    return operationLifecycle.continueInternalAll(operation, records, ready => {
        const sortable = []
        const undefinedOrigins = []
        for (const record of ready) {
            if (record.value === undefined) {
                undefinedOrigins.push(record.origin)
            } else {
                sortable.push(record)
            }
        }
        if (sortable.length < 2) {
            return finish(sortable)
        }
        return prepareAndSortRecords(sortable, comparator, operation, finish)

        function finish(sorted) {
            return finishSortedRemap(
                sorted,
                undefinedOrigins,
                denseHoles,
                source.length,
            )
        }
    })
}

function prepareAndSortRecords(sortable, comparator, operation, finish) {
    if (comparator === undefined) {
        const records = sortable.map(record => operationLifecycle.continuePrepared(
            operation,
            conversion.toStringValue(record.value, undefined, operation),
            key => {
                record.key = key
                return record
            },
        ))
        return operationLifecycle.continuePreparedAll(
            operation,
            records,
            ready => sortRecords(ready, comparePreparedKeys, finish),
        )
    }

    const snapshot = sortable.map(record => record.value)
    return operationLifecycle.continuePrepared(
        operation,
        exportValue(snapshot, operation),
        exported => {
            for (let index = 0; index < sortable.length; index++) {
                sortable[index].exported = exported[index]
            }
            return sortRecords(
                sortable,
                (left, right) => compareExported(
                    comparator,
                    left.exported,
                    right.exported,
                ),
                finish,
            )
        },
    )
}

function sortRecords(sortable, compare, finish) {
    const sorted = invocation.invokeDataFunction(
        arraySort,
        sortable,
        [compare],
    )
    return finish(sorted)
}

function finishSortedRemap(
    sorted,
    undefinedOrigins,
    denseHoles,
    length,
) {
    const remap = new Array(length)
    let index = 0
    for (const record of sorted) remap[index++] = record.origin
    for (const origin of undefinedOrigins) remap[index++] = origin
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

function compareExported(comparator, left, right) {
    const result = invocation.invokeDataFunction(
        comparator,
        undefined,
        [left, right],
    )
    if (languageValues.isError(result)) throw result
    if (languageValues.isPromise(result)) {
        throw errorUtils.validationError(
            "Promise-returning Array sort comparators are unsupported",
        )
    }
    if (typeof result !== "number") {
        throw errorUtils.validationError(
            "Array sort comparator must return a Number",
        )
    }
    return result
}

function includes(
    thisValue,
    { searchValue, fromIndex = 0 },
    operation,
) {
    const length = arrayViews.logicalArrayLength(thisValue)
    if (length === 0) return false
    const start = normalizeForwardStart(fromIndex, length)
    if (start >= length) return false
    const pending = []
    for (let index = start; index < length; index++) {
        const key = String(index)
        if (!languageProperties.hasLanguageProperty(thisValue, key)) {
            if (searchValue === undefined) return true
            continue
        }
        const value = languageProperties.readLanguageProperty(thisValue, key)
        if (languageValues.isPromise(value)) {
            pending.push(key)
        } else if (matches(value)) {
            return true
        }
    }
    if (pending.length === 0) return false

    let remaining = pending.length
    let resolveResult
    let rejectResult
    const result = new Promise((resolve, reject) => {
        resolveResult = resolve
        rejectResult = reject
    })
    for (const key of pending) {
        const branch = operationLifecycle.continueInternal(
            operation,
            propertyVersions.resolvePropertyValueAtKey(thisValue, key),
            value => {
                if (matches(value)) return finish(true)
                if (--remaining === 0) finish(false)
            },
        )
        if (languageValues.isPromise(branch)) {
            operationLifecycle.observeFatal(operation, branch, rejectResult)
        }
    }
    return result

    function finish(value) {
        operationLifecycle.close(operation)
        resolveResult(value)
    }

    function matches(value) {
        return value === searchValue || Object.is(value, searchValue)
    }
}

function indexOf(thisValue, prepared, operation) {
    return orderedIndexSearch(thisValue, prepared, false, operation)
}

function lastIndexOf(thisValue, prepared, operation) {
    return orderedIndexSearch(thisValue, prepared, true, operation)
}

function orderedIndexSearch(
    thisValue,
    { searchValue, fromIndex },
    backwards,
    operation,
) {
    fromIndex ??= backwards ? Infinity : 0
    const length = arrayViews.logicalArrayLength(thisValue)
    if (length === 0) return -1
    let index = backwards
        ? normalizeBackwardStart(fromIndex, length)
        : normalizeForwardStart(fromIndex, length)
    const result = next()
    if (!languageValues.isPromise(result)) return result

    return result

    function next() {
        while (index >= 0 && index < length) {
            const current = index
            index += backwards ? -1 : 1
            const key = String(current)
            if (!languageProperties.hasLanguageProperty(thisValue, key)) {
                continue
            }
            const value = languageProperties.readLanguageProperty(
                thisValue,
                key,
            )
            if (languageValues.isPromise(value)) {
                return operationLifecycle.continueInternal(
                    operation,
                    propertyVersions.resolvePropertyValueAtKey(thisValue, key),
                    resolved => resolved === searchValue ? current : next(),
                )
            }
            if (value === searchValue) return current
        }
        return -1
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

function tryShiftArrayView(thisValue) {
    const length = arrayViews.logicalArrayLength(thisValue)
    return deriveArrayView(thisValue, Math.min(1, length), length)
}

function tryPopArrayView(thisValue) {
    const length = arrayViews.logicalArrayLength(thisValue)
    return deriveArrayView(thisValue, 0, Math.max(0, length - 1))
}

function deriveArrayView(thisValue, start, end) {
    if (start === end) return arrayRemaps.createArrayFromRemap([])
    const projection = arrayViews.ArrayView.tryAttachTo(thisValue)
    if (!projection) return undefined

    const view = new arrayViews.ArrayView(projection, start, end)
    propertyVersions.prepareRetainedArrayProperties(
        thisValue,
        view,
        start,
        end,
        -start,
    )
    return view
}

function tryConcatArrayView(thisValue, parts) {
    const suffix = invocation.invokeDataFunction(arrayConcat, [], parts)
    return tryAppendArrayView(thisValue, suffix)
}

function tryAppendArrayView(thisValue, suffix) {
    const view = arrayViews.ArrayView.tryExtendEnd(
        thisValue,
        suffix.length,
        derived => propertyVersions.prepareRetainedArrayProperties(
            thisValue,
            derived,
        ),
    )
    if (!view) return undefined
    const start = view.length - suffix.length
    arrayRemaps.placeRemap(view, suffix, start)
    return view
}

export {
    ARRAY_METHODS,
    RETURN_RECEIVER,
    PASS_AS_PAYLOAD,
}
