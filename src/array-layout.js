import { ArrayView, isArrayView } from "./array-view.js"
import { createArrayFromRemap, readArrayPlacement } from "./array-remap.js"
import { combineErrors, ERROR_KIND, intrinsicValidationError, isPoisonError, validationError } from "./error.js"
import { enumerableLanguageKeyCandidates } from "./language-properties.js"
import { PlacementConstruction } from "./parent-placements.js"
import { blockedPlacement, densePlacement, knownObstruction, PendingFailure, placementFromSelection, placementPresent, placementValue, projectPlacement, resolvePlacement, resolvePlacementTransition, structuralFailure, visiblePlacement,
    MARKER_SELECTION, STRUCTURAL_ERROR, transferPlacement } from "./property-versions.js"
import { collectInputs, continueGraphTransition, decideInputs } from "./internal-step.js"
import { isPending, isTraversable } from "./language-values.js"
import { isObjectLike } from "./meta.js"
import { createLeaseLedger } from "./ownership.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import { releaseOnClose } from "./operation-lifecycle.js"

const MAX_ARRAY_LENGTH = 0xffffffff
const MAX_COUNT = Number.MAX_SAFE_INTEGER
const MIXED_SELECTION = 1

// Leaves describe repeated placements or holes. Joins share captured
// subtrees; restriction and reversal never enumerate their occurrences.
function span(length, placement) {
    if (placement?.present === false && !placement.ownFailure && !placement.sourceVersion) placement = undefined
    const structural = placement?.transition ? placement.transition.structuralError === MARKER_SELECTION :
        placement?.role === STRUCTURAL_ERROR
    const payloadFailure = placement && isPoisonError(placement.value)
    const scalar = placement && !placement.sourceVersion && (!isObjectLike(placement.value) || payloadFailure)
    const shared = Boolean(placement?.layoutChild)
    const implicit = structural || scalar || shared
    const stored = Boolean(placement) && !implicit
    return { length, placement, height: 1, errors: structural ? length : 0,
        poison: placement && (!placement.transition && payloadFailure || blockedPlacement(placement)) ? length : 0,
        skipped: (placement?.transition ? placement.transition.structuralError : placement?.ownFailure || structural) ? length : 0,
        covered: implicit ? length : 0, selection: placement?.transition, stored, shared,
        fixedPresence: !placement?.transition && !placement?.pendingPresence,
        dense: !length || Boolean(placement && !placement.transition && placement.present === true) }
}
function branch(left, right) {
    if (!left.length) return right
    if (!right.length) return left
    if (!left.left && !right.left && left.placement === right.placement) return span(left.length + right.length, left.placement)
    return { left, right, length: left.length + right.length, height: 1 + Math.max(left.height, right.height),
        errors: left.errors + right.errors, poison: left.poison + right.poison, skipped: left.skipped + right.skipped,
        covered: left.covered + right.covered, selection: left.selection === right.selection ? left.selection : MIXED_SELECTION,
        stored: left.stored || right.stored, shared: left.shared || right.shared, dense: left.dense && right.dense,
        fixedPresence: left.fixedPresence && right.fixedPresence }
}
function balanced(left, right) {
    if (left.height > right.height + 1) {
        if (left.right.height > left.left.height)
            return branch(branch(left.left, left.right.left), branch(left.right.right, right))
        return branch(left.left, branch(left.right, right))
    }
    if (right.height > left.height + 1) {
        if (right.left.height > right.right.height)
            return branch(branch(left, right.left.left), branch(right.left.right, right.right))
        return branch(branch(left, right.left), right.right)
    }
    return branch(left, right)
}
function join(left, right) {
    const room = MAX_COUNT - left.length
    if (right.length > room) right = restrict(right, 0, room)
    if (!left.length || !right.length) return left.length ? left : right
    if (left.height > right.height + 1) return balanced(left.left, join(left.right, right))
    if (right.height > left.height + 1) return balanced(join(left, right.left), right.right)
    return branch(left, right)
}
// Build a balanced layout in one pass. Each completed pair of equally
// tall runs merges once instead of rebuilding the left prefix per slot.
class LayoutBuilder {
    parts = []
    append(node) {
        if (!node.length) return
        const parts = this.parts
        while (parts.length && parts[parts.length - 1].height <= node.height)
            node = join(parts.pop(), node)
        parts.push(node)
    }
    finish() {
        let node = span(0)
        for (let i = this.parts.length - 1; i >= 0; i--) node = join(this.parts[i], node)
        return node
    }
}
function restrict(node, first, end) {
    if (first === 0 && end === node.length) return node
    if (end <= first) return span(0)
    if (!node.left) return span(end - first, node.placement)
    const middle = node.left.length
    if (end <= middle) return restrict(node.left, first, end)
    if (first >= middle) return restrict(node.right, first - middle, end - middle)
    return join(restrict(node.left, first, middle), restrict(node.right, 0, end - middle))
}
function layoutAt(node, index) {
    while (node.left) {
        if (index < node.left.length) node = node.left
        else { index -= node.left.length; node = node.right }
    }
    return node.fixedResult?.placement ?? node.placement
}

