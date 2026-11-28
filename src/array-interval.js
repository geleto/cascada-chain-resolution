import { anyPresent, capacityCause, capacityError, captureLayout, join, matchingLength, MAX_ARRAY_LENGTH, overlappingFailures, possibleWrites, projectCapacity, restrict, skippedLength, span, structuralPlacement, replaceLayoutRange } from "./array-layout.js"
import { capacitySequence, concatSequence, captureOrder, captureSequence, fixed, forwardSkipRange, inRange, obstructedSequence, pointAt, pointSelection, publishLayout, publishSequence, useExtent,
    selectedSequence, SelectionQuestions, sequenceExtent, edgeWindow, layoutPoint, layoutWindow, takeSequence, projectEdge, pendingSequence, dropSequence, valueSignal, watch } from "./array-sequence.js"
import { ArrayView } from "./array-view.js"
import { LinkedWidth } from "./array-width.js"
import { retainOperands } from "./array-sequence-layout.js"
import { CHAIN_MODE } from "./chain.js"
import { combineErrors, isPoisonError } from "./error.js"
import { collectInputs, continueGraphTransition, decideInputs } from "./internal-step.js"
import { isPending } from "./language-values.js"
import { OperationOwner, releaseOnClose } from "./operation-lifecycle.js"
import { createLeaseLedger } from "./ownership.js"
import { arrayInput, createRangeOutput, createRemap, sliceOutput } from "./array-remap.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import { knownObstruction, placementFromSelection, placementPresent, resolvePlacementPresence } from "./property-versions.js"
import { readLanguagePlacement } from "./language-properties.js"
import { supplyErrorEvidence } from "./error-evidence.js"
import { checkArrayCapacity, numericInput, runArrayStep } from "./array-methods.js"

const hole = Object.freeze({ present: false, value: undefined })
const empty = span(0)

function broadRange(width, receiver, length, ctx) {
    return width > 64 && width > Math.min(length, ArrayView.storedIndexes(receiver, ctx)) / 4
}

// A determined interval carries the destination and the corresponding
// predecessor range. All storage paths consume this same clipped count.
const emptyRange = { at: 0, first: 0, count: 0 }
function intervalRange(method, length, target, first, end, payload) {
    const at = method === "copyWithin" ? target : first
    return { at, first, count: Math.max(0, Math.min(end - first, length - at)), payload }
}

function overwriteLayout(read, length, { at, first, count, payload }, writes, ctx) {
    const replacement = payload ? span(count, payload) : read(first, first + count)
    return { node: replaceLayoutRange(read, length, at, count, replacement),
        writes: writes && (payload ? count > 0 : possibleWrites([replacement, read(at, at + count)], ctx)) }
}

function rangeBounds(values, length) {
    const low = n => typeof n === "number" ? n : 0
    const high = n => typeof n === "number" ? n : length
    return { t: low(values[0]), T: high(values[0]), s: low(values[1]), S: high(values[1]),
        e: low(values[2]), E: high(values[2]) }
}

function canSelect({ t, T, s, S, E }, length, copying) {
    if (s >= E) return false
    if (!copying) return true
    const lastStart = Math.min(S, E - 1), lastTarget = Math.min(T, length - 1)
    return t <= lastTarget && !(t === lastTarget && s === lastStart && s === t)
}

function normalizeIndex(value, length) {
    return typeof value !== "number" ? value : value < 0 ? Math.max(0, length + value) : Math.min(length, value)
}

// Between clamp knees and crossings, the ordering of the normalized
// coordinates is fixed. Equal starts suppress a copy, so test both sides.
function lengthSamples(values, minimum, maximum) {
    const samples = new Set([minimum, maximum])
    if (minimum === maximum) return samples
    const around = point => {
        for (const n of [point - 1, point, point + 1]) if (n > minimum && n < maximum) samples.add(n)
    }
    for (const value of values) if (Number.isFinite(value)) {
        around(Math.abs(value))
        if (value < 0) for (const other of values)
            if (typeof other === "number" && other >= 0) around(other - value)
    }
    // The last copied destination is min(length, target + end - start).
    // Its only interior maximum is where a falling reach meets length:
    // target and end are fixed while start advances from the far end.
    const [target, start, end] = values
    if (Number.isFinite(target) && target >= 0 && Number.isFinite(start) && start < 0 && Number.isFinite(end) && end >= 0)
        around(Math.floor(target / 2 + end / 2 - start / 2))
    return samples
}

// Slice dimensions depend on normalized controls and the input count alone.
// The last layout owner can leave while a length question keeps this alive.
function sliceExtent(selection, source, ctx) {
    const extent = LinkedWidth.pending(selection.sliceMinimum, selection.sliceMaximum, ctx)
    if (extent.minimum === extent.maximum) return extent
    const unwatch = selection.observeExtent(source)
    selection.updateBounds = active => {
        extent.narrow(selection.sliceMinimum, selection.sliceMaximum, active)
        if (extent.minimum === extent.maximum) {
            unwatch?.()
            selection.updateBounds = undefined
        }
    }
    return extent
}

