import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as conversion from "./language-conversion.js"
import * as errorUtils from "./error.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as resolution from "./resolution.js"
import * as propertyVersions from "./property-versions.js"

const ARRAY_METHODS = {
    __proto__: null,
    at: { exportArgs: [true], implementation: getElementAt },
    concat: { prepare: prepareConcatArguments, view: true },
    copyWithin: { mutate: true, exportArgs: [true, true, true] },
    fill: { mutate: true, exportArgs: [false, true, true] },
    flat: { prepare: prepareFlatArguments },
    includes: { prepare: prepareSearchArguments },
    indexOf: { prepare: prepareSearchArguments },
    join: { exportArgs: [true] },
    lastIndexOf: { prepare: prepareSearchArguments },
    pop: { mutate: true, view: true, transformResult: materializeElement },
    push: { mutate: true, view: true, restValues: true },
    reverse: { mutate: true },
    shift: { mutate: true, view: true, transformResult: materializeElement },
    slice: {
        exportArgs: [true, true],
        view: true,
        transformResult: materializeArrayResult,
    },
    sort: {
        mutate: true,
        prepare: prepareSortArguments,
        mutationRemap: prepareAndSortAndRemap,
    },
    splice: {
        mutate: true,
        exportArgs: [true, true],
        restValues: true,
        transformResult: materializeArrayResult,
    },
    toReversed: { transformResult: materializeArrayResult },
    toSorted: { prepare: prepareSortArguments },
    toSpliced: {
        exportArgs: [true, true],
        restValues: true,
        transformResult: materializeArrayResult,
    },
    toString: {},
    unshift: { mutate: true, view: true, restValues: true },
    with: {
        exportArgs: [true, false],
        transformResult: materializeArrayResult,
    },
}

function getElementAt(thisValue, args) {
    const receiver = new Proxy(
        { length: arrayViews.logicalArrayLength(thisValue) },
        {
            get(target, key) {
                return key === "length"
                    ? target.length
                    : propertyVersions.getPropertyReference(thisValue, key)
            },
        },
    )
    const origin = invocation.invokeDataFunctionOrPoison(
        Array.prototype.at,
        receiver,
        args,
    )
    return languageValues.isError(origin)
        ? origin
        : materializeElement(origin)
}

function prepareConcatArguments(args) {
    const items = args.map(item => {
        return resolution.continueInitialValueUnlessPoison(
            item,
            value => {
                const type = typeof value
                if (
                    value === null ||
                    (type !== "object" && type !== "function")
                ) return value

                const entry = invocation.findPropertyDescriptor(
                    value,
                    Symbol.isConcatSpreadable,
                )
                if (languageValues.isError(entry)) return entry
                const descriptor = entry?.descriptor
                if (
                    descriptor === undefined ||
                    (
                        "value" in descriptor &&
                        descriptor.value === undefined
                    )
                ) return value
                return errorUtils.validationError(
                    "Concat protocols are unsupported",
                )
            },
        )
    })
    return resolution.continueOperationsUnlessPoison(
        items,
        prepared => prepared,
    )
}

function concat(thisValue, items) {
    const result = createConcatRemap(
        arrayRemaps.createInitialRemap(thisValue),
        items,
    )
    return languageValues.isError(result)
        ? result
        : arrayRemaps.createArrayFromRemap(result)
}

function createConcatRemap(receiver, items) {
    const prepared = items.map(item => {
        return arrayViews.isLogicalArray(item)
            ? arrayRemaps.createInitialRemap(item)
            : item
    })
    return invocation.invokeDataFunctionOrPoison(
        Array.prototype.concat,
        receiver,
        prepared,
    )
}

function prepareFlatArguments(args) {
    return resolution.continueInitialValueUnlessPoison(
        args[0],
        value => {
            return value === undefined
                ? 1
                : conversion.toIntegerOrInfinity(value)
        },
    )
}

