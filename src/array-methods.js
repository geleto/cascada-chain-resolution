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

const RECEIVER_RESULT = Symbol()
// By default, the same-named native method runs on a property remap.
// mutationResult is absent for observations, RECEIVER_RESULT for mutators
// returning their receiver, or a publisher for an independent result.
// viewOperationResult reconstructs that result for an ArrayView mutation.
const ARRAY_METHODS = {
    __proto__: null,
    at: { exportArgs: [true], observe: observeAt },
    concat: {
        prepare: prepareConcatArguments,
        remap: createConcatResultRemap,
        view: tryConcatArrayView,
    },
    copyWithin: {
        exportArgs: [true, true, true],
        mutationResult: RECEIVER_RESULT,
    },
    fill: {
        exportArgs: [false, true, true],
        mutationResult: RECEIVER_RESULT,
    },
    flat: { prepare: prepareFlatArguments, remap: flatRemap },
    includes: { prepare: prepareSearchArguments, observe: includes },
    indexOf: { prepare: prepareSearchArguments, observe: indexOf },
    join: { exportArgs: [true], observe: join },
    lastIndexOf: {
        prepare: prepareSearchArguments,
        observe: lastIndexOf,
    },
    pop: {
        mutationResult: publishElement,
        view: tryPopArrayView,
        viewOperationResult: getLastElementOrigin,
    },
    push: {
        restValues: true,
        mutationResult: publishValue,
        view: tryAppendArrayView,
        viewOperationResult: getViewLength,
    },
    reverse: { mutationResult: RECEIVER_RESULT },
    shift: {
        mutationResult: publishElement,
        view: tryShiftArrayView,
        viewOperationResult: getFirstElementOrigin,
    },
    slice: { exportArgs: [true, true], observe: slice },
    sort: {
        prepare: prepareSortArguments,
        remap: prepareAndSortAndRemap,
        mutationResult: RECEIVER_RESULT,
    },
    splice: {
        exportArgs: [true, true],
        restValues: true,
        mutationResult: publishArray,
    },
    toReversed: {},
    toSorted: {
        prepare: prepareSortArguments,
        remap: prepareToSortedRemap,
    },
    toSpliced: { exportArgs: [true, true], restValues: true },
    toString: { observe: toString },
    unshift: { restValues: true, mutationResult: publishValue },
    with: { exportArgs: [true, false] },
}

function observeAt(thisValue, args) {
    const receiver = new Proxy(
        { length: arrayViews.logicalArrayLength(thisValue) },
        {
            get(target, key) {
                return key === "length"
                    ? target.length
                    : propertyVersions.getPropertyOrigin(thisValue, key)
            },
        },
    )
    const element = invocation.invokeDataFunction(
        Array.prototype.at,
        receiver,
        args,
    )
    return retainElement(element)
}

function slice(thisValue, args) {
    const canDeriveView = args.every(value => {
        return value === undefined || typeof value === "number"
    })
    const length = arrayViews.logicalArrayLength(thisValue)
    const start = toRelativeIndex(args[0], length, 0)
    let end = toRelativeIndex(args[1], length, length)
    end = Math.max(start, end)

    if (canDeriveView) {
        const view = deriveArrayView(thisValue, start, end)
        if (view !== undefined) return view
    }
    return arrayRemaps.createArrayFromRemap(
        arrayRemaps.createRemap(thisValue, start, end),
    )
}

function publishValue(value) {
    return value
}

function publishElement(element, sourceSurvives) {
    return sourceSurvives
        ? retainElement(element)
        : transferElement(element)
}

function publishArray(remap, sourceSurvives) {
    return arrayRemaps.createArrayFromRemap(remap, undefined, sourceSurvives)
}

function transferElement(element) {
    return propertyVersions.isPropertyOrigin(element)
        ? propertyVersions.resolvePropertyValue(element)
        : element
}

function retainElement(element) {
    return resolution.continueInternalPromiseOrFatal(
        transferElement(element),
        value => {
            metadata.markShared(value)
            return value
        },
    )
}

function getFirstElementOrigin(thisValue) {
    return propertyVersions.getPropertyOrigin(thisValue, "0")
}

function getLastElementOrigin(thisValue) {
    const length = arrayViews.logicalArrayLength(thisValue)
    return length === 0
        ? undefined
        : propertyVersions.getPropertyOrigin(thisValue, String(length - 1))
}

function getViewLength(_thisValue, view) {
    return view.length
}

