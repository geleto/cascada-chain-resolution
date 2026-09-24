import { ArrayView, isLogicalArray, isArrayIndex, hasArrayAncestor } from "./array-view.js"
import * as internalSteps from "./internal-step.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import * as arrayRemaps from "./array-remap.js"
import * as conversion from "./language-conversion.js"
import * as errorUtils from "./error.js"
import { exportManyValues } from "./export.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import { finishContainerCopy } from "./placement-structure.js"

const RETURN_RECEIVER = Symbol()
const PASS_AS_PAYLOAD = Symbol()
const arrayConcat = Array.prototype.concat
const arrayFlat = Array.prototype.flat
const arraySort = Array.prototype.sort

// Dispatch precedence is view, direct observation, remap producer, then the
// captured intrinsic on a property remap. methodResult is absent for pure
// observations, RETURN_RECEIVER for receiver-returning mutators, or a result
// handler. viewNativeResult reconstructs the native result a view mutation
// would have returned, which methodResult then consumes.
// leaseInputsThroughResult protects receiver placements and retained payloads
// until a delayed observation has captured its output.
// PASS_AS_PAYLOAD retains logical data without resolving, converting, or exporting.
const ARRAY_METHODS = {
    __proto__: null,
    at: { prepare: prepareAtIndex, observe: observeAt },
    concat: {
        prepare: prepareConcatArguments,
        leaseInputsThroughResult: true,
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
        leaseInputsThroughResult: true,
        remap: prepareFlatRemap,
    },
    includes: {
        leaseInputsThroughResult: true,
        prepare: prepareSearchArguments,
        observe: includes,
    },
    indexOf: {
        leaseInputsThroughResult: true,
        prepare: prepareSearchArguments,
        observe: indexOf,
    },
    join: { inputs: [stringInput], observe: join },
    lastIndexOf: {
        leaseInputsThroughResult: true,
        prepare: prepareSearchArguments,
        observe: lastIndexOf,
    },
    pop: {
        intrinsic: Array.prototype.pop,
        methodResult: retainElement,
        view: tryPopArrayView,
        viewNativeResult: getLastElementPlacement,
    },
    push: {
        intrinsic: Array.prototype.push,
        remainingArgsAsPayload: true,
        methodResult: plainResult,
        view: tryAppendArrayView,
        viewNativeResult: getViewLength,
    },
    reverse: {
        intrinsic: Array.prototype.reverse,
        methodResult: RETURN_RECEIVER,
    },
    shift: {
        intrinsic: Array.prototype.shift,
        methodResult: retainElement,
        view: tryShiftArrayView,
        viewNativeResult: getFirstElementPlacement,
    },
    slice: { prepare: prepareSliceBounds, observe: slice },
    sort: {
        leaseInputsThroughResult: true,
        prepare: prepareSortArguments,
        remap: prepareSortedRemap,
        methodResult: RETURN_RECEIVER,
    },
    splice: {
        inputs: [numericInput, numericInput],
        intrinsic: Array.prototype.splice,
        remainingArgsAsPayload: true,
        methodResult: retainArray,
    },
    toReversed: { intrinsic: Array.prototype.toReversed, leaseInputsThroughResult: true },
    toSorted: {
        leaseInputsThroughResult: true,
        prepare: prepareSortArguments,
        remap: prepareToSortedRemap,
    },
    toSpliced: {
        inputs: [numericInput, numericInput],
        intrinsic: Array.prototype.toSpliced,
        remainingArgsAsPayload: true,
        leaseInputsThroughResult: true,
    },
    // No prepared arguments makes join use its default separator.
    toString: { observe: join },
    unshift: {
        intrinsic: Array.prototype.unshift,
        remainingArgsAsPayload: true,
        methodResult: plainResult,
    },
    with: {
        prepare: prepareWithArguments,
        intrinsic: Array.prototype.with,
        leaseInputsThroughResult: true,
    },
}

function prepareAtIndex(work) {
    return internalSteps.prepareInputs([numericInput(work.args[0], work)], work.operationContext,
        ([index = 0]) => runArrayStep(work, () => index < 0
            ? ArrayView.resolveInRange(work.receiver, -index - 1, work, present => present
                ? ArrayView.resolveLength(work.receiver, work, length => length + index) : undefined)
            : index), work)
}

