import { MAX_ARRAY_LENGTH, MAX_COUNT, anyPresent, capacityCause, capacityError, captureLayout, denseLayout, inheritSpliceSlots, join,
    layoutFromRemap, materializeIndividualSlots, projectCapacity, reportCapacityLoss, restrict, span } from "./array-layout.js"
import { combineOperands, retainOperands, SelectedOperands, selectionReceipt } from "./array-sequence-layout.js"
import { afterFailedWidth, capacitySequence, captureSequence, concatSequence, denseSequence, displacedRange, fixed, holesWithExtent, inRange,
    obstructedSequence, pendingSequence, publishLayout, publishSequence, valueSignal,
    hasUnmarkedRange, selectedExtent, selectedSequence, sequenceExtent, takeSequence, trimmedSequence } from "./array-sequence.js"
import { projectedCount, sumExtent } from "./array-width.js"
import { appendView, arrayInput, createRangeOutput, createRemap, createArrayFromRemap, copyPhysicalArray, sliceOutput } from "./array-remap.js"
import { copyFixedRanges } from "./array-layout-methods.js"
import { ArrayView } from "./array-view.js"
import { broadRange, normalizeIndex } from "./array-interval.js"
import { CHAIN_MODE } from "./chain.js"
import { combineErrors, isPoisonError } from "./error.js"
import { collectInputs, continueGraphTransition, decideInputs } from "./internal-step.js"
import { isPending } from "./language-values.js"
import { isNumericPrimitive, toIntegerOrInfinity } from "./language-conversion.js"
import { PendingFailure, retainPlacement } from "./property-versions.js"
import { OperationOwner, releaseOnClose } from "./operation-lifecycle.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import { checkArrayCapacity, numericInput, resolveArrayLength, runArrayStep } from "./array-methods.js"

function replacesPrefixRange(start, count, width, work) {
    const ctx = work.operationContext, length = ArrayView.prefixLength(work.receiver, ctx)
    return work.method === "splice" && length > 0 && typeof start === "number" && start >= 0 &&
        count === width && start + count <= length && !broadRange(count, work.receiver, length, ctx)
}

// Kept length is nondecreasing in source length for a fixed signed start
// and count. A failed control can only succeed where it removes no slots.
function cannotFitInsertion(length, start, count, width) {
    const at = typeof start === "number" ? normalizeIndex(start, length) : 0
    const cut = isPoisonError(start) || isPoisonError(count) ? 0 :
        Math.min(length - at, typeof count === "number" ? Math.max(0, count) : length)
    return width > MAX_ARRAY_LENGTH - (length - cut)
}