// Identity depends on prescribed writes. A known present placement or flag
// settles that question even when another selected presence never settles.
function possibleWrites(ranges, ctx) {
    return anyPlacement(ranges, ctx, part => {
        if (part.covered) return true
        if (!part.stored) return false
        if (!part.left) return resolvePlacementTransition(part.placement, ctx, placementPresent)
    })
}

function anyPlacement(ranges, ctx, prove) {
    const waits = [], seen = new Set()
    function visit(part) {
        if (seen.has(part)) return false
        seen.add(part)
        const answer = prove(part)
        if (answer === undefined) return visit(part.left) || visit(part.right)
        if (typeof answer === "boolean") return answer
        waits.push(answer)
        return false
    }
    if (ranges.some(visit)) return true
    return anyPresent(waits, ctx)
}

function anyPresent(inputs, ctx) {
    if (inputs.length < 2) return inputs[0] ?? false
    return decideInputs(inputs, ctx, (_inputs, present, remaining) => present || (remaining ? undefined : false))
}

// Count each captured placement across leaves and shared subtrees. Child
// counts add to the captured length, which is already bounded by MAX_COUNT.
function placementCounts(node, include, placements = new Map()) {
    const order = [], copies = new Map()
    function visit(part) {
        if (copies.has(part) || include && !include(part)) return
        copies.set(part, 0)
        if (part.left) { visit(part.left); visit(part.right) }
        order.push(part)
    }
    visit(node)
    copies.set(node, 1)
    for (let i = order.length - 1; i >= 0; i--) {
        const part = order[i], n = copies.get(part)
        if (part.left) for (const child of [part.left, part.right])
            copies.set(child, (copies.get(child) ?? 0) + n)
        else if (part.length) placements.set(part.placement, (placements.get(part.placement) ?? 0) + n * part.length)
    }
    return placements
}

// A settled primitive on an ordinary captured producer can live in the shared
// terminal layout. Open selectors and managed deliveries retain their own path.
function settledScalarLayout(node, seen = new Map()) {
    if (!node.stored || !node.fixedPresence) return node
    if (node.scalarLayout) return node.scalarLayout
    if (seen.has(node)) return seen.get(node)
    let result = node
    if (node.left) {
        const left = settledScalarLayout(node.left, seen), right = settledScalarLayout(node.right, seen)
        if (left !== node.left || right !== node.right) result = branch(left, right)
    } else {
        const p = node.placement, v = p.sourceVersion
        if (v && v.present === true && !v.publication && !v.copiedDelivery && !v.transition && !v.pendingPresence &&
            !v.ownFailure && !v.role && !v.discoveryBlocked && p.present === true &&
            !p.ownFailure && !p.role && !p.discoveryBlocked && isObjectLike(p.value) && !isObjectLike(v.value))
            result = span(node.length, { ...p, value: v.value, sourceVersion: undefined })
    }
    if (!result.stored) node.scalarLayout = result
    else seen.set(node, result)
    return result
}

