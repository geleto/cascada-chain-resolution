import { ArrayRegion } from "./array-region.js"
import { ArrayView } from "./array-view.js"
import { drainWidthUpdates, fixedWidth, LinkedWidth, projectedCount, sumExtent, sumWidths, widthInRange } from "./array-width.js"
import { capacityCause, capacityPlacement, captureLayout, compactLayout, denseLayout, flagPositions, hasUnmarkedPlacement, join, layoutAt, LayoutBuilder, MAX_ARRAY_LENGTH, MAX_COUNT,
    fixedPayloads, individualFixedSlots, missingOutputMarker, missingOutputMarkers, projectCapacity, closedLayout, resolvedFixedLayout, restrict, reverseLayout, span, structuralPlacement } from "./array-layout.js"
import { combineErrors, isPoisonError } from "./error.js"
import { collectInputs, continueGraphTransition } from "./internal-step.js"
import { readArrayPlacement } from "./array-remap.js"
import { isPending } from "./language-values.js"
import { requireMeta } from "./meta.js"
import { createLeaseLedger } from "./ownership.js"
import { capturePlacementFromVersion, densePlacement, knownObstruction, ownPlacementVersionEntries, placementFromSelection, resolvePlacementTransition, structuralFailure } from "./property-versions.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import { combineOperands, deriveSequenceLayout, layoutOperands, readSequenceLayout, retainOperands, SelectedOperands, selectionReceipt, selectSequenceLayout } from "./array-sequence-layout.js"

const hole = Object.freeze({ value: undefined, present: false })
const empty = span(0)

// A selector can forward a point through arbitrarily many captured commands.
// Keep the remaining projections with this request across any availability wait.
class PointReference {
    constructor(source, index, back, project) {
        this.source = source
        this.index = index
        this.back = back
        this.project = project
    }
}
function pointAt(source, index, back, project) { return new PointReference(source, index, back, project) }
function pointSelection(sequence, selectPoint, ctx) {
    sequence.selectPoint = selectPoint
    sequence.point = (index, back) => read(pointAt(sequence, index, back))
    return sequence

    function read(value, projections) {
        while (value instanceof PointReference) {
            const { source, index, back, project } = value
            if (project) (projections ??= []).push(project)
            value = source.selectPoint ? source.selectPoint(index, back) : source.point(index, back)
        }
        if (isPending(value, ctx)) return continueGraphTransition(value, ctx, p => read(p, projections))
        while (projections?.length) value = projections.pop()(value)
        return value
    }
}

// A selection may become provable before all of its controls settle.
class SelectionQuestions {
    read(prove) {
        const answer = prove()
        if (answer !== undefined) return answer
        const { promise, resolve } = Promise.withResolvers()
        const pending = this.pending ??= new Set()
        const decide = () => {
            const answer = prove()
            if (answer !== undefined) { pending.delete(decide); resolve(answer) }
        }
        pending.add(decide)
        return promise
    }
    changed() { for (const decide of this.pending ?? []) decide() }
}

function refine(sequence, minimum, maximum, active) {
    if (minimum === sequence.minimum && maximum === sequence.maximum) return
    sequence.minimum = minimum
    sequence.maximum = maximum
    const pending = active ?? []
    for (const update of sequence.listeners ?? []) pending.push([update, minimum, maximum])
    if (minimum === maximum) {
        sequence.listeners?.clear()
        sequence.listeners = undefined
    }
    if (!active) drainWidthUpdates(pending)
}
function watch(sequence, update, ctx) {
    if (sequence.minimum === sequence.maximum) return
    if (sequence.widths) return sequence.widths.watch(update)
    if (sequence.watch) return sequence.watch(update)
    const needsLength = !sequence.listeners
    const release = watchBounds.call(sequence, update)
    if (needsLength) followLength(sequence, ctx)
    return release
}

// Projected counts refine their bounds through completion. External length
// sources use the same listeners and add one reaction for the final width.
function watchBounds(update) {
    if (this.minimum === this.maximum) return
    const listeners = this.listeners ??= new Set()
    listeners.add(update)
    return () => listeners.delete(update)
}

// The source's native reaction outlives a removable first subscriber.
function followLength(sequence, ctx) {
    markPromiseHandled(continueGraphTransition(sequence.length, ctx, n => refine(sequence, n, n)), ctx)
}

function inRange(sequence, index, ctx) {
    if (index < sequence.minimum) return true
    if (index >= sequence.maximum) return false
    if (sequence.widths) return widthInRange(sequence.widths, index)
    const { promise, resolve } = Promise.withResolvers()
    let release
    release = watch(sequence, (minimum, maximum) => {
        if (index < minimum || index >= maximum) { release?.(); resolve(index < minimum) }
    }, ctx)
    return promise
}
function fixed(node) {
    return { node, operands: layoutOperands(node), dense: node.dense, minimum: node.length, maximum: node.length, length: node.length, ready: node,
        head: node, tail: node, point(index, back) {
            return index >= node.length ? hole : layoutAt(node, back ? node.length - 1 - index : index) ?? hole
        } }
}

function captureSkippedRange(source, first, end, ctx) {
    if (source.node) return restrict(source.node, first, end)
    if (source.obstructions?.range) return source.obstructions.range(first, end)
    return continueGraphTransition(source.ready, ctx, node => restrict(node, first, end))
}

// Both branches obstruct every actual position, while the exact role, cause
// and hidden value can differ. A position outside the final width is healthy.
function blockedPositions(sequence, ctx) {
    if (sequence.node) return sequence
    const read = pointSelection({}, sequence.selectPoint, ctx).point
    sequence.obstructions = { end: (_first, limit) => limit }
    return pointSelection(sequence, (i, back) => continueGraphTransition(inRange(sequence, i, ctx), ctx,
        exists => exists ? knownObstruction(placementFromSelection(read(i, back), ctx)) : hole), ctx)
}

// A proved skip has a fixed width even when different selectors produce
// different positional causes. Materialize only the marker a point consumer
// requests. Whole consumers map the shared layout when selection finishes.
function markerSequence(source, first, end, ctx) {
    const length = end - first
    let final
    const ready = continueGraphTransition(captureSkippedRange(source, first, end, ctx), ctx, node => {
        source = undefined
        return final = missingOutputMarkers(node, ctx)
    })
    if (final) return fixed(final)
    return { length, minimum: length, maximum: length, head: empty, tail: empty, ready,
        point(index, back) {
            const local = back ? length - 1 - index : index
            if (final) return layoutAt(final, local)
            const placed = source.point(first + local, false)
            const cause = continueGraphTransition(placed, ctx, p => resolvePlacementTransition(p, ctx, structuralFailure))
            return missingOutputMarker(cause, ctx)
        },
        obstructions: {
            end: (_start, limit) => limit,
            range: (start, stop) => final ? restrict(final, start, stop) :
                continueGraphTransition(captureSkippedRange(source, first + start, first + stop, ctx), ctx, node => missingOutputMarkers(node, ctx))
        } }
}