function prepareWithArguments(work) {
    const replacement = work.leaseArgument(work.args[1])
    return internalSteps.prepareInputs([numericInput(work.args[0], work)], work.operationContext,
        ([index = 0]) => runArrayStep(work, () => {
            const finish = valid => valid ? [index, replacement] : errorUtils.validationError(
                "Array index is out of range", work.operationContext, errorUtils.ERROR_KIND.InvalidArrayOperation)
            return ArrayView.resolveInRange(work.receiver, index < 0 ? -index - 1 : index, work, finish)
        }), work)
}

function observeAt(index, invocationWork) {
    const thisValue = invocationWork.receiver
    if (!isArrayIndex(String(index))) return undefined
    return retainElement(
        propertyVersions.getPropertyPlacement(
            thisValue,
            String(index),
            invocationWork.operationContext,
        ),
        invocationWork,
    )
}

function numericInput(value, invocationWork) {
    return internalSteps.consumeValue(
        value,
        invocationWork.operationContext,
        errorUtils.ERROR_KIND.OperationInputFailed,
        resolved => {
            if (errorUtils.isPoisonError(resolved)) return resolved

            // Let each position apply its own undefined default.
            return resolved === undefined
                ? undefined
                : conversion.toIntegerOrInfinity(resolved, invocationWork)
        },
        invocationWork,
    )
}

function stringInput(value, invocationWork) {
    return internalSteps.consumeValue(
        value,
        invocationWork.operationContext,
        errorUtils.ERROR_KIND.OperationInputFailed,
        resolved => {
            if (errorUtils.isPoisonError(resolved)) return resolved

            return resolved === undefined
                ? undefined
                : conversion.toStringValue(resolved, undefined, invocationWork)
        },
        invocationWork,
    )
}

function prepareSliceBounds(work) {
    return internalSteps.prepareInputs(work.args.slice(0, 2).map(value => numericInput(value, work)),
        work.operationContext, ([start = 0, end]) => runArrayStep(work, () => {
            // Relative bounds with the same sign preserve their ordering at
            // every length. These empty ranges consume no receiver placements.
            if (start === Infinity || end === -Infinity ||
                end !== undefined && (start < 0) === (end < 0) && start >= end) return [0, 0]
            const exact = () => ArrayView.resolveLength(work.receiver, work, length => {
                const first = toRelativeIndex(start, length, 0)
                return [first, Math.max(first, toRelativeIndex(end, length, length))]
            })
            return start >= 0 ? ArrayView.resolveInRange(work.receiver, start, work, present => {
                if (!present) return [0, 0]
                return end >= 0 && Number.isFinite(end)
                    ? ArrayView.resolveInRange(work.receiver, end - 1, work, covered => covered ? [start, end] : exact())
                    : exact()
            }) : exact()
        }), work)
}

function slice([start, end], invocationWork) {
    const thisValue = invocationWork.receiver
    return tryDeriveArrayView(start, end, invocationWork) ??
        arrayRemaps.createArrayFromRemap(
            arrayRemaps.createRemap(thisValue, invocationWork.operationContext, start, end),
            invocationWork.operationContext,
        )
}

function plainResult(value) {
    return value
}

function retainArray(remap, invocationWork) {
    return arrayRemaps.createArrayFromRemap(remap, invocationWork.operationContext)
}

// pop/shift/at hand this element to the caller: reject a registered mutable
// identity leaving its context path, then retain what the caller keeps.
function retainElement(element, invocationWork) {
    const result = propertyVersions.isPropertyPlacement(element)
        ? element.resolveValue()
        : element
    return internalSteps.continueOperation(
        result,
        invocationWork.operationContext,
        value => {
            if (invocationWork.operationContext.execution._externalIdentities.has(value))
                return externalCapabilityEscapeError(invocationWork.operationContext)
            metadata.markShared(value, invocationWork.operationContext)
            return value
        },
        undefined,
        invocationWork,
    )
}

function getFirstElementPlacement(_view, invocationWork) {
    const thisValue = invocationWork.receiver
    return propertyVersions.getPropertyPlacement(
        thisValue,
        "0",
        invocationWork.operationContext,
    )
}