// Publish a repeated placement once, including its managed parent relationships.
// An open prefix leaves repeated producers in the region until they settle.
function compactLayout(node, ctx, prefix = false) {
    if (!prefix && node.stored && node.fixedPresence) node = settledScalarLayout(node)
    if (!node.stored) return node
    const repeated = new Set()
    for (const [p, count] of placementCounts(node, part => part.stored)) {
        if (count === 1) continue
        if (prefix && p.sourceVersion) return span(0)
        repeated.add(p)
    }
    if (!repeated.size) return node
    const seen = new Map()
    try { return project(node) } finally { seen.clear(); repeated.clear() }

    function project(part) {
        if (!part.stored) return part
        if (seen.has(part)) return seen.get(part)
        let result
        if (part.left) {
            const left = project(part.left), right = project(part.right)
            if (left === part.left && right === part.right) result = part
            else if (part.compact?.left === left && part.compact.right === right) result = part.compact.result
            else {
                const cell = part.compact = { left, right }
                result = cell.result = collectInputs([left, right], ctx, ([a, b]) => cell.result = branch(a, b))
            }
        } else if (!repeated.has(part.placement)) result = part
        else if (part.compact) result = part.compact.result
        else {
            const cell = part.compact = {}, p = part.placement
            const placements = ctx.execution._compactPlacements ??= new WeakMap()
            let receipt = placements.get(p)
            if (!receipt) {
                placements.set(p, receipt = {})
                receipt.result = p.sourceVersion ? resolvePlacementTransition(p, ctx, selected =>
                    resolvePlacement(selected, ctx, ready => receipt.result = { ...ready, sourceVersion: undefined,
                        ownFailure: p.ownFailure ?? ready.ownFailure,
                        layoutChild: isObjectLike(ready.value) && !isPoisonError(ready.value) })) : { ...p, layoutChild: true }
            }
            result = cell.result = continueGraphTransition(receipt.result, ctx, ready => cell.result = span(part.length, ready))
        }
        seen.set(part, result)
        return result
    }
}

// A disjoint interval of leaf numbers proves that a join does not duplicate
// stored occurrences. Overlapping ranges and repeated runs keep the counted
// publication path. Cache this proof on immutable subtrees, including misses.
function individualFixedSlots(node, ctx) {
    if (!node.stored && !node.shared) return true
    if (!node.fixedPresence) return false
    if (node.fixedSlots !== undefined) return node.fixedSlots
    if (!node.left) {
        if (node.length !== 1) return node.fixedSlots = false
        const id = ctx.execution._nextLayoutSlot = (ctx.execution._nextLayoutSlot ?? 0) + 1
        return node.fixedSlots = { first: id, last: id }
    }
    return node.fixedSlots = disjointFixedSlots(node.left, node.right, ctx)
}

function disjointFixedSlots(left, right, ctx) {
    const a = individualFixedSlots(left, ctx), b = individualFixedSlots(right, ctx)
    if (!a || !b) return false
    if (a === true || b === true) return a === true ? b : a
    return (a.last < b.first || b.last < a.first) && {
        first: Math.min(a.first, b.first), last: Math.max(a.last, b.last) }
}

// A splice visits two nonoverlapping ranges of one source and each insertion
// once. Their original leaf IDs can interleave after a middle insertion.
function inheritSpliceSlots(result, source, inserted, ctx) {
    if (result.stored && result.fixedPresence) {
        const proof = disjointFixedSlots(source, inserted, ctx)
        if (proof) result.fixedSlots = proof
    }
}

// A pending sibling may keep this readiness signal alive. The signal carries
// no layout, payload or successful sibling. Active destinations subscribe to
// child publication and can detach independently of root completion.
class FixedLink {
    constructor(parent, offset) { this.parent = parent; this.offset = offset }
    deliver(index, placement, count, indexed) { this.parent.deliver(this.offset + index, placement, count, indexed) }
    finish() { this.parent.finish() }
}