// In the chosen direction the first available bound is the end of the
// retained window. The remaining start still refers to the original width.
function selectedSlice(selection, source, shape, extent, ctx) {
    if (selection.empty) return fixed(empty)
    if (selection.failure) return obstructedSequence(extent, selection.failure, ctx)
    const [, start, end] = selection.values
    const failed = selection.controls?.failed || isPoisonError(start) || isPoisonError(end)
    if (failed || start === undefined && end === undefined) {
        if (failed) source = undefined
        return selectedSequence(source?.operands, extent, sliceChange(selection, !failed, ctx),
            () => selectedSlice(selection, source, shape, extent, ctx), ctx)
    }
    const reverse = end === undefined
    const opposite = index => index === 0 ? Infinity : -index
    const stop = reverse ? opposite(start) : end
    const candidate = stop < 0 ? dropSequence(source, -stop, !reverse, ctx) : takeSequence(source, stop, reverse, ctx)
    // A cut from one end may also contain a fixed run known from the other.
    // Save only the part guaranteed to survive this bound, at its old offset.
    const stable = reverse ? source.head : source.tail
    const base = Math.max(0, shape.maximum - stop)
    const common = stop > 0 && stop < shape.maximum && base < stable.length ?
        layoutWindow(stable, base, stable.length, !reverse) : empty
    source = undefined
    const select = () => {
        if (selection.empty) return fixed(empty)
        if (selection.failure) return obstructedSequence(extent, selection.failure, ctx)
        const from = reverse ? opposite(selection.values[2]) : selection.values[1]
        if (from >= 0) return dropSequence(candidate, from, reverse, ctx)
        if (stop < 0) return takeSequence(candidate, Math.max(0, stop - from), !reverse, ctx)
        if (-from >= shape.maximum) return candidate
        if (stop >= shape.maximum) return takeSequence(candidate, -from, !reverse, ctx)
        const used = -from - base
        const edge = used > 0 && used <= common.length ? layoutWindow(common, 0, used, !reverse) : empty
        return intersectSlice(candidate, shape, extent, from, stop, reverse, edge, ctx)
    }
    if (selection.done) return select()
    return selectedSequence(candidate.operands, extent, sliceChange(selection, false, ctx), select, ctx)
}

// A length-only reader can retain this signal after every data owner leaves.
function sliceChange(selection, first, ctx) {
    return valueSignal(selection.read(() => selection.done || first && (selection.controls?.failed ||
        selection.values[1] !== undefined || selection.values[2] !== undefined) || undefined), ctx)
}

function sliceCoordinates(extent, length, start, end, ctx) {
    return valueSignal(decideInputs([extent.length, length], ctx, ([width, count]) => {
        if (width === 0) return [0, 0]
        if (!isPending(count, ctx)) return [normalizeIndex(start, count), normalizeIndex(end, count)]
    }), ctx)
}

// Opposing anchors can meet inside the source's possible length range.
// Keep the possible source interval and its independently captured shape.
function intersectSlice(source, shape, extent, start, end, reverse, edge, ctx) {
    const base = normalizeIndex(start, shape.minimum)
    let candidate = dropSequence(source, base, reverse, ctx)
    const coordinates = sliceCoordinates(extent, shape.length, start, end, ctx)
    const selected = selectedSequence(candidate.operands, extent, coordinates, ([first, last]) => {
        const result = edgeWindow(candidate, first - base, last - base, reverse, ctx)
        candidate = undefined
        return result
    }, ctx)
    if (coordinates.pending) {
        selected[reverse ? "tail" : "head"] = edge
        const point = selected.selectPoint
        pointSelection(selected, (index, back) => {
            if (reverse === back && index < edge.length) return layoutPoint(edge, index, back)
            if (!candidate || !coordinates.pending) return point(index, back)
            const first = normalizeIndex(start, shape.minimum), high = normalizeIndex(start, shape.maximum)
            const last = normalizeIndex(end, shape.minimum), endHigh = normalizeIndex(end, shape.maximum)
            const fromEnd = back !== reverse
            if (index < last - high && (fromEnd ? last === endHigh : first === high))
                return pointAt(candidate, (fromEnd ? last - 1 - index : first + index) - base, reverse)
            return point(index, back)
        }, ctx)
    }
    return selected
}

// Possible source indexes for one destination. All sums stay below the
// captured length, even when the logical Array has Number.MAX_SAFE_INTEGER slots.
function copiedIndexes(i, { t, T, s, S, E }) {
    const nearest = Math.min(T, i)
    if (t > nearest || i - nearest >= E - s) return
    const cap = E - 1, base = Math.min(S, cap)
    return [s + (i - nearest), base + Math.min(i - t, cap - base)]
}

function copyReach(bounds, length) {
    return bounds.T + Math.min(length - bounds.T, Math.max(0, bounds.E - bounds.s))
}