// Compose coordinate changes once. Densifying a skipped slot preserves its
// visible cause, while reversing a run reverses its positional causes.
function forwardSkipRange(output, source, offset, reversed, ctx) {
    let facts = source.obstructions
    if (!facts) return
    if (facts.origin) {
        offset = facts.reversed ? facts.offset - offset : facts.offset + offset
        reversed = facts.reversed !== reversed
        facts = facts.origin
    }
    if (!offset && !reversed) { output.obstructions = facts; return }
    const mapped = output.obstructions = { origin: facts, offset, reversed }
    const startAt = (first, end) => reversed ? offset - end : offset + first
    const endAt = (first, end) => reversed ? offset - first : offset + end
    mapped.end = (first, end) => {
        if (!reversed) return facts.end(offset + first, offset + end) - offset
        const stop = offset - first
        if (facts.end(offset - end, stop) === stop) return end
        while (first < end) {
            const mid = first + Math.ceil((end - first) / 2)
            if (facts.end(offset - mid, stop) === stop) first = mid
            else end = mid - 1
        }
        return first
    }
    if (facts.range) mapped.range = (first, end) => {
        const node = facts.range(startAt(first, end), endAt(first, end))
        return reversed ? continueGraphTransition(node, ctx, reverseLayout) : node
    }
    if (facts.observe) mapped.observe = (first, end, work, inspect, fail) =>
        facts.observe(startAt(first, end), endAt(first, end), work, inspect, fail)
}

// Number of old slots before an output boundary after inserting at cut.
function beforeInsertion(bound, cut, width) { return Math.max(bound - width, Math.min(bound, cut)) }

// Borrowed prefix data stays in storage. Point writes in the open region
// replace numeric slots without changing disjoint occurrence identities.
function captureOrder(owner, ctx) {
    const sequence = ArrayView.region(owner, ctx)?.sequence
    if (!sequence) return
    const start = requireMeta(owner, ctx).arrayRange?.start ?? 0
    const minimum = ArrayView.minimumLength(owner, ctx), maximum = ArrayView.maximumLength(owner, ctx)
    const source = takeSequence(trimmedSequence(sequence, start, 0, ctx), ArrayView.retainedLength(owner, ctx, maximum), false, ctx)
    const prefix = ArrayView.prefixLength(owner, ctx)
    const entries = ownPlacementVersionEntries(owner, ctx).filter(([key]) => Number(key) >= prefix)
    if (!entries.length && minimum === source.minimum && maximum === source.maximum) return source
    // A still-conditional index write can extend the Array independently of
    // the old end. Capture its bounded length questions before handoff.
    const growth = maximum > Math.max(minimum, source.maximum) ||
        entries.length && Number(entries.at(-1)[0]) >= minimum
    const width = (n, first, end) => Math.max(0, Math.min(end, n) - first)
    function extent(first, end) {
        const lo = width(minimum, first, end), hi = width(maximum, first, end)
        if (lo === hi) return lo
        const captured = ArrayView.captureLength(owner, ctx, undefined, end)
        return continueGraphTransition(captured.read ? captured.read() : captured, ctx, n => width(n, first, end))
    }
    let output = fixed(empty), first = 0
    const append = part => { output = concatSequence(output, part, ctx) }
    function gap(end) {
        if (end <= first) return
        const part = takeSequence(trimmedSequence(source, first, 0, ctx), end - first, false, ctx)
        const lo = width(minimum, first, end), hi = width(maximum, first, end)
        append(growth && lo !== hi ? padSequence(part, lo, ctx, hi, extent(first, end)) : padSequence(part, lo, ctx))
    }
    for (let i = 0; i < entries.length;) {
        const index = Number(entries[i][0]), run = new LayoutBuilder()
        gap(index)
        first = index
        do {
            run.append(span(1, capturePlacementFromVersion(entries[i++][1])))
            first++
        } while (i < entries.length && Number(entries[i][0]) === first)
        const node = run.finish(), count = extent(index, first)
        if (typeof count === "number") append(fixed(restrict(node, 0, count)))
        else {
            const kept = width(minimum, index, first)
            append(fixed(restrict(node, 0, kept)))
            append(pendingSequence(count, n => fixed(restrict(node, kept, n)), ctx, 0, node.length - kept))
        }
    }
    gap(maximum)
    owner = undefined
    return output
}

// Growth pads the captured extent with holes. The final width can be known
// before the boundary between original occurrences and padding is known.
function padSequence(source, minimum, ctx, maximum, length) {
    if (length === undefined && source.minimum >= minimum) return source
    if (length === undefined && source.node) return fixed(join(source.node, span(minimum - source.minimum)))
    if (minimum > source.maximum) {
        // Positions past the old maximum have fixed coordinates. A search
        // starting there can match a hole while the old end is still open.
        const prefix = padSequence(source, source.maximum, ctx)
        let extra = fixed(span(minimum - source.maximum))
        if (maximum > minimum) extra = concatSequence(extra,
            pendingSequence(length, n => fixed(span(n - minimum)), ctx, 0, maximum - minimum), ctx)
        return concatSequence(prefix, extra, ctx)
    }
    const size = n => Math.max(n, minimum)
    const extent = length ?? (minimum >= source.maximum ? minimum : continueGraphTransition(source.length, ctx, size))
    const output = { minimum, maximum: maximum ?? size(source.maximum), head: source.head, tail: empty, length: extent,
        ready: continueGraphTransition(source.ready, ctx, node =>
            continueGraphTransition(extent, ctx, n => join(node, span(n - node.length)))),
        point(index, back) {
            const read = i => i < 0 || i >= source.maximum ? hole : source.point(i, false)
            return back ? continueGraphTransition(output.length, ctx, n => read(n - index - 1)) : read(index)
        },
        split() {
            const count = collectInputs([extent, source.length], ctx, ([n, used]) => n - used)
            const padding = pendingSequence(count, n => fixed(span(n)), ctx, 0, output.maximum - source.minimum)
            return [source, padding]
        } }
    watch(source, (lo, hi, pending) => refine(output, Math.max(output.minimum, size(lo)),
        Math.min(output.maximum, maximum ?? size(hi)), pending), ctx)
    return output
}