class FixedDelivery {
    remaining = 1
    published = false
    deliver(index, placement, count, indexed = false) {
        if (!indexed) this.published = true
        for (const use of (indexed ? this.indexed : this.listeners) ?? []) use.deliver(index, placement, count, indexed)
    }
    finish() {
        if (--this.remaining) return
        this.left = this.right = this.leftUse = this.rightUse = undefined
        const listeners = this.listeners
        this.listeners = this.indexed = undefined
        for (const use of listeners ?? []) use.finish?.()
    }
    join(left, right, offset) {
        this.published = Boolean(left?.published || right?.published)
        this.left = left?.remaining ? left : undefined
        this.right = right?.remaining ? right : undefined
        this.remaining = Number(Boolean(this.left)) + Number(Boolean(this.right))
        this.offset = offset
    }
    subscribe(use) {
        if (!this.remaining) return false
        if (!this.listeners && (this.left || this.right)) {
            this.remaining = 0
            if (this.left) {
                this.leftUse = new FixedLink(this, 0)
                if (this.left.subscribe(this.leftUse)) this.remaining++
                this.published ||= this.left.published
            }
            if (this.right) {
                this.rightUse = new FixedLink(this, this.offset)
                if (this.right.subscribe(this.rightUse)) this.remaining++
                this.published ||= this.right.published
            }
            if (!this.remaining) {
                this.left = this.right = this.leftUse = this.rightUse = undefined
                return false
            }
        }
        ;(this.listeners ??= new Set()).add(use)
        return true
    }
    unsubscribe(use) {
        if (!this.listeners?.delete(use) || this.listeners.size) return
        this.listeners = undefined
        this.left?.unsubscribe(this.leftUse)
        this.right?.unsubscribe(this.rightUse)
        this.leftUse = this.rightUse = undefined
    }
    index(use) {
        if (!this.remaining) return
        if (!this.indexed) {
            this.indexed = new Set()
            if (this.leftUse) this.left.index(this.leftUse)
            if (this.rightUse) this.right.index(this.rightUse)
        }
        this.indexed.add(use)
    }
    unindex(use) {
        if (!this.indexed?.delete(use) || this.indexed.size) return
        this.indexed = undefined
        if (this.leftUse) this.left.unindex(this.leftUse)
        if (this.rightUse) this.right.unindex(this.rightUse)
    }
}

function fixedPayloads(node, ctx) {
    if (!node.stored && !node.shared) return
    if (node.delivery) return node.delivery
    const cell = node.delivery = new FixedDelivery()
    if (node.left) cell.join(fixedPayloads(node.left, ctx), fixedPayloads(node.right, ctx), node.left.length)
    else settleFixedLeaf(node, cell, ctx)
    return cell
}

function fixedPayloadError(p) {
    return p && !p.role && !p.ownFailure && isPoisonError(p.value)
}

function settleFixedLeaf(node, cell, ctx) {
    const p = node.placement
    const result = resolvePlacement(p, ctx, ready => {
        const placement = { ...ready, sourceVersion: undefined, ownFailure: p.ownFailure ?? ready.ownFailure,
            layoutChild: isObjectLike(ready.value) && !isPoisonError(ready.value) }
        node.fixedResult = span(node.length, placement)
        // Ordinary payload poison is already readable in the immutable leaf.
        // Only active counters need projected backing publication.
        if (fixedPayloadError(placement)) cell.deliver(0, placement, node.length, true)
        else if (isTraversable(placement.value, ctx) || placement.ownFailure || isPoisonError(placement.value))
            cell.deliver(0, placement, node.length)
        cell.finish()
    })
    markPromiseHandled(result, ctx)
}

function resolvedFixedLayout(node) {
    if (!node.delivery) return node
    return node.fixedResult ??= branch(resolvedFixedLayout(node.left), resolvedFixedLayout(node.right))
}