function flat(thisValue, depth) {
    depth = Math.max(depth, 0)
    return resolution.continueOperationUnlessPoison(
        prepareFlatArray(thisValue, depth),
        prepared => {
            const result = invocation.invokeDataFunctionOrPoison(
                Array.prototype.flat,
                prepared,
                [depth],
            )
            return languageValues.isError(result)
                ? result
                : arrayRemaps.createArrayFromRemap(result)
        },
    )
}

function prepareFlatArray(array, depth, ancestry = undefined) {
    if (depth === Infinity) {
        for (let current = ancestry; current; current = current.parent) {
            if (current.array === array) {
                return new RangeError(
                    "Cannot flat an Array cycle to unlimited depth",
                )
            }
        }
    }
    const source = arrayRemaps.createInitialRemap(array)
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
        )
        if (languageValues.isError(prepared)) return prepared
        if (languageValues.isPromise(prepared)) {
            pending.push(resolution.continueOperationUnlessPoison(
                prepared,
                value => ({ index, value }),
            ))
        } else {
            output[index] = prepared
        }
    }
    return resolution.continueOperationsUnlessPoison(pending, entries => {
        for (const { index, value } of entries) {
            output[index] = value
        }
        return output
    })
}

function prepareFlatProperty(origin, depth, ancestry) {
    if (depth === 0) return origin
    return resolution.resolveOperationResultOrFatal(
        propertyVersions.resolvePropertyValue(origin),
        value => {
            if (arrayViews.isLogicalArray(value)) {
                return prepareFlatArray(value, depth - 1, ancestry)
            }
            return origin
        },
    )
}

function prepareSearchArguments(args) {
    const searchResult = resolution.resolveInitialValueOrPoison(args[0])
    const fromResult = args.length > 1
        ? conversion.toIntegerOrInfinity(args[1])
        : undefined
    return resolution.continueOperationsUnlessPoison(
        [searchResult, fromResult],
        ([searchValue, fromIndex]) => ({ searchValue, fromIndex }),
    )
}

function join(thisValue, [separator]) {
    return conversion.joinLogicalArray(thisValue, separator)
}

function toString(thisValue) {
    return conversion.joinLogicalArray(thisValue)
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
        arrayRemaps.createArrayFromRemap,
    )
}

// Native sorting permutes property origins by their resolved values; placement
// later reads each source slot before mutation replay changes the receiver.
// Supplied comparators are synchronous and pure; default comparison stringifies
// each defined element once.
function prepareAndSortAndRemap(
    thisValue,
    comparator,
    denseHoles = false,
) {
    const records = []
    let holeCount = 0
    const source = arrayRemaps.createInitialRemap(thisValue)
    for (let index = 0; index < source.length; index++) {
        const origin = source[index]
        if (!origin) {
            holeCount++
            continue
        }
        const valueResult = propertyVersions.resolvePropertyValue(origin)
        records.push(resolution.resolveOperationResultOrFatal(
            valueResult,
            value => {
                return {
                    origin,
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
                    conversion.toStringValue(record.value),
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
                const sorted = invocation.invokeDataFunctionOrPoison(
                    Array.prototype.toSorted,
                    sortable,
                    [compare],
                )
                if (languageValues.isError(sorted)) return sorted
                source.length = sorted.length
                for (let index = 0; index < sorted.length; index++) {
                    source[index] = sorted[index].origin
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
        const valueResult = propertyVersions.resolvePropertyValueAtKey(
            thisValue,
            key,
        )
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
                    propertyVersions.resolvePropertyValueAtKey(thisValue, key),
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
    const result = propertyVersions.isPropertyReference(element)
        ? propertyVersions.resolvePropertyValue(element)
        : element
    return retained
        ? resolution.resolveOperationResultOrFatal(result, value => {
            metadata.markShared(value)
            return value
        })
        : result
}

function materializeArrayResult(remap, retained = true) {
    return arrayRemaps.createArrayFromRemap(
        remap,
        undefined,
        retained,
    )
}

export {
    ARRAY_METHODS,
    concat,
    createConcatRemap,
    flat,
    includes,
    indexOf,
    join,
    lastIndexOf,
    sort,
    toString,
    toSorted,
}