// A sequence has two independent questions: its extent and a selected
// placement. Both ends can be used before the absolute coordinates are known.
function captureSequence(array, ctx, { limit = MAX_COUNT, keepExtent = false, omitStart = 0, omitEnd = 0, inspect } = {}) {
    // Borrowed storage and discarded inputs both keep their width without a
    // descriptor read. Only the consumer knows which source range it needs.
    const capture = (array, first, end) => {
        const from = Math.max(first, omitStart), to = Math.min(end, omitEnd)
        if (from >= to) return captureLayout(array, ctx, end, first, end, inspect)
        return join(join(captureLayout(array, ctx, end, first, from, inspect), span(to - from)),
            captureLayout(array, ctx, end, to, end, inspect))
    }
    const region = ArrayView.region(array, ctx)
    const minimum = ArrayView.minimumLength(array, ctx), maximum = ArrayView.maximumLength(array, ctx)
    const preserve = keepExtent && limit < maximum
    if (!limit && (!preserve || minimum === maximum)) return fixed(span(preserve ? minimum : 0))
    if (region?.placements && !ArrayView.hasPendingLength(array, ctx)) {
        const prefix = capture(array, 0, Math.min(limit, minimum))
        return fixed(preserve ? join(prefix, span(maximum - limit)) : prefix)
    }
    const order = captureOrder(array, ctx)
    if (order) {
        const prefix = ArrayView.prefixLength(array, ctx)
        let source = order
        if (prefix && (omitStart !== 0 || omitEnd < prefix)) {
            const node = capture(array, 0, Math.min(limit, prefix))
            source = limit <= prefix ? fixed(node) : replacePrefix(order, node, ctx)
        }
        const kept = takeSequence(source, limit, false, ctx)
        return preserve ? padToExtent(kept, limit, sequenceExtent(order, ctx), ctx) : kept
    }
    const low = Math.min(limit, minimum), high = Math.min(limit, maximum)
    const extent = preserve || low !== high ? ArrayView.captureExtent(array, ctx, preserve ? MAX_COUNT : limit) : undefined
    const kept = low === high && (!limit || !region?.pending) ? fixed(capture(array, 0, low)) :
        captureOpenSequence(array, ctx, extent ? projectedCount(extent, 0, ctx, 0, limit) : fixedWidth(low), region, capture, (array, index) =>
            index >= omitStart && index < omitEnd ? hole : readArrayPlacement(array, index, ctx, inspect))
    return preserve ? padToExtent(kept, limit, extent, ctx) : kept
}

function padToExtent(prefix, limit, extent, ctx) {
    const tail = projectedCount(extent, -limit, ctx)
    return concatSequence(prefix, extentHoles(tail, ctx), ctx)
}

// Borrowing keeps the leftmost fixed contribution in backing storage. Only a
// consumer that needs its data rebuilds that spine, retaining each enclosing
// command's own overflow projection and its already-ordered right operand.
function replacePrefix(order, node, ctx) {
    const path = []
    let part = order
    while (part.capacityInput || part.parts && part.parts[0].minimum >= node.length) {
        path.push(part)
        part = part.capacityInput ?? part.parts[0]
    }
    let output = part.node ? fixed(join(node, restrict(part.node, node.length, part.node.length))) :
        concatSequence(fixed(node), trimmedSequence(part, node.length, 0, ctx), ctx)
    while (path.length) {
        const parent = path.pop()
        output = parent.capacityInput ? capacitySequence(output, ctx, parent.capacityCause) :
            concatSequence(output, parent.parts[1], ctx)
    }
    return output
}

function captureOpenSequence(array, ctx, extent, region, capture, read) {
    const { length, minimum } = extent, end = Math.min(minimum, region?.start ?? minimum)
    const head = capture(array, 0, end)
    const lease = createLeaseLedger(ctx)
    lease.acquire(array)
    const ready = collectInputs([length, region?.settlement], ctx, ([count]) => {
        try { return join(head, capture(array, head.length, count)) }
        finally { lease.release(); array = undefined }
    })
    const sequence = { length, ready, head, tail: empty, point(index, back) {
        if (!back && index < head.length) return layoutAt(head, index) ?? hole
        if (array && !back && index < minimum) return read(array, index)
        return continueGraphTransition(ready, ctx, node => fixed(node).point(index, back))
    } }
    useExtent(sequence, extent)
    return sequence
}

function useExtent(output, widths) {
    output.widths = widths
    Object.defineProperties(output, {
        minimum: { configurable: true, get: () => widths.minimum },
        maximum: { configurable: true, get: () => widths.maximum },
    })
}

function concatSequence(left, right, ctx, trackPrefix) {
    if (left.minimum === MAX_COUNT) return left
    if (left.node && right.node) return fixed(join(left.node, right.node))
    if (!left.maximum) return right
    if (!right.maximum) return left
    if (left.parts?.[1].node && right.node)
        return concatSequence(left.parts[0], fixed(join(left.parts[1].node, right.node)), ctx, trackPrefix)
    if (left.node && right.parts?.[0].node && !right.cappedEnd)
        return concatSequence(fixed(join(left.node, right.parts[0].node)), right.parts[1], ctx, trackPrefix)
    const minimum = sumWidths(left.minimum, right.minimum), maximum = sumWidths(left.maximum, right.maximum)
    const clips = right.maximum > MAX_COUNT - left.maximum
    let endQuestion
    function endAtCap() {
        if (right.maximum <= MAX_COUNT - left.maximum) return false
        if (right.minimum >= MAX_COUNT - left.minimum) return true
    }
    const widths = minimum === maximum ? fixedWidth(minimum) :
        sumExtent(sequenceExtent(left, ctx), sequenceExtent(right, ctx), ctx, trackPrefix)
    const output = { minimum, maximum, length: widths.length, parts: [left, right], operands: combineOperands(left.operands, right.operands), dense: left.dense && right.dense,
        head: left.node ? join(left.node, right.head) : left.head,
        tail: clips ? empty : right.node ? join(left.tail, right.node) : right.tail }
    deriveSequenceLayout(output, left, right, undefined, ctx)
    pointSelection(output, (index, back) => sequencePoint(output, index, back, ctx), ctx)
    if (clips) output.cappedEnd = () => {
        const known = endAtCap()
        if (known !== undefined) return known
        if (!endQuestion) {
            endQuestion = Promise.withResolvers()
            if (output.widths) {
                const a = watch(left, update, ctx), b = watch(right, update, ctx)
                endQuestion.release = () => { a?.(); b?.() }
            }
        }
        return endQuestion.promise
    }
    function update(_lo, _hi, pending) {
        if (endQuestion) {
            const end = endAtCap()
            if (end !== undefined) { endQuestion.release?.(); endQuestion.resolve(end); endQuestion = undefined }
        }
    }
    useExtent(output, widths)
    return output
}

