import { MAX_ARRAY_LENGTH, MAX_COUNT, anyPresent, capacityError, capacityFailure, captureLayout, denseLayout, flagPositions, layoutFromRemap, join,
    layoutAt, materializeIndividualSlots, projectCapacity, restrict, span, structuralPlacement } from "./array-layout.js"
import { afterFailedWidth, capacitySequence, captureSequence, concatSequence, denseSequence, fixed, inRange,
    obstructedSequence, pendingSequence, publishLayout, publishSequence, refine, retainLayout, selectionReceipt, SelectionQuestions, takeSequence, trimmedSequence, watch } from "./array-sequence.js"
import { appendView, arrayInput, createRangeOutput, createRemap, createArrayFromRemap, copyPhysicalArray, sliceOutput } from "./array-remap.js"
import { copyFixedRanges } from "./array-layout-methods.js"
import { ArrayView } from "./array-view.js"
import { broadRange, normalizeIndex } from "./array-interval.js"
import { CHAIN_MODE } from "./chain.js"
import { combineErrors, isPoisonError } from "./error.js"
import { collectInputs, continueGraphTransition, decideInputs } from "./internal-step.js"
import { createLeaseLedger } from "./ownership.js"
import { isPending } from "./language-values.js"
import { densePlacement, PendingFailure } from "./property-versions.js"
import { OperationOwner } from "./operation-lifecycle.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import { checkArrayCapacity, numericInput, resolveArrayLength, runArrayStep } from "./array-methods.js"

function replacesPrefixRange(start, count, width, work) {
    const ctx = work.operationContext, length = ArrayView.prefixLength(work.receiver, ctx)
    return work.method === "splice" && length > 0 && typeof start === "number" && start >= 0 &&
        count === width && start + count <= length && !broadRange(count, work.receiver, length, ctx)
}