// Source bounds for consecutive destinations are monotone. Stop before the
// first destination which could select a body from outside the skipped run.
function copySkipEnd(node, bounds, first, limit) {
    const end = first + skippedLength(node, first, limit)
    if (!canSelect(bounds, node.length, true)) return end
    const start = Math.max(first, bounds.t)
    const reach = copyReach(bounds, node.length)
    const stop = Math.min(end, reach)
    if (start >= stop) return end
    const low = copiedIndexes(start, bounds)[0], last = copiedIndexes(stop - 1, bounds)[1]
    const boundary = low + skippedLength(node, low, last + 1)
    if (boundary > last) return end
    return firstIndex(start, stop, i => copiedIndexes(i, bounds)[1] >= boundary)
}

function firstIndex(first, end, matches) {
    while (first < end) {
        const middle = first + Math.floor((end - first) / 2)
        if (matches(middle)) end = middle
        else first = middle + 1
    }
    return first
}

// A Boolean failure query needs one failed destination anywhere in its
// capture. At fixed length each unresolved raw index spans the full domain.
// An open target fixes the lower source bound, an open start fixes the upper
// bound, and two known starts give a single translated source at each point.
function hasCopyFailure(node, bounds, first, end) {
    const old = restrict(node, first, end)
    if (!old.poison) return false
    const [low, high] = copiedIndexes(first, bounds), [lastLow, lastHigh] = copiedIndexes(end - 1, bounds)
    if (low === lastLow) {
        const stop = low + matchingLength(node, low, lastHigh + 1, part => part.poison)
        const until = firstIndex(first, end, i => copiedIndexes(i, bounds)[1] >= stop)
        return restrict(old, 0, until - first).poison > 0
    }
    if (high === lastHigh) {
        const start = high + 1 - matchingLength(node, low, high + 1, part => part.poison, true)
        const from = firstIndex(first, end, i => copiedIndexes(i, bounds)[0] >= start)
        return restrict(old, from - first, old.length).poison > 0
    }
    return overlappingFailures(old, restrict(node, low, lastHigh + 1))
}

// A failed control permits keeping the old position. A distinct possible
// source matters if either position is occupied. Clean holes need no selector.
function uncertainCopy(source, bounds, marker, ctx) {
    const length = source.length
    const last = copyReach(bounds, length)
    if (last <= bounds.t) return source
    const visit = (node, first) => {
        const end = first + node.length
        const low = copiedIndexes(first, bounds), high = copiedIndexes(end - 1, bounds)
        // Both bounds relative to their destination are nonincreasing.
        if (low[1] === first && high[0] === end - 1) return node
        const relevant = restrict(source, low[0], high[1] + 1)
        if (!node.stored && !node.covered && !relevant.stored && !relevant.covered) return node
        if (low[0] < first || high[1] > end - 1) {
            if (node.covered === node.length || relevant.covered === relevant.length ||
                !node.left && possibleWrites([node], ctx) === true ||
                high[0] <= low[1] && possibleWrites([restrict(source, high[0], low[1] + 1)], ctx) === true)
                return span(node.length, marker)
            if (node.length === 1 || !node.left && !relevant.left) {
                const selected = continueGraphTransition(possibleWrites([node, relevant], ctx), ctx, found => found ? marker : hole)
                return span(node.length, placementFromSelection(selected, ctx))
            }
        }
        const middle = node.left?.length ?? Math.floor(node.length / 2)
        return join(visit(restrict(node, 0, middle), first), visit(restrict(node, middle, node.length), first + middle))
    }
    return join(join(restrict(source, 0, bounds.t), visit(restrict(source, bounds.t, last), bounds.t)),
        restrict(source, last, length))
}

class IntervalSelection extends SelectionQuestions {
    constructor(method, minimum, maximum, ctx) {
        super()
        this.method = method
        this.minimum = minimum
        this.maximum = maximum
        this.ctx = ctx
        this.values = []
        this.indexes = method === "copyWithin" ? [0, 1, 2] : [1, 2]
    }

    bounds(length) {
        return rangeBounds(this.values.map(value => normalizeIndex(value, length)), length)
    }

    extent(minimum, maximum, active) {
        this.minimum = minimum
        this.maximum = maximum
        this.consider(active)
    }

    observeExtent(source) {
        return watch(source, (lo, hi, active) => this.extent(lo, hi, active))
    }

    observeUnchanged(work, query) {
        let prefix = 0, suffix = Infinity, seenLength = 0
        const check = () => {
            if (!query.open || !work.receiver) return
            const minimum = this.minimum
            if (minimum > MAX_ARRAY_LENGTH) return query.found()
            let first = minimum, end = 0
            const copy = this.method === "copyWithin"
            for (const n of lengthSamples(this.values, minimum, this.maximum)) {
                const b = this.bounds(n)
                if (!canSelect(b, n, copy)) continue
                first = Math.min(first, copy ? b.t : b.s)
                end = Math.max(end, copy ? copyReach(b, n) : b.E)
            }
            end = Math.max(first, Math.min(end, minimum))
            // Range exclusion grows as controls and length become known.
            const visitNew = (lo, hi) => {
                query.inspectArrayRange(work.receiver, Math.max(lo, prefix), Math.min(hi, suffix, seenLength))
                query.inspectArrayRange(work.receiver, Math.max(lo, seenLength), hi)
            }
            visitNew(0, first)
            visitNew(end, minimum)
            prefix = first
            suffix = end
            seenLength = minimum
        }
        check()
        if (!query.open || this.done) return
        const questions = this.pending ??= new Set()
        const update = () => { check(); if (this.done) questions.delete(update) }
        questions.add(update)
        releaseOnClose(query, () => questions.delete(update))
    }