// A chain of concat commands can be deep even when its final Array has one
// element. Walk determined joins directly and resume at the undecided one.
function sequencePoint(part, index, back, ctx, loss) {
    while (part.parts || part.capacityInput) {
        if (index >= part.maximum) return hole
        if (part.capacityInput) {
            const input = part.capacityInput
            if (back ? input.maximum - 1 - index >= MAX_ARRAY_LENGTH : index >= MAX_ARRAY_LENGTH) {
                const virtual = !back || inRange(input, MAX_ARRAY_LENGTH + index, ctx)
                if (typeof virtual !== "boolean")
                    return continueGraphTransition(virtual, ctx, () => sequencePoint(part, index, back, ctx, loss))
                if (index >= input.minimum)
                    return continueGraphTransition(inRange(input, index, ctx), ctx, present =>
                        present ? sequencePoint(part, index, back, ctx, loss) : hole)
                // An inner loss is earlier. A permanent marker at the leaf
                // keeps its original cause even when several commands clip it.
                if (virtual) loss = part.capacityCause
            }
            part = input
            continue
        }
        if (back && part.cappedEnd) {
            const capped = part.cappedEnd()
            if (typeof capped !== "boolean") return continueGraphTransition(capped, ctx, () => sequencePoint(part, index, back, ctx, loss))
            if (capped) { index = MAX_COUNT - 1 - index; back = false }
        }
        const first = part.parts[back ? 1 : 0], next = part.parts[back ? 0 : 1]
        if (index < first.minimum) {
            part = first
        } else if (index >= first.maximum) {
            if (first.minimum !== first.maximum)
                return continueGraphTransition(first.length, ctx, n => sequencePoint(next, index - n, back, ctx, loss))
            index -= first.minimum
            part = next
        } else {
            return continueGraphTransition(inRange(first, index, ctx), ctx, () => sequencePoint(part, index, back, ctx, loss))
        }
    }
    return pointAt(part, index, back, loss && (p => capacityPlacement(p, loss, ctx)))
}

function reversedSequence(source, ctx, dense = false) { return mappedSequence(source, true, dense, ctx) }
function denseSequence(source, ctx) { return mappedSequence(source, false, true, ctx) }

function denseCapturedPoint(point, ctx) {
    return { placement: continueGraphTransition(point.placement, ctx, p => densePlacement(p, ctx)), release: point.release }
}

// Reversal and making holes present commute. Compose them once, stopping
// at each command that can discard data or change an occurrence's status.
function mappedSequence(source, reversed, dense, ctx) {
    if (source.dense) dense = false
    if (!reversed && !dense) return source
    if (reversed && !dense && source.mirror) return source.mirror
    if (source.mappedInput && !source.capacityInput) {
        reversed = reversed !== source.reversed
        dense ||= source.dense
        source = source.mappedInput
    }
    if (!reversed && !dense) return source
    const map = node => {
        if (reversed) node = reverseLayout(node)
        return dense ? denseLayout(node, ctx) : node
    }
    if (source.node) return fixed(map(source.node))
    if (reversed && source.parts && !source.cappedEnd && !source.capacityInput) {
        const key = dense ? "denseMirror" : "mirror"
        if (source[key]) return source[key]
        const todo = [source]
        while (todo.length) {
            const part = todo[todo.length - 1]
            const [left, right] = part.parts
            const pending = [left, right].find(p => p.parts && !p.cappedEnd && !p.capacityInput && !p[key])
            if (pending) { todo.push(pending); continue }
            const mirror = p => p[key] ?? mappedSequence(p, true, dense, ctx)
            const result = part[key] = concatSequence(mirror(right), mirror(left), ctx)
            if (!dense) result.mirror = part
            todo.pop()
        }
        return source[key]
    }
    const output = { minimum: source.minimum, maximum: source.maximum, length: source.length,
        mappedInput: source, reversed, dense, head: map(reversed ? source.tail : source.head),
        tail: map(reversed ? source.head : source.tail), awaitSelection: source.awaitSelection }
    deriveSequenceLayout(output, source, undefined, map, ctx)
    pointSelection(output, (index, back) => pointAt(source, index, back !== reversed,
        dense && (p => densePlacement(p, ctx))), ctx)
    if (source.capturePoint) output.capturePoint = (index, back) => {
        const point = source.capturePoint(index, back !== reversed)
        return point && dense ? denseCapturedPoint(point, ctx) : point
    }
    if (!reversed || source.minimum === source.maximum)
        forwardSkipRange(output, source, reversed ? source.minimum : 0, reversed, ctx)
    if (source.parts || source.split) output.split = () => {
        const parts = splitSequence(source, ctx)
        return parts && [mappedSequence(parts[reversed ? 1 : 0], reversed, dense, ctx),
            mappedSequence(parts[reversed ? 0 : 1], reversed, dense, ctx)]
    }
    if (!source.capacityInput && "origins" in source) {
        let mapped
        Object.defineProperty(output, "origins", { get() {
            if (mapped) return mapped
            const { source: old, added, cut, backCut, context } = source.origins
            return mapped = { source: mappedSequence(old, reversed, dense, ctx), added: map(added),
                cut: reversed ? backCut : cut, backCut: reversed ? cut : backCut, context }
        } })
    }
    if ("current" in source) {
        let mapped
        Object.defineProperty(output, "current", { get() {
            const child = source.current
            return child && (mapped ??= mappedSequence(child, reversed, dense, ctx))
        } })
    }
    useExtent(output, sequenceExtent(source, ctx))
    return output
}

function trimmedSequence(source, first, last, ctx) {
    if (!first && !last) return source
    if (first && last) return trimmedSequence(trimmedSequence(source, first, 0, ctx), 0, last, ctx)
    const back = Boolean(last)
    let count = first || last, rest, result
    // Push a determined cut into the join while its boundary is known.
    // Keep only the narrow, moving fringe when the cut crosses a fixed run.
    const pair = (near, far) => back ? concatSequence(far, near, ctx) : concatSequence(near, far, ctx)
    for (;;) {
        if (count >= source.maximum) { result = fixed(empty); break }
        // Decided choices can form a history-sized spine. Only a pending
        // choice needs a new projection to follow its eventual child.
        const current = source.restrictChoice && source.current
        if (current) { source = current; continue }
        if (!source.parts || source.cappedEnd) {
            if (source.capacityInput || source.cappedEnd) source = omitClippedEdge(source, count, back, ctx)
            result = cropWithSplit(source, count, back, ctx)
            break
        }
        const near = source.parts[back ? 1 : 0], far = source.parts[back ? 0 : 1]
        if (count <= near.minimum) { (rest ??= []).push(far); source = near; continue }
        if (near.minimum === near.maximum) { count -= near.minimum; source = far; continue }
        if (far.node) {
            const n = far.maximum, cut = count
            const low = Math.min(n, Math.max(0, cut - near.maximum))
            const high = Math.min(n, cut - near.minimum)
            const common = back ? restrict(far.node, 0, n - high) : restrict(far.node, high, n)
            if (common.length) (rest ??= []).push(fixed(common))
            source = near
            if (low === high) continue
            const fringe = back ? restrict(far.node, n - high, n - low) : restrict(far.node, low, high)
            const kept = projectedCount(sequenceExtent(near, ctx), high - cut, ctx, 0, high - low)
            ;(rest ??= []).push(growingRange(fringe, back, kept, 0, ctx))
            continue
        }
        result = cropWithSplit(source, count, back, ctx)
        break
    }
    while (rest?.length) result = pair(result, rest.pop())
    return result
}

