import { checkArrayCapacity, retainElement } from "./array-methods.js"
import { ArrayView } from "./array-view.js"
import { CHAIN_MODE } from "./chain.js"
import { retainPlacement } from "./property-versions.js"
import { releaseOnClose } from "./operation-lifecycle.js"
import { readLanguagePlacement } from "./language-properties.js"
import { capacitySequence, captureSequence, concatSequence, denseSequence, displacedRange, fixed, inRange, publishFixedCopy, publishLayout, publishSequence, reversedSequence,
    hasUnmarkedRange, takeSequence, trimmedSequence } from "./array-sequence.js"
import { continueGraphTransition } from "./internal-step.js"
import { anyPresent, MAX_ARRAY_LENGTH, MAX_COUNT, capacityCause, capacityError, captureLayout, denseLayout, individualFixedSlots, layoutFromRemap, join,
    possibleWrites, projectCapacity, reportCapacityLoss, restrict, reverseLayout, span } from "./array-layout.js"
import { arrayInput, copyPhysicalArray, createRangeOutput } from "./array-remap.js"

function partialEndpoint(work) {
    const { receiver, operationContext: ctx } = work
    const region = ArrayView.region(receiver, ctx)
    return work.missingOutput || !work.receiverCapture &&
        (region?.pending && !region.fixedStorage || ArrayView.hasPendingLength(receiver, ctx))
}

function reverseWrites(node, ctx) {
    const half = Math.floor(node.length / 2)
    return possibleWrites([restrict(node, 0, half), restrict(node, node.length - half, node.length)], ctx)
}

// These mappings use each retained source occurrence at most once. A copy
// of physical slots establishes the first shared tree. Later endpoint edits,
// dense copies and reversals reuse its unchanged ranges at their new offsets.
function copyFixedRanges(work, length, at, cut, inserted) {
    const { receiver, operationContext: ctx, method } = work
    if (length === undefined || length > MAX_ARRAY_LENGTH || length - cut + inserted.length > MAX_ARRAY_LENGTH) return
    const region = ArrayView.region(receiver, ctx)
    const interiorInsertion = (method === "splice" || method === "toSpliced") && !cut && inserted.length && at < length
    if (region ? !region.fixedCoordinates : !interiorInsertion && !inserted.some(p => p.sourceVersion) && !ArrayView.hasStoredVersions(receiver, ctx)) return
    const read = (first, end) => captureLayout(receiver, ctx, length, first, end)
    let node
    if (method === "toReversed") node = reverseLayout(read(0, length))
    else node = join(join(read(0, at), layoutFromRemap(inserted)), read(at + cut, length))
    if (method === "toReversed" || method === "toSpliced" || method === "with") node = denseLayout(node, ctx)
    return publishFixedCopy(node, ctx)
}

const returnLength = length => () => length

