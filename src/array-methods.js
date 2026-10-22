import { captureIdentity, compareIdentities, IdentityPublication } from "./captured-identity.js"
import { ArrayView, isLogicalArray, isArrayIndex, hasArrayAncestor } from "./array-view.js"
import * as internalSteps from "./internal-step.js"
import { markPromiseHandled, mayBeThenable, readCallableThen } from "./thenable-subscription.js"
import * as arrayRemaps from "./array-remap.js"
import * as conversion from "./language-conversion.js"
import * as errorUtils from "./error.js"
import { ManagedCapture } from "./managed-capture.js"
import { assembleCapturedGraph } from "./captured-graph.js"
import * as invocation from "./invocation.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import { PlacementConstruction } from "./parent-placements.js"
import { externalCapabilityEscapeError } from "./external-operation.js"

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
// inputs and restInput determine both the protected frontier and preparation.
// Custom preparation receives those outcomes and consumes receiver shape before
// snapshot identity assembly. Placement-consuming work belongs to invocation.
// A remap producer can report a nonwriting or pending mutation through its third
// argument. Otherwise publication is effective. Intrinsics require exact length
// before invocation, including when a custom remap supplies their write rules.
const ARRAY_METHODS = {
    __proto__: null,
    at: { inputs: [numericInput], prepare: prepareAtIndex, observe: observeAt },
    concat: {
        restInput: concatInput,
        leaseInputsThroughResult: true,
        prepare: prepareConcatArguments,
        remap: createConcatRemap,
        view: tryConcatArrayView,
    },
    copyWithin: {
        inputs: [numericInput, numericInput, numericInput],
        intrinsic: Array.prototype.copyWithin,
        remap: copyWithin,
        methodResult: RETURN_RECEIVER,
    },
    fill: {
        inputs: [PASS_AS_PAYLOAD, numericInput, numericInput],
        intrinsic: Array.prototype.fill,
        remap: fill,
        methodResult: RETURN_RECEIVER,
    },
    flat: {
        inputs: [numericInput],
        leaseInputsThroughResult: true,
        remap: prepareFlatRemap,
    },
    includes: {
        leaseInputsThroughResult: true,
        inputs: [identityInput, searchFromIndex],
        prepare: prepareSearchArguments,
        observe: includes,
    },
    indexOf: {
        leaseInputsThroughResult: true,
        inputs: [identityInput, searchFromIndex],
        prepare: prepareSearchArguments,
        observe: indexOf,
    },
    join: { inputs: [stringInput], observe: join },
    lastIndexOf: {
        leaseInputsThroughResult: true,
        inputs: [identityInput, searchFromIndex],
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
        restInput: PASS_AS_PAYLOAD,
        methodResult: plainResult,
        view: tryAppendArrayView,
        viewNativeResult: getViewLength,
    },
    reverse: {
        intrinsic: Array.prototype.reverse,
        remap: reverse,
        methodResult: RETURN_RECEIVER,
    },
    shift: {
        intrinsic: Array.prototype.shift,
        methodResult: retainElement,
        view: tryShiftArrayView,
        viewNativeResult: getFirstElementPlacement,
    },
    slice: { inputs: [numericInput, numericInput], prepare: prepareSliceBounds, observe: slice },
    sort: {
        leaseInputsThroughResult: true,
        inputs: [comparatorInput],
        remap: prepareSortedRemap,
        methodResult: RETURN_RECEIVER,
    },
    splice: {
        inputs: [numericInput, numericInput],
        intrinsic: Array.prototype.splice,
        restInput: PASS_AS_PAYLOAD,
        methodResult: retainArray,
    },
    toReversed: { intrinsic: Array.prototype.toReversed, leaseInputsThroughResult: true },
    toSorted: {
        leaseInputsThroughResult: true,
        inputs: [comparatorInput],
        remap: prepareToSortedRemap,
    },
    toSpliced: {
        inputs: [numericInput, numericInput],
        intrinsic: Array.prototype.toSpliced,
        restInput: PASS_AS_PAYLOAD,
        leaseInputsThroughResult: true,
    },
    // No prepared arguments makes join use its default separator.
    toString: { observe: join },
    unshift: {
        intrinsic: Array.prototype.unshift,
        restInput: PASS_AS_PAYLOAD,
        methodResult: plainResult,
    },
    with: {
        inputs: [numericInput, PASS_AS_PAYLOAD],
        prepare: prepareWithArguments,
        intrinsic: Array.prototype.with,
        leaseInputsThroughResult: true,
    },
}