// Truncation and capacity markers belong to the original command's coordinates.
// Preserve those widths while dropping data that cannot survive the crop.
// At the back, truncation can only remove more of the right operand's tail.
function omitClippedEdge(source, count, back, ctx) {
    const path = [], side = back ? 1 : 0
    let part = source, result
    for (;;) {
        if (count >= part.maximum) {
            result = holesWithExtent(part, ctx)
            break
        }
        if (part.capacityInput) {
            path.push({ parent: part })
            part = part.capacityInput
        } else if (part.parts) {
            const near = part.parts[side], far = part.parts[1 - side]
            if (count > near.maximum) {
                // All of near is excluded. Its width can still decide where
                // the original join reached the cap.
                const omitted = holesWithExtent(near, ctx)
                path.push({ parent: part, side: 1 - side, other: omitted })
                count -= near.maximum
                part = far
            } else {
                path.push({ parent: part, side, other: far })
                part = near
            }
        } else {
            result = part
            if (part.node) {
                const n = part.node.length
                result = fixed(back ? join(restrict(part.node, 0, n - count), span(count)) :
                    join(span(count), restrict(part.node, count, n)))
            }
            break
        }
    }
    while (path.length) {
        const { parent, side, other } = path.pop()
        if (parent.capacityInput) {
            result = result === parent.capacityInput ? parent : capacitySequence(result, ctx, parent.capacityCause)
        } else if (result === parent.parts[side] && other === parent.parts[1 - side]) result = parent
        else result = side ? concatSequence(other, result, ctx) : concatSequence(result, other, ctx)
    }
    return result
}

function holesWithExtent(part, ctx) {
    return extentHoles(sequenceExtent(part, ctx), ctx)
}

function extentHoles(size, ctx) {
    if (size.minimum === size.maximum) return fixed(span(size.minimum))
    const known = span(size.minimum)
    const result = { length: size.length, head: known, tail: known, point: () => hole,
        ready: continueGraphTransition(size.length, ctx, span) }
    useExtent(result, size)
    return result
}

function sequenceExtent(source, ctx) {
    if (source.widths) return source.widths
    if (source.coordinateExtent) return source.coordinateExtent
    const count = source.coordinateExtent = LinkedWidth.pending(source.minimum, source.maximum, ctx)
    if (count.minimum !== count.maximum) watch(source, (lo, hi, active) => count.narrow(lo, hi, active), ctx)
    return count
}

// The selected slots are a subset of the source. Their numeric bounds can
// narrow before the choice, independently of any retained data.
function selectedExtent(input, select, source, ctx, minimum = 0) {
    if (!isPending(input, ctx)) return select(input, ctx)
    const size = LinkedWidth.pending(minimum, source.maximum, ctx)
    const release = watch(source, (_, hi, active) => size.narrow(minimum, hi, active), ctx)
    markPromiseHandled(continueGraphTransition(input, ctx, choice => {
        release?.()
        size.select(projectedCount(select(choice, ctx), 0, ctx, size.minimum, size.maximum))
    }), ctx)
    return size
}

// A cut across a fixed run exposes its slots progressively from one edge.
// Split the retained coordinates in halves so each completed portion can
// settle, including for a reader issued before the first slot was proved.
function growingRange(node, fromHead, extent, offset, ctx) {
    const length = node.length
    const count = projectedCount(extent, -offset, ctx, 0, length)
    const pick = n => fromHead ? restrict(node, 0, n) : restrict(node, length - n, length)
    if (count.minimum === count.maximum) return fixed(pick(count.minimum))
    const part = { length: count.length }
    useExtent(part, count)
    let final
    Object.defineProperties(part, {
        current: { get: () => count.minimum === count.maximum ? final ??= fixed(pick(count.minimum)) : undefined },
        head: { get: () => fromHead ? pick(part.minimum) : empty },
        tail: { get: () => fromHead ? empty : pick(part.minimum) },
    })
    deriveSequenceLayout(part, fixed(node), undefined, () => part.current.node, ctx, valueSignal(count.length, ctx))
    part.point = (index, back) => {
        if (index >= part.maximum) return hole
        if (back !== fromHead) return continueGraphTransition(inRange(part, index, ctx), ctx,
            present => present ? layoutAt(node, fromHead ? index : length - 1 - index) ?? hole : hole)
        return continueGraphTransition(part.current?.node ?? part.ready, ctx, selected =>
            index < selected.length ? layoutAt(selected, back ? selected.length - 1 - index : index) ?? hole : hole)
    }
    part.split = () => {
        if (!part.minimum || length < 2) return
        const mid = Math.floor(length / 2)
        return [growingRange(restrict(node, 0, mid), fromHead, extent, offset + (fromHead ? 0 : length - mid), ctx),
            growingRange(restrict(node, mid, length), fromHead, extent, offset + (fromHead ? mid : 0), ctx)]
    }
    return part
}

function cropWithSplit(source, count, back, ctx) {
    const output = cropSequence(source, back ? 0 : count, back ? count : 0, ctx)
    if (!output.node && (source.parts || source.split)) {
        output.split = () => {
            const parts = splitSequence(source, ctx)
            if (!parts) return
            const [near, far] = back ? [parts[1], parts[0]] : parts
            const trim = (part, n) => trimmedSequence(part, back ? 0 : n, back ? n : 0, ctx)
            const pair = (a, b) => back ? [b, a] : [a, b]
            if (count <= near.minimum) return pair(trim(near, count), far)
            const spill = count - near.minimum
            if (spill >= far.maximum) return
            if (near.minimum === near.maximum) return pair(fixed(empty), trim(far, spill))
            const fringe = takeSequence(far, spill, back, ctx)
            // Only this fringe can cross the cut as the near side grows.
            const uncertain = back ? concatSequence(fringe, near, ctx) : concatSequence(near, fringe, ctx)
            return pair(trim(uncertain, count), trim(far, spill))
        }
    }
    return output
}