function prepareSpliceArguments(work) {
    let args = work.args
    const ctx = work.operationContext
    const immediateCount = args.length >= 2 && isNumericPrimitive(args[1])
        ? toIntegerOrInfinity(args[1], work) : undefined
    const countKnownZero = !args.length || immediateCount <= 0
    if (!work.receiverCapture && ArrayView.hasPendingLength(work.receiver, ctx)) {
        const controls = new OperationOwner(ctx), maximum = ArrayView.maximumLength(work.receiver, ctx)
        const argc = args.length, width = Math.max(0, argc - 2), inserted = []
        const read = i => numericInput(work.takeArgument(i, args), controls, 0)
        const start = !width && countKnownZero ? 0 : read(0)
        const count = countKnownZero || typeof start === "number" && start >= maximum ? 0 :
            argc === 1 ? Infinity : immediateCount ?? read(1)
        const complete = work.mode === CHAIN_MODE.Complete
        const waitsForBoth = complete && width && isPending(count, ctx) && (isPending(start, ctx) || isPoisonError(start))
        const nonempty = waitsForBoth ? ArrayView.captureInRange(work.receiver, 0, ctx, controls) : undefined
        const inputs = [start, count, nonempty]
        const select = ([at, cut, present]) => {
            if (present === false) at = cut = 0
            const command = { start: at, count: cut, inserted, controls }
            if (complete && maximum > MAX_ARRAY_LENGTH && replacesPrefixRange(at, cut, width, work))
                return checkArrayCapacity(MAX_ARRAY_LENGTH, work, () => command)
            if (!complete || !width) return command
            const minimum = ArrayView.minimumLength(work.receiver, ctx)
            const failed = minimum > 0 && (isPoisonError(at) ||
                isPoisonError(cut) && typeof at === "number" && at < minimum)
            if (failed || cannotFitInsertion(minimum, at, cut, width)) {
                work.discardArgumentsFrom(2)
                inserted.length = 0
                // A known relevant failure has the same causes at every
                // possible length. Only a conditional control needs live bounds.
                const shape = failed || typeof at === "number" && typeof cut === "number" ? fixed(span(minimum)) :
                    captureSequence(work.receiver, ctx, { limit: 0, keepExtent: true })
                const selected = spliceSides(shape, at, cut, width, false, ctx)
                const failure = controlFailure(continueGraphTransition(selected, ctx, cutOf), controls, ctx)
                if (!isPending(failure, ctx)) return failure ?? capacityError(ctx)
                work.preparationFailed()
                return new PendingFailure(continueGraphTransition(failure, ctx, error => error ?? capacityError(ctx)), ctx)
            }
            // A failed start on a nonempty Array rules out all data while
            // the count can still add a cause. Empty input ignores both controls.
            if (waitsForBoth && isPending(cut, ctx) && isPending(at, ctx)) return
            return command
        }
        const selected = select(inputs)
        if (!isPoisonError(selected) && !(selected instanceof PendingFailure))
            for (let i = 2; i < argc; i++) inserted.push(work.prepareArgument(i, args))
        args = undefined
        return selected ?? decideInputs(inputs, ctx, select, work)
    }
    const prepared = resolveArrayLength(work, length => {
        work.arrayLength = length
        const argc = args.length, width = Math.max(0, argc - 2), inserted = []
        // The producer can outlive an observation returning its partial Array.
        const controls = new OperationOwner(ctx)
        const normalized = (index, normalize) => continueGraphTransition(
            numericInput(work.prepareArgument(index, args), controls, 0), ctx,
            value => isPoisonError(value) ? value : normalize(value), undefined, controls)
        const start = length === 0 || !width && countKnownZero ? 0 : normalized(0, value => normalizeIndex(value, length))
        const clampCount = value => Math.max(0, Math.min(length, value))
        const count = length === 0 || start === length || countKnownZero ? 0 : argc < 2 ? length :
            immediateCount === undefined ? normalized(1, clampCount) : clampCount(immediateCount)
        const streaming = work.mode !== CHAIN_MODE.Complete
        const select = ([start, count]) => {
            if (start === length) count = 0
            if (count === 0 && !width) start = 0
            if (!streaming) {
                const waiting = isPending(start, ctx) || isPending(count, ctx)
                const failedStart = isPoisonError(start) && (width || typeof count === "number" && count > 0)
                const cannotFit = !work.receiverCapture && cannotFitInsertion(length, start, count, width)
                const failure = waiting ? undefined : spliceControlFailure(start, count, width, length)
                if (failedStart || cannotFit || failure) {
                    inserted.length = 0
                    work.discardArgumentsFrom(2)
                    if (!waiting) return failure ?? capacityError(ctx)
                    work.preparationFailed()
                }
                if (waiting && !failedStart && !cannotFit) return
                // Every valid selection overflows, or a required control already
                // failed. An invalid selection contributes only its required Errors.
                if (waiting) return new PendingFailure(decideInputs([start, count], ctx, ([at, cut]) => {
                    if (at === length) cut = 0
                    if (cut === 0 && !width) at = 0
                    if (isPending(at, ctx) || isPending(cut, ctx)) return
                    controls.close()
                    return spliceControlFailure(at, cut, width, length) ?? capacityError(ctx)
                }), ctx)
            }
            return { start, count, inserted, width, length, controls }
        }
        const inputs = [start, count]
        const selected = select(inputs)
        if (!isPoisonError(selected) && !(selected instanceof PendingFailure))
            for (let index = 2; index < argc; index++) inserted[index - 2] = work.prepareArgument(index, args)
        args = undefined
        return continueGraphTransition(selected ?? decideInputs(inputs, ctx, select, controls), ctx, result => {
            if (isPoisonError(result)) controls.close()
            return result
        })
    })
    if (args) work.prepareArgumentFrontier(args.length, args)
    return prepared
}