function applyEndpoint(args, work, finish, reportWrites) {
    const ctx = work.operationContext
    const appending = work.mutation && work.method === "push" && args.length > 0
    if (appending && ArrayView.minimumLength(work.receiver, ctx) === MAX_COUNT) {
        reportWrites(false)
        return finish(undefined, undefined, capacityError(ctx))
    }
    const append = work.method === "push" || work.method === "unshift" && !args.length
    const removes = work.method === "pop" || work.method === "shift"
    let range = (append || removes) && ArrayView.borrowPrefix(work.receiver, ArrayView.readyLength(work.receiver, ctx), ctx)
    let skip = range?.length ?? 0, sourceStart = 0, removed, lastPhysical
    if (range && removes) {
        if (work.method === "shift") {
            sourceStart = 1
            if (work.mutation) removed = readLanguagePlacement(work.receiver, 0, ctx)
            range = { ...range, start: range.start + 1, length: range.length - 1 }
        } else if (range.length === ArrayView.minimumLength(work.receiver, ctx)) {
            // An empty suffix makes the last physical slot the removed value.
            skip--
            lastPhysical = true
            range = { ...range, length: skip }
        }
    }
    const source = captureSequence(work.receiver, ctx, { omitEnd: skip })
    // Until the width is known this one slot can belong to the retained
    // Array or to the removed result. Each keeps it through its own handoff.
    const edge = lastPhysical ? source.point(skip, false) : removed
    if (work.mutation && edge) releaseOnClose(work, retainPlacement(edge, ctx))
    const release = lastPhysical ? retainPlacement(edge, ctx) : undefined
    const borrowed = range?.length ? { source: work.receiver, range, sourceStart } : undefined
    let output, result
    switch (work.method) {
    case "push": case "unshift": {
        if (appending && source.maximum === MAX_COUNT)
            reportWrites(continueGraphTransition(inRange(source, MAX_COUNT - 1, ctx), ctx, full => !full))
        const inserted = work.missingOutput ? args : fixed(layoutFromRemap(args))
        output = work.method === "push" ? concatSequence(source, inserted, ctx) : concatSequence(inserted, source, ctx)
        result = returnLength(output.length)
        // A settled edit of a captured layout already has disjoint slots.
        // Keep its persistent prefix/suffix for the next capture.
        if (!borrowed && ArrayView.region(work.receiver, ctx) && output.node?.fixedPresence && output.maximum <= MAX_ARRAY_LENGTH &&
            individualFixedSlots(output.node, ctx)) return finish(publishFixedCopy(output.node, ctx), result)
        break
    }
    case "pop": case "shift": {
        const tail = work.method === "pop"
        output = trimmedSequence(source, tail ? 0 : 1, tail ? 1 : 0, ctx)
        result = () => continueGraphTransition(removed ?? source.point(0, tail), ctx, p =>
            retainElement(p, work), undefined, work)
        break
    }
    case "reverse":
        output = reversedSequence(source, ctx)
        if (work.mutation) {
            const half = Math.floor(source.minimum / 2)
            const ends = join(restrict(source.head, 0, Math.min(half, source.head.length)),
                restrict(source.tail, Math.max(0, source.tail.length - half), source.tail.length))
            const early = possibleWrites([ends], ctx)
            if (early === true || source.maximum < 2) reportWrites(early === true)
            else reportWrites(anyPresent([early, continueGraphTransition(source.ready, ctx, node => reverseWrites(node, ctx))], ctx))
        }
        break
    }
    if (output.maximum <= MAX_ARRAY_LENGTH) return finish(publishSequence(output, ctx, release, borrowed), result)
    const cause = capacityCause(ctx)
    const view = publishSequence(capacitySequence(output, ctx, cause), ctx, release, borrowed)
    if (!work.mutation) return finish(view)
    let lost
    if (appending) lost = inRange(source, (work.missingOutput ? MAX_COUNT : MAX_ARRAY_LENGTH) - args.length, ctx)
    else if (work.method === "unshift" && args.length)
        lost = anyPresent([inRange(source, MAX_COUNT - args.length, ctx), hasUnmarkedRange(displacedRange(source, args.length, ctx), ctx)], ctx)
    else if (work.method === "reverse") lost = hasUnmarkedRange(trimmedSequence(output, MAX_ARRAY_LENGTH, 0, ctx), ctx)
    return finish(view, result, reportCapacityLoss(lost, cause, ctx))
}