function cropSequence(source, first, last, ctx) {
    const size = dropWidth(first + last)
    const crop = node => restrict(node, first, node.length - last)
    if (source.node) return fixed(crop(source.node))
    const minimum = size(source.minimum), maximum = size(source.maximum)
    if (!maximum) return fixed(empty)
    if (source.mappedInput && !source.capacityInput) {
        const child = trimmedSequence(source.mappedInput, source.reversed ? last : first, source.reversed ? first : last, ctx)
        return mappedSequence(child, source.reversed, source.dense, ctx)
    }
    const extent = projectedCount(sequenceExtent(source, ctx), -(first + last), ctx)
    const selected = source.restrictChoice?.(extent, child => trimmedSequence(child, first, last, ctx))
    if (selected) return selected
    const output = { minimum, maximum, length: extent.length }
    output.head = restrict(source.head, Math.min(first, source.head.length), Math.min(source.head.length, first + minimum))
    output.tail = restrict(source.tail, Math.max(0, source.tail.length - last - minimum), Math.max(0, source.tail.length - last))
    deriveSequenceLayout(output, source, undefined, crop, ctx)
    pointSelection(output, (index, back) => {
        if (index < output.minimum || !(back ? first : last)) return pointAt(source, index + (back ? last : first), back)
        return continueGraphTransition(source.length, ctx, n =>
            index < size(n) ? pointAt(source, index + (back ? last : first), back) : hole)
    }, ctx)
    forwardSkipRange(output, source, first, false, ctx)
    useExtent(output, extent)
    return output
}

function takeSequence(source, count, back, ctx) {
    let pieces, result
    for (;;) {
        if (!count) { result = fixed(empty); break }
        if (count >= source.maximum) { result = source; break }
        if (!back && count <= MAX_ARRAY_LENGTH && source.capacityInput) { source = source.capacityInput; continue }
        const edge = back ? source.tail : source.head
        if (edge.length >= count) {
            result = fixed(back ? restrict(edge, edge.length - count, edge.length) : restrict(edge, 0, count))
            break
        }
        const current = (!back || source.restrictChoice) && source.current
        if (current && (source.restrictChoice || count <= current.minimum)) { source = current; continue }
        if (source.parts && !(back && source.cappedEnd)) {
            const side = back ? 1 : 0, first = source.parts[side]
            if (count <= first.minimum) { source = first; continue }
            if (first.minimum === first.maximum) {
                ;(pieces ??= []).push(first)
                count -= first.minimum
                source = source.parts[1 - side]
                continue
            }
        }
        // Even when the requested endpoint crosses an open operand, the
        // minimum width proves a range at the opposite end unreachable.
        const excluded = source.minimum - count
        if (excluded > 0 && (source.parts || source.capacityInput)) {
            source = trimmedSequence(source, back ? excluded : 0, back ? 0 : excluded, ctx)
            continue
        }
        result = boundedSequence(source, count, back, ctx)
        if (source.parts || source.split) result.split = () => {
            const parts = !back && source.parts || splitSequence(source, ctx)
            return parts && splitBounded(parts, count, back, ctx)
        }
        break
    }
    while (pieces?.length) {
        const part = pieces.pop()
        result = back ? concatSequence(result, part, ctx) : concatSequence(part, result, ctx)
    }
    return result
}

function boundedSequence(source, count, back, ctx) {
    const crop = node => back ? restrict(node, Math.max(0, node.length - count), node.length) :
        restrict(node, 0, Math.min(node.length, count))
    const edge = back ? source.tail : source.head
    if (edge.length >= count) return fixed(crop(edge))
    if (source.mappedInput && !source.capacityInput)
        return mappedSequence(takeSequence(source.mappedInput, count, back !== source.reversed, ctx), source.reversed, source.dense, ctx)
    const size = limitWidth(count), minimum = size(source.minimum)
    const extent = projectedCount(sequenceExtent(source, ctx), 0, ctx, 0, count)
    const selected = source.restrictChoice?.(extent, child => takeSequence(child, count, back, ctx))
    if (selected) return selected
    const output = { minimum, maximum: size(source.maximum), length: extent.length }
    output.head = back ? empty : edge
    output.tail = back ? edge : empty
    deriveSequenceLayout(output, source, undefined, crop, ctx)
    pointSelection(output, (index, fromEnd) => {
        if (index >= count) return hole
        if (fromEnd === back) return pointAt(source, index, back)
        return continueGraphTransition(output.minimum === count ? count : output.length, ctx, length =>
            index < length ? pointAt(source, length - 1 - index, back) : hole)
    }, ctx)
    if (!back || source.minimum === source.maximum)
        forwardSkipRange(output, source, back ? Math.max(0, source.minimum - count) : 0, false, ctx)
    useExtent(output, extent)
    return output
}

const dropWidth = amount => n => Math.max(0, n - amount)
const limitWidth = limit => n => Math.min(n, limit)

// A plain join stores its operands. Other mappings expose two disjoint,
// ordered contributions on demand. Their widths can depend on the same cut.
function splitSequence(source, ctx) {
    // A cut from the back consumes the retained K positions, even if the
    // original join would have placed additional occurrences beyond K.
    if (source.parts && !source.cappedEnd) return source.parts
    // A successful split represents this entire captured sequence, including
    // its pending remainder. Readers share the derived views and subscriptions.
    return source.partition ??= source.cappedEnd && source.parts ? splitBounded(source.parts, MAX_COUNT, false, ctx) :
        source.split?.()
}

function splitBounded(parts, count, back, ctx) {
    const [near, far] = back ? [parts[1], parts[0]] : parts
    const room = Math.max(0, count - near.maximum)
    const kept = takeSequence(near, count, back, ctx)
    if (count <= near.minimum) return back ? [fixed(empty), kept] : [kept, fixed(empty)]
    if (far.maximum <= room) return back ? [far, kept] : [kept, far]
    const common = takeSequence(far, room, back, ctx)
    const fringe = trimmedSequence(far, back ? 0 : room, back ? room : 0, ctx)
    const rest = pendingSequence(near.length, n => takeSequence(fringe, Math.max(0, count - n - room), back, ctx),
        ctx, 0, Math.min(fringe.maximum, Math.max(0, count - near.minimum - room)))
    return back ? [concatSequence(rest, common, ctx), kept] : [kept, concatSequence(common, rest, ctx)]
}

function publishLayout(node, ctx) { return publishSequence(fixed(node), ctx) }

// Physical slots and injective selections of them can share every retained
// payload between copies. Duplication and structural selections continue to
// use the general counted layout. No payload gates publication of a sibling.
function publishFixedCopy(node, ctx) {
    if (!node.fixedPresence) return publishLayout(node, ctx)
    const delivery = fixedPayloads(node, ctx)
    if (!delivery?.remaining) return closedLayout(resolvedFixedLayout(node), ctx, true)
    const { region, output } = ArrayRegion.open(fixed(node), empty, ctx)
    region.fixedCoordinates = true
    region.attachFixed(node, true)
    return output
}

