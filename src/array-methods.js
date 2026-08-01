import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as coercion from "./language-coercion.js"
import * as errorUtils from "./error.js"
import * as helpers from "./helpers.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as resolution from "./resolution.js"
import * as propertyCaptures from "./property-capture.js"

const ARRAY_METHODS = {
    __proto__: null,
    at: { exportArgs: [true], result: materializeElement },
    concat: { prepare: prepareConcatArguments },
    copyWithin: { mutate: true, exportArgs: [true, true, true] },
    fill: { mutate: true, exportArgs: [false, true, true] },
    flat: { prepare: prepareFlatArguments },
    includes: { prepare: prepareSearchArguments },
    indexOf: { prepare: prepareSearchArguments },
    join: { exportArgs: [true] },
    lastIndexOf: { prepare: prepareSearchArguments },
    pop: { mutate: true, endpoint: true, result: materializeElement },
    push: { mutate: true, endpoint: true, restValues: true },
    reverse: { mutate: true },
    shift: { mutate: true, endpoint: true, result: materializeElement },
    slice: { exportArgs: [true, true], result: arrayRemaps.materialize },
    sort: {
        mutate: true,
        prepare: prepareSortArguments,
        mutationRemap: prepareAndSortAndRemap,
    },
    splice: { mutate: true, exportArgs: [true, true], restValues: true, result: arrayRemaps.materialize },
    toReversed: { result: arrayRemaps.materialize },
    toSorted: { prepare: prepareSortArguments },
    toSpliced: { exportArgs: [true, true], restValues: true, result: arrayRemaps.materialize },
    toString: {},
    unshift: { mutate: true, endpoint: true, restValues: true },
    with: { exportArgs: [true, false], result: arrayRemaps.materialize },
}

function callNativeArrayMethod(method, thisValue, args) {
    return helpers.invokeDataFunctionOrPoison(
        Array.prototype[method],
        thisValue,
        args,
    )
}

function prepareConcatArguments(args) {
    const items = args.map(item => {
        return resolution.continueInitialValueUnlessPoison(
            item,
            value => {
                const protocol = helpers.hasDefinedProtocol(
                    value,
                    Symbol.isConcatSpreadable,
                )
                if (languageValues.isError(protocol)) return protocol
                return protocol
                    ? errorUtils.validationError(
                        "Concat protocols are unsupported",
                    )
                    : value
            },
        )
    })
    return resolution.continueOperationsUnlessPoison(
        items,
        prepared => prepared,
    )
}

function concat(thisValue, items) {
    const prepared = items.map(item => {
        return arrayViews.isLogicalArray(item)
            ? arrayRemaps.capture(item)
            : item
    })
    const result = callNativeArrayMethod(
        "concat",
        arrayRemaps.capture(thisValue),
        prepared,
    )
    return languageValues.isError(result)
        ? result
        : arrayRemaps.materialize(result)
}

function prepareFlatArguments(args) {
    return resolution.continueInitialValueUnlessPoison(
        args[0],
        value => {
            return value === undefined
                ? 1
                : coercion.toIntegerOrInfinity(value)
        },
    )
}

function flat(thisValue, depth) {
    depth = Math.max(depth, 0)
    return resolution.resolveOperationResultOrFatal(
        prepareFlatArray(thisValue, depth),
        prepared => {
            const result = callNativeArrayMethod(
                "flat",
                prepared,
                [depth],
            )
            return languageValues.isError(result)
                ? result
                : arrayRemaps.materialize(result)
        },
    )
}

function prepareFlatArray(array, depth) {
    const source = arrayRemaps.capture(array)
    const output = new Array(source.length)
    const pending = []
    for (let index = 0; index < source.length; index++) {
        const property = source[index]
        if (!property) continue
        const prepared = prepareFlatProperty(
            property,
            depth,
        )
        if (languageValues.isPromise(prepared)) {
            pending.push(resolution.resolveOperationResultOrFatal(
                prepared,
                value => ({ index, value }),
            ))
        } else {
            output[index] = prepared
        }
    }
    return resolution.resolveOperationResultsOrFatal(pending, entries => {
        for (const { index, value } of entries) output[index] = value
        return output
    })
}

function prepareFlatProperty(property, depth) {
    if (depth === 0) return property
    return resolution.resolveOperationResultOrFatal(
        propertyCaptures.resolve(property),
        value => {
            if (arrayViews.isLogicalArray(value)) {
                return prepareFlatArray(value, depth - 1)
            }
            propertyCaptures.updateValue(property, value)
            return property
        },
    )
}

function prepareSearchArguments(args) {
    const searchResult = resolution.resolveInitialValueOrPoison(args[0])
    const fromResult = args.length > 1
        ? coercion.toIntegerOrInfinity(args[1])
        : undefined
    return resolution.continueOperationsUnlessPoison(
        [searchResult, fromResult],
        ([searchValue, fromIndex]) => ({ searchValue, fromIndex }),
    )
}

function join(thisValue, [separator]) {
    return coercion.joinLogicalArray(thisValue, separator)
}

function toString(thisValue) {
    return coercion.joinLogicalArray(thisValue)
}