function prepareSpliceArguments(work) {
    let args = work.args
    const ctx = work.operationContext
    if (!work.receiverCapture && ArrayView.hasPendingLength(work.receiver, ctx)) {
        const controls = new OperationOwner(ctx), maximum = ArrayView.maximumLength(work.receiver, ctx)
        const argc = args.length, inserted = []
        const read = i => numericInput(work.takeArgument(i, args), controls)
        let start = argc ? read(0) : 0
        if (start === undefined) start = 0
        const count = !argc || typeof start === "number" && start >= maximum ? 0 : argc === 1 ? Infinity : read(1)
        for (let i = 2; i < argc; i++) inserted.push(work.prepareArgument(i, args))
        if (work.mode === CHAIN_MODE.Complete && maximum > MAX_ARRAY_LENGTH && replacesPrefixRange(start, count, inserted.length, work))
            return checkArrayCapacity(MAX_ARRAY_LENGTH, work, () => ({ start, count, inserted, controls }))
        return { start, count, inserted, controls }
    }
    const prepared = resolveArrayLength(work, length => {
        work.arrayLength = length
        const argc = args.length, inserted = args.slice(2), width = inserted.length
        const countInput = args[1]
        // The producer can outlive an observation returning its partial Array.
        const controls = new OperationOwner(ctx)
        const normalized = (index, normalize) => continueGraphTransition(
            numericInput(work.prepareArgument(index, args), controls), ctx,
            value => isPoisonError(value) ? value : normalize(value ?? 0), undefined, controls)
        for (let index = 2; index < argc; index++) inserted[index - 2] = work.prepareArgument(index, args)
        const countKnownZero = argc === 0 || argc >= 2 &&
            (countInput == null || typeof countInput === "number" && !(Math.trunc(countInput) > 0))
        let start = length === 0 || !inserted.length && countKnownZero ? 0 : normalized(0, value => normalizeIndex(value, length))
        let count = length === 0 || start === length || countKnownZero ? 0 : argc < 2 ? length :
            normalized(1, value => Math.max(0, Math.min(length, value)))
        args = undefined
        const streaming = work.mode !== CHAIN_MODE.Complete
        const select = ([start, count]) => {
            if (start === length) count = 0
            if (count === 0 && !width) start = 0
            if (!streaming) {
                const waiting = isPending(start, ctx) || isPending(count, ctx)
                const failedStart = isPoisonError(start) && (width || typeof count === "number" && count > 0)
                const maxCut = isPoisonError(count) || isPoisonError(start) ? 0 : Math.min(typeof count === "number" ? count : length,
                    length - (typeof start === "number" ? start : 0))
                const cannotFit = !work.receiverCapture && width > MAX_ARRAY_LENGTH - (length - maxCut)
                if (failedStart || waiting && cannotFit) {
                    inserted.length = 0
                    for (let index = 2; index < argc; index++) work.discardArgument(index)
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
        return select(inputs) ?? decideInputs(inputs, ctx, select, controls)
    })
    if (args) work.prepareArgumentFrontier(args.length, args)
    return prepared
}

function spliceControlFailure(start, count, width, length) {
    const failedStart = isPoisonError(start) && (width || count !== 0) ? start : undefined
    const failedCount = isPoisonError(count) && start !== length ? count : undefined
    return failedStart && failedCount ? combineErrors([failedStart, failedCount]) : failedStart ?? failedCount
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
    if (length === undefined || work.mode === CHAIN_MODE.Unordered && width &&
        (isPending(start, ctx) || isPoisonError(start))) return spliceSequence(start, count, inserted, controls, work, finish)
    if (!complete && (isPending(start, ctx) || isPending(count, ctx) || isPoisonError(start) || isPoisonError(count)))
        return streamSplice(start, count, inserted, length, controls, work, finish)
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
        if (!dense && length <= MAX_ARRAY_LENGTH && (prefix || !ArrayView.region(work.receiver, ctx))) {
            const slice = (first, end) => sliceOutput(work.receiver, first, end, ctx)
            if (!width && (!at || at + cut === length) && ArrayView.tryShareStorage(work.receiver, ctx))
                return finish(at ? slice(0, at) : slice(cut, length), () => work.retainOutput(cut && cut <= kept ?
                    createArrayFromRemap(createRemap(work.receiver, ctx, at, at + cut), ctx) : slice(at, at + cut)))
            if (width && width === cut && ArrayView.tryShareStorage(work.receiver, ctx)) return replaceRange(at, cut)
            if (at === length && width <= MAX_ARRAY_LENGTH - length) {
                const extended = appendView(work.receiver, [inserted], length, width, ctx)
                if (extended) return finish(extended, () => work.retainOutput(slice(at, at)))
            }
        }
        const shared = dense && copyFixedRanges(work, length, at, cut, inserted)
        if (shared) return finish(shared)
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
    const source = captureSequence(work.receiver, ctx, { omitStart, omitEnd })
    const added = fixed(layoutFromRemap(values)), empty = fixed(span(0)), width = values.length
    const complete = work.mode === CHAIN_MODE.Complete, sequential = work.mode === CHAIN_MODE.Sequential
    const leases = createLeaseLedger(ctx)
    leases.acquire(work.receiver)
    for (const p of values) leases.acquire(p.value)
    values = undefined
    const select = s => {
        s ??= 0
        const failedStart = isPoisonError(s), at = failedStart ? Infinity : s
        const left = at < 0 ? trimmedSequence(source, 0, -at, ctx) : takeSequence(source, at, false, ctx)
        const rest = at < 0 ? takeSequence(source, -at, true, ctx) : trimmedSequence(source, at, 0, ctx)
        const cut = !failedStart && rest.maximum === 0 ? 0 : count
        const decide = c => {
            c ??= 0
            const failedCount = isPoisonError(c)
            if (failedStart) {
                const cause = failedCount ? combineErrors([s, c]) : s
                const failure = width || failedCount || c > 0 ? continueGraphTransition(inRange(source, 0, ctx), ctx,
                    present => present ? cause : undefined) : undefined
                const old = failedCount || c > 0 ? obstructedSequence(source, cause, ctx) :
                    sequential ? afterFailedWidth(source, failure, ctx) : source
                const insert = sequential ? afterFailedWidth(added, failure, ctx) : added
                return { prefix: old, insert, after: empty, removed: empty, failure }
            }
            if (failedCount) return { after: obstructedSequence(rest, c, ctx), removed: empty,
                failure: continueGraphTransition(inRange(rest, 0, ctx), ctx, present => present ? c : undefined) }
            const n = Math.max(0, c)
            return { after: trimmedSequence(rest, n, 0, ctx), removed: takeSequence(rest, n, false, ctx) }
        }
        const cutResult = continueGraphTransition(cut, ctx, decide)
        const prefix = failedStart ? pendingSequence(cutResult, r => r.prefix, ctx, source.minimum, source.maximum) : left
        if (failedStart && isPending(cutResult, ctx)) {
            prefix.length = source.length
            watch(source, (lo, hi, active) => refine(prefix, lo, hi, active), ctx)
        }
        const insert = failedStart && sequential ? pendingSequence(cutResult, r => r.insert, ctx, width, width) : added
        const after = failedStart ? empty : pendingSequence(cutResult, r => r.after, ctx, 0, rest.maximum)
        return { output: concatSequence(concatSequence(prefix, insert, ctx), after, ctx), prefix, after, cutResult }
    }
    // A zero-width, zero-deletion splice still prescribes its length write.
    if (!width && typeof count === "number" && count <= 0) start = 0
    if (!source.minimum && isPending(start, ctx))
        start = decideInputs([start, inRange(source, 0, ctx)], ctx, ([at, nonempty]) =>
            nonempty === false ? 0 : isPending(at, ctx) ? undefined : at)
    const selected = continueGraphTransition(start, ctx, select)
    const insertion = typeof count === "number" && count <= 0, dense = work.method === "toSpliced"
    const addWidth = n => n + Math.min(width, MAX_COUNT - n)
    const keep = typeof count === "number" ? Math.max(0, source.minimum - Math.max(0, count)) : 0
    const order = pendingSequence(selected, s => s.output, ctx, addWidth(keep), addWidth(source.maximum))
    const movable = width && !complete && !sequential && isPending(start, ctx) && width <= MAX_COUNT - source.maximum
    if (movable || insertion && isPending(start, ctx)) {
        // Inserted slots survive every cut. The old slots depend on the
        // selected removal, unless a zero count proves all of them survive.
        const survivors = insertion ? source : pendingSequence(decideInputs([selected, count], ctx, ([s, c]) =>
            typeof c === "number" && c <= 0 ? source :
                isPending(s, ctx) ? undefined : concatSequence(s.prefix, s.after, ctx)), seq => seq, ctx, keep, source.maximum)
        order.length = continueGraphTransition(survivors.length, ctx, addWidth)
        watch(survivors, (lo, hi, active) => refine(order, addWidth(lo), addWidth(hi), active), ctx)
        if (movable) order.origins = insertionOrigins(survivors, added.node, selected, ctx)
    }
    const output = dense ? denseSequence(order, ctx) : order
    const cut = continueGraphTransition(selected, ctx, s => s.cutResult)
    const failure = continueGraphTransition(cut, ctx, r => r.failure)
    markPromiseHandled(continueGraphTransition(failure, ctx, () => controls.close()), ctx)
    let lost
    const cause = () => lost ??= capacityError(ctx)
    const make = sequence => publishSequence(sequence, ctx, leases.release)
    const removed = () => continueGraphTransition(cut, ctx, r =>
        complete && r.removed.maximum > MAX_ARRAY_LENGTH ? continueGraphTransition(inRange(r.removed, MAX_ARRAY_LENGTH, ctx), ctx, over =>
            over ? cause() : work.retainOutput(publishSequence(r.removed, ctx))) :
            work.retainOutput(publishSequence(r.removed, ctx)))
    if (complete) {
        return decideInputs([failure, inRange(output, MAX_ARRAY_LENGTH, ctx)], ctx, ([error, over]) => {
            if (isPoisonError(error) || over === true) {
                leases.release()
                if (isPending(error, ctx))
                    return new PendingFailure(continueGraphTransition(error, ctx, reason => reason ?? cause()), ctx).outcome(work.mutation)
                return error ?? cause()
            }
            if (isPending(error, ctx) || isPending(over, ctx)) return
            return finish(make(output), removed)
        })
    }
    const view = make(capacitySequence(output, ctx, cause))
    if (!work.mutation) return finish(view)
    let capacity
    if (output.maximum > MAX_ARRAY_LENGTH) capacity = continueGraphTransition(output.ready, ctx, node => {
        const loss = capacityFailure(node, ctx, cause)
        if (width <= MAX_COUNT - source.maximum) return loss
        const clipped = collectInputs([source.length, continueGraphTransition(cut, ctx, r => r.removed.length)], ctx,
            ([n, deleted]) => width > MAX_COUNT - (n - deleted))
        return continueGraphTransition(anyPresent([clipped, continueGraphTransition(loss, ctx, Boolean)], ctx), ctx,
            failed => failed ? cause() : undefined)
    })
    return finish(view, () => collectInputs([failure, capacity], ctx, ([error, loss]) =>
        error && loss ? combineErrors([error, loss]) : error ?? loss ?? removed()))
}

// A cut can be addressed from either end. Keep just the widths for rank
// futures, independently of the payloads retained by the selected layouts.
function insertionOrigins(source, added, selected, ctx) {
    const width = side => {
        const cut = { minimum: 0, maximum: source.maximum }
        cut.length = continueGraphTransition(selected, ctx, choice => {
            const part = choice[side]
            refine(cut, part.minimum, part.maximum)
            watch(part, (lo, hi, active) => refine(cut, lo, hi, active), ctx)
            return part.length
        })
        watch(source, (_, hi, active) => refine(cut, cut.minimum, Math.min(cut.maximum, hi), active), ctx)
        return cut
    }
    return { source, added, cut: width("prefix"), backCut: width("after"), context: ctx }
}

function streamSplice(start, count, values, length, controls, work, finish) {
    const ctx = work.operationContext, dense = work.method === "toSpliced", sequential = work.mode === CHAIN_MODE.Sequential
    let source = captureSequence(work.receiver, ctx), borrowed
    // Each side of the cut can outlive the other. Give the established
    // prefix its own backing. Repeated or virtual ranges stay compact.
    if (source.node && typeof start === "number" && start > 0 && isPending(count, ctx)) {
        const prefix = restrict(source.node, 0, start)
        const array = materializeIndividualSlots(dense ? denseLayout(prefix, ctx) : prefix, ctx)
        if (array) {
            borrowed = { source: array, range: ArrayView.borrowPrefix(array, start, ctx) }
            source = fixed(join(span(start), restrict(source.node, start, length)))
        }
    }
    const added = layoutFromRemap(values), width = added.length
    const leases = createLeaseLedger(ctx)
    const selections = new SelectionQuestions()
    const releaseSuffix = borrowed ? retainLayout([source.node], ctx) : undefined
    if (!borrowed) leases.acquire(work.receiver)
    for (const p of values) leases.acquire(p.value)
    let seq, completed, signal, result
    const addWidth = n => n + Math.min(width, MAX_COUNT - n)
    const bounds = () => {
        const s = typeof start === "number" ? start : 0, S = typeof start === "number" ? start : length
        const c = typeof count === "number" ? count : 0, C = typeof count === "number" ? count : length
        return [addWidth(length - Math.min(C, length - s)), addWidth(length - Math.min(c, length - S))]
    }
    function update() {
        if (completed) return
        if (start === length) count = 0
        if (count === 0 && !width) start = 0
        if (seq) refine(seq, ...bounds())
        if (isPending(start, ctx) || isPending(count, ctx)) { selections.changed(); return }
        completed = true
        controls.close()
        const failures = [start, count].filter(isPoisonError)
        const failure = failures.length ? combineErrors(failures) : undefined
        const at = isPoisonError(start) ? length : start, cut = isPoisonError(count) ? 0 : Math.min(count, length - at)
        result = continueGraphTransition(source.ready, ctx, node => {
            let prefix = restrict(node, 0, at), suffix = restrict(node, at + cut, length), insertion = added
            if (isPoisonError(start)) {
                if (count !== 0) prefix = span(at, structuralPlacement(failure))
                else if (sequential) prefix = flagPositions(prefix, start, ctx)
                if (sequential) insertion = flagPositions(added, start, ctx)
            } else if (isPoisonError(count)) suffix = span(length - at, structuralPlacement(count))
            const mapped = join(join(prefix, insertion), suffix)
            const projected = projectCapacity(dense ? denseLayout(mapped, ctx) : mapped, ctx, width > MAX_COUNT - (length - cut))
            return { node: projected.node, failure: work.mutation && continueGraphTransition(projected.failure, ctx, loss =>
                failure && loss ? combineErrors([failure, loss]) : failure ?? loss),
                removed: work.mutation && !failure && restrict(node, at, at + cut) }
        })
        signal?.resolve(result)
        selections.changed()
    }
    update()
    if (!completed) {
        signal = Promise.withResolvers()
        if (isPending(start, ctx)) markPromiseHandled(continueGraphTransition(start, ctx, s => { start = s; update() }, undefined, controls), ctx)
        if (isPending(count, ctx)) markPromiseHandled(continueGraphTransition(count, ctx, c => { count = c; update() }, undefined, controls), ctx)
    }
    const completion = result ?? signal.promise, ready = continueGraphTransition(completion, ctx, item => item.node)
    if (isPending(ready, ctx)) {
        const [minimum, maximum] = bounds()
        const knownStart = typeof start === "number"
        let head = knownStart ? restrict(source.head, 0, Math.min(start, source.head.length)) : span(0)
        if (knownStart && head.length === start) head = join(head, added)
        if (dense) head = denseLayout(head, ctx)
        const hole = { value: undefined, present: false }, point = (index, back) => selections.read(() => {
            if (!back && typeof start === "number") {
                if (index < start) return continueGraphTransition(source.point(index, false), ctx,
                    p => dense ? densePlacement(p, ctx) : p)
                if (index - start < width) return layoutAt(added, index - start)
            }
            if (completed) return continueGraphTransition(ready, ctx, node => index < node.length ?
                layoutAt(node, back ? node.length - 1 - index : index) ?? hole : hole)
        })
        seq = { minimum, maximum, length: minimum === maximum ? minimum : continueGraphTransition(ready, ctx, node => node.length),
            head, tail: span(0), ready, point }
        if (source.node) {
            // Before start is known no numeric slot is selected. Once it is
            // known, the old prefix and the insertion are one fixed run.
            const chosenStart = isPending(start, ctx) && start
            const receipt = selectionReceipt(ready, ctx)
            seq.awaitSelection = chosenStart ? selectionReceipt(chosenStart, ctx) : receipt
            if (chosenStart) markPromiseHandled(continueGraphTransition(chosenStart, ctx, at => {
                if (typeof at === "number") {
                    head = join(restrict(source.node, 0, at), added)
                    seq.head = dense ? denseLayout(head, ctx) : head
                }
                seq.awaitSelection = receipt
            }), ctx)
            markPromiseHandled(continueGraphTransition(ready, ctx, node => { seq.current = fixed(node) }), ctx)
        }
    } else seq = fixed(ready)
    const output = publishSequence(seq, ctx, () => { releaseSuffix?.(); leases.release() }, borrowed)
    return finish(output, () => continueGraphTransition(completion, ctx, item =>
        continueGraphTransition(item.failure, ctx, failure =>
            failure ?? work.retainOutput(publishLayout(projectCapacity(item.removed, ctx).node, ctx)))))
}

export { prepareSpliceArguments, spliceArray }
