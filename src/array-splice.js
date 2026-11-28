import { MAX_ARRAY_LENGTH, MAX_COUNT, anyPresent, capacityCause, capacityError, denseLayout, inheritSpliceSlots, join,
    layoutFromRemap, materializeIndividualSlots, reportCapacityLoss, restrict, span, structuralPlacement } from "./array-layout.js"
import { combineOperands, retainOperands, SelectedOperands, selectionReceipt } from "./array-sequence-layout.js"
import { hole, afterFailedWidth, capacitySequence, captureSequence, concatSequence, denseSequence, displacedRange, edgeWindow, fixed, inRange,
    obstructedSequence, publishSequence, valueSignal, layoutPoint,
    hasUnmarkedRange, selectedExtent, selectedSequence, sequenceExtent, takeSequence, dropSequence, undecidedCut } from "./array-sequence.js"
import { fixedWidth, LinkedWidth, projectedCount, sumExtent, widthInRange } from "./array-width.js"
import { arrayInput } from "./array-remap.js"
import { fixedEdit, replaceRange } from "./array-layout-methods.js"
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
import { checkArrayCapacity, numericInput, runArrayStep } from "./array-methods.js"

function replacesPrefixRange(start, count, width, work) {
    const ctx = work.operationContext, length = ArrayView.prefixLength(work.receiver, ctx)
    return work.method === "splice" && length > 0 && typeof start === "number" && start >= 0 &&
        count === width && start + count <= length && !broadRange(count, work.receiver, length, ctx)
}

// Kept length is nondecreasing in source length for a fixed signed start
// and count. A failed control can only succeed where it removes no slots.
function cannotFitInsertion(length, start, count, width, maximum) {
    const at = typeof start === "number" ? normalizeIndex(start, length) : 0
    const cut = isPoisonError(start) || isPoisonError(count) ? 0 :
        Math.min(length - at, typeof count === "number" ? Math.max(0, count) : length)
    return width > maximum - (length - cut)
}

function prepareSpliceArguments(work) {
    let args = work.args
    const ctx = work.operationContext, controls = new OperationOwner(ctx)
    const length = work.arrayLength ?? ArrayView.readyLength(work.receiver, ctx)
    work.arrayLength = length
    const maximum = length ?? ArrayView.maximumLength(work.receiver, ctx)
    const width = Math.max(0, args.length - 2), inserted = []
    const immediate = args.length >= 2 && isNumericPrimitive(args[1]) ? toIntegerOrInfinity(args[1], work) : undefined
    const zero = !args.length || immediate <= 0
    const read = index => numericInput(work.takeArgument(index, args), controls, 0)
    const start = !maximum || !width && zero ? 0 : continueGraphTransition(read(0), ctx,
        at => length === undefined ? at : normalizeIndex(at, length), undefined, controls)
    const count = zero || !maximum || typeof start === "number" && start >= maximum ? 0 :
        args.length === 1 ? Infinity : immediate ?? read(1)
    const complete = work.mode === CHAIN_MODE.Complete
    const needsStart = complete && width && isPending(count, ctx) && isPending(start, ctx)
    const nonempty = length === undefined && needsStart ? ArrayView.captureInRange(work.receiver, 0, ctx, controls) : undefined
    const inputs = [start, count, nonempty]
    const select = ([at, cut, present]) => {
        if (present === false) at = cut = 0
        if (typeof at === "number" && at >= maximum) cut = 0
        if (typeof cut === "number") cut = Math.max(0, cut)
        if (!width && cut === 0) at = 0
        const command = { start: at, count: cut, width, inserted, length, controls }
        if (!complete) return command
        if (length === undefined && maximum > MAX_ARRAY_LENGTH && replacesPrefixRange(at, cut, width, work))
            return checkArrayCapacity(MAX_ARRAY_LENGTH, work, () => command)
        const minimum = length ?? ArrayView.minimumLength(work.receiver, ctx)
        const failed = minimum > 0 && (isPoisonError(at) && (width || typeof cut === "number" && cut > 0 || isPoisonError(cut)) ||
            isPoisonError(cut) && typeof at === "number" && normalizeIndex(at, minimum) < minimum)
        if (failed || !work.receiverCapture && cannotFitInsertion(minimum, at, cut, width, MAX_ARRAY_LENGTH)) {
            work.discardArgumentsFrom(2)
            inserted.length = 0
            const size = failed || length !== undefined || typeof at === "number" && typeof cut === "number" ?
                fixedWidth(minimum) : ArrayView.captureExtent(work.receiver, ctx, MAX_COUNT)
            const selected = spliceCut(size, at, cut, width, false, ctx)
            const failure = controlFailure(continueGraphTransition(selected, ctx, cutOf), controls, ctx)
            if (!isPending(failure, ctx)) return failure ?? capacityError(ctx)
            work.preparationFailed()
            return new PendingFailure(continueGraphTransition(failure, ctx, error => error ?? capacityError(ctx)), ctx)
        }
        if (length !== undefined ? isPending(at, ctx) || isPending(cut, ctx) :
            needsStart && isPending(at, ctx) && isPending(cut, ctx)) return
        return command
    }
    const selected = select(inputs)
    if (!isPoisonError(selected) && !(selected instanceof PendingFailure))
        for (let i = 2; i < args.length; i++) inserted.push(work.prepareArgument(i, args))
    args = undefined
    return selected ?? decideInputs(inputs, ctx, select, work)
}