function prepareSortArguments(args) {
    const argument = args[0]
    if (argument === undefined) return undefined
    return resolution.continueInitialValueUnlessPoison(
        argument,
        value => {
            if (value === undefined) return undefined
            if (typeof value !== "function") {
                return errorUtils.validationError(
                    "Array sort comparator must be callable or undefined",
                )
            }
            return value
        },
    )
}

function toSorted(thisValue, comparator) {
    return sort(thisValue, comparator, true)
}

function sort(thisValue, comparator, denseHoles = false) {
    return resolution.continueOperationUnlessPoison(
        prepareAndSortAndRemap(thisValue, comparator, denseHoles),
        arrayRemaps.materialize,
    )
}

// Native sorting permutes captured properties by their resolved values; each
// final position becomes the property's new index, preserving slot metadata.
// Supplied comparators are synchronous and pure; default comparison stringifies
// each defined element once.
function prepareAndSortAndRemap(
    thisValue,
    comparator,
    denseHoles = false,
) {
    const records = []
    let holeCount = 0
    const source = arrayRemaps.capture(thisValue)
    for (let index = 0; index < source.length; index++) {
        const property = source[index]
        if (!property) {
            holeCount++
            continue
        }
        const valueResult =
            propertyCaptures.resolve(property)
        records.push(resolution.resolveOperationResultOrFatal(
            valueResult,
            value => {
                propertyCaptures.updateValue(property, value)
                return {
                    property,
                    value,
                }
            },
        ))
    }
    return resolution.resolveOperationResultsOrFatal(records, prepared => {
        const ready = comparator === undefined
            ? prepared.map(record => {
                if (record.value === undefined) return record
                return resolution.continueOperationUnlessPoison(
                    coercion.toStringValue(record.value),
                    key => ({ ...record, key }),
                )
            })
            : prepared
        return resolution.continueOperationsUnlessPoison(
            ready,
            sortable => {
                const compare = comparator === undefined
                    ? comparePreparedKeys
                    : compareRecords
                const sorted = callNativeArrayMethod(
                    "toSorted",
                    sortable,
                    [compare],
                )
                if (languageValues.isError(sorted)) return sorted
                source.length = sorted.length
                for (let index = 0; index < sorted.length; index++) {
                    source[index] = sorted[index].property
                }
                const sortedLength = source.length
                source.length += holeCount
                if (denseHoles) {
                    for (let index = sortedLength; index < source.length; index++) {
                        source[index] = undefined
                    }
                }
                return source
            },
        )
    })

    function comparePreparedKeys(left, right) {
        if (left.value === undefined) {
            return right.value === undefined ? 0 : 1
        }
        if (right.value === undefined) return -1
        if (left.key < right.key) return -1
        if (left.key > right.key) return 1
        return 0
    }

    function compareRecords(left, right) {
        if (left.value === undefined) {
            return right.value === undefined ? 0 : 1
        }
        if (right.value === undefined) return -1
        const result = Reflect.apply(
            comparator,
            undefined,
            [left.value, right.value],
        )
        if (languageValues.isPromise(result)) {
            throw errorUtils.validationError(
                "Promise-returning Array sort comparators are unsupported",
            )
        }
        if (languageValues.isError(result)) throw result
        return result
    }
}

function includes(
    thisValue,
    { searchValue, fromIndex = 0 },
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
    let matched = false
    let resolveResult
    const result = new Promise(resolve => {
        resolveResult = resolve
    })
    for (const key of pending) {
        const valueResult = propertyCaptures.resolveAt(thisValue, key)
        resolution.resolveOperationResultOrFatal(
            valueResult,
            value => {
                if (!matched && matches(value)) {
                    matched = true
                    resolveResult(true)
                }
                remaining--
                if (remaining === 0 && !matched) resolveResult(false)
            },
        )
    }
    return result

    function matches(value) {
        return value === searchValue || Object.is(value, searchValue)
    }
}

function indexOf(thisValue, prepared) {
    return orderedIndexSearch(thisValue, prepared, false)
}

function lastIndexOf(thisValue, prepared) {
    return orderedIndexSearch(thisValue, prepared, true)
}

function orderedIndexSearch(
    thisValue,
    { searchValue, fromIndex },
    backwards,
) {
    fromIndex ??= backwards ? Infinity : 0
    const length = arrayViews.logicalArrayLength(thisValue)
    if (length === 0) return -1
    let index = backwards
        ? normalizeBackwardStart(fromIndex, length)
        : normalizeForwardStart(fromIndex, length)
    return next()

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
                return resolution.resolveOperationResultOrFatal(
                    propertyCaptures.resolveAt(thisValue, key),
                    resolved => resolved === searchValue
                        ? current
                        : next(),
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

function materializeElement(element, retained = true) {
    const result = propertyCaptures.is(element)
        ? propertyCaptures.resolve(element)
        : element
    return retained
        ? resolution.resolveOperationResultOrFatal(result, value => {
            metadata.markShared(value)
            return value
        })
        : result
}

export {
    ARRAY_METHODS,
    concat,
    flat,
    includes,
    indexOf,
    join,
    lastIndexOf,
    sort,
    toString,
    toSorted,
}