function followFixedChildren(node, use, offset, previous, indexed = false) {
    if (!node.delivery || !indexed && !node.delivery.published) return
    const end = offset + node.length
    if (previous && end <= previous.length && restrict(previous, offset, end) === node) return
    if (node.left) {
        followFixedChildren(node.left, use, offset, previous, indexed)
        followFixedChildren(node.right, use, offset + node.left.length, previous, indexed)
    } else {
        const placement = node.fixedResult?.placement
        if (!indexed || fixedPayloadError(placement)) use.deliver(offset, placement, node.length, indexed)
    }
}
function mapLayout(node, select, cache = new Map()) {
    const replacement = select(node)
    if (replacement) return replacement
    if (cache.has(node)) return cache.get(node)
    const left = mapLayout(node.left, select, cache), right = mapLayout(node.right, select, cache)
    const result = left === node.left && right === node.right ? node : branch(left, right)
    cache.set(node, result)
    return result
}
function reverseLayout(node) {
    if (!node.left) return node
    if (!node.mirror) {
        const mirror = branch(reverseLayout(node.right), reverseLayout(node.left))
        mirror.mirror = node
        node.mirror = mirror
    }
    return node.mirror
}
function denseLayout(node, ctx) {
    const present = { present: true, value: undefined }
    return mapLayout(node, part => {
        if (part.dense) return part
        if (part.left) return
        const p = part.placement
        const next = p ? densePlacement(p, ctx) : present
        return next === p ? part : span(part.length, next)
    })
}
function flagPositions(node, cause, ctx) {
    if (!cause) return node
    const flagged = mapLayout(node, part => {
        if (part.flaggedBy === cause || !part.length) return part
        if (part.left) return
        const p = part.placement ?? { value: undefined, present: false }
        const next = projectPlacement(p, ctx, selected => {
            if (selected.ownFailure === cause) return selected
            let failure = cause
            if (selected.ownFailure) {
                const first = placementValue(selected)
                failure = isPending(first, ctx) ? new PendingFailure(continueGraphTransition(first, ctx,
                    error => combineErrors([error, cause])), ctx) : combineErrors([first, cause])
            }
            return { ...selected, ownFailure: failure }
        })
        return next === p ? part : span(part.length, next)
    })
    // A later enclosing join can apply the same cause to this entire result.
    if (flagged !== node) flagged.flaggedBy = cause
    return flagged
}
function capacityError(ctx) { return validationError("Invalid Array length", ctx, ERROR_KIND.InvalidArrayLength) }
// A derived range keeps the originating command's Error even after its
// operands retire. Capture only the context and the first actual failure.
function capacityCause(ctx) {
    let error
    return () => error ??= capacityError(ctx)
}

function reportCapacityLoss(lost, cause, ctx) {
    return continueGraphTransition(lost, ctx, failed => failed ? cause() : undefined)
}

// A native Array fits by construction. A managed view can already have a
// mandatory Error tail. Full consumption stops there, before touching slots.
function consumeArrayValue(value, work, consume, fail) {
    const ctx = work.operationContext
    if (!isArrayView(value, ctx)) return consume(value)
    const over = ArrayView.captureInRange(value, MAX_ARRAY_LENGTH, ctx, work)
    if (over === false) return consume(value)
    const capacity = () => fail(intrinsicValidationError(work, ERROR_KIND.InvalidArrayLength, "Invalid Array length"))
    if (over === true) return capacity()
    const lease = createLeaseLedger(ctx)
    lease.acquire(value)
    const release = () => { lease.release(); value = consume = fail = undefined }
    const unregister = releaseOnClose(work, release)
    return continueGraphTransition(over, ctx, oversized => {
        try { return oversized ? capacity() : consume(value) }
        finally { unregister?.(); release() }
    }, undefined, work)
}
function structuralPlacement(cause) { return { value: cause, present: true, role: STRUCTURAL_ERROR } }
function missingOutputMarker(cause, ctx) {
    return knownObstruction(placementFromSelection(continueGraphTransition(cause, ctx, structuralPlacement), ctx), MARKER_SELECTION)
}
function layoutFromRemap(entries) {
    const output = new LayoutBuilder()
    let next = 0
    for (const key of Object.keys(entries)) {
        const index = Number(key)
        if (next < index) output.append(span(index - next))
        output.append(span(1, entries[key]))
        next = index + 1
    }
    if (next < entries.length) output.append(span(entries.length - next))
    return output.finish()
}

// A command introduces loss only where the virtual tail still contains an
// unmarked slot. Its direct result can ask this without rebuilding the layout.
function capacityFailure(node, ctx, cause) {
    if (node.length <= MAX_ARRAY_LENGTH) return
    return reportCapacityLoss(hasUnmarkedPlacement(restrict(node, MAX_ARRAY_LENGTH, node.length), ctx), cause, ctx)
}

function hasUnmarkedPlacement(node, ctx) {
    return anyPlacement([node], ctx, part => {
        if (part.errors === part.length) return false
        if (!part.selection) return true
        if (part.selection !== MIXED_SELECTION)
            return resolvePlacementTransition(layoutAt(part, 0), ctx, p => p.role !== STRUCTURAL_ERROR)
    })
}

function projectCapacity(node, ctx, exceeded = false, cause) {
    cause ??= capacityCause(ctx)
    if (node.length <= MAX_ARRAY_LENGTH) return { node, failure: exceeded ? cause() : undefined }
    const tail = restrict(node, MAX_ARRAY_LENGTH, node.length)
    const output = projectLoss(tail, cause, ctx)
    return { node: output === tail ? node : join(restrict(node, 0, MAX_ARRAY_LENGTH), output),
        get failure() { return exceeded ? cause() : capacityFailure(node, ctx, cause) } }
}