function getLastElementPlacement(_view, invocationWork) {
    const thisValue = invocationWork.receiver
    const length = invocationWork.arrayLength
    return length === 0
        ? undefined
        : propertyVersions.getPropertyPlacement(
            thisValue,
            String(length - 1),
            invocationWork.operationContext,
        )
}

function getViewLength(view, work) {
    return ArrayView.readyLength(view, work.operationContext)
}

// Every Array step consumes exact external escapes before its continuation returns
// to the fatal envelope. The same rule applies to ready and resumed work.
function runArrayStep(invocationWork, work) {
    return errorUtils.catchExternalThrow(
        work,
        invocationWork.operationContext,
        invocationWork.mutation ? errorUtils.ERROR_KIND.PropertyMutationFailed : errorUtils.ERROR_KIND.InvocationFailed,
    )
}

// Complete preparation keeps an unreadable placement as an Error input instead
// of abandoning known siblings. Fix presence before resolving any property value.
// Structural remaps keep their ordinary all-or-nothing capture contract.
function collectArrayPlacements(array, invocationWork) {
    const operationContext = invocationWork.operationContext
    const placements = new Array(ArrayView.minimumLength(array, operationContext))
    for (const key of languageProperties.enumerableLanguageKeyCandidates(array, operationContext)) {
        const placement = runArrayStep(invocationWork, () =>
            propertyVersions.getPropertyPlacement(array, key, operationContext),
        )
        if (placement !== undefined) {
            languageProperties.writeLanguageProperty(
                placements,
                key,
                placement,
                operationContext,
            )
        }
    }
    return placements
}

function prepareConcatArguments(invocationWork) {
    const parts = invocationWork.args.map(item =>
        internalSteps.consumeValue(
            item,
            invocationWork.operationContext,
            errorUtils.ERROR_KIND.OperationInputFailed,
            value =>
                runArrayStep(invocationWork, () => {
                    if (errorUtils.isPoisonError(value)) return value
                    invocationWork.leaseArgument(value)
                    return isLogicalArray(value, invocationWork.operationContext)
                        ? captureRemap(value, invocationWork)
                        : [value]
                }),
            invocationWork,
        ),
    )
    return internalSteps.prepareInputs(
        parts,
        invocationWork.operationContext,
        values => values,
        invocationWork,
    )
}

function captureRemap(array, work) {
    const operationContext = work.operationContext
    const remap = arrayRemaps.createRemap(array, operationContext)
    remap.forEach(placement => placement?.ensureCaptured())
    return ArrayView.resolveLength(array, work, length => { remap.length = length; return remap })
}

function createConcatRemap(parts, invocationWork) {
    return internalSteps.continueOperation(
        captureRemap(invocationWork.receiver, invocationWork),
        invocationWork.operationContext,
        remap => invocation.invokeFunction(arrayConcat, remap, parts, invocationWork.operationContext),
        undefined,
        invocationWork,
    )
}

function prepareFlatRemap([depth = 1], invocationWork) {
    depth = Math.max(depth, 0)
    return internalSteps.continueOperation(
        prepareFlatArray(
            invocationWork.receiver,
            depth,
            undefined,
            invocationWork,
        ),
        invocationWork.operationContext,
        prepared => {
            if (errorUtils.isPoisonError(prepared)) return prepared
            return invocation.invokeFunction(
                arrayFlat,
                prepared,
                [depth],
                invocationWork.operationContext,
            )
        },
        undefined,
        invocationWork,
    )
}

function prepareFlatArray(array, depth, ancestry, invocationWork) {
    return runArrayStep(invocationWork, () => {
        if (
            depth === Infinity &&
            hasArrayAncestor(ancestry, array)
        ) {
            return errorUtils.validationError(
                "Cannot flat an Array cycle to unlimited depth",
                invocationWork.operationContext,
                errorUtils.ERROR_KIND.InvalidArrayOperation,
            )
        }
        const source = collectArrayPlacements(array, invocationWork)
        const shape = { length: ArrayView.captureLength(array, invocationWork.operationContext, invocationWork) }
        const keys = Object.keys(source)
        const nestedAncestry = depth === Infinity
            ? { array, parent: ancestry }
            : undefined
        const parts = keys.map(key =>
            prepareFlatProperty(
                source[key],
                depth,
                nestedAncestry,
                invocationWork,
            ),
        )
        return internalSteps.prepareInputs(
            parts,
            invocationWork.operationContext,
            values => {
                const output = new Array(source.length)
                for (let index = 0; index < keys.length; index++)
                    if (source[keys[index]].present !== false) output[keys[index]] = values[index]
                finishContainerCopy(output, shape)
                return output
            },
            invocationWork,
        )
    })
}