function spliceControlFailure(start, count, width, length) {
    const failedStart = isPoisonError(start) && (width || count !== 0) ? start : undefined
    const failedCount = isPoisonError(count) && start !== length ? count : undefined
    return failedStart && failedCount ? combineErrors([failedStart, failedCount]) : failedStart ?? failedCount
}

const cutOf = choice => choice.cutResult
const keptAfter = cut => cut.after
const prefixOf = choice => choice.prefix
const prefixExtent = (choice, ctx) => sequenceExtent(choice.prefix, ctx)
const suffixExtent = (choice, ctx) => sequenceExtent(choice.after, ctx)
const failureOf = cut => cut.failure

function controlFailure(cut, controls, ctx) {
    const failure = continueGraphTransition(cut, ctx, failureOf)
    markPromiseHandled(continueGraphTransition(failure, ctx, () => controls.close()), ctx)
    return failure
}

const KEEP_ALL_SLOTS = 1

function survivingExtent(source, selected, count, ctx) {
    if (typeof count === "number" && count <= 0) return { extent: sequenceExtent(source, ctx) }
    const minimum = typeof count === "number" ? Math.max(0, source.minimum - count) : 0
    const decision = isPending(count, ctx) ? decideInputs([selected, count], ctx, ([s, c]) =>
        typeof c === "number" && c <= 0 ? KEEP_ALL_SLOTS : isPending(s, ctx) ? undefined : s) : selected
    const extent = selectedExtent(decision, choice => choice === KEEP_ALL_SLOTS ? sequenceExtent(source, ctx) :
        sumExtent(sequenceExtent(choice.prefix, ctx), sequenceExtent(choice.after, ctx), ctx), source, ctx, minimum)
    return { decision, extent }
}

// A pending delete count only selects from the suffix. The established
// prefix belongs to the output, and can retire before the removed result.
function captureSpliceSource(receiver, start, count, dense, options, ctx) {
    const sequence = captureSequence(receiver, ctx, options)
    if (sequence.node?.length && typeof start === "number" && start > 0 && isPending(count, ctx)) {
        const length = Math.min(start, sequence.node.length)
        const prefix = restrict(sequence.node, 0, length)
        const array = materializeIndividualSlots(dense ? denseLayout(prefix, ctx) : prefix, ctx)
        if (array) return {
            source: fixed(join(span(length), restrict(sequence.node, length, sequence.node.length))),
            borrowed: { source: array, range: ArrayView.borrowPrefix(array, length, ctx) },
        }
    }
    return { source: sequence }
}

function publishRemoved(sequence, work, cause, ctx) {
    if (work.mode === CHAIN_MODE.Complete && sequence.maximum > MAX_ARRAY_LENGTH)
        return continueGraphTransition(inRange(sequence, MAX_ARRAY_LENGTH, ctx), ctx, over =>
            over ? cause() : work.retainOutput(publishSequence(sequence, ctx)))
    return work.retainOutput(publishSequence(sequence, ctx))
}

function emptyRemoved(work, cause, ctx) {
    return () => publishRemoved(fixed(span(0)), work, cause, ctx)
}

function beforeStart(source, at, ctx) {
    return at < 0 ? trimmedSequence(source, 0, -at, ctx) : takeSequence(source, at, false, ctx)
}

function fromStart(source, at, ctx) {
    return at < 0 ? takeSequence(source, -at, true, ctx) : trimmedSequence(source, at, 0, ctx)
}

function oldPrefix(source, choice, ctx) {
    if (!isPoisonError(choice.start)) return beforeStart(source, choice.start, ctx)
    return selectedSequence(source.operands, sequenceExtent(choice.prefix, ctx), valueSignal(choice.cutResult, ctx), cut =>
        cut.obstructed ? cut.prefix : afterFailedWidth(source, choice.insertFailure && cut.failure, ctx), ctx, choice.blocksOld)
}