const cutOf = choice => choice.cutResult
const prefixExtent = choice => choice.prefix
const suffixExtent = choice => choice.after
const failureOf = cut => cut.failure

function controlFailure(cut, controls, ctx) {
    const failure = continueGraphTransition(cut, ctx, failureOf)
    markPromiseHandled(continueGraphTransition(failure, ctx, () => controls.close()), ctx)
    return failure
}

const KEEP_ALL_SLOTS = 1

function survivingExtent(source, selected, count, ctx) {
    if (typeof count === "number" && count <= 0) return { extent: source }
    const minimum = typeof count === "number" ? Math.max(0, source.minimum - count) : 0
    const decision = isPending(count, ctx) ? decideInputs([selected, count], ctx, ([s, c]) =>
        typeof c === "number" && c <= 0 ? KEEP_ALL_SLOTS : isPending(s, ctx) ? undefined : s) : selected
    const extent = selectedExtent(decision, choice => choice === KEEP_ALL_SLOTS ? source :
        sumExtent(choice.prefix, choice.after, ctx), source, ctx, minimum)
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
        return continueGraphTransition(inRange(sequence, MAX_ARRAY_LENGTH), ctx, over =>
            over ? cause() : work.retainOutput(publishSequence(sequence, ctx)))
    return work.retainOutput(publishSequence(sequence, ctx))
}

function emptyRemoved(work, cause, ctx) {
    return () => publishRemoved(fixed(span(0)), work, cause, ctx)
}

function beforeStart(source, at, ctx) {
    return at < 0 ? dropSequence(source, -at, true, ctx) : takeSequence(source, at, false, ctx)
}

function fromStart(source, at, ctx) {
    return at < 0 ? takeSequence(source, -at, true, ctx) : dropSequence(source, at, false, ctx)
}

function failedPrefix(source, choice, ctx) {
    return selectedSequence(source.operands, sequenceExtent(source), choice.deletion, cut =>
        cut.obstruction ? obstructedSequence(sequenceExtent(source), cut.obstruction, ctx) :
            afterFailedWidth(source, choice.insertFailure && cut.failure, ctx), ctx, choice.blocksOld)
}