function prepareFlatProperty(placement, depth, ancestry, invocationWork) {
    return runArrayStep(invocationWork, () => {
        if (errorUtils.isPoisonError(placement)) return placement
        if (depth === 0) return placement.resolvePresence()
        return internalSteps.continueOperation(
            placement.resolveValue(),
            invocationWork.operationContext,
            value => isLogicalArray(value, invocationWork.operationContext)
                ? prepareFlatArray(value, depth - 1, ancestry, invocationWork)
                : placement,
            undefined,
            invocationWork,
        )
    })
}

function prepareSearchArguments(invocationWork) {
    const { args } = invocationWork
    const searchResult = internalSteps.consumeValue(
        args[0],
        invocationWork.operationContext,
        errorUtils.ERROR_KIND.OperationInputFailed,
        value => value,
        invocationWork,
    )
    const fromResult = args.length > 1
        ? conversion.toIntegerOrInfinity(args[1], invocationWork)
        : undefined
    return internalSteps.prepareInputs(
        [searchResult, fromResult],
        invocationWork.operationContext,
        readyValues => {
            const backwards = invocationWork.method === "lastIndexOf"
            const [searchValue, fromIndex = backwards ? Infinity : 0] = readyValues
            const at = start => ({ searchValue, start })
            const capture = () => ArrayView.resolveLength(invocationWork.receiver, invocationWork,
                length => at(backwards ? normalizeBackwardStart(fromIndex, length) : normalizeForwardStart(fromIndex, length)))
            return runArrayStep(invocationWork, () => {
                // Absolute forward starts need no length. An absolute backward
                // start needs only proof that the position is in range.
                if (fromIndex >= 0) return backwards
                    ? ArrayView.resolveInRange(invocationWork.receiver, fromIndex, invocationWork,
                        present => present ? at(fromIndex) : capture())
                    : at(fromIndex)
                if (!backwards) return fromIndex === -Infinity ? at(0) : capture()
                return ArrayView.resolveInRange(invocationWork.receiver, -fromIndex - 1, invocationWork,
                    present => present ? capture() : at(-1))
            })
        },
        invocationWork,
    )
}

function join([separator], invocationWork) {
    return conversion.joinLogicalArray(
        invocationWork.receiver,
        separator,
        undefined,
        invocationWork,
    )
}

function prepareSortArguments(invocationWork) {
    const { args } = invocationWork
    if (args[0] === undefined) return undefined
    return internalSteps.consumeValue(
        args[0],
        invocationWork.operationContext,
        errorUtils.ERROR_KIND.OperationInputFailed,
        value => {
            if (errorUtils.isPoisonError(value)) return value

            if (value === undefined || typeof value === "function") return value
            return errorUtils.validationError(
                "Array sort comparator must be callable or undefined",
                invocationWork.operationContext,
                errorUtils.ERROR_KIND.NotAFunction,
            )
        },
        invocationWork,
    )
}

function prepareToSortedRemap(comparator, invocationWork) {
    return prepareSortedRemap(comparator, invocationWork, true)
}

