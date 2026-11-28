import { finishLayout } from "./array-interval.js"
import { checkArrayCapacity, retainElement } from "./array-methods.js"
import { metaOf, requireMeta } from "./meta.js"
import { ArrayView, isArrayView } from "./array-view.js"
import { CHAIN_MODE } from "./chain.js"
import { retainPlacement } from "./property-versions.js"
import { releaseOnClose } from "./operation-lifecycle.js"
import { readLanguagePlacement } from "./language-properties.js"
import { capacitySequence, captureSequence, concatSequence, denseSequence, displacedRange, fixed, inRange, publishFixedCopy, publishLayout, publishSequence, reversedSequence,
    hasUnmarkedRange, takeSequence, dropSequence } from "./array-sequence.js"
import { continueGraphTransition } from "./internal-step.js"
import { anyPresent, MAX_ARRAY_LENGTH, MAX_COUNT, capacityCause, capacityError, captureLayout, denseLayout, individualFixedSlots, layoutFromRemap, join,
    possibleWrites, replaceLayoutRange, projectCapacity, reportCapacityLoss, restrict, reverseLayout, span } from "./array-layout.js"
import { appendView, arrayInput, copyPhysicalArray, createArrayFromRemap, createRangeOutput, createRemap, sliceOutput } from "./array-remap.js"

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

// Reuse the unchanged spans of a physical view between shifting edits.
// A backing with child placements pays to relink them on each publication;
// the direct native copy installs those relationships once.
function sharesScalarBacking(receiver, ctx) {
    return isArrayView(receiver, ctx) && !metaOf(requireMeta(receiver, ctx).backingRecord, ctx)?.outgoingPlacements?.size
}

// A determined cut can share an endpoint, patch equal-width storage, copy
// directly to native order, or reuse persistent spans. The same coordinates
// drive both outputs. Only splice! consumes the removed descriptors.
function fixedEdit(work, length, at, cut, inserted, finish, readResult) {
    const { method, operationContext: ctx } = work
    const width = inserted.length, kept = length - cut
    const dense = method === "with" || method === "toReversed" || method === "toSpliced"
    const removes = method === "shift" || method === "pop", splice = method === "splice" || method === "toSpliced"
    const region = ArrayView.region(work.receiver, ctx), prefix = ArrayView.prefixLength(work.receiver, ctx)
    const native = length <= MAX_ARRAY_LENGTH && width <= MAX_ARRAY_LENGTH - kept
    if (!splice && (!native || region?.pending && !region.fixedCoordinates)) return
    const slice = (lo, hi) => sliceOutput(work.receiver, lo, hi, ctx)
    const done = readResult ? (output, removed, failure) => finish(output, readResult, failure) : finish
    if (!dense && native) {
        if (!width && (!at || at + cut === length) && (prefix || !region?.pending) &&
            (removes && !region?.fixedCoordinates || ArrayView.tryShareStorage(work.receiver, ctx))) {
            return done(at ? slice(0, at) : slice(cut, length), () => work.retainOutput(cut && cut <= kept ?
                createArrayFromRemap(createRemap(work.receiver, ctx, at, at + cut), ctx) : slice(at, at + cut)))
        }
        if (prefix || !region) {
            if (cut && cut === width && ArrayView.tryShareStorage(work.receiver, ctx))
                return replaceRange(work, at, inserted, finish)
            if (at === length) {
                const output = appendView(work.receiver, [inserted], length, width, ctx)
                if (output) return done(output, () => work.retainOutput(slice(at, at)))
            }
        }
    }
    const shared = native && (region ? region.fixedCoordinates :
        splice && at < length && (!cut && width || cut !== width && at + cut < length && sharesScalarBacking(work.receiver, ctx)) ||
        dense && (inserted.some(p => p.sourceVersion) || ArrayView.hasStoredVersions(work.receiver, ctx)))
    if (!shared) {
        // A non-extensible push can still borrow the predecessor as a
        // prefix. Copying that storage would revisit it on every append.
        if (!dense && !splice && (method !== "unshift" || region && !prefix)) return
        const copy = copyPhysicalArray(work, length, done, at, cut, inserted)
        if (copy !== undefined || !splice) return copy
    }
    const removed = method === "splice" && work.mutation
    const source = removed ? captureLayout(work.receiver, ctx, length) : undefined
    const read = (lo, hi) => source ? restrict(source, lo, hi) : captureLayout(work.receiver, ctx, length, lo, hi)
    let mapped = method === "toReversed" ? reverseLayout(read(0, length)) :
        replaceLayoutRange(read, length, at, cut, layoutFromRemap(inserted))
    if (dense) mapped = denseLayout(mapped, ctx)
    const result = removed && (() => work.mode === CHAIN_MODE.Complete && cut > MAX_ARRAY_LENGTH ?
        capacityError(ctx) : work.retainOutput(publishLayout(read(at, at + cut), ctx)))
    if (shared) return done(publishFixedCopy(mapped, ctx), result)
    const projected = projectCapacity(mapped, ctx, width > MAX_COUNT - kept)
    return done(publishLayout(projected.node, ctx), result, projected.failure)
}

function replaceRange(work, at, inserted, finish) {
    const ctx = work.operationContext
    const removed = work.mutation && work.retainOutput(createArrayFromRemap(createRemap(work.receiver, ctx, at, at + inserted.length), ctx))
    return finish(createRangeOutput(at, inserted, work), () => removed)
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
            reportWrites(continueGraphTransition(inRange(source, MAX_COUNT - 1), ctx, full => !full))
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
        output = dropSequence(source, 1, tail, ctx)
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
    if (appending) lost = inRange(source, (work.missingOutput ? MAX_COUNT : MAX_ARRAY_LENGTH) - args.length)
    else if (work.method === "unshift" && args.length)
        lost = anyPresent([inRange(source, MAX_COUNT - args.length), hasUnmarkedRange(displacedRange(source, args.length, ctx), ctx)], ctx)
    else if (work.method === "reverse") lost = hasUnmarkedRange(dropSequence(output, MAX_ARRAY_LENGTH, false, ctx), ctx)
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
            const at = !replacement ? 0 : args[0] < 0 ? length + args[0] : args[0]
            const result = fixedEdit(work, length, at, Number(Boolean(replacement)), replacement ? [replacement] : [], finish)
            if (result !== undefined) return result
        }
        let mapped
        if (work.method === "toReversed") mapped = reversedSequence(captureSequence(receiver, ctx), ctx, true)
        else {
            const [relative] = args, back = relative < 0, index = back ? -1 - relative : relative
            const at = back && length !== undefined ? length + relative : relative
            const source = captureSequence(receiver, ctx, { omitStart: at, omitEnd: at + 1 })
            const near = takeSequence(source, index, back, ctx)
            const far = dropSequence(source, index + 1, back, ctx)
            mapped = denseSequence(concatSequence(concatSequence(back ? far : near, fixed(span(1, replacement)), ctx),
                back ? near : far, ctx), ctx)
        }
        return finish(publishSequence(capacitySequence(mapped, ctx), ctx))
    }
}

function reverseFixed(work, finish, reportWrites) {
    const { receiver, arrayLength: length, operationContext: ctx } = work
    const physical = copyPhysicalArray(work, length, finish)
    if (physical !== undefined) return physical
    const node = reverseLayout(captureLayout(receiver, ctx, length))
    return finishLayout(node, work.mutation && reverseWrites(node, ctx), work, finish, reportWrites)
}

export { copyDense, fixedEdit, replaceRange, reverseFixed, applyEndpoint, partialEndpoint }