    arguments(length, payload) {
        const [target, start, end] = this.values.map(value => normalizeIndex(value, length))
        return intervalRange(this.method, length, target, start, end, payload)
    }

    consider(active) {
        this.empty = true
        let low = Infinity, high = 0, fallback = Infinity, guaranteed = true
        for (const length of lengthSamples(this.values, this.minimum, this.maximum)) {
            const b = this.bounds(length)
            const possible = canSelect(b, length, this.method === "copyWithin")
            if (possible) this.empty = false
            if (b.e <= b.S) guaranteed = false
            low = Math.min(low, Math.max(0, b.e - b.S))
            const width = Math.max(0, b.E - b.s)
            if (this.method === "slice") fallback = Math.min(fallback, width)
            high = Math.max(high, width)
        }
        this.done = this.empty || this.indexes.every(i => this.values[i] !== undefined)
        this.guaranteed = guaranteed
        const failures = this.done && !this.empty && this.values.filter(isPoisonError)
        this.failure = failures?.length ? this.failure ?? combineErrors(failures) : undefined
        this.sliceMinimum = this.failure ? fallback : low
        this.sliceMaximum = high
        this.settlePayload()
        if (this.done && this.controls) {
            this.controls.close()
            this.controls = undefined
        }
        this.updateBounds?.(active)
        this.changed()
    }

    settlePayload(published = false) {
        if (this.empty || this.controls?.failed || this.values.some(isPoisonError)) {
            this.payload = undefined
            this.payloadInput?.close()
        } else if (published) this.payloadInput?.release()
        else return
        this.payloadInput = undefined
    }

    publish(work, finish, reportWrites) {
        const { ctx, method } = this
        const receiver = work.receiver
        const slice = method === "slice"
        if (this.empty && work.mutation) { reportWrites(false); return finish() }
        if (this.empty && slice) return finish(publishSequence(fixed(empty), ctx))
        const [, start, end] = this.values
        const failedSlice = slice && (this.controls?.failed || this.values.some(isPoisonError))
        // A symbolic source keeps its end anchor. A fixed capture can omit
        // the excluded physical suffix before inspecting any of its slots.
        const absoluteEnd = slice && typeof end === "number" && (end >= 0 ||
            this.minimum === this.maximum && !ArrayView.region(receiver, ctx)?.sequence)
        const limit = failedSlice ? 0 : absoluteEnd ? normalizeIndex(end, this.maximum) : undefined
        const keepExtent = failedSlice || limit !== undefined && (end < 0 || !(typeof start === "number" && start >= 0))
        const low = this.bounds(this.minimum)
        const omitStart = method === "fill" ? this.bounds(this.maximum).S : 0
        const omitEnd = slice ? low.s : method === "fill" ? low.e : 0
        const source = captureSequence(receiver, ctx, { limit, keepExtent, omitStart, omitEnd })
        if (slice) return this.publishSlice(source, work, finish)
        const complete = work.mode === CHAIN_MODE.Complete
        if (complete && (!this.done || this.failure)) {
            // A failed control belongs to the complete root only if the
            // eventual extent actually permits that operation.
            const release = !this.done && this.observeExtent(source)
            if (release) releaseOnClose(this.controls, release)
            const done = this.read(() => this.done || undefined)
            return continueGraphTransition(done, ctx, () => this.failure ? continueGraphTransition(source.length, ctx, n =>
                canSelect(this.bounds(n), n, method === "copyWithin") ? this.failure : finishEmpty()) :
                this.publishSelected(source, work, finish, reportWrites))
        }
        return this.publishSelected(source, work, finish, reportWrites)

        function finishEmpty() {
            if (work.mutation) { reportWrites(false); return finish() }
            return finish(publishSequence(source, ctx))
        }
    }

    publishSlice(source, work, finish) {
        const ctx = this.ctx
        const complete = work.mode === CHAIN_MODE.Complete
        const shape = sequenceExtent(source)
        const extent = sliceExtent(this, shape, ctx)
        const sequence = selectedSlice(this, source, shape, extent, ctx)
        const output = () => finish(publishSequence(capacitySequence(sequence, ctx), ctx))
        if (!complete) return output()
        const done = this.read(() => this.done || undefined)
        const valid = continueGraphTransition(done, ctx, () => this.failure ?
            continueGraphTransition(inRange(extent, 0), ctx, present => present ? this.failure : undefined) :
            continueGraphTransition(inRange(extent, MAX_ARRAY_LENGTH), ctx, over => over ? capacityError(ctx) : undefined))
        // Until whole-Array validation completes, the result itself owns its
        // remaining candidate placements. Transfer them before dropping that use.
        const release = isPending(valid, ctx) && retainOperands(sequence.operands, ctx)
        return continueGraphTransition(valid, ctx, failure => {
            try { return failure ?? output() }
            finally { if (release) release() }
        })
    }