function capacityPlacement(p, cause, ctx) {
    const select = selected => selected?.role === STRUCTURAL_ERROR ? selected : structuralPlacement(cause())
    const projected = p?.transition ? projectPlacement(p, ctx, select) : select(p)
    return knownObstruction(projected)
}

function projectLoss(node, cause, ctx, firstRun = false) {
    // Copies sharing a structural predecessor select the same marker. One
    // cursor credit covers that run even if its cause is still pending.
    if (firstRun) while (node.selection === MIXED_SELECTION) node = node.left
    let marker
    return mapLayout(node, part => {
        if (part.errors === part.length) return part
        if (!part.selection && !part.errors) return span(part.length, marker ??= structuralPlacement(cause()))
        if (part.selection && part.selection !== MIXED_SELECTION)
            return span(part.length, capacityPlacement(layoutAt(part, 0), cause, ctx))
    })
}

function collectCauses(node, causes, seen) {
    if (!node.poison || seen.has(node)) return
    seen.add(node)
    if (!node.left) causes.add(placementValue(visiblePlacement(node.placement)))
    else { collectCauses(node.left, causes, seen); collectCauses(node.right, causes, seen) }
}

function layoutCause(node, ctx) {
    const causes = new Set()
    collectCauses(node, causes, new Set())
    return collectInputs([...causes], ctx, combineErrors)
}

// Export observes own status. Its hidden payload can remain pending forever
// without becoming a dependency of an already failed visible placement.
function visibleLayout(node) {
    return mapLayout(node, part => part.left ? !part.stored && part : part.placement?.ownFailure ?
        span(part.length, part.placement.ownFailure instanceof PendingFailure ? visiblePlacement(part.placement) :
            { value: part.placement.ownFailure, present: true }) : part)
}

// A structural subtree has no comparable payload. Keep the subtree so a
// deferred search bound can still restrict the exact set of required causes.
function* searchRuns(node, first, backwards, seen, groupErrors = true) {
    if (!node.length || seen?.has(node)) return
    seen?.add(node)
    if (!node.left || groupErrors && node.errors === node.length) { yield { node, first }; return }
    const middle = first + node.left.length
    if (backwards) yield* searchRuns(node.right, middle, true, seen, groupErrors)
    yield* searchRuns(node.left, first, backwards, seen, groupErrors)
    if (!backwards) yield* searchRuns(node.right, middle, false, seen, groupErrors)
}

function matchingLength(layout, first, limit, matches, back = false) {
    const range = restrict(layout, first, limit)
    let count = 0
    const scan = part => {
        const total = matches(part)
        if (total === part.length) { count += total; return true }
        return total > 0 && (back ? scan(part.right) && scan(part.left) : scan(part.left) && scan(part.right))
    }
    scan(range)
    return count
}

function skippedLength(layout, first, limit) {
    return matchingLength(layout, first, limit, part => part.skipped)
}

// Compare failed positions in two aligned slices. Repeated subtrees at the
// same relative offset pose the same question, including when cuts differ.
function overlappingFailures(left, right) {
    const seen = new Map()
    function overlaps(a, b, offset) {
        if (!a.poison || !b.poison || offset >= a.length || -offset >= b.length) return false
        if (a === b && !offset) return true
        if (a.poison === a.length)
            return restrict(b, Math.max(0, -offset), Math.min(b.length, a.length - offset)).poison > 0
        if (b.poison === b.length)
            return restrict(a, Math.max(0, offset), Math.min(a.length, offset + b.length)).poison > 0
        let others = seen.get(a)
        if (!others) seen.set(a, others = new Map())
        let offsets = others.get(b)
        if (!offsets) others.set(b, offsets = new Set())
        if (offsets.has(offset)) return false
        offsets.add(offset)
        return a.length >= b.length ?
            overlaps(a.left, b, offset) || overlaps(a.right, b, offset - a.left.length) :
            overlaps(a, b.left, offset) || overlaps(a, b.right, offset + b.left.length)
    }
    return overlaps(left, right, 0)
}

function skippedRun(layout, first, limit) {
    const count = skippedLength(layout, first, limit)
    if (count > 1) return restrict(layout, first, first + count)
}