function prepareSortedRemap(comparator, invocationWork, denseOutput = false) {
    const thisValue = invocationWork.receiver
    const source = collectArrayPlacements(thisValue, invocationWork)
    const shape = { length: ArrayView.captureLength(thisValue, invocationWork.operationContext, invocationWork) }
    const records = []
    for (const key of Object.keys(source)) {
        const placement = source[key]
        if (errorUtils.isPoisonError(placement)) {
            records.push(placement)
            continue
        }
        records.push(
            runArrayStep(invocationWork, () =>
                internalSteps.continueOperation(
                    placement.resolveValue(),
                    invocationWork.operationContext,
                    value => ({ placement, value }),
                    undefined,
                    invocationWork,
                ),
            ),
        )
    }
    // Failed captures remain inputs to conversion/export, alongside successfully
    // resolved records. Only that complete preparation may decide to stop sorting.
    return internalSteps.collectInputs(
        records,
        invocationWork.operationContext,
        ready => {
            const sortable = []
            const undefinedPlacements = []
            for (const record of ready) {
                if (record.placement?.present === false) continue
                if (!errorUtils.isPoisonError(record) && record.value === undefined) {
                    undefinedPlacements.push(record.placement)
                } else {
                    sortable.push(record)
                }
            }
            if (sortable.length < 2) {
                return errorUtils.isPoisonError(sortable[0]) ? sortable[0] : finish(sortable)
            }
            return prepareAndSortRecords(sortable, comparator, invocationWork, finish)

            function finish(sorted) {
                finishContainerCopy(source, shape)
                return finishSortedRemap(
                    sorted,
                    undefinedPlacements,
                    denseOutput,
                    source.length,
                )
            }
        },
        invocationWork,
    )
}