    publishSelected(source, work, finish, reportWrites) {
        const { ctx, method } = this
        const fill = method === "fill", complete = work.mode === CHAIN_MODE.Complete
        if (this.empty && work.mutation) { reportWrites(false); return finish() }
        const done = this.read(() => this.done || undefined)
        const safe = source.maximum <= MAX_ARRAY_LENGTH
        const leases = createLeaseLedger(ctx), receiver = work.receiver
        leases.acquire(receiver)
        const unwatch = this.observeExtent(source)
        const release = () => { unwatch?.(); leases.release(); this.settlePayload(true) }
        const initial = this.bounds(source.minimum)
        let wrote = false, lost, settled
        const cause = capacityCause(ctx)
        const project = node => {
            const extent = node.length, b = this.bounds(extent), marker = this.failure && structuralPlacement(this.failure)
            if (!canSelect(b, extent, !fill)) return node
            let mapped
            if (marker && !fill) {
                mapped = uncertainCopy(node, b, marker, ctx)
                const reach = copyReach(b, extent)
                wrote = possibleWrites([restrict(node, b.t, reach), restrict(node, b.s, b.E)], ctx)
            } else {
                const range = intervalRange(method, extent, b.t, b.s, b.E, marker ?? this.payload)
                const edit = overwriteLayout((lo, hi) => restrict(node, lo, hi), extent, range, true, ctx)
                mapped = edit.node
                wrote = edit.writes
            }
            const projected = projectCapacity(mapped, ctx, false, cause)
            lost = projected.failure
            return projected.node
        }
        let captured = source.node
        const sourceReady = !fill && !captured ? continueGraphTransition(source.ready, ctx, node => {
            captured = node
            this.changed()
            return node
        }) : source.ready
        const ready = collectInputs([done, sourceReady], ctx, ([, node]) => {
            settled = project(node)
            this.changed()
            this.updateBounds = undefined
            return settled
        })
        const point = (index, back) => {
            let question
            const select = proveSkip => {
                if (settled) return fixed(settled).point(index, back)
                const lo = source.minimum, hi = source.maximum
                if (index >= hi) return hole
                const min = this.bounds(lo), max = this.bounds(hi)
                const b = {}
                for (const key of ["t", "T", "s", "S", "e", "E"]) {
                    const lower = key === key.toLowerCase()
                    b[key] = back ? (lower ? max[key] - hi : min[key] - lo) : lower ? min[key] : max[key]
                }
                const i = back ? -1 - index : index
                const at = (j, fromEnd = back) => proveSkip ? pointAt(source, fromEnd ? -1 - j : j, fromEnd) :
                    source.point(fromEnd ? -1 - j : j, fromEnd)
                const admitted = read => index < lo ? read() : continueGraphTransition(inRange(source, index), ctx,
                    member => member ? read() : hole)
                if (fill) {
                    if (i < b.s || i >= b.E || this.empty) return at(i)
                    if (b.S <= i && i < b.e) return admitted(() => this.payload)
                } else {
                    const range = copiedIndexes(i, b)
                    if (!range || range[0] === i && range[1] === i || this.empty) return at(i)
                    if (b.T <= i && i - b.t < b.e - b.S && range[0] === range[1]) return admitted(() => at(range[0]))
                    const node = captured ?? (back ? source.tail : source.head)
                    const base = back ? node.length : 0, old = base + i
                    const first = base + range[0], end = base + range[1] + 1
                    if (old >= 0 && old < node.length && first >= 0 && end <= node.length) {
                        if (question?.first !== first || question.end !== end || question.old !== old) {
                            const alternatives = [restrict(node, old, old + 1), restrict(node, first, end)]
                            const present = possibleWrites(alternatives, ctx)
                            const check = question = { old, first, end, present,
                                skipped: alternatives.every(part => part.skipped === part.length) }
                            if (isPending(present, ctx)) markPromiseHandled(continueGraphTransition(present, ctx, answer => {
                                check.present = answer
                                if (question === check) this.changed()
                            }), ctx)
                        }
                        if (question.present === false) return hole
                        if (this.failure && lo === hi && question.present === true) return structuralPlacement(this.failure)
                        if (proveSkip && index < lo && question.skipped) {
                            // Every admissible source and the unmoved destination are
                            // blocked. Reuse this point question for cause and repair.
                            return knownObstruction(placementFromSelection(this.read(() => select(false)), ctx))
                        }
                    }
                }
            }
            return this.read(() => select(true))
        }
        let seq
        if (isPending(ready, ctx)) {
            const head = restrict(source.head, 0, Math.min(source.head.length, fill ? initial.s : initial.t))
            seq = useExtent({ head, tail: empty, ready }, sequenceExtent(source))
            pointSelection(seq, point, ctx)
            if (!fill) {
                const facts = seq.obstructions = {
                    end: (first, limit) => settled ? first + skippedLength(settled, first, limit) :
                        captured ? copySkipEnd(captured, this.bounds(captured.length), first, limit) : first
                }
                facts.range = (first, end) => this.read(() => {
                    if (settled) return restrict(settled, first, end)
                    if (!captured) return
                    const n = captured.length, b = this.bounds(n), from = Math.max(first, b.t)
                    const stop = Math.min(end, copyReach(b, n))
                    if (from >= stop || !canSelect(b, n, true) ||
                        copiedIndexes(from, b)[1] === from && copiedIndexes(stop - 1, b)[0] === stop - 1)
                        return restrict(captured, first, end)
                })
                // Numeric controls can expose unchanged data without changing
                // the width. Wake an earlier graph query at the same transition.
                facts.observe = (first, end, work, inspect, fail) => {
                    const check = () => {
                        if (!work.open || !captured || settled) return
                        const b = this.bounds(captured.length)
                        const from = Math.max(first, b.t), stop = Math.min(end, copyReach(b, captured.length))
                        if (from >= stop || !canSelect(b, captured.length, true)) { inspect(captured, first, end); return }
                        inspect(captured, first, from)
                        if (work.open) inspect(captured, stop, end)
                        if (!work.open) return
                        // Both relative source bounds decrease across destinations.
                        // They coincide at the destination throughout any self-only run.
                        const self = firstIndex(from, stop, i => copiedIndexes(i, b)[1] <= i)
                        const after = firstIndex(self, stop, i => copiedIndexes(i, b)[0] < i)
                        if (self < after) inspect(captured, self, after)
                        if (work.open && hasCopyFailure(captured, b, from, stop)) fail()
                    }
                    check()
                    if (!work.open || settled) return
                    const questions = this.pending ??= new Set()
                    const update = () => { if (settled) questions.delete(update); else check() }
                    questions.add(update)
                    return () => questions.delete(update)
                }
            }
            const selectionSequence = seq
            if (source.node?.fixedPresence &&
                !this.values.some(isPoisonError) && this.indexes.filter(i => this.values[i] === undefined).length === 1) {
                // With one unknown bound a failed control distinguishes the
                // undecided destinations. Every other clean run is already
                // the original data. Keep one receipt per contiguous gap.
                let partition
                Object.defineProperty(selectionSequence, "current", { get: () => {
                    if (settled) return fixed(settled)
                    if (partition) return partition
                    const unknown = { value: undefined, present: true }, input = source.node, b = this.bounds(input.length)
                    const layout = fill ? join(join(restrict(input, 0, b.s), span(b.E - b.s, unknown)),
                        restrict(input, b.E, input.length)) : uncertainCopy(input, b, unknown, ctx)
                    const affected = new WeakMap()
                    function changes(node) {
                        if (!node.left) return node.placement === unknown
                        if (!affected.has(node)) affected.set(node, changes(node.left) || changes(node.right))
                        return affected.get(node)
                    }
                    function split(node, offset) {
                        if (!changes(node)) return fixed(node)
                        if (!node.left) return undecided(restrict(input, offset, offset + node.length), offset)
                        return concatSequence(split(node.left, offset), split(node.right, offset + node.left.length), ctx)
                    }
                    function undecided(old, offset) {
                        // A blocked destination can still prove a skip before
                        // the control settles. Keep its point and skip proofs;
                        // adjacent healthy holes wait on one captured choice.
                        if (!fill && old.skipped && old.skipped !== old.length)
                            return concatSequence(undecided(old.left, offset),
                                undecided(old.right, offset + old.left.length), ctx)
                        const part = pendingSequence(ready, result => fixed(restrict(result, offset, offset + old.length)),
                            ctx, old.length, old.length)
                        if (!fill && old.skipped) {
                            delete part.awaitSelection
                            pointSelection(part, (index, back) => pointAt(selectionSequence,
                                offset + (back ? old.length - 1 - index : index), false), ctx)
                            forwardSkipRange(part, selectionSequence, offset, false, ctx)
                        }
                        return part
                    }
                    return partition = split(layout, 0)
                } })
            }
            const reach = (b, n) => fill ? b.E : copyReach(b, n)
            const samples = lengthSamples(this.values, source.minimum, source.maximum)
            let last = 0, suffix = source.tail.length, fillFirst = 0, fillEnd = source.minimum
            for (const n of samples) {
                const bounds = this.bounds(n), end = reach(bounds, n)
                last = Math.max(last, end)
                suffix = Math.min(suffix, n - end)
                fillFirst = Math.max(fillFirst, bounds.S)
                fillEnd = Math.min(fillEnd, bounds.e)
            }
            seq.tail = restrict(source.tail, source.tail.length - suffix, source.tail.length)
            if (last < source.maximum) {
                const split = () => [projectEdge(selectionSequence, last, false, true, ctx), dropSequence(source, last, false, ctx)]
                if (last <= source.minimum) seq = concatSequence(...split(), ctx)
                else seq.split = split
            }
            // The proved fill interval has one captured placement regardless
            // of the unresolved source layout. A slice can take any subrange
            // of this run without inspecting or waiting on either neighbour.
            if (fill && this.payload && fillFirst < fillEnd) {
                const before = takeSequence(seq, fillFirst, false, ctx)
                const after = dropSequence(seq, fillEnd, false, ctx)
                seq = concatSequence(concatSequence(before, fixed(span(fillEnd - fillFirst, this.payload)), ctx), after, ctx)
            }
        } else seq = fixed(ready)
        const selection = this
        if (complete && seq.maximum > MAX_ARRAY_LENGTH) {
            return continueGraphTransition(inRange(seq, MAX_ARRAY_LENGTH), ctx, over => {
                if (!over) return completeOutput()
                return continueGraphTransition(work.mutation ? requiredWrites() : true, ctx, writes => {
                    release()
                    if (!writes) { reportWrites(false); return finish() }
                    return capacityError(ctx)
                })
            })
        }
        return completeOutput()
        function requiredWrites() {
            return fill && (safe || complete) ? selection.read(() => selection.empty ? false : selection.guaranteed ? true :
                selection.done ? continueGraphTransition(source.length, ctx, n => canSelect(selection.bounds(n), n, false)) : undefined) :
                continueGraphTransition(ready, ctx, () => wrote)
        }
        function completeOutput() {
            const output = publishSequence(complete ? seq : capacitySequence(seq, ctx, cause), ctx, release)
            if (!work.mutation) return finish(output)
            const writes = requiredWrites()
            if (writes === false) { reportWrites(false); return finish() }
            reportWrites(writes)
            const direct = continueGraphTransition(writes, ctx, effective => {
                const failed = effective ? selection.failure : undefined
                return continueGraphTransition(lost, ctx, loss => failed && loss ? combineErrors([failed, loss]) : failed ?? loss)
            })
            return finish(output, undefined, direct)
        }
    }
}