function prepareConcatArguments(args, retainSource) {
    const items = args.map(item => {
        return resolution.continueInitialValueUnlessPoison(
            item,
            value => {
                const type = typeof value
                if (
                    value === null ||
                    (type !== "object" && type !== "function")
                ) return retainSource(value)

                const entry = invocation.findPropertyDescriptor(
                    value,
                    Symbol.isConcatSpreadable,
                )
                const descriptor = entry?.descriptor
                if (
                    descriptor === undefined ||
                    (
                        "value" in descriptor &&
                        descriptor.value === undefined
                    )
                ) return retainSource(value)
                return errorUtils.validationError(
                    "Concat protocols are unsupported",
                )
            },
        )
    })
    return resolution.continuePreparedValuesUnlessPoison(
        items,
        prepared => prepared,
    )
}

function createConcatResultRemap(thisValue, items) {
    return createConcatRemap(
        arrayRemaps.createRemap(thisValue),
        items,
    )
}

function createConcatRemap(receiver, items) {
    const prepared = items.map(item => {
        return arrayViews.isLogicalArray(item)
            ? arrayRemaps.createRemap(item)
            : item
    })
    return invocation.invokeDataFunction(
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

function flatRemap(thisValue, depth) {
    depth = Math.max(depth, 0)
    return resolution.continuePreparedValueUnlessPoison(
        prepareFlatArray(thisValue, depth),
        prepared => invocation.invokeDataFunction(
            Array.prototype.flat,
            prepared,
            [depth],
        ),
    )
}

function prepareFlatArray(array, depth, ancestry = undefined) {
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
        )
        if (languageValues.isError(prepared)) return prepared
        if (languageValues.isPromise(prepared)) {
            pending.push(resolution.continuePreparedValueUnlessPoison(
                prepared,
                value => ({ index, value }),
            ))
        } else {
            output[index] = prepared
        }
    }
    return resolution.continuePreparedValuesUnlessPoison(pending, entries => {
        for (const { index, value } of entries) {
            output[index] = value
        }
        return output
    })
}

function prepareFlatProperty(origin, depth, ancestry) {
    if (depth === 0) return origin
    return resolution.continueInternalPromiseOrFatal(
        propertyVersions.resolvePropertyValue(origin),
        value => {
            if (arrayViews.isLogicalArray(value)) {
                return prepareFlatArray(value, depth - 1, ancestry)
            }
            return origin
        },
    )
}

function prepareSearchArguments(args, retainSource) {
    const searchResult = resolution.resolveInitialValueOrPoison(
        args[0],
        retainSource,
    )
    const fromResult = args.length > 1
        ? conversion.toIntegerOrInfinity(args[1])
        : undefined
    return resolution.continuePreparedValuesUnlessPoison(
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

function prepareToSortedRemap(thisValue, comparator) {
    return prepareAndSortAndRemap(thisValue, comparator, true)
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
    const source = arrayRemaps.createRemap(thisValue)
    for (let index = 0; index < source.length; index++) {
        const origin = source[index]
        if (!origin) {
            holeCount++
            continue
        }
        const valueResult = propertyVersions.resolvePropertyValue(origin)
        records.push(resolution.continueInternalPromiseOrFatal(
            valueResult,
            value => {
                return {
                    origin,
                    value,
                }
            },
        ))
    }
    return resolution.continueInternalPromisesOrFatal(records, prepared => {
        const ready = comparator === undefined
            ? prepared.map(record => {
                if (record.value === undefined) return record
                return resolution.continuePreparedValueUnlessPoison(
                    conversion.toStringValue(record.value),
                    key => ({ ...record, key }),
                )
            })
            : prepared
        return resolution.continuePreparedValuesUnlessPoison(
            ready,
            sortable => {
                const compare = comparator === undefined
                    ? comparePreparedKeys
                    : compareRecords
                const sorted = invocation.invokeDataFunction(
                    Array.prototype.toSorted,
                    sortable,
                    [compare],
                )
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
            // Abort native sort through its callback boundary; invokeDataFunction
            // preserves this validation Error as the operation's poison.
            throw errorUtils.validationError(
                "Promise-returning Array sort comparators are unsupported",
            )
        }
        // An Error comparator result poisons sort, so stop native comparison
        // before it can invoke the comparator again or publish a partial order.
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
        resolution.continueInternalPromiseOrFatal(
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
    const result = next()
    if (!languageValues.isPromise(result)) return result

    // Other Array observations capture every property version before returning.
    // An ordered search resumes scanning the receiver after a pending element.
    metadata.incrementReadLease(thisValue)
    const releaseLease = () => metadata.decrementReadLease(thisValue)
    return resolution.observeResultPromise(result, releaseLease, releaseLease)

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
                return resolution.continueInternalPromiseOrFatal(
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

function toRelativeIndex(value, length, defaultValue) {
    if (value === undefined) return defaultValue
    // Numeric coercion may invoke Symbol.toPrimitive or valueOf.
    value = errorUtils.runUserCode(() => +value)
    value = Number.isNaN(value) ? 0 : Math.trunc(value)
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

function tryConcatArrayView(thisValue, items) {
    const suffix = createConcatRemap([], items)
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
    RECEIVER_RESULT,
}