function oldSuffix(source, choice, ctx) {
    if (isPoisonError(choice.start)) return fixed(span(0))
    const rest = fromStart(source, choice.start, ctx)
    return selectedSequence(rest.operands, sequenceExtent(choice.after, ctx), valueSignal(choice.cutResult, ctx), cut =>
        isPoisonError(cut.count) ? cut.after : trimmedSequence(rest, cut.count, 0, ctx), ctx)
}

// Only mutating splice owes removed data. A known start drops the prefix
// immediately and a zero or failed count drops every remaining candidate.
function captureRemoved(candidate, start, count, cut, work, cause, ctx) {
    if (typeof count === "number" && count <= 0) return emptyRemoved(work, cause, ctx)
    let started = false, width, release = retainOperands(candidate.operands, ctx)
    function narrow(next) {
        if (next === candidate) return
        const previous = release
        candidate = next
        release = retainOperands(candidate.operands, ctx)
        previous?.()
    }
    markPromiseHandled(continueGraphTransition(start, ctx, at => {
        started = true
        const rest = isPoisonError(at) ? fixed(span(0)) : fromStart(candidate, at, ctx)
        narrow(width === undefined ? rest : takeSequence(rest, width, false, ctx))
    }, undefined, work), ctx)
    markPromiseHandled(continueGraphTransition(count, ctx, value => {
        width = isPoisonError(value) ? 0 : Math.max(0, value)
        if (!width || started) narrow(takeSequence(candidate, width, false, ctx))
    }, undefined, work), ctx)
    releaseOnClose(work, () => { release?.(); candidate = undefined })
    return () => continueGraphTransition(cut, ctx, () => publishRemoved(candidate, work, cause, ctx))
}

function streamingSpliceResult(failure, capacity, removed, ctx) {
    return () => collectInputs([failure, capacity], ctx, ([error, loss]) =>
        error && loss ? combineErrors([error, loss]) : error ?? loss ?? removed())
}

function spliceCapacity(source, selected, cut, count, width, cause, ctx) {
    const boundary = MAX_ARRAY_LENGTH - width
    // If the insertion fits, only original slots from [MAX-width+d, MAX)
    // can move into the virtual tail after deleting d. A count extending
    // beyond the end leaves no old suffix to displace.
    const lost = [continueGraphTransition(selected, ctx, s => inRange(s.prefix, boundary, ctx))]
    if (!isPoisonError(count) && !(typeof count === "number" && count >= width)) {
        const fringe = displacedRange(source, width, ctx)
        lost.push(continueGraphTransition(cut, ctx, c => typeof c.count === "number" && c.count < width &&
            hasUnmarkedRange(trimmedSequence(fringe, c.count, 0, ctx), ctx)))
    }
    if (width > MAX_COUNT - source.maximum) {
        const at = continueGraphTransition(selected, ctx, choice => choice.start)
        const amount = continueGraphTransition(cut, ctx, choice => choice.count)
        lost.push(collectInputs([source.length, at, amount], ctx, ([n, start, count]) => {
            const deleted = typeof count === "number" ? Math.min(count, n - normalizeIndex(start, n)) : 0
            return width > MAX_COUNT - (n - deleted)
        }))
    }
    return reportCapacityLoss(anyPresent(lost, ctx), cause, ctx)
}