// A skipped position contributes its visible failure as permanent output.
// Its own flag may hide either healthy data or an older structural Error.
function missingOutputMarkers(range, ctx) {
    return mapLayout(range, part => {
        if (part.left) return
        const p = part.placement
        if (p.transition?.structuralError === MARKER_SELECTION ||
            p.role === STRUCTURAL_ERROR && !p.ownFailure && !p.transition) return part
        const cause = resolvePlacementTransition(p, ctx, structuralFailure)
        return span(part.length, missingOutputMarker(cause, ctx))
    })
}

function skippedCause(markers, ctx) {
    if (!markers.stored && markers.poison === markers.length) return layoutCause(markers, ctx)
    const causes = Array.from(placementCounts(markers).keys(), p => resolvePlacementTransition(p, ctx, structuralFailure))
    return collectInputs(causes, ctx, combineErrors)
}

// Terminals without graph edges can stay in the layout. Managed and pending
// placements use normal backing publication, parent indexing and COW.
class LayoutRegion {
    implicit = true
    pending = false
    start = 0
    constructor(layout) { this.layout = layout; this.end = layout.length }
    versionAt(index) {
        if (index < this.start || index >= this.end) return
        const p = layoutAt(this.layout, index)
        return p?.transition?.structuralError === MARKER_SELECTION ? p.sourceVersion : p
    }
    counts(first, end) { return restrict(this.layout, first, end) }
    copyIndividualSlots(first, end, slots, offset) {
        const range = this.counts(first, end)
        return !range.shared && visitIndividualPlacements(range, first - offset, false, (p, i) => { slots[i] = p })
    }
    *keys(first, end) {
        yield* visit(restrict(this.layout, first, end), first)
        function* visit(node, offset) {
            if (!node.covered) return
            if (node.covered === node.length) {
                for (let i = 0; i < node.length; i++) yield offset + i
            } else { yield* visit(node.left, offset); yield* visit(node.right, offset + node.left.length) }
        }
    }
    skippedRun(index, limit) { return skippedRun(this.layout, index, limit) }
    children(range, visit) {
        if (!this.layout?.shared) return
        const counts = new Map()
        const collect = (first, end) => placementCounts(restrict(this.layout, first, end), part => part.shared, counts)
        if (range) range.intervals(collect)
        else collect(0, this.layout.length)
        for (const [p, count] of counts) visit(p, count)
    }
    visitChildKeys(placement, first, end, visit) {
        if (!this.layout?.shared) return
        const found = new Map()
        function contains(part) {
            if (!part.shared) return false
            if (!part.left) return part.placement === placement
            if (!found.has(part)) found.set(part, contains(part.left) || contains(part.right))
            return found.get(part)
        }
        const walk = (part, offset) => {
            if (offset >= end || offset + part.length <= first || !contains(part)) return
            if (part.left) {
                if (walk(part.left, offset) === false) return false
                return walk(part.right, offset + part.left.length)
            }
            if (part.placement === placement)
                for (let i = Math.max(offset, first), stop = Math.min(offset + part.length, end); i < stop; i++)
                    if (visit(i) === false) return false
        }
        return walk(this.layout, 0)
    }
    visit(range, owner, visit, fail, needsOutput) {
        const ctx = owner.operationContext, waits = []
        const seen = new Set(), causes = new Set()
        range.intervals((first, end) => collectCauses(restrict(this.layout, first, end), causes, seen))
        for (const cause of causes) {
            if (isPending(cause, ctx)) {
                const result = continueGraphTransition(cause, ctx, fail, undefined, owner)
                if (isPending(result, ctx)) waits.push(result)
            } else fail(cause)
        }
        if (needsOutput?.()) range.intervals((first, end) => write(restrict(this.layout, first, end), first))
        if (!needsOutput?.()) this.children(range, p => { if (owner.open && !p.ownFailure) record(p) })
        if (waits.length) return collectInputs(waits, ctx, () => undefined, owner)
        function record(p, key) {
            const result = visit(p, key)
            if (isPending(result, ctx)) waits.push(result)
        }
        function write(node, offset) {
            if (node.covered === node.poison || !needsOutput()) return
            if (node.left) { write(node.left, offset); write(node.right, offset + node.left.length); return }
            for (let i = 0; i < node.length && needsOutput(); i++) record(node.placement, String(offset + i - range.offset))
        }
    }
}

