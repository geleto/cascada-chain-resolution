import { ArrayView, isLogicalArray, isArrayIndex } from "./array-view.js"
import * as internalSteps from "./internal-step.js"
import { markPromiseHandled, mayBeThenable, readCallableThen } from "./thenable-subscription.js"
import * as arrayRemaps from "./array-remap.js"
import * as conversion from "./language-conversion.js"
import * as errorUtils from "./error.js"
import { ManagedCapture, assembleCapturedGraph } from "./managed-capture.js"
import * as invocation from "./invocation.js"
import * as languageValues from "./language-values.js"
import { prepareSearch, search } from "./array-search.js"
import { concatSequence, joinContributions, capacitySequence, captureOrder, captureSequence, fixed, inRange, publishLayout, publishSequence, retainLayout } from "./array-sequence.js"
import { createLeaseLedger } from "./ownership.js"
import { CHAIN_MODE } from "./chain.js"
import { applyEndpoint, applyLayoutMethod, copyDense, copyFixedRanges, partialEndpoint } from "./array-layout-methods.js"
import { broadRange, IntervalSelection, prepareInterval } from "./array-interval.js"
import * as propertyVersions from "./property-versions.js"
import { readLanguagePlacement } from "./language-properties.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import { flatStream } from "./array-flat-stream.js"
import { prepareSpliceArguments, spliceArray } from "./array-splice.js"
import { LayoutBuilder, anyPresent, capacityError, captureLayout, denseLayout, join as joinLayout, layoutFromRemap, MAX_ARRAY_LENGTH, MAX_COUNT, mapLayout, projectCapacity, restrict, structuralPlacement,
    span, placementCounts } from "./array-layout.js"

const RETURN_RECEIVER = 1
const RETURN_VALUE = 2
const PASS_AS_PAYLOAD = Symbol()
const arraySort = Array.prototype.sort