function spliceArray({ start, count, inserted, width, length, controls }, work, finish) {
    const ctx = work.operationContext, complete = work.mode === CHAIN_MODE.Complete
    for (let i = 0; i < inserted.length; i++) inserted[i] = arrayInput(inserted[i], ctx)
    const dense = work.method === "toSpliced"
    const prefix = ArrayView.prefixLength(work.receiver, ctx)
    if (length === undefined && replacesPrefixRange(start, count, inserted.length, work)) {
        controls.close()
        return replaceRange(start, count)
    }
    if (length === undefined || !complete &&
        (isPending(start, ctx) || isPending(count, ctx) || isPoisonError(start) || isPoisonError(count)))
        return spliceSequence(start, count, inserted, controls, work, finish)
    return runArrayStep(work, () => {
        const failure = spliceControlFailure(start, count, width, length)
        controls.close()
        if (failure) return failure
        const at = isPoisonError(start) ? length : start
        const cut = isPoisonError(count) ? 0 : Math.min(count, length - at)
        const kept = length - cut
        if (complete && width > MAX_ARRAY_LENGTH - kept) {
            inserted.length = 0
            return capacityError(ctx)
        }
        if (!dense && length <= MAX_ARRAY_LENGTH) {
            const region = ArrayView.region(work.receiver, ctx)
            const slice = (first, end) => sliceOutput(work.receiver, first, end, ctx)
            if (!width && (!at || at + cut === length) && (prefix || !region?.pending) && ArrayView.tryShareStorage(work.receiver, ctx))
                return finish(at ? slice(0, at) : slice(cut, length), () => work.retainOutput(cut && cut <= kept ?
                    createArrayFromRemap(createRemap(work.receiver, ctx, at, at + cut), ctx) : slice(at, at + cut)))
            if (prefix || !region) {
                if (width && width === cut && ArrayView.tryShareStorage(work.receiver, ctx)) return replaceRange(at, cut)
                if (at === length && width <= MAX_ARRAY_LENGTH - length) {
                    const extended = appendView(work.receiver, [inserted], length, width, ctx)
                    if (extended) return finish(extended, () => work.retainOutput(slice(at, at)))
                }
            }
        }
        if (dense || !cut && width && at < length) {
            const shared = copyFixedRanges(work, length, at, cut, inserted)
            if (shared) return finish(shared, work.mutation && (() => work.retainOutput(createArrayFromRemap([], ctx))))
        }
        const copy = copyPhysicalArray(work, length, finish, at, cut, inserted)
        if (copy !== undefined) return copy
        // Mutation also needs the removed result. An observation consumes
        // only the retained ranges, so discarded descriptors cannot fail it.
        const source = work.mutation || !cut ? captureLayout(work.receiver, ctx, length) : undefined
        const read = (first, end) => source ? restrict(source, first, end) : captureLayout(work.receiver, ctx, length, first, end)
        const mapped = join(join(read(0, at), layoutFromRemap(inserted)), read(at + cut, length))
        const projected = projectCapacity(dense ? denseLayout(mapped, ctx) : mapped, ctx, width > MAX_COUNT - kept)
        return finish(publishLayout(projected.node, ctx), () => complete && cut > MAX_ARRAY_LENGTH ?
            capacityError(ctx) : work.retainOutput(publishLayout(read(at, at + cut), ctx)), projected.failure)
    })

    function replaceRange(at, cut) {
        const removed = work.mutation && work.retainOutput(createArrayFromRemap(createRemap(work.receiver, ctx, at, at + cut), ctx))
        return finish(createRangeOutput(at, inserted, work), () => removed)
    }
}