function selectedSuffix(rest, choice, history, ctx) {
    const decision = choice.deletion, extent = choice.after
    let after
    after = selectedSequence(rest.operands, extent, decision, cut => {
        if (after) after.capturePoint = undefined
        return isPoisonError(cut.count) ? obstructedSequence(extent, cut.count, ctx) : dropSequence(rest, cut.count, false, ctx)
    }, ctx)
    if (decision.pending) {
        after.decisions = history
        // For a contiguous suffix, its exclusive source end stays fixed. A
        // front position names no single old occurrence until the width is
        // exact. A failed cut can establish a structural marker earlier.
        const anchored = rest.node || rest.trailing
        if (anchored) after.trailing = suffixFailures(rest.trailing, decision, ctx)
        after.capturePoint = (index, back) => {
            const ownsHead = rest.head.stored || rest.head.shared
            if (!back && after.trailing && !ownsHead) return captureTrailingPoint(after, index, ctx)
            if (!rest.operands || !back && !ownsHead) return
            const candidates = back ? edgeWindow(rest, index, index + 1, true, ctx) :
                dropSequence(rest, index, false, ctx)
            return captureSuffixPoint(candidates, decision, extent, index, back, ctx)
        }
    }
    return after
}

function suffixFailures(previous, decision, ctx) {
    const failed = continueGraphTransition(decision.pending, ctx, () => isPoisonError(decision.value.count))
    const prior = previous && continueGraphTransition(previous.pending, ctx, () => previous.value)
    return valueSignal(anyPresent([prior, failed], ctx), ctx)
}

function captureTrailingPoint(source, index, ctx) {
    const release = retainOperands(source.operands, ctx), failed = source.trailing
    const placement = decideInputs([source.length, failed.pending, inRange(source, index)], ctx, ([n, _, present]) => {
        if (present === false) return hole
        if (failed.value) return source.point(index, false)
        if (typeof n !== "number") return
        if (index >= n) return hole
        if (failed.value === false) return continueGraphTransition(source.ready, ctx, node => layoutPoint(node, index, false))
        return source.point(n - index - 1, true)
    })
    return { placement, release }
}

function captureSuffixPoint(candidates, decision, extent, index, back, ctx) {
    const release = retainOperands(candidates.operands, ctx)
    const placement = continueGraphTransition(decision.pending, ctx, () => {
        const cut = decision.value
        if (isPoisonError(cut.count)) return continueGraphTransition(inRange(extent, index), ctx, present =>
            present ? structuralPlacement(cut.count) : hole)
        return back ? continueGraphTransition(inRange(extent, index), ctx, present =>
            present ? candidates.point(0, true) : hole) : candidates.point(cut.count, false)
    })
    return { placement, release }
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
    const lost = [continueGraphTransition(selected, ctx, s => inRange(s.prefix, boundary))]
    if (!isPoisonError(count) && !(typeof count === "number" && count >= width)) {
        const fringe = displacedRange(source, width, ctx)
        lost.push(continueGraphTransition(cut, ctx, c => typeof c.count === "number" && c.count < width &&
            hasUnmarkedRange(dropSequence(fringe, c.count, false, ctx), ctx)))
    }
    if (width > MAX_COUNT - source.maximum) {
        const at = continueGraphTransition(selected, ctx, choice => choice.start)
        const amount = continueGraphTransition(cut, ctx, choice => choice.count)
        lost.push(collectInputs([source.length, at, amount], ctx, ([n, start, count]) =>
            cannotFitInsertion(n, start, count, width, MAX_COUNT)))
    }
    return reportCapacityLoss(anyPresent(lost, ctx), cause, ctx)
}