// An unused control may never deliver. Its continuation keeps only this
// conversion owner after a different bound proves the range empty.
function readBound(raw, index, controls) {
    const ctx = controls.operationContext
    const input = numericInput(raw, controls)
    markPromiseHandled(continueGraphTransition(input, ctx, value => {
        const selection = controls.selection
        selection.values[index] = value ?? (index === 2 ? Infinity : 0)
        selection.consider()
    }, undefined, controls), ctx)
}
function prepareInterval(work) {
    const ctx = work.operationContext, method = work.method
    let args = work.args
    const minimum = work.arrayLength ?? ArrayView.minimumLength(work.receiver, ctx)
    const maximum = work.arrayLength ?? ArrayView.maximumLength(work.receiver, ctx)
    if (minimum === maximum) work.arrayLength = minimum
    const selection = new IntervalSelection(method, minimum, maximum, ctx), controls = new OperationOwner(ctx)
    selection.controls = controls
    controls.selection = selection
    controls.release = function () { this.selection = this.preparationFailed = undefined }
    // Once conversion fails, the only successful Complete slice is empty.
    // Its captured exact shape suffices while diagnostics finish collecting.
    const preparedReceiver = Boolean(work.receiverCapture)
    if (method === "slice") controls.preparationFailed = preparedReceiver ? () => work.preparationFailed() : function () {
        this.failed = true
        this.selection.changed()
    }
    if (method === "fill") controls.preparationFailed = function () {
        this.failed = true
        this.selection.settlePayload()
    }
    const argIndex = index => method === "slice" ? index - 1 : index
    const primitive = index => { const value = args[argIndex(index)]; return value === null ||
        typeof value !== "object" && typeof value !== "function" }
    const order = [...selection.indexes.filter(primitive), ...selection.indexes.filter(i => !primitive(i))]
    selection.consider()
    for (const index of order) {
        if (selection.done) break
        readBound(work.takeArgument(argIndex(index), args), index, controls)
    }
    if (selection.empty) {
        for (let i = 0; i < args.length; i++) work.discardArgument(i)
        args = undefined
        return minimum !== maximum ? selection : emptyRange
    }
    if (selection.failure && minimum === maximum && work.mode === CHAIN_MODE.Complete) {
        work.preparationFailed()
        return selection.failure
    }
    const filling = method === "fill"
    const usesPayload = filling && !controls.failed && !selection.values.some(isPoisonError)
    const payload = usesPayload ? arrayInput(work.prepareArgument(0, args), ctx) : undefined
    if (filling && !usesPayload) work.discardArgument(0)
    args = undefined
    if (selection.done && !selection.failure && minimum === maximum)
        return selection.arguments(minimum, payload)
    if (selection.done && !selection.failure) {
        const [target, start, end] = selection.values, width = end - start
        const prefix = ArrayView.prefixLength(work.receiver, ctx)
        if (start >= 0 && end <= prefix && width >= 0 &&
            (method === "slice" || !broadRange(width, work.receiver, minimum, ctx) &&
                (method !== "copyWithin" || target >= 0 && target + width <= prefix))) {
            const selected = selection.arguments(minimum, payload)
            if (method === "slice" || work.mode !== CHAIN_MODE.Complete || maximum <= MAX_ARRAY_LENGTH) return selected
            if (method === "fill" || !work.mutation) return checkArrayCapacity(MAX_ARRAY_LENGTH, work, () => selected)
            // Even on an oversized receiver a copy between two hole ranges
            // is a no-op. Only those two ranges can prescribe a write.
            return ArrayView.resolveInRange(work.receiver, MAX_ARRAY_LENGTH, work, over => !over ? selected : runArrayStep(work, () => {
                const read = first => captureLayout(work.receiver, ctx, minimum, first, first + width)
                const writes = possibleWrites([read(start), read(target)], ctx)
                return continueGraphTransition(writes, ctx, effective => effective ? capacityError(ctx) : emptyRange)
            }))
        }
    }
    if (usesPayload) {
        // A partial result owns its input after the invocation hands it out.
        // Fixed Complete ranges finish control preparation inside the call.
        selection.payloadInput = work.argumentInput(0, work.mode !== CHAIN_MODE.Complete || minimum !== maximum)
        selection.payload = payload
        selection.settlePayload()
    }
    if (work.mode === CHAIN_MODE.Complete && !selection.done && (method !== "slice" || preparedReceiver)) {
        if (method !== "slice" && !preparedReceiver)
            supplyErrorEvidence(work.resultEvidence, query => selection.observeUnchanged(work, query))
        if (minimum !== maximum) {
            const sequence = captureOrder(work.receiver, ctx)
            if (sequence) {
                const release = selection.observeExtent(sequence)
                if (release) releaseOnClose(controls, release)
            }
            else markPromiseHandled(ArrayView.resolveLength(work.receiver, controls, n => selection.extent(n, n)), ctx)
        }
        return selection.read(() => {
            if (!selection.done) return
            if (selection.minimum !== selection.maximum) return selection
            work.arrayLength = selection.minimum
            if (selection.empty) return emptyRange
            if (selection.failure) { work.preparationFailed(); return selection.failure }
            return minimum === maximum ? selection.arguments(minimum, selection.payload) : selection
        })
    }
    return selection
}