// Split a symbolic length from its anchored end. The insertion and both
// retained sides have separate membership; the removed result owns its cut.
function spliceSequence(start, count, values, controls, work, finish) {
    const ctx = work.operationContext
    let omitStart, omitEnd
    if (!work.mutation && typeof start === "number" && typeof count === "number" && count > 0) {
        const minimum = ArrayView.minimumLength(work.receiver, ctx)
        omitStart = normalizeIndex(start, ArrayView.maximumLength(work.receiver, ctx))
        const earliest = normalizeIndex(start, minimum)
        omitEnd = earliest + Math.min(count, minimum - earliest)
    }
    const dense = work.method === "toSpliced"
    const complete = work.mode === CHAIN_MODE.Complete, sequential = work.mode === CHAIN_MODE.Sequential
    // A failed start with a required cut or insertion succeeds only on empty
    // input. A failed count succeeds only when the start reaches the end.
    let limit
    if (complete && isPoisonError(start) && (values.length || typeof count === "number" && count > 0 || isPoisonError(count))) limit = 0
    else if (complete && isPoisonError(count) && typeof start === "number") limit = Math.max(0, start)
    const { source, borrowed } = captureSpliceSource(work.receiver, start, count, dense,
        { omitStart, omitEnd, limit, keepExtent: limit !== undefined }, ctx)
    const added = fixed(layoutFromRemap(values))
    const width = values.length
    const pendingControls = isPending(start, ctx) || isPending(count, ctx)
    const coordinates = pendingControls ? holesWithExtent(source, ctx) : source
    values.length = 0
    values = undefined
    // A zero-width, zero-deletion splice still prescribes its length write.
    if (!width && typeof count === "number" && count <= 0) start = 0
    else if (!width && isPending(start, ctx) && isPending(count, ctx))
        start = decideInputs([start, count], ctx, ([at, n]) =>
            typeof n === "number" && n <= 0 ? 0 : isPending(at, ctx) ? undefined : at)
    if (!source.minimum && isPending(start, ctx))
        start = decideInputs([start, inRange(source, 0, ctx)], ctx, ([at, nonempty]) =>
            nonempty === false ? 0 : isPending(at, ctx) ? undefined : at)
    const selected = spliceSides(coordinates, start, count, width, sequential, ctx)
    const movable = width && !complete && !sequential && isPending(start, ctx) && width <= MAX_COUNT - source.maximum
    const order = pendingControls ? spliceOrder(source, added, selected, coordinates, count, movable, ctx) :
        joinSplice(selected.prefix, added, selected.after, selected.insertFailure, ctx)
    if (typeof start === "number" && start >= 0 && typeof count === "number" && count >= 0 &&
        start + count <= source.head.length && order.head.length === source.head.length - count + width)
        inheritSpliceSlots(order.head, source.head, added.node, ctx)
    const output = dense ? denseSequence(order, ctx) : order
    const cut = continueGraphTransition(selected, ctx, cutOf)
    const failure = controlFailure(cut, controls, ctx)
    const cause = capacityCause(ctx)
    const removed = work.mutation && captureRemoved(source, start, count, cut, work, cause, ctx)
    if (complete) {
        // Until whole-Array validation succeeds there is no public destination
        // for these operands. The removed result has its own restricted use.
        const release = retainOperands(output.operands, ctx)
        const releasePrefix = borrowed && retainPlacement({ present: true, value: borrowed.source }, ctx)
        if (!work.mutation) work.releaseReceiverLeases()
        return decideInputs([failure, inRange(output, MAX_ARRAY_LENGTH, ctx)], ctx, ([error, over]) => {
            if (isPoisonError(error) || over === true) {
                release?.()
                releasePrefix?.()
                if (isPending(error, ctx))
                    return new PendingFailure(continueGraphTransition(error, ctx, reason => reason ?? cause()), ctx).outcome(work)
                return error ?? cause()
            }
            if (isPending(error, ctx) || isPending(over, ctx)) return
            try { return finish(publishSequence(output, ctx, undefined, borrowed), removed) }
            finally { release?.(); releasePrefix?.() }
        })
    }
    const view = publishSequence(capacitySequence(output, ctx, cause), ctx, undefined, borrowed)
    if (!work.mutation) return finish(view)
    const capacity = width && output.maximum > MAX_ARRAY_LENGTH ?
        spliceCapacity(source, selected, cut, count, width, cause, ctx) : undefined
    return finish(view, streamingSpliceResult(failure, capacity, removed, ctx))
}