function resolveArrayLength(work, onLength) {
    return work.arrayLength !== undefined ? onLength(work.arrayLength) :
        ArrayView.resolveLength(work.receiver, work, onLength)
}

function resolveArrayInRange(index, work, onInRange) {
    return work.arrayLength !== undefined ? onInRange(index < work.arrayLength) :
        ArrayView.resolveInRange(work.receiver, index, work, onInRange)
}

function prepareAtIndex([index = 0], work) {
    return runArrayStep(work, () => index < 0
        ? resolveArrayInRange(-index - 1, work, present => present
            ? resolveArrayLength(work, length => length + index) : undefined)
        : index)
}

function prepareWithArguments([index = 0, replacement], work) {
    return runArrayStep(work, () => {
        const finish = valid => valid ? [index, replacement] : errorUtils.validationError(
            "Array index is out of range", work.operationContext, errorUtils.ERROR_KIND.InvalidArrayOperation)
        return resolveArrayInRange(index < 0 ? -index - 1 : index, work, finish)
    })
}

function observeAt(index, invocationWork) {
    const thisValue = invocationWork.receiver
    if (!isArrayIndex(index)) return undefined
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
    return internalSteps.continueGraphTransition(
        value,
        invocationWork.operationContext,
        resolved => {
            if (errorUtils.isPoisonError(resolved)) return resolved

            // Let each position apply its own undefined default.
            return resolved === undefined
                ? undefined
                : conversion.toIntegerOrInfinity(resolved, invocationWork)
        },
        undefined,
        invocationWork,
    )
}

function stringInput(value, invocationWork) {
    return internalSteps.continueGraphTransition(
        value,
        invocationWork.operationContext,
        resolved => {
            if (errorUtils.isPoisonError(resolved)) return resolved

            return resolved === undefined
                ? undefined
                : conversion.toStringValue(resolved, undefined, invocationWork)
        },
        undefined,
        invocationWork,
    )
}

function prepareSliceBounds([start = 0, end], work) {
    return runArrayStep(work, () => {
        // Relative bounds with the same sign preserve their ordering at
        // every length. These empty ranges consume no receiver placements.
        if (start === Infinity || end === -Infinity ||
            end !== undefined && (start < 0) === (end < 0) && start >= end) return [0, 0]
        const exact = () => resolveArrayLength(work, length => {
            const first = toRelativeIndex(start, length, 0)
            return [first, Math.max(first, toRelativeIndex(end, length, length))]
        })
        return start >= 0 ? resolveArrayInRange(start, work, present => {
            if (!present) return [0, 0]
            return end >= 0 && Number.isFinite(end)
                ? resolveArrayInRange(end - 1, work, covered => covered ? [start, end] : exact())
                : exact()
        }) : exact()
    })
}

function slice([start, end], invocationWork) {
    const thisValue = invocationWork.receiver
    return invocationWork.retainOutput(tryDeriveArrayView(start, end, invocationWork) ??
        arrayRemaps.createArrayFromRemap(
            arrayRemaps.createRemap(thisValue, invocationWork.operationContext, start, end),
            invocationWork.operationContext,
        ))
}

function plainResult(value) {
    return value
}

function retainArray(remap, invocationWork) {
    return invocationWork.retainOutput(arrayRemaps.createArrayFromRemap(remap, invocationWork.operationContext))
}