function prepareAndSortRecords(
    sortable,
    comparator,
    invocationWork,
    finish,
) {
    if (comparator === undefined) {
        const records = sortable.map(record => {
            if (errorUtils.isPoisonError(record)) return record
            return internalSteps.continueOperation(
                conversion.toStringValue(record.value, undefined, invocationWork),
                invocationWork.operationContext,
                key => {
                    if (errorUtils.isPoisonError(key)) return key

                    record.key = key
                    return record
                },
                undefined,
                invocationWork,
            )
        })
        return internalSteps.prepareInputs(
            records,
            invocationWork.operationContext,
            ready => {
                return sortRecords(
                    ready,
                    comparePreparedKeys,
                    invocationWork.operationContext,
                    finish,
                )
            },
            invocationWork,
        )
    }

    const snapshot = sortable.map(record =>
        errorUtils.isPoisonError(record) ? record : record.value,
    )
    return internalSteps.continueOperation(
        exportManyValues(snapshot, invocationWork),
        invocationWork.operationContext,
        exported => {
            if (errorUtils.isPoisonError(exported)) return exported

            for (let index = 0; index < sortable.length; index++) {
                sortable[index].exported = exported[index]
            }
            return sortRecords(
                sortable,
                (left, right) => compareExported(
                    comparator,
                    left.exported,
                    right.exported,
                    invocationWork.operationContext,
                ),
                invocationWork.operationContext,
                finish,
            )
        },
        undefined,
        invocationWork,
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
    denseOutput,
    length,
) {
    const remap = new Array(length)
    let index = 0
    for (const record of sorted) remap[index++] = record.placement
    for (const placement of undefinedPlacements) remap[index++] = placement
    if (denseOutput) {
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
    const result = invocation.invokeFunction(
        comparator,
        undefined,
        [left, right],
        operationContext,
        errorUtils.ERROR_KIND.ControlledCallbackFailed,
    )
    if (errorUtils.isPoisonError(result)) throw result
    const pending = errorUtils.runExternalBoundary(
        operationContext,
        errorUtils.ERROR_KIND.ThenAccessFailed,
        () => languageValues.isPending(result, operationContext),
    )
    if (errorUtils.isPoisonError(pending)) throw pending
    if (pending) {
        const observed = internalSteps.continueOperation(
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

function includes({ searchValue, start }, invocationWork) {
    const thisValue = invocationWork.receiver
    const operationContext = invocationWork.operationContext
    // Scanning is one unfinished branch; each pending comparison adds another.
    // Any match can finish while scanning still awaits growth or other values.
    let remaining = 1, index = start, outcome, result
    scan()
    if (outcome !== undefined) return outcome
    result = Promise.withResolvers()
    return result.promise

    function scan() {
        const failure = runArrayStep(invocationWork, () => {
            const end = ArrayView.minimumLength(thisValue, operationContext)
            for (; index < end; index++) {
                const branch = internalSteps.continueOperation(
                    propertyVersions.resolvePropertyValueAtKey(thisValue, String(index), operationContext),
                    operationContext, matches, undefined, invocationWork,
                )
                if (languageValues.isPending(branch, operationContext)) {
                    remaining++
                    const wait = internalSteps.continueOperation(branch, operationContext, finish, undefined, invocationWork)
                    markPromiseHandled(wait, operationContext)
                } else if (branch) return finish(true)
            }
            const wait = ArrayView.resolveInRange(thisValue, index, invocationWork, present => {
                if (present) return scan()
                // All property versions are captured. Their pending values no
                // longer need the receiver, just as with an initially ready shape.
                invocationWork.releaseReceiverLeases()
                finish(false)
            })
            markPromiseHandled(wait, operationContext)
        })
        if (errorUtils.isPoisonError(failure)) finish(failure)
    }

    function finish(found) {
        if (outcome !== undefined) return
        if (!found && --remaining !== 0) return
        outcome = found
        if (result) {
            invocationWork.close()
            result.resolve(found)
        }
    }

    function matches(value) {
        return value === searchValue || Object.is(value, searchValue)
    }
}

function indexOf(prepared, invocationWork) {
    return orderedIndexSearch(prepared, false, invocationWork)
}

function lastIndexOf(prepared, invocationWork) {
    return orderedIndexSearch(prepared, true, invocationWork)
}

function orderedIndexSearch(
    { searchValue, start },
    backwards,
    invocationWork,
) {
    const thisValue = invocationWork.receiver
    let index = start
    return next()

    function next() {
        return runArrayStep(invocationWork, () => {
            const end = backwards ? -1 : ArrayView.minimumLength(thisValue, invocationWork.operationContext)
            while (backwards ? index > end : index < end) {
                const current = index
                index += backwards ? -1 : 1
                const key = String(current)
                const placement = propertyVersions.getPropertyPlacement(
                    thisValue,
                    key,
                    invocationWork.operationContext,
                )
                if (!placement) continue
                const value = placement.resolveValue()
                if (languageValues.isPending(value, invocationWork.operationContext)) {
                    return internalSteps.continueOperation(
                        value,
                        invocationWork.operationContext,
                        resolved => placement.present !== false &&
                            resolved === searchValue ? current : next(),
                        undefined,
                        invocationWork,
                    )
                }
                if (placement.present !== false && value === searchValue) return current
            }
            return backwards ? -1 : ArrayView.resolveInRange(thisValue, index, invocationWork,
                present => present ? next() : -1)
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

function tryShiftArrayView(_args, invocationWork) {
    const thisValue = invocationWork.receiver
    const length = invocationWork.arrayLength
    return tryDeriveArrayView(
        Math.min(1, length),
        length,
        invocationWork,
    )
}

function tryPopArrayView(_args, invocationWork) {
    const thisValue = invocationWork.receiver
    const length = invocationWork.arrayLength
    return tryDeriveArrayView(
        0,
        Math.max(0, length - 1),
        invocationWork,
    )
}

function tryDeriveArrayView(start, end, invocationWork) {
    const { operationContext, receiver: thisValue } = invocationWork
    if (start === end) return arrayRemaps.createArrayFromRemap([], operationContext)
    const projection = ArrayView.tryAttachTo(thisValue, operationContext)
    if (!projection) return undefined

    const view = new ArrayView(projection, operationContext, start, end)
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

function tryConcatArrayView(parts, invocationWork) {
    const suffix = invocation.invokeFunction(
        arrayConcat,
        [],
        parts,
        invocationWork.operationContext,
    )
    return tryAppendArrayView(suffix, invocationWork)
}

function tryAppendArrayView(suffix, invocationWork) {
    const { receiver: thisValue, operationContext } = invocationWork
    const view = ArrayView.tryExtendEnd(
        thisValue,
        suffix.length,
        derived => propertyVersions.prepareRetainedArrayProperties(
            thisValue,
            derived,
            operationContext,
        ),
        operationContext,
    )
    if (!view) return undefined
    const start = ArrayView.readyLength(view, operationContext) - suffix.length
    arrayRemaps.placeRemap(view, suffix, operationContext, start)
    return view
}

export { ARRAY_METHODS, RETURN_RECEIVER, PASS_AS_PAYLOAD, runArrayStep }