// Control settlement selects old occurrences and the possible failure of the
// insertion. Only a consumer of the output needs the inserted values.
function spliceSides(source, start, count, width, sequential, ctx) {
    return continueGraphTransition(start, ctx, s => {
        s ??= 0
        if (!isPoisonError(s)) {
            const left = beforeStart(source, s, ctx), rest = fromStart(source, s, ctx)
            const cutResult = selectCut(rest, countForSuffix(rest, count, ctx), ctx)
            return { start: s, prefix: left, after: pendingSequence(cutResult, keptAfter, ctx, 0, rest.maximum), cutResult }
        }
        const cutResult = continueGraphTransition(countForSuffix(source, count, ctx), ctx, c => {
            c ??= 0
            const failedCount = isPoisonError(c)
            const cause = failedCount ? combineErrors([s, c]) : s
            const failure = width || failedCount || c > 0 ? continueGraphTransition(inRange(source, 0, ctx), ctx,
                present => present ? cause : undefined) : undefined
            const prefix = failedCount || c > 0 ? obstructedSequence(source, cause, ctx) :
                sequential ? afterFailedWidth(source, failure, ctx) : source
            return { prefix, failure, obstructed: failedCount || c > 0 }
        })
        const prefix = selectedSequence(source.operands, sequenceExtent(source, ctx), valueSignal(cutResult, ctx), prefixOf, ctx)
        return { start: s, prefix, after: fixed(span(0)), cutResult, blocksOld: sequential && width > 0,
            insertFailure: sequential && continueGraphTransition(cutResult, ctx, failureOf) }
    })
}

function joinSplice(prefix, added, after, failure, ctx, blocked = false) {
    return concatSequence(concatSequence(prefix, afterFailedWidth(added, failure, ctx, blocked), ctx), after, ctx)
}

// Both readers share the cut. An Unordered reader of only old occurrences
// retains these operands. The positional result transfers its own inputs.
class SpliceRanges extends SelectedOperands {
    constructor(source, ctx) {
        super(source.operands)
        this.source = source
        this.ctx = ctx
    }
    read = (choice, added) => {
        if (this.source) {
            if (choice === KEEP_ALL_SLOTS) return this.source
            this.prefix = oldPrefix(this.source, choice, this.ctx)
            this.after = oldSuffix(this.source, choice, this.ctx)
            this.source = undefined
            this.pointInputs = undefined
            this.select(combineOperands(this.prefix.operands, this.after.operands), this.ctx)
        }
        return added ? joinSplice(this.prefix, added, this.after, choice.insertFailure, this.ctx, choice.blocksOld && this.prefix.minimum > 0) :
            concatSequence(this.prefix, this.after, this.ctx)
    }

    capturePoint = (index, back) => {
        const source = this.source, inputs = this.pointInputs
        if (!inputs || index >= source.maximum + inputs.added.length) return
        const { added, start, count } = inputs
        const { old, additions } = splicePointInputs(source, added, count.pending ?? count.value, index, back, this.ctx)
        if (!count.pending && old === source && additions.node === added) return
        return retainSplicePoint(old, additions, start, count, index, back, this.ctx)
    }
}

// A requested position can have an old prefix value, an insertion, or an
// old suffix value. Preserve their original coordinates for the common cut.
function splicePointInputs(source, inserted, count, index, back, ctx) {
    const size = source.maximum, width = inserted.length
    const insertFirst = Math.min(width, Math.max(0, index - size)), insertEnd = Math.min(width, index + 1)
    // Rank from either end keeps the adjacent old candidate. Across the
    // insertion, a rear rank can move by any clipped deletion count. A
    // front rank has no surviving suffix if a numeric count gets clipped.
    const delta = index - width
    const pending = isPending(count, ctx)
    const failed = isPoisonError(count), maximumDeleted = pending ? size : failed ? 0 : Math.max(0, count ?? 0)
    const first = delta < 0 || failed && !back ? size : Math.min(size, delta + (back || pending ? 0 : maximumDeleted))
    const end = first === size ? size : Math.min(size, delta + maximumDeleted + 1)
    const point = Math.min(index, size), pointEnd = Math.min(index + 1, size)
    const ranges = [[point, pointEnd], [first, end]].filter(([lo, hi]) => lo < hi).sort((a, b) => a[0] - b[0])
    if (ranges.length === 2 && ranges[0][1] >= ranges[1][0])
        ranges[0][1] = Math.max(ranges[0][1], ranges.pop()[1])
    const lo = back ? width - insertEnd : insertFirst, hi = back ? width - insertFirst : insertEnd
    const additions = fixed(!lo && hi === width ? inserted : join(join(span(lo), restrict(inserted, lo, hi)), span(width - hi)))
    if (!size || ranges[0]?.[0] === 0 && ranges[0][1] === size) return { old: source, additions }
    // Gaps retain their original, possibly open, width without any placements.
    const shape = holesWithExtent(source, ctx)
    const append = (a, b) => back ? concatSequence(b, a, ctx) : concatSequence(a, b, ctx)
    const skip = (part, n) => trimmedSequence(part, back ? 0 : n, back ? n : 0, ctx)
    const portion = (part, lo, hi) => skip(takeSequence(part, hi, back, ctx), lo)
    let old = fixed(span(0)), next = 0
    for (const [lo, hi] of ranges) {
        if (lo > next) old = append(old, portion(shape, next, lo))
        old = append(old, portion(source, lo, hi))
        next = hi
    }
    old = append(old, skip(shape, next))
    return { old, additions }
}