function captureLayout(array, ctx, length, first = 0, end = length, inspect) {
    if (first >= end) return span(0)
    const view = ArrayView.region(array, ctx)
    let base = span(end - first)
    for (const range of ArrayView.implicitRanges(array, ctx)) {
        const layout = range.region.layout ?? range.region.placements
        if (!layout) continue
        const low = Math.max(first, range.first - range.offset), high = Math.min(end, range.end - range.offset)
        if (high > low) {
            const occupied = restrict(layout, range.offset + low, range.offset + high)
            base = join(join(restrict(base, 0, low - first), occupied), restrict(base, high - first, end - first))
        }
    }
    const output = new LayoutBuilder()
    let next = 0
    for (const key of enumerableLanguageKeyCandidates(array, ctx, first, end, undefined, !view?.pending || Boolean(view.placements))) {
        const index = Number(key) - first
        const placement = readArrayPlacement(array, key, ctx, inspect)
        if (next < index) output.append(restrict(base, next, index))
        output.append(span(1, placement))
        next = index + 1
    }
    if (next < end - first) output.append(restrict(base, next, end - first))
    return output.finish()
}

function storedPlacements(node, visit, start = 0) {
    function write(part, index) {
        if (!part.stored) return
        if (part.left) { write(part.left, index); write(part.right, index + part.left.length); return }
        for (let offset = 0; offset < part.length; offset++) visit(index + offset, part.placement)
    }
    write(node, start)
}
function implicitLayout(node) {
    return mapLayout(node, part => !part.stored ? part : !part.covered ? span(part.length) : undefined)
}
// Dense materialization must also bound runs of holes. A sparse destination
// can skip an entire empty range. Both keep repeated spans and branches compact.
function visitIndividualPlacements(node, first, sparse, visit) {
    const seen = new Set()
    return walk(node, first)

    function walk(part, index) {
        if (!part.length || sparse && !part.covered && !part.stored) return true
        if (!part.left) {
            if (part.length !== 1) return false
            if (part.placement) visit(part.placement, index)
            return true
        }
        if (seen.has(part)) return false
        seen.add(part)
        return walk(part.left, index) && walk(part.right, index + part.left.length)
    }
}
function materializeIndividualSlots(node, ctx) {
    // Materialize isolated occurrences directly. Shared subtrees and repeated
    // spans remain compact regardless of their logical width.
    if (node.length <= MAX_ARRAY_LENGTH && !node.skipped && !node.shared) {
        const entries = []
        if (visitIndividualPlacements(node, 0, true, (p, i) => { entries[i] = p })) {
            entries.length = node.length
            return createArrayFromRemap(entries, ctx)
        }
    }
}
function closedLayout(node, ctx, fixedCoordinates = false) {
    const array = !fixedCoordinates && materializeIndividualSlots(node, ctx)
    if (array) return array
    const backing = createArrayFromRemap([], ctx)
    const region = new LayoutRegion(implicitLayout(node))
    if (fixedCoordinates) region.fixedCoordinates = true
    const producers = ArrayView.attachRegion(backing, region, ctx)
    storedPlacements(node, (index, p) => transferPlacement(p, producers, String(index), ctx, undefined, undefined, false))
    return PlacementConstruction.initializeAndPublish(new ArrayView(backing, ctx, 0, node.length), ctx, () => {})
}

export { LayoutBuilder, MAX_ARRAY_LENGTH, MAX_COUNT, capacityCause, capacityError, consumeArrayValue, hasUnmarkedPlacement, reportCapacityLoss, capacityPlacement, structuralPlacement, projectLoss, skippedLength, matchingLength, overlappingFailures, skippedRun, skippedCause, missingOutputMarker, missingOutputMarkers, span, join, restrict, layoutFromRemap,
    layoutAt, layoutCause, searchRuns, mapLayout, reverseLayout, denseLayout, flagPositions, projectCapacity, captureLayout, closedLayout, materializeIndividualSlots, LayoutRegion, storedPlacements, implicitLayout, placementCounts, compactLayout, fixedPayloads, fixedPayloadError, followFixedChildren, individualFixedSlots, inheritSpliceSlots, resolvedFixedLayout, possibleWrites, anyPresent, visibleLayout }