// A captured layout can outlive its owner. Protect each distinct producer
// or managed child once, even when a run repeats it at many positions.
function retainLayout(node, ctx) {
    return retainOperands(layoutOperands(node), ctx) ?? noRelease
}

const noRelease = () => {}

// Keep the width and forward result even when the backing has no remaining
// destination. An outstanding point or range read owns its publication.
class SequencePublication {
    constructor(region, prefixLength, compact) {
        this.region = region
        this.shape = region.shape
        this.prefixLength = prefixLength
        this.compact = compact
    }
    refine = (lo, hi) => {
        if (this.region) this.region.refine(lo, hi)
        else this.shape?.refine(lo, hi)
    }
    finishForward = () => {
        this.forwardReady = true
        if (this.region) return this.attach(this.region)
    }
    finish = node => {
        this.unwatch?.()
        this.unwatch = undefined
        const prefix = this.prefixLength
        this.node = prefix ? join(span(prefix), restrict(node, prefix, node.length)) : node
        if (this.region) return this.attach(this.region)
        this.shape?.complete(node.length)
        this.shape = undefined
    }
    attach(region) {
        // Reactivation can select a ready child synchronously while the
        // original aggregate notification is still queued.
        if (!this.region && !this.forwardReady && region.sequence.layoutSource) {
            const available = readSequenceLayout(region.sequence.layoutSource, true)
            if (available) { this.region = region; return this.finish(available) }
        }
        if (this.forwardReady) {
            this.forwardReady = false
            this.region = region
            return this.finish(readSequenceLayout(region.sequence.layoutSource))
        }
        if (!this.node) {
            if (!this.region) region.refine(region.sequence.minimum, region.sequence.maximum)
            this.region = region
            return
        }
        const node = this.node
        this.node = this.region = this.shape = region.publication = undefined
        return this.compact ? region.publish(node) : region.finishLayout(node)
    }
}

function publishSequence(sequence, ctx, releaseInputs, borrowed) {
    let compact
    if (sequence.node && !borrowed) {
        compact = compactLayout(sequence.node, ctx)
        if (!isPending(compact, ctx)) {
            try { return closedLayout(compact, ctx) } finally { releaseInputs?.() }
        }
    }
    let releaseLayout
    try {
        // A repeated unfinished producer stays in the open region. Point
        // selection can already read it without publishing it at every key.
        const sharedHead = !compact && sequence.head.stored && individualFixedSlots(sequence.head, ctx)
        const head = compact ? empty : sharedHead ? sequence.head : compactLayout(sequence.head, ctx, true)
        const prefix = borrowed ? join(span(borrowed.range.length),
            restrict(head, Math.min(head.length, borrowed.range.length), head.length)) : head
        let operands = combineOperands(sequence.operands, layoutOperands(sequence.tail))
        if (borrowed || head.length < sequence.head.length) operands = combineOperands(operands, layoutOperands(sequence.head))
        const { region, output } = ArrayRegion.open(sequence, prefix, ctx, borrowed, sharedHead)
        releaseLayout = retainOperands(operands, ctx, region.producers.backing)
        if (releaseLayout) {
            region.preservation = { operands, release: releaseLayout }
            region.updatePreservationReaders()
        }
        const receipt = region.publication = new SequencePublication(region, region.start, Boolean(compact))
        if (region.shape) receipt.unwatch = watch(sequence, receipt.refine, ctx)
        if (compact) region.placements = sequence.node
        // This destination already retained its selections and can retire.
        // Independent readers use sequence.ready, which requests each choice
        // through its own completion even if the last destination retires.
        const publication = !compact && sequence.layoutSource ?
            continueGraphTransition(sequence.layoutSource.signal?.pending, ctx, receipt.finishForward) :
            continueGraphTransition(compact ?? sequence.ready, ctx, receipt.finish)
        if (region.pending) region.settlement = publication
        markPromiseHandled(releaseInputs ? continueGraphTransition(publication, ctx, releaseInputs) : publication, ctx)
        return output
    } catch (failure) { releaseLayout?.(); releaseInputs?.(); throw failure }
}

// A width observer can outlive every holder. Only a data consumer follows
// the choice into its operands to find the selected layout or point.
function selectedSequence(operands, extent, choice, select, ctx, blocked = false) {
    if (!choice.pending) return select(choice.value)
    const output = { length: extent.length, head: empty, tail: empty,
        awaitSelection: choice.watch ??= selectionReceipt(choice.pending, ctx),
        get current() { return current() } }
    const current = selectSequenceLayout(output, operands, choice, select, ctx)
    // A cropped consumer depends on the chosen child's cropped layout. Its
    // excluded suffix need never settle, even if selection follows issuance.
    output.restrictChoice = (extent, project) => selectedSequence(output.operands, extent, choice,
        () => project(current()), ctx, blocked)
    pointSelection(output, (index, back) => {
        const child = current()
        return child ? pointAt(child, index, back) : continueGraphTransition(choice.pending, ctx, () => pointAt(current(), index, back))
    }, ctx)
    useExtent(output, extent)
    return blocked ? blockedPositions(output, ctx) : output
}

function pendingSequence(input, select, ctx, minimum = 0, maximum = MAX_COUNT, openForRead, operands) {
    if (!isPending(input, ctx)) return select(input)
    operands ??= new SelectedOperands()
    let chosen
    const part = continueGraphTransition(input, ctx, value => {
        if (!chosen) choose(select(value))
        select = openForRead = undefined
        return chosen
    })
    function current() {
        if (openForRead) {
            choose(openForRead())
            select = openForRead = undefined
        }
        return chosen
    }
    function choose(child) {
        chosen = child
        operands.select(child.operands, ctx)
    }
    const extent = LinkedWidth.pending(minimum, maximum, ctx)
    if (minimum !== maximum) markPromiseHandled(continueGraphTransition(part, ctx, child =>
        extent.select(projectedCount(sequenceExtent(child, ctx), 0, ctx, minimum, maximum))), ctx)
    const output = { operands, head: empty, tail: empty, length: extent.length,
        ready: continueGraphTransition(part, ctx, child => child.ready),
        widthFailure: continueGraphTransition(part, ctx, child => child.widthFailure) }
    pointSelection(output, (index, back) => {
        const child = current()
        return child ? pointAt(child, index, back) : continueGraphTransition(part, ctx, child => pointAt(child, index, back))
    }, ctx)
    // Copying bounds or projecting capacity does not inspect the interior.
    Object.defineProperty(output, "current", { get: current })
    output.awaitSelection = selectionReceipt(part, ctx)
    useExtent(output, extent)
    return output
}