function retainSplicePoint(old, additions, start, count, index, back, ctx) {
    // This callback can outlive the backing. Its operands are the point's
    // actual candidate placements and the common shape-only cut decision.
    let releaseOld = retainOperands(old.operands, ctx)
    const releaseAdded = retainOperands(additions.operands, ctx)
    const unwatch = count.pending && (count.watch ??= selectionReceipt(count.pending, ctx))(() => {
        const narrowed = splicePointInputs(old, additions.node, count.value, index, back, ctx).old
        const previous = releaseOld
        old = narrowed
        releaseOld = retainOperands(old.operands, ctx)
        previous?.()
    })
    const release = () => { unwatch?.(); old = additions = undefined; releaseOld?.(); releaseAdded?.() }
    const placement = continueGraphTransition(start.pending, ctx, () => {
        unwatch?.()
        if (!old) return { present: false, value: undefined }
        const ranges = new SpliceRanges(old, ctx), inserted = additions
        old = additions = undefined
        return ranges.read(start.value, inserted).point(index, back)
    })
    return { placement, release }
}

// The start chooses both sides at once. A count can still narrow the suffix
// after the prefix and insertion have become available.
function spliceOrder(source, added, selected, coordinates, count, movable, ctx) {
    const ranges = new SpliceRanges(source, ctx)
    if (!isPending(selected, ctx)) return ranges.read(selected, added)
    const start = valueSignal(selected, ctx)
    const { decision, extent } = survivingExtent(coordinates, selected, count, ctx)
    const size = projectedCount(extent, added.node.length, ctx)
    const order = selectedSequence(combineOperands(source.operands, added.operands), size, start, choice => ranges.read(choice, added), ctx)
    ranges.pointInputs = { added: added.node, start, count: valueSignal(count, ctx) }
    order.capturePoint = ranges.capturePoint
    if (movable) {
        const survival = decision && (decision === selected ? start : valueSignal(decision, ctx))
        const old = survival ? selectedSequence(ranges, extent, survival, ranges.read, ctx) : source
        order.origins = { source: old, added: added.node,
            cut: selectedExtent(selected, prefixExtent, coordinates, ctx),
            backCut: selectedExtent(selected, suffixExtent, coordinates, ctx), context: ctx }
    }
    return order
}

// A count is unused at the end, including an end proved after issuance.
function countForSuffix(rest, count, ctx) {
    if (!rest.maximum) return 0
    if (rest.minimum || !isPending(count, ctx)) return count
    return decideInputs([count, inRange(rest, 0, ctx)], ctx, ([n, present]) =>
        present === false ? 0 : isPending(n, ctx) ? undefined : n)
}

function selectCut(rest, count, ctx) {
    return continueGraphTransition(count, ctx, value => {
        if (isPoisonError(value)) return { count: value, after: obstructedSequence(rest, value, ctx),
            failure: continueGraphTransition(inRange(rest, 0, ctx), ctx, present => present ? value : undefined) }
        const n = Math.max(0, value ?? 0)
        return { count: n, after: trimmedSequence(rest, n, 0, ctx) }
    })
}

export { prepareSpliceArguments, spliceArray }