function spliceArray({ start, count, inserted, width, length, controls }, work, finish) {
    const ctx = work.operationContext, complete = work.mode === CHAIN_MODE.Complete
    for (let i = 0; i < inserted.length; i++) inserted[i] = arrayInput(inserted[i], ctx)
    if (length === undefined && replacesPrefixRange(start, count, inserted.length, work)) {
        controls.close()
        return replaceRange(work, start, inserted, finish)
    }
    if (length === undefined || !complete &&
        (isPending(start, ctx) || isPending(count, ctx) || isPoisonError(start) || isPoisonError(count)))
        return spliceSequence(start, count, inserted, controls, work, finish)
    return runArrayStep(work, () => {
        controls.close()
        const at = start, cut = Math.min(count, length - at)
        const kept = length - cut
        if (complete && width > MAX_ARRAY_LENGTH - kept) {
            inserted.length = 0
            return capacityError(ctx)
        }
        return fixedEdit(work, length, at, cut, inserted, finish)
    })
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
    const coordinates = sequenceExtent(source)
    values.length = 0
    values = undefined
    // A zero-width, zero-deletion splice still prescribes its length write.
    if (!width && typeof count === "number" && count <= 0) start = 0
    else if (!width && isPending(start, ctx) && isPending(count, ctx))
        start = decideInputs([start, count], ctx, ([at, n]) =>
            typeof n === "number" && n <= 0 ? 0 : isPending(at, ctx) ? undefined : at)
    if (!source.minimum && isPending(start, ctx))
        start = decideInputs([start, inRange(source, 0)], ctx, ([at, nonempty]) =>
            nonempty === false ? 0 : isPending(at, ctx) ? undefined : at)
    const selected = spliceCut(coordinates, start, count, width, sequential, ctx)
    const movable = width && !complete && !sequential && isPending(start, ctx) && width <= MAX_COUNT - source.maximum
    const cut = continueGraphTransition(selected, ctx, cutOf)
    const history = (source.node || source.decisions) && captureCutHistory(source.decisions, cut, ctx)
    const order = spliceOrder(source, added, selected, coordinates, count, movable, history, ctx)
    if (history && !order.node) order.decisions = history
    if (typeof start === "number" && start >= 0 && typeof count === "number" && count >= 0 &&
        start + count <= source.head.length && order.head.length === source.head.length - count + width)
        inheritSpliceSlots(order.head, source.head, added.node, ctx)
    const output = dense ? denseSequence(order, ctx) : order
    const failure = controlFailure(cut, controls, ctx)
    const cause = capacityCause(ctx)
    const removed = work.mutation && captureRemoved(source, start, count, cut, work, cause, ctx)
    if (complete) {
        // Until whole-Array validation succeeds there is no public destination
        // for these operands. The removed result has its own restricted use.
        const release = retainOperands(output.operands, ctx)
        const releasePrefix = borrowed && retainPlacement({ present: true, value: borrowed.source }, ctx)
        if (!work.mutation) work.releaseReceiverLeases()
        return decideInputs([failure, inRange(output, MAX_ARRAY_LENGTH)], ctx, ([error, over]) => {
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

function captureCutHistory(previous, cut, ctx) {
    if (!isPending(cut, ctx)) return previous
    const entry = { open: true, previous: undecidedCut(previous) }
    markPromiseHandled(continueGraphTransition(cut, ctx, () => {
        entry.open = false
        entry.previous = undecidedCut(entry.previous)
    }), ctx)
    return entry
}

// The cut contains widths and control outcomes only. Old data, insertions,
// and the removed result can each release their own range independently.
function spliceCut(size, start, count, width, sequential, ctx) {
    return continueGraphTransition(start, ctx, at => {
        at ??= 0
        const failed = isPoisonError(at)
        const prefix = failed ? size : at < 0 ? projectedCount(size, at, ctx) : projectedCount(size, 0, ctx, 0, at)
        const rest = failed ? size : at < 0 ? projectedCount(size, 0, ctx, 0, -at) : projectedCount(size, -at, ctx)
        const cutResult = continueGraphTransition(countForSuffix(rest, count, ctx), ctx, value => {
            const rejected = isPoisonError(value)
            const amount = rejected ? 0 : Math.max(0, value ?? 0)
            const cause = failed && rejected ? combineErrors([at, value]) : failed ? at : rejected ? value : undefined
            const relevant = rejected || failed && (width || amount)
            const failure = relevant && cause ? continueGraphTransition(inRange(rest, 0), ctx,
                present => present ? cause : undefined) : undefined
            return { count: failed ? 0 : rejected ? value : amount, failure,
                obstruction: failed && (amount || rejected) ? cause : undefined }
        })
        const deletion = valueSignal(cutResult, ctx)
        let after
        if (failed) after = fixedWidth(0)
        else {
            const surviving = cut => isPoisonError(cut.count) ? rest : projectedCount(rest, -cut.count, ctx)
            if (!deletion.pending) after = surviving(deletion.value)
            else {
                after = LinkedWidth.pending(0, rest.maximum, ctx)
                markPromiseHandled(continueGraphTransition(cutResult, ctx, cut => after.select(surviving(cut))), ctx)
            }
        }
        return { start: at, prefix, after, deletion, cutResult, blocksOld: failed && sequential && width > 0,
            insertFailure: failed && sequential && continueGraphTransition(cutResult, ctx, failureOf) }
    })
}

// Both readers share the cut. An Unordered reader of only old occurrences
// retains these operands. The positional result transfers its own inputs.
class SpliceRanges extends SelectedOperands {
    constructor(source, ctx, history) {
        super(source.operands)
        this.history = history
        this.source = source
        this.ctx = ctx
    }
    read = (choice, added) => {
        if (this.source) {
            if (choice === KEEP_ALL_SLOTS) return this.source
            this.prefix = isPoisonError(choice.start) ? failedPrefix(this.source, choice, this.ctx) : beforeStart(this.source, choice.start, this.ctx)
            this.after = !choice.after.maximum ? fixed(span(0)) :
                selectedSuffix(fromStart(this.source, choice.start, this.ctx), choice, this.history, this.ctx)
            this.source = undefined
            this.pointInputs = undefined
            this.select(combineOperands(this.prefix.operands, this.after.operands), this.ctx)
        }
        const prefix = added ? concatSequence(this.prefix,
            afterFailedWidth(added, choice.insertFailure, this.ctx, choice.blocksOld && this.prefix.minimum > 0), this.ctx) : this.prefix
        const joined = concatSequence(prefix, this.after, this.ctx)
        if (added && this.order) {
            this.order.capturePoint = joined.capturePoint
            this.order = undefined
        }
        return joined
    }

    capturePoint = (index, back) => {
        const source = this.source, inputs = this.pointInputs
        if (!inputs || index >= source.maximum + inputs.added.length) return
        const { added, start, count } = inputs
        return captureSplicePoint(source, added, start, count, index, back, this.ctx)
    }
}

// A near old slot keeps its offset. Across the insertion the old offset is
// q - W + D. Keep that window in predecessor coordinates. Its other end
// remains addressable when a clipped deletion leaves a known prefix.
function captureSplicePoint(source, added, start, count, index, back, ctx) {
    const size = sequenceExtent(source), width = added.length, offset = index - width
    const firstAdded = Math.max(0, index - size.maximum), endAdded = Math.min(width, index + 1)
    let insertion = fixed(back ? restrict(added, width - endAdded, width - firstAdded) : restrict(added, firstAdded, endAdded))
    let near = edgeWindow(source, index, index + 1, back, ctx)
    let far = offset < 0 ? fixed(span(0)) : dropSequence(source, offset, back, ctx)
    let base = 0
    source = added = undefined
    const use = new SelectedOperands()
    const retain = () => use.select(combineOperands(near?.operands, combineOperands(insertion?.operands, far?.operands)), ctx)
    function narrow() {
        const value = count.value
        if (!far || offset < 0 || count.pending) return
        const deleted = isPoisonError(value) ? 0 : Math.max(0, value ?? 0)
        if (back) {
            const limit = deleted + 1
            if (limit < far.maximum && limit <= far.tail.length) {
                base = projectedCount(size, -offset - limit, ctx).length
                far = takeSequence(far, limit, true, ctx)
            } else {
                base = Math.max(0, size.minimum - offset - limit)
                far = dropSequence(far, base, false, ctx)
            }
        } else far = isPoisonError(value) ? fixed(span(0)) : edgeWindow(far, deleted, deleted + 1, false, ctx)
    }
    narrow()
    retain()
    const release = retainOperands(use, ctx)
    const unwatch = count.pending && (count.watch ??= selectionReceipt(count.pending, ctx))(() => { narrow(); retain() })
    const placement = continueGraphTransition(start.pending, ctx, () => {
        const choice = start.value, nearWidth = back ? choice.after : choice.prefix
        return continueGraphTransition(widthInRange(nearWidth, index), ctx, inside => {
            if (inside) {
                const data = choose(near)
                if (isPoisonError(choice.start)) return failedPrefix(data, choice, ctx).point(0, back)
                if (!back) return data.point(0, false)
                return continueGraphTransition(choice.cutResult, ctx, cut =>
                    isPoisonError(cut.count) ? structuralPlacement(cut.count) : data.point(0, true))
            }
            return continueGraphTransition(width && widthInRange(nearWidth, offset), ctx, inserted => {
                if (!inserted) return across(choice)
                const data = afterFailedWidth(choose(insertion), choice.insertFailure, ctx, choice.blocksOld && size.minimum > 0)
                return continueGraphTransition(nearWidth.length, ctx, n => data.point(index - n - firstAdded, back))
            })
        })
    })
    return { placement, release }

    function across(choice) {
        near = insertion = undefined
        retain()
        if (isPoisonError(choice.start)) return back ? failedPrefix(choose(far), choice, ctx).point(0, true) : choose(far).point(0, false)
        return continueGraphTransition(choice.cutResult, ctx, cut => {
            const data = choose(far)
            if (!back && isPoisonError(cut.count)) return continueGraphTransition(widthInRange(size, offset), ctx,
                present => present ? structuralPlacement(cut.count) : hole)
            if (!back) return data.point(0, false)
            const amount = isPoisonError(cut.count) ? 0 : cut.count
            if (choice.start < 0) return data.point(Math.min(amount, -choice.start), true)
            if (!amount || amount <= size.minimum - choice.start) return data.point(amount, true)
            // A surviving suffix uses the full delete count. Otherwise its
            // boundary is the end of the old prefix, min(start, N).
            return continueGraphTransition(widthInRange(choice.after, 0), ctx, suffix => suffix ? data.point(amount, true) :
                continueGraphTransition(base, ctx, from =>
                    takeSequence(data, Math.max(0, choice.start - offset - from), false, ctx).point(0, true)))
        })
    }
    function choose(part) {
        unwatch?.()
        use.select(part.operands, ctx)
        near = insertion = far = undefined
        return part
    }
}

// The start chooses both sides at once. A count can still narrow the suffix
// after the prefix and insertion have become available.
function spliceOrder(source, added, selected, coordinates, count, movable, history, ctx) {
    const ranges = new SpliceRanges(source, ctx, history)
    if (!isPending(selected, ctx)) return ranges.read(selected, added)
    const start = valueSignal(selected, ctx)
    const { decision, extent } = survivingExtent(coordinates, selected, count, ctx)
    const size = projectedCount(extent, added.node.length, ctx)
    const order = ranges.order = selectedSequence(combineOperands(source.operands, added.operands), size, start, choice => ranges.read(choice, added), ctx)
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
    return decideInputs([count, inRange(rest, 0)], ctx, ([n, present]) =>
        present === false ? 0 : isPending(n, ctx) ? undefined : n)
}

export { prepareSpliceArguments, spliceArray }