function intervalMethod(range, work, finish, reportWrites) {
    if (range instanceof IntervalSelection) return range.publish(work, finish, reportWrites)
    const { method, operationContext: ctx, mutation } = work
    const { at, first, count, payload } = range
    const length = work.arrayLength ?? ArrayView.minimumLength(work.receiver, ctx)
    const region = ArrayView.region(work.receiver, ctx), prefix = ArrayView.prefixLength(work.receiver, ctx)
    const regional = (region?.layout || region?.placements) && (!prefix || length > MAX_ARRAY_LENGTH)
    const capture = (lo, hi) => captureLayout(work.receiver, ctx, length, lo, hi)
    if (method === "slice") {
        if (!regional || first + count <= prefix || !region.pending && work.arrayLength !== undefined && length <= MAX_ARRAY_LENGTH)
            return finish(sliceOutput(work.receiver, first, first + count, ctx))
        if (work.mode === CHAIN_MODE.Complete && count > MAX_ARRAY_LENGTH) return capacityError(ctx)
        const copy = projectCapacity(capture(first, first + count), ctx)
        return finish(publishLayout(copy.node, ctx), undefined, copy.failure)
    }
    if (!count && mutation) { reportWrites(false); return finish() }
    if (regional || broadRange(count, work.receiver, length, ctx)) {
        const source = !payload && capture(0, length)
        const edit = overwriteLayout(source ? (lo, hi) => restrict(source, lo, hi) : capture, length, range, mutation, ctx)
        return finishLayout(edit.node, edit.writes, work, finish, reportWrites)
    }

    // A local copy captures its source before inspecting or replacing the
    // destination. Stop the write test at the first established presence.
    let entries = payload ? new Array(count).fill(payload) : createRemap(work.receiver, ctx, first, first + count)
    try {
        if (mutation) {
            const pending = []
            const present = p => {
                const found = resolvePlacementPresence(p, ctx, placementPresent)
                if (isPending(found, ctx)) pending.push(found)
                return found === true
            }
            let writes = Boolean(payload) || Object.values(entries).some(present)
            for (let i = at; !writes && i < at + count; i++) writes = present(readLanguagePlacement(work.receiver, i, ctx))
            reportWrites(writes || anyPresent(pending, ctx))
        }
        return finish(runArrayStep(work, () => createRangeOutput(at, entries, work)))
    } finally { entries = undefined }
}

function finishLayout(node, writes, work, finish, reportWrites) {
    const ctx = work.operationContext
    if (work.mode === CHAIN_MODE.Complete && node.length > MAX_ARRAY_LENGTH)
        return continueGraphTransition(!work.mutation || writes, ctx, effective => {
            if (effective) return capacityError(ctx)
            reportWrites(false)
            return finish()
        })
    if (work.mutation) {
        reportWrites(writes)
        if (writes === false) return finish()
    }
    const projected = projectCapacity(node, ctx)
    return finish(publishLayout(projected.node, ctx), undefined, projected.failure)
}

export { intervalMethod, finishLayout, prepareInterval, broadRange, normalizeIndex }