// pop/shift/at hand this element to the caller: reject a registered mutable
// identity leaving its context path, then retain what the caller keeps.
function retainElement(element, invocationWork) {
    const result = propertyVersions.isPropertyPlacement(element)
        ? element.resolveValue()
        : element
    return internalSteps.continueGraphTransition(
        result,
        invocationWork.operationContext,
        value => {
            if (invocationWork.operationContext.execution._externalIdentities.has(value))
                return externalCapabilityEscapeError(invocationWork.operationContext)
            return invocationWork.retainOutput(value)
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

function concatInput(value, invocationWork) {
    return internalSteps.continueGraphTransition(
        value,
        invocationWork.operationContext,
        value => runArrayStep(invocationWork, () => {
            if (errorUtils.isPoisonError(value)) return value
            return isLogicalArray(value, invocationWork.operationContext)
                ? captureRemap(value, invocationWork)
                : [value]
        }),
        undefined,
        invocationWork,
    )
}

function captureRemap(array, work) {
    const operationContext = work.operationContext
    const remap = arrayRemaps.createRemap(array, operationContext)
    for (const key of Object.keys(remap)) remap[key]?.ensureCaptured()
    return ArrayView.resolveLength(array, work, length => { remap.length = length; return remap })
}

function prepareConcatArguments(parts, work) {
    return runArrayStep(work, () => {
        const length = work.arrayLength ?? ArrayView.readyLength(work.receiver, work.operationContext)
        if (length !== undefined) return finish(length)
        // Capture available placements before waiting for structural work.
        // Publication must reuse those versions rather than later backing state.
        return internalSteps.continueGraphTransition(captureRemap(work.receiver, work),
            work.operationContext, remap => finish(remap.length, remap), undefined, work)

        function finish(length, receiverRemap) {
            for (const part of parts) length += part.length
            return length > 0xffffffff ? invalidArrayLength(work) : { parts, receiverRemap }
        }
    })
}

function invalidArrayLength(work) {
    return errorUtils.validationError(
        "Invalid Array length",
        work.operationContext,
        errorUtils.ERROR_KIND.InvalidArrayLength,
    )
}

function createConcatRemap({ parts, receiverRemap }, invocationWork) {
    return internalSteps.continueGraphTransition(
        receiverRemap ?? captureRemap(invocationWork.receiver, invocationWork),
        invocationWork.operationContext,
        remap => Reflect.apply(arrayConcat, remap, parts),
        undefined,
        invocationWork,
    )
}

function prepareFlatRemap([depth = 1], invocationWork) {
    depth = Math.max(depth, 0)
    return internalSteps.continueGraphTransition(
        prepareFlatArray(
            invocationWork.receiver,
            depth,
            undefined,
            invocationWork,
        ),
        invocationWork.operationContext,
        prepared => {
            if (errorUtils.isPoisonError(prepared)) return prepared
            return Reflect.apply(arrayFlat, prepared, [depth])
        },
        undefined,
        invocationWork,
    )
}

function prepareFlatArray(array, depth, ancestry, invocationWork) {
    return runArrayStep(invocationWork, () => internalSteps.continueGraphTransition(
        depth === Infinity && hasArrayAncestor(ancestry, array, invocationWork),
        invocationWork.operationContext, cycle => runArrayStep(invocationWork, () => {
        try {
            if (cycle) return errorUtils.validationError(
                "Cannot flat an Array cycle to unlimited depth",
                invocationWork.operationContext,
                errorUtils.ERROR_KIND.InvalidArrayOperation,
            )
            const source = arrayRemaps.createRemap(array, invocationWork.operationContext, 0, undefined,
                action => runArrayStep(invocationWork, action))
            const nestedAncestry = depth === Infinity
                ? { identity: captureIdentity(array, invocationWork.operationContext), parent: ancestry }
                : undefined
            const parts = []
            for (const key of Object.keys(source))
                parts.push(prepareFlatProperty(source[key], depth, nestedAncestry, invocationWork))
            // Consumed placements carry final presence. Nested remaps come only
            // from present Array values, so no source-key map needs to survive.
            return internalSteps.prepareInputs(parts, invocationWork.operationContext,
                values => values.filter(value => !propertyVersions.isPropertyPlacement(value) || value.present !== false),
                invocationWork)
        } finally { array = undefined }
    }), undefined, invocationWork))
}

function prepareFlatProperty(placement, depth, ancestry, invocationWork) {
    return runArrayStep(invocationWork, () => {
        if (errorUtils.isPoisonError(placement) || depth === 0) {
            try { return errorUtils.isPoisonError(placement) ? placement : placement.resolvePresence() }
            finally { placement = undefined }
        }
        return internalSteps.continueGraphTransition(
            placement.resolveValue(), invocationWork.operationContext,
            value => {
                try {
                    return isLogicalArray(value, invocationWork.operationContext)
                        ? prepareFlatArray(value, depth - 1, ancestry, invocationWork) : placement
                } finally { placement = undefined }
            }, undefined, invocationWork)
    })
}

function identityInput(value, invocationWork) {
    return internalSteps.continueGraphTransition(
        value,
        invocationWork.operationContext,
        value => errorUtils.isPoisonError(value) ? value : captureIdentity(value, invocationWork.operationContext),
        undefined,
        invocationWork,
    )
}

function searchFromIndex(value, work) {
    const hasElements = work.searchHasElements
    work.searchHasElements = undefined
    return runArrayStep(work, () => internalSteps.continueGraphTransition(
        hasElements,
        work.operationContext, present => {
        try {
            if (!present) {
                work.discardArgument(1)
                return undefined
            }
            const result = conversion.toIntegerOrInfinity(value, work)
            work.releaseArgument(1)
            return result
        } finally { value = undefined }
    }, undefined, work))
}

function prepareSearchArguments(args, invocationWork) {
    invocationWork.releaseArgumentLeases()
    const backwards = invocationWork.method === "lastIndexOf"
    const [searchValue, fromIndex = backwards ? Infinity : 0] = args
    const at = start => ({ searchValue, start })
    const capture = () => resolveArrayLength(invocationWork,
        length => at(backwards ? normalizeBackwardStart(fromIndex, length) : normalizeForwardStart(fromIndex, length)))
    return runArrayStep(invocationWork, () => {
        // Absolute forward starts need no length. An absolute backward
        // start needs only proof that the position is in range.
        if (fromIndex >= 0) return backwards
            ? resolveArrayInRange(fromIndex, invocationWork,
                present => present ? at(fromIndex) : capture())
            : at(fromIndex)
        if (!backwards) return fromIndex === -Infinity ? at(0) : capture()
        return resolveArrayInRange(-fromIndex - 1, invocationWork,
            present => present ? capture() : at(-1))
    })
}

function join([separator], invocationWork) {
    return conversion.joinLogicalArray(
        invocationWork.receiver,
        separator,
        undefined,
        invocationWork,
    )
}

function comparatorInput(value, invocationWork) {
    return internalSteps.continueGraphTransition(
        value,
        invocationWork.operationContext,
        value => {
            if (errorUtils.isPoisonError(value)) return value

            if (value === undefined || typeof value === "function") return value
            return errorUtils.validationError(
                "Array sort comparator must be callable or undefined",
                invocationWork.operationContext,
                errorUtils.ERROR_KIND.NotAFunction,
            )
        },
        undefined,
        invocationWork,
    )
}

function fill(args, work, reportWrites) {
    const length = work.arrayLength
    const writes = toRelativeIndex(args[1], length, 0) < toRelativeIndex(args[2], length, length)
    // An empty range cannot receive this payload, even in observation mode.
    if (!writes) work.discardArgument(0)
    if (work.mutation) {
        reportWrites(writes)
        if (!writes) return
    }
    const remap = arrayRemaps.createRemap(work.receiver, work.operationContext, 0, length)
    return Reflect.apply(ARRAY_METHODS.fill.intrinsic, remap, args)
}

function reverse(args, work, reportWrites) {
    return remapSparseMutation(ARRAY_METHODS.reverse.intrinsic, args, work, reportWrites,
        index => index !== work.arrayLength - index - 1)
}

function copyWithin(args, work, reportWrites) {
    const length = work.arrayLength
    const target = toRelativeIndex(args[0], length, 0)
    const start = toRelativeIndex(args[1], length, 0)
    const end = toRelativeIndex(args[2], length, length)
    const count = Math.min(end - start, length - target)
    if (work.mutation && count <= 0) {
        reportWrites(false)
        return
    }
    return remapSparseMutation(ARRAY_METHODS.copyWithin.intrinsic, args, work, reportWrites,
        index => index >= start && index < start + count || index >= target && index < target + count)
}

// Capture presence during the existing remap walk. Holes do not write, and a
// known write makes the remaining presence questions irrelevant to identity.
function remapSparseMutation(intrinsic, args, work, reportWrites, touches) {
    const operationContext = work.operationContext
    let published = false
    const remap = arrayRemaps.createRemap(work.receiver, operationContext, 0, work.arrayLength, undefined,
        work.mutation ? (placement, index) => {
            if (published === true || !touches(index)) return
            const wait = internalSteps.continueGraphTransition(placement.resolvePresence(), operationContext,
                () => placement.present !== false)
            if (languageValues.isPending(wait, operationContext)) {
                if (published === false) published = new IdentityPublication(operationContext)
                published.addPending(wait)
            } else if (wait) {
                if (published !== false) published.finish(true)
                published = true
            }
        } : undefined)
    if (work.mutation) reportWrites(published)
    return Reflect.apply(intrinsic, remap, args)
}

function prepareToSortedRemap(args, invocationWork) {
    return prepareSortedRemap(args, invocationWork, undefined, true)
}

function prepareSortedRemap([comparator], work, reportWrites, denseOutput = false) {
    const { operationContext } = work
    let receiver = work.receiver
    const shape = { length: ArrayView.captureLength(receiver, operationContext, work) }
    const records = [], waits = [], errors = new Set()
    const capture = comparator === undefined ? undefined :
        new ManagedCapture(work, errorUtils.ERROR_KIND.ExportReflectionFailed, collect)
    let first, preparing = false
    work.discardPreparedOutput = discardOutput
    let source
    try {
        source = arrayRemaps.createRemap(receiver, operationContext, 0, undefined,
            action => runArrayStep(work, action))
        for (const key of Object.keys(source)) {
            let placement = source[key]
            const record = { placement }
            records.push(record)
            const ready = errorUtils.isPoisonError(placement) ? placement :
                runArrayStep(work, () => internalSteps.continueGraphTransition(placement.resolveValue(),
                    operationContext, value => { record.value = value; return record }, undefined, work))
            waits.push(internalSteps.continueGraphTransition(ready, operationContext, value => {
                record.present = placement?.present !== false
                placement = undefined
                if (errorUtils.isPoisonError(value)) {
                    record.error = value
                    collect(value)
                } else if (!record.present) return
                else {
                    record.defined = record.value !== undefined
                    // A singleton needs no callback; with another candidate this
                    // poison prevents comparison. Required collection still waits.
                    if (errorUtils.isPoisonError(record.value)) comparator = undefined
                }
                if (errors.size) record.placement = undefined
                if (!record.error && !record.defined) return
                // Native sort needs no comparison for fewer than two defined
                // elements. Once needed, consume each value as it arrives.
                if (preparing) prepare(record)
                else if (first) {
                    preparing = true
                    prepare(first)
                    first = undefined
                    prepare(record)
                } else first = record
            }, undefined, work))
        }
    } finally { receiver = source = undefined }
    // Deliveries can add conversion/capture work. Join that frontier only after
    // every placement has delivered; failed output still collects all Errors.
    const result = internalSteps.collectInputs(waits.slice(), operationContext, () =>
        internalSteps.collectInputs(waits, operationContext, finish, work), work)
    return internalSteps.continueGraphTransition(result, operationContext, value => {
        discardOutput()
        records.length = waits.length = 0
        first = undefined
        errors.clear()
        work.discardPreparedOutput = undefined
        return value
    }, undefined, work)

    function collect(error) {
        errors.add(error)
        work.preparationFailed()
    }

    function discardOutput() {
        comparator = undefined
        shape.length?.release?.()
        capture?.discard()
        for (const record of records) record.placement = record.edge = record.exported = undefined
    }

    function prepare(record) {
        if (record.error) return
        let value = record.value
        record.value = undefined
        try {
            const result = capture
            ? capture.walk(value, edge => { record.edge = edge })
            : internalSteps.continueGraphTransition(conversion.toStringValue(value, undefined, work),
                operationContext, key => {
                    if (errorUtils.isPoisonError(key)) collect(key)
                    else if (!errors.size) record.key = key
                }, undefined, work)
            waits.push(result)
        } finally { value = undefined }
    }

    function finish() {
        if (errors.size) return errorUtils.combineErrors(errors)
        const sortable = [], undefinedPlacements = []
        for (const record of records) if (record.present) {
            if (record.defined) sortable.push(record)
            else undefinedPlacements.push(record.placement)
        }
        if (capture && preparing) {
            capture.roots = sortable.map(record => record.edge)
            return internalSteps.continueGraphTransition(capture.resolve(), operationContext, () => {
                let exported = assembleCapturedGraph(capture)
                for (let index = 0; index < sortable.length; index++) sortable[index].exported = exported[index]
                exported = undefined
                capture.discard()
                return sorted(sortRecords(sortable, (left, right) =>
                    compareExported(comparator, left.exported, right.exported, operationContext)))
            }, undefined, work)
        }
        return sorted(preparing ? sortRecords(sortable, comparePreparedKeys) : sortable)

        function sorted(sorted) {
            if (errorUtils.isPoisonError(sorted)) return sorted
            if (work.mutation) reportWrites(sorted.length + undefinedPlacements.length > 0)
            return internalSteps.continueGraphTransition(shape.length?.read ? shape.length.read() : shape.length,
                operationContext, length => finishSortedRemap(sorted, undefinedPlacements, denseOutput, length), undefined, work)
        }
    }
}

function sortRecords(sortable, compare) {
    // The records and native sort are runtime-owned. Only the comparator's
    // explicit poison outcome aborts sorting recoverably; internal throws are fatal.
    let sorted, comparatorFailure
    const compareRecords = (left, right) => {
        const result = compare(left, right)
        if (!errorUtils.isPoisonError(result)) return result
        comparatorFailure = result
        throw result
    }
    try {
        sorted = Reflect.apply(arraySort, sortable, [compareRecords])
    } catch (reason) {
        if (comparatorFailure === undefined || reason !== comparatorFailure) throw reason
        return reason
    }
    return sorted
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
    let result
    try {
        result = invocation.invokeFunction(
            comparator,
            undefined,
            [left, right],
            operationContext,
            errorUtils.ERROR_KIND.ControlledCallbackFailed,
        )
        if (errorUtils.isPoisonError(result)) return result
        const pending = mayBeThenable(result, operationContext) && errorUtils.catchExternalThrow(
            () => readCallableThen(result, operationContext),
            operationContext,
            errorUtils.ERROR_KIND.ThenAccessFailed,
        )
        if (errorUtils.isPoisonError(pending)) return pending
        if (pending) {
            const observed = internalSteps.continueGraphTransition(
                result,
                operationContext,
                () => undefined,
                () => undefined,
            )
            markPromiseHandled(observed, operationContext)
            return errorUtils.validationError(
                "Promise-returning Array sort comparators are unsupported",
                operationContext,
                errorUtils.ERROR_KIND.InvalidCallbackResult,
            )
        }
        if (typeof result !== "number") {
            return errorUtils.validationError(
                "Array sort comparator must return a Number",
                operationContext,
                errorUtils.ERROR_KIND.InvalidCallbackResult,
            )
        }
        return result
    } finally { comparator = left = right = result = undefined }
}

function includes({ searchValue, start }, invocationWork) {
    let thisValue = invocationWork.receiver
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
                const branch = internalSteps.continueGraphTransition(
                    propertyVersions.resolvePropertyIdentityAtKey(thisValue, String(index), operationContext),
                    operationContext, matches, undefined, invocationWork,
                )
                if (languageValues.isPending(branch, operationContext)) {
                    remaining++
                    const wait = internalSteps.continueGraphTransition(branch, operationContext, finish, undefined, invocationWork)
                    markPromiseHandled(wait, operationContext)
                } else if (branch) return finish(true)
            }
            const wait = ArrayView.resolveInRange(thisValue, index, invocationWork, present => {
                if (present) return scan()
                // All property versions are captured. Their pending values no
                // longer need the receiver, just as with an initially ready shape.
                invocationWork.releaseReceiverLeases()
                thisValue = undefined
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
        thisValue = undefined
        invocationWork.releaseReceiverLeases()
        if (result) {
            invocationWork.close()
            result.resolve(found)
        }
    }

    function matches(value) {
        return compareIdentities(value, searchValue, invocationWork, true)
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
    let thisValue = invocationWork.receiver
    let index = start
    return internalSteps.continueGraphTransition(next(), invocationWork.operationContext,
        result => { thisValue = undefined; return result }, undefined, invocationWork)

    function next() {
        return runArrayStep(invocationWork, () => {
            const length = backwards ? undefined : ArrayView.readyLength(thisValue, invocationWork.operationContext)
            const end = backwards ? -1 : length ?? ArrayView.minimumLength(thisValue, invocationWork.operationContext)
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
                const comparison = internalSteps.continueGraphTransition(placement.resolveValue(captureIdentity),
                    invocationWork.operationContext, identity => placement.present !== false &&
                        compareIdentities(identity, searchValue, invocationWork), undefined, invocationWork)
                if (languageValues.isPending(comparison, invocationWork.operationContext)) {
                    // The final capture needs only its comparison. Unknown
                    // forward growth still requires the receiver for later work.
                    if (backwards ? index === -1 : index === length) {
                        invocationWork.releaseReceiverLeases()
                        thisValue = undefined
                    }
                    return internalSteps.continueGraphTransition(
                        comparison,
                        invocationWork.operationContext,
                        equal => equal ? current : thisValue === undefined ? -1 : next(),
                        undefined,
                        invocationWork,
                    )
                }
                if (comparison) return current
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
    const length = invocationWork.arrayLength
    return tryDeriveArrayView(
        Math.min(1, length),
        length,
        invocationWork,
    )
}

function tryPopArrayView(_args, invocationWork) {
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
    if (!ArrayView.tryShareStorage(thisValue, operationContext)) return undefined

    const view = new ArrayView(thisValue, operationContext, start, end)
    return PlacementConstruction.initializeAndPublish(view, operationContext, view => {
        propertyVersions.copyArrayOverlays(
            thisValue,
            view,
            operationContext,
            start,
            end,
            -start,
        )
    })
}

function tryConcatArrayView({ parts, receiverRemap }, invocationWork) {
    if (receiverRemap !== undefined) return undefined
    // Common preparation checked the complete output length before either
    // private intrinsic call or backing extension can run.
    const suffix = Reflect.apply(arrayConcat, [], parts)
    return tryAppendArrayView(suffix, invocationWork)
}

function tryAppendArrayView(suffix, invocationWork) {
    const { receiver: thisValue, operationContext } = invocationWork
    return ArrayView.tryExtendEnd(
        thisValue,
        suffix.length,
        operationContext,
        view => {
            const start = ArrayView.readyLength(view, operationContext) - suffix.length
            arrayRemaps.placeRemap(view, suffix, operationContext, start)
        },
    )
}

export { ARRAY_METHODS, RETURN_RECEIVER, PASS_AS_PAYLOAD, runArrayStep, searchFromIndex,
    resolveArrayLength, resolveArrayInRange }