function obstructedSequence(source, cause, ctx) {
    const placement = structuralPlacement(cause)
    if (source.minimum === source.maximum) return fixed(span(source.minimum, placement))
    source = sequenceExtent(source, ctx)
    const output = { minimum: source.minimum, maximum: source.maximum, length: source.length,
        head: span(source.minimum, placement), tail: span(source.minimum, placement),
        ready: continueGraphTransition(source.length, ctx, n => span(n, placement)),
        point: index => continueGraphTransition(inRange(source, index, ctx), ctx, present => present ? placement : hole) }
    watch(source, (lo, hi, pending) => refine(output, lo, hi, pending), ctx)
    return output
}

function valueSignal(input, ctx) {
    const signal = {}
    signal.pending = continueGraphTransition(input, ctx, value => { signal.value = value; signal.pending = undefined })
    return signal
}

function afterFailedWidth(sequence, failure, ctx, blocked = false) {
    if (!failure) return sequence
    let output
    if (isPending(failure, ctx)) {
        const decision = valueSignal(failure, ctx)
        let selected
        const current = () => !decision.pending && (selected ??= afterFailedWidth(sequence, decision.value, ctx))
        output = { length: sequence.length, head: empty, tail: empty, status: failure,
            awaitSelection: selectionReceipt(failure, ctx), get current() { return current() } }
        if (sequence.widthFailure) {
            const widthFailure = sequence.widthFailure
            output.widthFailure = continueGraphTransition(failure, ctx, cause => cause ? undefined : widthFailure)
        }
        pointSelection(output, (index, back) => continueGraphTransition(decision.pending, ctx,
            () => pointAt(current(), index, back)), ctx)
        deriveSequenceLayout(output, sequence, undefined, node => decision.value ? flagPositions(node, decision.value, ctx) : node, ctx, decision)
        useExtent(output, sequenceExtent(sequence, ctx))
        return blocked ? blockedPositions(output, ctx) : output
    } else {
        const flag = node => flagPositions(node, failure, ctx)
        const ready = continueGraphTransition(sequence.ready, ctx, flag)
        if (!isPending(ready, ctx)) return fixed(ready)
        output = { minimum: sequence.minimum, maximum: sequence.maximum, length: sequence.length, operands: sequence.operands,
            head: flag(sequence.head), tail: flag(sequence.tail), ready, status: ready }
        pointSelection(output, (index, back) => pointAt(sequence, index, back, p => flag(span(1, p)).placement), ctx)
        // Every selected position fails. An any-match search can collect the
        // compact causes together while it compares independent contributions.
        markPromiseHandled(continueGraphTransition(ready, ctx, node => {
            output.current = fixed(node)
            output.status = undefined
        }), ctx)
    }
    watch(sequence, (lo, hi, pending) => refine(output, lo, hi, pending), ctx)
    return output
}

function combineWidthFailures(left, right, ctx) {
    return left && right ? collectInputs([left, right], ctx, ([a, b]) =>
        a && b ? combineErrors([a, b]) : a ?? b) : left ?? right
}

function appendContribution(output, part, sequential, ctx) {
    const joined = concatSequence(output, sequential ? afterFailedWidth(part, output.widthFailure, ctx) : part, ctx)
    if ((output.widthFailure || part.widthFailure) && joined !== output && joined !== part)
        joined.widthFailure = combineWidthFailures(output.widthFailure, part.widthFailure, ctx)
    return joined
}

// Concat flags later operands only for a failed argument root of this call.
// Previously published Arrays contribute their actual slots and flags.
function joinContributions(inputs, asSequence, sequential, ctx, operands) {
    const parts = inputs.map((input, i) => pendingSequence(input, asSequence, ctx, 0, MAX_COUNT, undefined, operands?.[i]))
    const failures = sequential && inputs.length > 1 && inputs.map(input =>
        continueGraphTransition(input, ctx, value => isPoisonError(value) ? value : undefined))
    for (let width = 1; width < parts.length; width *= 2) {
        for (let i = 0; i + width < parts.length; i += 2 * width) {
            let right = parts[i + width]
            if (failures) {
                right = afterFailedWidth(right, failures[i], ctx)
                if (i + width * 2 < parts.length) failures[i] = combineWidthFailures(failures[i], failures[i + width], ctx)
            }
            parts[i] = concatSequence(parts[i], right, ctx)
            parts[i + width] = undefined
        }
    }
    return parts[0] ?? fixed(empty)
}

function hasUnmarkedRange(sequence, ctx) {
    return continueGraphTransition(inRange(sequence, 0, ctx), ctx, present => present &&
        continueGraphTransition(sequence.ready, ctx, node => hasUnmarkedPlacement(node, ctx)))
}

function displacedRange(source, width, ctx) {
    return takeSequence(trimmedSequence(source, MAX_ARRAY_LENGTH - width, 0, ctx), width, false, ctx)
}

function capacitySequence(input, ctx, cause) {
    if (input.capacityInput || input.maximum <= MAX_ARRAY_LENGTH) return input
    cause ??= capacityCause(ctx)
    const project = node => projectCapacity(node, ctx, false, cause).node
    if (input.node) return fixed(project(input.node))
    const output = { length: input.length, dense: input.dense, widthFailure: input.widthFailure,
        capacityInput: input, capacityCause: cause, head: project(input.head), tail: empty,
        obstructions: {
            end: (first, limit) => first >= MAX_ARRAY_LENGTH ? limit : first,
            observe: (_first, end, _work, _inspect, fail) => { if (end > MAX_ARRAY_LENGTH) fail() }
        },
        split: () => [takeSequence(input, MAX_ARRAY_LENGTH, false, ctx), cropSequence(output, MAX_ARRAY_LENGTH, 0, ctx)] }
    deriveSequenceLayout(output, input, undefined, project, ctx)
    pointSelection(output, (index, back) => sequencePoint(output, index, back, ctx), ctx)
    if (input.capturePoint) output.capturePoint = (index, back) => {
        if (!back && index < MAX_ARRAY_LENGTH) return input.capturePoint(index, false)
    }
    useExtent(output, sequenceExtent(input, ctx))
    return output
}

export { pointAt, pointSelection, selectionReceipt, captureSequence, captureOrder, fixed, splitSequence, captureSkippedRange, forwardSkipRange, markerSequence, concatSequence, reversedSequence, trimmedSequence, publishLayout, publishFixedCopy, publishSequence, retainLayout, refine, watch, watchBounds, sequenceExtent, holesWithExtent, valueSignal, SelectionQuestions, beforeInsertion,
    takeSequence, boundedSequence, denseSequence, pendingSequence, selectedSequence, appendContribution, joinContributions, capacitySequence, displacedRange, hasUnmarkedRange, inRange, afterFailedWidth, obstructedSequence, useExtent, selectedExtent }