// Preparation consumes only required controls. Each evaluator owns its
// mapping and hands mutations to the common publication boundary.
const ARRAY_METHODS = {
    __proto__: null,
    at: { argumentIndex: 0, inputs: [numericInput], prepare: prepareAtIndex, apply: observeAt },
    concat: { prepareArguments: prepareConcatArguments, leaseInputsThroughResult: true, apply: concatenate },
    copyWithin: { prepareArguments: prepareInterval, apply: intervalMethod, methodResult: RETURN_RECEIVER },
    fill: { prepareArguments: prepareInterval, apply: intervalMethod, methodResult: RETURN_RECEIVER },
    flat: { prepareArguments: retainControlArgument, leaseInputsThroughResult: true, apply: flatStream },
    includes: { prepareArguments: prepareSearch, leaseInputsThroughResult: true, apply: search },
    indexOf: { prepareArguments: prepareSearch, leaseInputsThroughResult: true, apply: search },
    join: { argumentIndex: 1, inputs: [stringInput], apply: join },
    lastIndexOf: { prepareArguments: prepareSearch, leaseInputsThroughResult: true, apply: search },
    pop: { prepare: prepareEndpoint, apply: endpointMethod, methodResult: RETURN_VALUE },
    push: { restInput: PASS_AS_PAYLOAD, prepare: prepareEndpoint, apply: endpointMethod, methodResult: RETURN_VALUE },
    reverse: { prepare: prepareEndpoint, apply: endpointMethod, methodResult: RETURN_RECEIVER },
    shift: { prepare: prepareEndpoint, apply: endpointMethod, methodResult: RETURN_VALUE },
    slice: { prepareArguments: prepareInterval, apply: intervalMethod },
    sort: {
        leaseInputsThroughResult: true,
        prepareArguments: retainControlArgument,
        apply: sortArray,
        methodResult: RETURN_RECEIVER,
    },
    splice: {
        prepareArguments: prepareSpliceArguments,
        apply: spliceArray,
        methodResult: RETURN_VALUE,
    },
    toReversed: { apply: copyDense, leaseInputsThroughResult: true },
    toSorted: {
        leaseInputsThroughResult: true,
        prepareArguments: retainControlArgument,
        apply: sortArray,
    },
    toSpliced: {
        prepareArguments: prepareSpliceArguments,
        apply: spliceArray,
        leaseInputsThroughResult: true,
    },
    // No prepared arguments makes join use its default separator.
    toString: { apply: join },
    unshift: { restInput: PASS_AS_PAYLOAD, prepare: prepareEndpoint, apply: endpointMethod, methodResult: RETURN_VALUE },
    with: {
        argumentIndex: 0,
        inputs: [numericInput, PASS_AS_PAYLOAD],
        prepare: prepareWithArguments,
        apply: copyDense,
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

// The first unrepresentable index decides capacity even when exact length
// remains open. Resumed host inspection retains the operation's Error scope.
function checkArrayCapacity(limit, work, onFit) {
    return resolveArrayInRange(limit, work, over => over ? capacityError(work.operationContext) : runArrayStep(work, onFit))
}

function prepareEndpoint(args, work) {
    return runArrayStep(work, () => {
        const grows = work.method === "push" || work.method === "unshift"
        if (!partialEndpoint(work)) return resolveArrayLength(work, length => {
            work.arrayLength = length
            if (grows && work.mode === CHAIN_MODE.Complete && args.length > MAX_ARRAY_LENGTH - length) {
                args = undefined
                return capacityError(work.operationContext)
            }
            return args
        })
        if (work.mode !== CHAIN_MODE.Complete || work.missingOutput) return args
        const limit = grows ? MAX_ARRAY_LENGTH - args.length : work.method === "reverse" ? MAX_ARRAY_LENGTH : MAX_ARRAY_LENGTH + 1
        return checkArrayCapacity(limit, work, () => args)
    })
}

function prepareAtIndex([index = 0], work) {
    if (index < 0) {
        const ctx = work.operationContext
        const sequence = captureOrder(work.receiver, ctx)
        const prefixLength = ArrayView.prefixLength(work.receiver, ctx)
        if (sequence && (!prefixLength || -index <= sequence.minimum - prefixLength))
            return { placement: sequence.point(-1 - index, true) }
    }
    return runArrayStep(work, () => index < 0
        ? resolveArrayInRange(-index - 1, work, present => present
            ? resolveArrayLength(work, length => length + index) : undefined)
        : index)
}

function prepareWithArguments([index = 0, replacement], work) {
    return runArrayStep(work, () => {
        const finish = valid => {
            try {
                return valid ? [index, replacement] : errorUtils.validationError(
                    "Array index is out of range", work.operationContext, errorUtils.ERROR_KIND.InvalidArrayOperation)
            } finally { replacement = undefined }
        }
        return resolveArrayInRange(index < 0 ? -index - 1 : index, work, finish)
    })
}

function observeAt(index, invocationWork) {
    if (index && typeof index === "object")
        return internalSteps.continueGraphTransition(index.placement, invocationWork.operationContext, p =>
            retainElement(p, invocationWork), undefined, invocationWork)
    const thisValue = invocationWork.receiver
    if (!isArrayIndex(index) && !ArrayView.mayHaveVirtualIndex(thisValue, index, invocationWork.operationContext)) return undefined
    return retainElement(readLanguagePlacement(thisValue, index, invocationWork.operationContext), invocationWork)
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

function intervalMethod(args, work, finish, reportWrites) {
    if (args instanceof IntervalSelection) return args.publish(work, finish, reportWrites)
    const ctx = work.operationContext, region = ArrayView.region(work.receiver, ctx)
    // Local writes preserve the old range on exclusive backing. A broad
    // replacement can be published as one span, including on sparse storage.
    const length = work.arrayLength ?? ArrayView.minimumLength(work.receiver, ctx)
    const width = work.method === "copyWithin" ? Math.min(args[2] - args[1], length - args[0]) : args[2] - args[1]
    const prefix = ArrayView.prefixLength(work.receiver, ctx)
    if (work.method === "slice" && args[1] <= prefix)
        return finish(arrayRemaps.sliceOutput(work.receiver, args[0], args[1], ctx))
    if ((region?.layout || region?.placements) && (!prefix || length > MAX_ARRAY_LENGTH) ||
        work.method !== "slice" && broadRange(width, work.receiver, length, ctx))
        return applyLayoutMethod(args, work, finish, reportWrites)
    if (work.method === "slice") return finish(arrayRemaps.sliceOutput(work.receiver, args[0], args[1], ctx))
    return finish(work.method === "fill" ? fill(args, work, reportWrites) : copyWithin(args, work, reportWrites))
}

function endpointMethod(args, work, finish, reportWrites) {
    const { method, operationContext: ctx, arrayLength: length } = work
    if (!work.missingOutput) for (let i = 0; i < args.length; i++) args[i] = arrayRemaps.arrayInput(args[i], ctx)
    if (partialEndpoint(work)) return applyEndpoint(args, work, finish, reportWrites)
    if (method === "reverse")
        return arrayRemaps.copyPhysicalArray(work, length, finish) ?? applyLayoutMethod(args, work, finish, reportWrites)
    const region = ArrayView.region(work.receiver, ctx)
    const removes = method === "shift" || method === "pop"
    if (region?.fixedCoordinates || method === "unshift" && args.length) {
        const cut = removes && length ? 1 : 0
        const at = method === "push" || method === "pop" ? length - cut : 0
        const shared = copyFixedRanges(work, length, at, cut, args)
        if (shared) return finish(shared, () => removes ? retainElement(cut ? readLanguagePlacement(work.receiver, at, ctx) :
            undefined, work) : length + args.length)
    }
    if (method === "unshift" && args.length) {
        const newLength = length + args.length
        const copy = arrayRemaps.copyPhysicalArray(work, length, output => finish(output, () => newLength), 0, 0, args)
        if (copy !== undefined) return copy
    }
    if (work.mode === CHAIN_MODE.Complete && removes && length - 1 > MAX_ARRAY_LENGTH) return capacityError(ctx)
    if (!region || removes && !region.pending && length <= MAX_ARRAY_LENGTH && ArrayView.prefixLength(work.receiver, ctx)) {
        if (removes) {
            const first = method === "shift", index = first ? 0 : length - 1
            const output = arrayRemaps.sliceOutput(work.receiver, first ? Math.min(1, length) : 0, first ? length : Math.max(0, length - 1), ctx)
            return finish(output, () => retainElement(length ? readLanguagePlacement(work.receiver, index, ctx) :
                undefined, work))
        }
        if ((method === "push" || method === "unshift" && !args.length) && args.length <= MAX_ARRAY_LENGTH - length) {
            const view = arrayRemaps.appendView(work.receiver, [args], length, args.length, ctx)
            if (view) return finish(view, () => length + args.length)
        }
    }
    return applyEndpoint(args, work, finish, reportWrites)
}

// pop/shift/at hand this element to the caller: reject a registered mutable
// identity leaving its context path, then retain what the caller keeps.
function retainElement(placement, invocationWork) {
    const result = placement && propertyVersions.resolveVisiblePlacement(placement, invocationWork.operationContext,
        propertyVersions.placementValue)
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

// Every Array step consumes exact external escapes before its continuation returns
// to the fatal envelope. The same rule applies to ready and resumed work.
function runArrayStep(invocationWork, work) {
    return errorUtils.catchExternalThrow(
        work,
        invocationWork.operationContext,
        invocationWork.mutation ? errorUtils.ERROR_KIND.PropertyMutationFailed : errorUtils.ERROR_KIND.InvocationFailed,
    )
}

// An ordinary fixed part is a sparse placement remap. Open or compact parts
// keep their sequence. Capture either at delivery, before a later write.
function concatInput(value, work, leases) {
    const ctx = work.operationContext
    return internalSteps.continueGraphTransition(value, ctx, value => runArrayStep(work, () => {
        try {
            if (errorUtils.isPoisonError(value)) return value
            leases?.acquire(value)
            if (!isLogicalArray(value, ctx)) return [{ value, present: true }]
            if (ArrayView.region(value, ctx) || ArrayView.hasPendingLength(value, ctx)) return captureSequence(value, ctx)
            return arrayRemaps.createRemap(value, ctx)
        } finally { value = undefined }
    }), undefined, leases ? undefined : work)
}

function prepareConcatArguments(work) {
    const ctx = work.operationContext
    if (work.mode !== CHAIN_MODE.Complete) {
        if (work.receiverCapture) work.prepareArgumentFrontier()
        return work.args
    }
    let args = work.args
    work.prepareArgumentFrontier()
    work.discardPreparedOutput = () => work.releaseArgumentLeases()
    const inputs = []
    for (let i = 0; i < args.length; i++) inputs.push(concatInput(args[i], work))
    args = undefined
    return internalSteps.prepareInputs(inputs, ctx, parts => runArrayStep(work, () => {
        let remaining = MAX_ARRAY_LENGTH
        // An open argument can narrow independently of the receiver. Their
        // combined sequence below owns that capacity question.
        for (const part of parts) {
            if (typeof part.length !== "number") return parts
            remaining -= part.length
            if (remaining < 0) break
        }
        const over = remaining < 0 || resolveArrayInRange(remaining, work, value => value)
        return internalSteps.continueGraphTransition(over, ctx, over => {
            try {
                return over ? capacityError(ctx) : parts
            } finally { parts = undefined }
        }, undefined, work)
    }), work)
}

function concatenate(args, work) {
    const ctx = work.operationContext, streaming = work.mode !== CHAIN_MODE.Complete
    const leases = streaming ? createLeaseLedger(ctx) : undefined
    let parts, prefix
    try {
        const length = work.arrayLength ?? ArrayView.readyLength(work.receiver, ctx)
        if (streaming) {
            let minimum = length ?? ArrayView.minimumLength(work.receiver, ctx)
            parts = []
            for (let i = 0; i < args.length && minimum < MAX_COUNT; i++) {
                const part = concatInput(work.takeArgument(i, args), work, leases)
                parts.push(part)
                minimum += Math.min(MAX_COUNT - minimum, Array.isArray(part) ? part.length :
                    errorUtils.isPoisonError(part) ? 1 : part.minimum ?? 0)
            }
        } else parts = args
        args = undefined

        // An exact sparse suffix can extend ordinary storage without reading
        // the receiver prefix. All modes use the same publication.
        let remaining = MAX_ARRAY_LENGTH - length
        if (length !== undefined && !ArrayView.region(work.receiver, ctx) &&
            parts.every(part => Array.isArray(part) && (remaining -= part.length) >= 0)) {
            const extended = arrayRemaps.appendView(work.receiver, parts, length, MAX_ARRAY_LENGTH - length - remaining, ctx)
            if (extended) { leases?.release(); return work.retainOutput(extended) }
        }
        const sequential = work.mode === CHAIN_MODE.Sequential
        const suffix = joinContributions(parts, asSequence, sequential, ctx)
        prefix = ArrayView.borrowPrefix(work.receiver, length, ctx)
        if (!prefix) leases?.acquire(work.receiver)
        const receiver = prefix && prefix.length === length ? fixed(span(length)) :
            captureSequence(work.receiver, ctx, { omitEnd: prefix?.length })
        const sequence = concatSequence(receiver, suffix, ctx, streaming)
        const borrowed = prefix && { source: work.receiver, range: prefix }
        const publish = sequence => work.retainOutput(publishSequence(sequence, ctx, leases?.release, borrowed))
        return streaming ? publish(capacitySequence(sequence, ctx)) : internalSteps.continueGraphTransition(
            inRange(sequence, MAX_ARRAY_LENGTH, ctx), ctx, over => over ? capacityError(ctx) :
                runArrayStep(work, () => publish(sequence)), undefined, work)
    } catch (failure) { leases?.release(); throw failure }
    finally { args = parts = prefix = undefined }

    function asSequence(part) {
        if (errorUtils.isPoisonError(part)) return fixed(span(1, structuralPlacement(part)))
        if (!Array.isArray(part)) return part
        return fixed(layoutFromRemap(part))
    }
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
    const [, start, end] = args
    const writes = start < end
    if (work.mutation) {
        reportWrites(writes)
        if (!writes) return
    }
    let entries = new Array(end - start).fill(args[0])
    args = undefined
    try { return runArrayStep(work, () => arrayRemaps.createRangeOutput(start, entries, work)) }
    finally { entries = undefined }
}

function copyWithin(args, work, reportWrites) {
    const length = work.arrayLength ?? ArrayView.minimumLength(work.receiver, work.operationContext)
    const [target, start, end] = args
    const count = Math.min(end - start, length - target)
    if (work.mutation && count === 0) {
        reportWrites(false)
        return
    }
    const ctx = work.operationContext
    let entries = arrayRemaps.createRemap(work.receiver, ctx, start, start + count)
    try {
        if (work.mutation) {
            const waits = []
            const present = p => {
                if (!p) return false
                const found = propertyVersions.resolvePlacementPresence(p, ctx, propertyVersions.placementPresent)
                if (languageValues.isPending(found, ctx)) waits.push(found)
                return found === true
            }
            let written = Object.values(entries).some(present)
            for (let i = target; !written && i < target + count; i++)
                written = present(readLanguagePlacement(work.receiver, i, ctx))
            reportWrites(written || anyPresent(waits, ctx))
        }
        return runArrayStep(work, () => arrayRemaps.createRangeOutput(target, entries, work))
    } finally { entries = undefined }
}

function retainControlArgument(work) {
    // A native snapshot can suspend before the controlled receiver is ready.
    if (work.receiverCapture) work.prepareArgumentFrontier(1)
    return work.args
}

function sortArray(args, work, finish, reportWrites) {
    if (!work.mutation) return captureSort(args, work, finish, reportWrites)
    const ctx = work.operationContext
    let certain = false, publishFailure
    const completed = captureSort(args, work, finish, reportWrites, () => {
        certain = true
        publishFailure?.()
        publishFailure = undefined
    })
    if (!languageValues.isPending(completed, ctx)) return completed
    // The owner can be repaired once failure is certain, while the operation's
    // original result still collects its exact cause.
    const failed = () => new propertyVersions.PendingFailure(completed, ctx).outcome(true)
    if (certain) return failed()
    const publication = Promise.withResolvers()
    publishFailure = () => publication.resolve(failed())
    markPromiseHandled(internalSteps.continueOperation(completed, ctx, result => {
        publishFailure = undefined
        publication.resolve(result)
    }), ctx)
    return publication.promise
}

function captureSort(args, work, finish, reportWrites, noteFailure) {
    const ctx = work.operationContext
    const region = ArrayView.region(work.receiver, ctx)
    if (region?.pending && !region.placements) {
        const sequence = captureSequence(work.receiver, ctx, { inspect: action => runArrayStep(work, action) })
        const head = !sequence.node && sortableFacts(placementCounts(sequence.head), ctx)
        if (head && (head.failures.length || head.defined >= 2 && (head.poisoned || head.symbol && args[0] === undefined)))
            noteFailure?.()
        if (args.length && head && head.defined >= 2) {
            const selected = requiredComparator(args, work, head.failures)
            return internalSteps.continueGraphTransition(selected, ctx, value => errorUtils.isPoisonError(value) ? value :
                internalSteps.continueGraphTransition(sequence.ready, ctx, node =>
                    sortLayout(node, [value], work, node.length, finish, reportWrites, noteFailure), undefined, work), undefined, work)
        }
        return internalSteps.continueGraphTransition(sequence.ready, ctx, node =>
            sortLayout(node, args, work, node.length, finish, reportWrites, noteFailure), undefined, work)
    }
    // An open entry can change length after all surviving placements have
    // been captured. Only a successful permutation consumes the final length.
    const length = ArrayView.captureLength(work.receiver, ctx, work)
    const maximum = ArrayView.maximumLength(work.receiver, ctx)
    const node = captureLayout(work.receiver, ctx, maximum, 0, maximum, action => runArrayStep(work, action))
    return sortLayout(node, args, work, length, finish, reportWrites, noteFailure)
}

function knownSortPoison(p) {
    return p.transition ? p.transition.structuralError === propertyVersions.MARKER_SELECTION :
        p.present !== false && (p.ownFailure || p.role === propertyVersions.STRUCTURAL_ERROR)
}

function sortableFacts(leaves, ctx) {
    let defined = 0, undefs = 0, unknown = false, poisoned = false, symbol = false, single
    const failures = []
    for (const [p, count] of leaves) {
        if (errorUtils.isPoisonError(p)) { failures.push(p); continue }
        if (!p || p.present === false && !p.transition) continue
        const value = propertyVersions.placementValue(p)
        if (knownSortPoison(p)) {
            defined += count
            single = p
            poisoned = true
        } else if (p.transition || languageValues.isPending(value, ctx)) unknown = true
        else if (value === undefined) undefs += count
        else {
            defined += count
            single = p
            poisoned ||= errorUtils.isPoisonError(value)
            symbol ||= typeof value === "symbol"
        }
    }
    return { defined, undefs, unknown, poisoned, symbol, single, failures }
}

function sortLayout(node, args, work, length, finish, reportWrites, noteFailure) {
    const ctx = work.operationContext, leaves = placementCounts(node)
    if (!work.mutation) {
        const release = retainLayout([node], ctx)
        work.releaseReceiverLeases()
        work.releaseCapturedReceiver = release
    }
    const { defined, undefs, unknown, single, failures, poisoned } = sortableFacts(leaves, ctx)
    const shape = { length, undefs, noteFailure }
    if (failures.length || defined >= 2 && poisoned) noteFailure?.()
    for (const p of leaves.keys()) if (p?.transition || p?.present === false && p.ownFailure) {
        shape.holes = node
        break
    }
    if (!failures.length && !unknown && defined < 2) {
        work.discardArgument(0)
        if (work.mutation) reportWrites(Boolean(defined + undefs))
        return internalSteps.continueGraphTransition(length.read ? length.read() : length, ctx,
            n => publishSorted(span(defined, single), undefs, n, shape.holes, work, finish), undefined, work)
    }
    // Keep repeated inputs compact through preparation. Only a successful
    // comparison can require invoking a callback once per logical comparison.
    const candidates = new Map()
    for (const [p, count] of leaves) {
        if (p && !errorUtils.isPoisonError(p) && (p.transition || p.present !== false && propertyVersions.placementValue(p) !== undefined))
            candidates.set(p, { input: p, count })
    }
    const empty = span(0)
    shape.order = mapLayout(node, part => {
        if (part.left) return
        const record = candidates.get(part.placement)
        return record ? span(part.length, record) : empty
    })
    const records = [...candidates.values()]
    for (const error of failures) records.push({ input: error, count: 1 })
    return orderEntries(args, records, shape, work, reportWrites, finish)
}

function publishSorted(ordered, undefs, length, sourceHoles, work, finish) {
    if (work.mutation && !ordered.length && !undefs) return finish()
    const ctx = work.operationContext
    if (work.mode === CHAIN_MODE.Complete && length > MAX_ARRAY_LENGTH) return capacityError(ctx)
    const present = { value: undefined, present: true }, count = length - ordered.length - undefs
    let holes = span(count)
    if (sourceHoles && count) {
        // Every candidate's presence has been selected before publishing the
        // permutation. Preserve the source order and status of the absent slots.
        const tail = mapLayout(sourceHoles, part => {
            if (part.left) return
            if (!part.placement) return part
            return propertyVersions.resolvePlacementTransition(part.placement, ctx,
                p => p.present === false ? span(part.length, p) : span(0))
        })
        holes = restrict(tail, 0, count)
    }
    if (work.method === "toSorted") holes = denseLayout(holes, ctx)
    const output = joinLayout(joinLayout(ordered, span(undefs, present)), holes)
    const projected = projectCapacity(output, ctx)
    return finish(publishLayout(projected.node, ctx), undefined, projected.failure)
}

function orderEntries(args, source, shape, work, reportWrites, finish) {
    const ctx = work.operationContext
    if (!source.length || source.length === 1 && source[0].count === 1) {
        work.discardArgument(0)
        args = undefined
        const selected = source[0]?.input
        source = undefined
        if (errorUtils.isPoisonError(selected)) return selected
        const presence = selected && propertyVersions.resolvePlacementTransition(selected, ctx, p => p)
        return internalSteps.continueGraphTransition(presence, ctx, placement => {
            if (errorUtils.isPoisonError(placement)) return placement
            const present = placement && placement.present !== false
            if (work.mutation) reportWrites(Boolean(present || shape.undefs))
            return internalSteps.continueGraphTransition(shape.length?.read ? shape.length.read() : shape.length, ctx,
                length => publishSorted(span(present ? 1 : 0, placement), shape.undefs, length, shape.holes, work, finish), undefined, work)
        }, undefined, work)
    }
    const selection = selectSortComparator(args, source, work, shape.noteFailure)
    args = undefined
    return internalSteps.continueGraphTransition(selection, ctx, comparator => {
        try {
            return errorUtils.isPoisonError(comparator) ? comparator :
                sortCapturedEntries(source, shape, comparator, work, reportWrites, finish)
        } finally { source = comparator = undefined }
    }, undefined, work)
}

// Comparator validation does not consume payloads, but source inspection
// may already have failed independently in a fixed or open layout.
function requiredComparator(args, work, failures) {
    const ctx = work.operationContext
    const result = comparatorInput(work.prepareArgument(0, args), work)
    work.releaseArgument(0)
    return internalSteps.continueGraphTransition(result, ctx, value =>
        errorUtils.isPoisonError(value) && failures.length ? errorUtils.combineErrors([...failures, value], ctx) : value,
        undefined, work)
}

function selectSortComparator(args, source, work, noteFailure) {
    const ctx = work.operationContext
    if (!args.length || args[0] === undefined || typeof args[0] === "function")
        return work.prepareArgument(0, args)
    let defined = 0, possible = 0, poisoned = false
    const pending = [], errors = []
    for (const record of source) {
        const { input, count } = record
        if (errorUtils.isPoisonError(input)) errors.push(input)
        else if (knownSortPoison(input)) { defined += count; poisoned = true }
        else if (input.transition || languageValues.isPending(propertyVersions.placementValue(input), ctx)) {
            pending.push(record)
            possible += count
        } else if (input.present !== false && propertyVersions.placementValue(input) !== undefined) {
            defined += count
            poisoned ||= errorUtils.isPoisonError(propertyVersions.placementValue(input))
        }
    }
    source = undefined
    if (defined >= 2) {
        const comparator = select(true)
        if (poisoned) noteFailure?.()
        else if (noteFailure && languageValues.isPending(comparator, ctx)) {
            // These roots can prove scope failure before comparator selection.
            // Once selected, its own preparation consumes the required inputs.
            markPromiseHandled(internalSteps.continueOperation(comparator, ctx, () => { noteFailure = undefined }), ctx)
            for (const { input, count } of pending)
                markPromiseHandled(propertyVersions.resolvePlacementTransition(input, ctx, p => {
                    if (work.open && noteFailure && p.present !== false)
                        return propertyVersions.resolveVisiblePlacement(p, ctx, ready => received(ready, count))
                }), ctx)
        }
        return comparator
    }
    if (defined + possible < 2) return select(false)
    work.prepareArgument(0, args)
    const receipts = pending.map(({ input, count }) =>
        propertyVersions.resolvePresentPlacement(input, ctx, p => received(p, count)))
    const required = internalSteps.decideInputs(receipts, ctx, (_inputs, answer) => answer, work)
    return internalSteps.continueGraphTransition(required, ctx, select, undefined, work)

    function received(p, count) {
        if (!work.open) return
        possible -= count
        const value = propertyVersions.placementValue(p)
        if (p.present !== false && value !== undefined) {
            defined += count
            poisoned ||= errorUtils.isPoisonError(value)
        }
        if (defined >= 2) {
            if (poisoned) noteFailure?.()
            return true
        }
        if (defined + possible < 2) return false
    }

    function select(required) {
        try {
            if (!required) { work.discardArgument(0); return undefined }
            return requiredComparator(args, work, errors)
        } finally {
            args[0] = undefined
            args = undefined
        }
    }
}

function sortCapturedEntries(records, shape, comparator, work, reportWrites, publish) {
    const { operationContext } = work
    const waits = [], errors = new Set()
    const capture = comparator === undefined ? undefined :
        new ManagedCapture(work, errorUtils.ERROR_KIND.ExportReflectionFailed, collect)
    let first, preparing = false
    work.discardPreparedOutput = discardOutput
    for (const record of records) {
        const placement = record.input
        record.input = undefined
        const ready = errorUtils.isPoisonError(placement) ? placement :
            runArrayStep(work, () => propertyVersions.resolvePresentPlacement(placement, operationContext, p => {
                if (!errors.size) record.placement = p
                record.present = p.present !== false
                record.value = propertyVersions.placementValue(p)
                return record
            }))
        waits.push(internalSteps.continueGraphTransition(ready, operationContext, value => {
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
            else if (first || record.count > 1) {
                preparing = true
                if (first) prepare(first)
                first = undefined
                prepare(record)
            } else first = record
        }, undefined, work))
    }
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
        const firstFailure = !errors.size
        errors.add(error)
        if (firstFailure) {
            work.preparationFailed()
            shape.noteFailure?.()
        }
    }

    function discardOutput() {
        comparator = undefined
        shape.order = shape.holes = undefined
        shape.length?.release?.()
        capture?.discard()
        for (const record of records) record.placement = record.edge = record.exported = record.key = undefined
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
        const sortable = []
        let undefinedCount = shape.undefs
        for (const record of records) if (record.present) {
            if (record.defined) sortable.push(record)
            else undefinedCount += record.count
        }
        if (capture && preparing) {
            capture.roots = sortable.map(record => record.edge)
            return internalSteps.continueGraphTransition(capture.resolve(), operationContext, () => {
                let exported = assembleCapturedGraph(capture)
                for (let index = 0; index < sortable.length; index++) sortable[index].exported = exported[index]
                exported = undefined
                capture.discard()
                return sortUsing((left, right) => compareExported(comparator, left.exported, right.exported, operationContext))
            }, undefined, work)
        }
        if (sortable.length < 2) {
            const only = sortable[0]
            return publishOrder(span(only?.count ?? 0, only?.placement))
        }
        return sortUsing(comparePreparedKeys)

        function sortUsing(compare) {
            const empty = span(0)
            const inputs = mapLayout(shape.order, part => part.left ? undefined :
                part.placement?.defined ? part : empty)
            const entries = []
            function append(part) {
                if (part.left) { append(part.left); append(part.right) }
                else for (let i = 0; i < part.length; i++) entries.push(part.placement)
            }
            append(inputs)
            const sorted = sortRecords(entries, compare)
            if (errorUtils.isPoisonError(sorted)) return sorted
            const ordered = new LayoutBuilder()
            for (const record of sorted) ordered.append(span(1, record.placement))
            return publishOrder(ordered.finish())
        }

        function publishOrder(ordered) {
            if (work.mutation) reportWrites(ordered.length + undefinedCount > 0)
            return internalSteps.continueGraphTransition(shape.length?.read ? shape.length.read() : shape.length,
                operationContext, length => publishSorted(ordered, undefinedCount, length, shape.holes, work, publish), undefined, work)
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

export { ARRAY_METHODS, RETURN_RECEIVER, PASS_AS_PAYLOAD, numericInput, runArrayStep, retainElement,
    resolveArrayLength, resolveArrayInRange, checkArrayCapacity }