// A dense copy can publish a selected slot while another is still being
// chosen. Only the replacement index and complete-mode capacity gate its root.
function copyDense(args, work, finish) {
    const ctx = work.operationContext
    const copy = () => publish(ArrayView.readyLength(work.receiver, ctx))
    return work.method === "toReversed" && work.mode === CHAIN_MODE.Complete
        ? checkArrayCapacity(MAX_ARRAY_LENGTH, work, copy) : copy()

    function publish(length) {
        const receiver = work.receiver
        const replacement = work.method === "with" ? arrayInput(args[1], ctx) : undefined
        if (length !== undefined) {
            const [relative] = args
            if (replacement && length <= MAX_ARRAY_LENGTH && !ArrayView.region(receiver, ctx) &&
                ArrayView.hasStoredVersions(receiver, ctx) && ArrayView.tryShareStorage(receiver, ctx)) {
                const at = relative < 0 ? length + relative : relative
                const left = captureLayout(receiver, ctx, length, 0, at), right = captureLayout(receiver, ctx, length, at + 1, length)
                if (left.dense && right.dense) return finish(createRangeOutput(at, [replacement], work))
                return finish(publishLayout(join(join(denseLayout(left, ctx), span(1, replacement)), denseLayout(right, ctx)), ctx))
            }
            const shared = copyFixedRanges(work, length, replacement ? relative < 0 ? length + relative : relative : 0,
                replacement ? 1 : 0, replacement ? [replacement] : [])
            if (shared) return finish(shared)
            const copy = work.method === "toReversed" ? copyPhysicalArray(work, length, finish) :
                copyPhysicalArray(work, length, finish, relative < 0 ? length + relative : relative, 1, [replacement])
            if (copy !== undefined) return copy
        }
        let mapped
        if (work.method === "toReversed") mapped = reversedSequence(captureSequence(receiver, ctx), ctx, true)
        else {
            const [relative] = args, back = relative < 0, index = back ? -1 - relative : relative
            const at = back && length !== undefined ? length + relative : relative
            const source = captureSequence(receiver, ctx, { omitStart: at, omitEnd: at + 1 })
            const near = takeSequence(source, index, back, ctx)
            const far = trimmedSequence(source, back ? 0 : index + 1, back ? index + 1 : 0, ctx)
            mapped = denseSequence(concatSequence(concatSequence(back ? far : near, fixed(span(1, replacement)), ctx),
                back ? near : far, ctx), ctx)
        }
        return finish(publishSequence(capacitySequence(mapped, ctx), ctx))
    }
}

// The selected extent is exact. Map its captured ranges without expanding
// compressed holes, repeated values or the virtual tail.
function applyLayoutMethod(args, work, finish, reportWrites) {
    const { method, operationContext: ctx, mode, mutation, arrayLength: length } = work
    const complete = mode === CHAIN_MODE.Complete
    const capture = (first, end) => captureLayout(work.receiver, ctx, length, first, end)
    let node
    switch (method) {
    case "reverse":
        node = reverseLayout(capture(0, length))
        if (mutation) return writeLayout(node, reverseWrites(node, ctx))
        if (complete && length > MAX_ARRAY_LENGTH) return capacityError(ctx)
        break
    case "slice": {
        const [first, end] = args
        if (complete && end - first > MAX_ARRAY_LENGTH) return capacityError(ctx)
        node = capture(first, end)
        break
    }
    case "fill": {
        const [placement, first, end] = args
        if (first === end && mutation) { reportWrites(false); return finish() }
        const replacement = span(end - first, placement)
        node = join(join(capture(0, first), replacement), capture(end, length))
        if (mutation) return writeLayout(node, true)
        break
    }
    case "copyWithin": {
        const [target, start, end] = args, count = Math.min(end - start, length - target)
        if (!count && mutation) { reportWrites(false); return finish() }
        const source = capture(0, length), replacement = restrict(source, start, start + count)
        node = join(join(restrict(source, 0, target), replacement), restrict(source, target + count, length))
        if (mutation) return writeLayout(node, possibleWrites([replacement, restrict(source, target, target + count)], ctx))
        break
    }
    }
    if (complete && node.length > MAX_ARRAY_LENGTH) return capacityError(ctx)
    const projected = projectCapacity(node, ctx)
    return finish(publishLayout(projected.node, ctx), undefined, projected.failure)

    function writeLayout(node, writes) {
        if (complete && length > MAX_ARRAY_LENGTH) return continueGraphTransition(writes, ctx, effective => {
            if (effective) return capacityError(ctx)
            reportWrites(false)
            return finish()
        })
        reportWrites(writes)
        if (writes === false) return finish()
        const projected = projectCapacity(node, ctx)
        return finish(publishLayout(projected.node, ctx), undefined, projected.failure)
    }
}

export { copyDense, copyFixedRanges, applyLayoutMethod, applyEndpoint, partialEndpoint }
