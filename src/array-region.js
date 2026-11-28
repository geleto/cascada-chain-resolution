import { ArrayView } from "./array-view.js"
import { createArrayFromRemap } from "./array-remap.js"
import { watchWidthIndex } from "./array-width.js"
import { compactLayout, fixedPayloadError, fixedPayloads, followFixedChildren, individualFixedSlots, join, layoutAt, LayoutRegion, implicitLayout, MAX_ARRAY_LENGTH,
    resolvedFixedLayout, restrict, span, storedPlacements, visibleLayout } from "./array-layout.js"
import { PlacementConstruction } from "./parent-placements.js"
import { collectInputs, continueGraphTransition } from "./internal-step.js"
import { isPending, isTraversable } from "./language-values.js"
import { isObjectLike, requireMeta } from "./meta.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import { releaseOnClose } from "./operation-lifecycle.js"
import { indexRegionPoint, publishRegionCount, releaseBackingCounter } from "./refcounts.js"
import { blockedPlacement, completePlacementGate, consumePlacementTransition, getOwnPlacementVersion, installPlacementGate, placementPresent, transferPlacement, copyArrayOverlays } from "./property-versions.js"
import { beforeInsertion, splitSequence, watch } from "./array-sequence.js"
import { retainOperands } from "./array-sequence-layout.js"

const hole = Object.freeze({ present: false, value: undefined })

function finishPoint(gate, placement, ctx) {
    const region = gate.owner.backing.region
    gate.unwatchWidth?.()
    gate.unwatchWidth = undefined
    const result = completePlacementGate(gate, placement, ctx)
    // A shrinking range may already hide this version from an indexed owner.
    if (!placementPresent(gate.version)) for (const owner of gate.version.counterProjections?.keys() ?? [])
        releaseBackingCounter(gate.version, owner, ctx)
    if (region.gates?.delete(Number(gate.key)) && !region.gates.size) region.suspendPublication()
    return result
}

// Fixed prefix storage and one open contribution use the same terminal layout
// as a closed result. Only selected positions need individual transitions.
class ArrayRegion extends LayoutRegion {
    pending = true

    get end() { return Math.min(this.publishedEnd, this.sequence?.widths?.maximum ?? this.publishedEnd) }
    set end(maximum) { this.publishedEnd = maximum }

    constructor(sequence, ctx) {
        super(span(0))
        this.layout = undefined
        this.operationContext = ctx
        this.end = sequence.maximum
        this.sequence = sequence
    }

    static open(sequence, head, ctx, borrowed, sharedHead) {
        const { minimum, maximum } = sequence
        const backing = createArrayFromRemap([], ctx)
        const region = new ArrayRegion(sequence, ctx)
        region.start = sharedHead ? borrowed?.range.length ?? 0 : head.length
        if (!sharedHead && head.covered) region.prefix = new LayoutRegion(implicitLayout(head))
        region.producers = ArrayView.attachRegion(backing, region, ctx)
        if (sharedHead) region.attachFixed(head, false)
        else storedPlacements(head, (index, p) => transferPlacement(p, region.producers, String(index), ctx, undefined, undefined, false))
        const view = new ArrayView(backing, ctx, 0, minimum, borrowed?.range)
        if (minimum !== maximum) region.shape = ArrayView.deferLength(view, minimum, maximum, ctx, sequence.widths)
        return { region, output: PlacementConstruction.initializeAndPublish(view, ctx, view => {
            if (borrowed) {
                const start = borrowed.sourceStart ?? 0
                copyArrayOverlays(borrowed.source, view, ctx, start, start + borrowed.range.length, -start)
            }
        }) }
    }

    refine(minimum, maximum) {
        // Closing an optional coordinate publishes its absence at the same
        // transition as the new bound, including already indexed projections.
        const gates = this.gates, ctx = this.operationContext
        if (gates?.size && maximum < this.publishedEnd) {
            const discard = index => {
                const gate = gates.get(index)
                if (gate?.owner) finishPoint(gate, hole, ctx)
            }
            if (this.publishedEnd - maximum < gates.size) {
                for (let index = maximum; index < this.publishedEnd; index++) discard(index)
            } else for (const index of gates.keys()) if (index >= maximum) discard(index)
        }
        this.end = maximum
        this.shape?.refine(minimum, maximum)
    }

    versionAt(index, delivered) {
        if (index < this.start) return this.prefix?.versionAt(index)
        if (index >= this.end) return
        if (!this.pending) return super.versionAt(index)
        const ctx = this.operationContext
        // Counter publication can consult a just-removed backing hole inside
        // the same commit. Its open gate remains authoritative until return.
        const existing = getOwnPlacementVersion(this.producers, index, ctx) ?? this.gates?.get(index)?.version
        if (existing) return placementPresent(existing) ? existing : undefined
        const fixed = this.placements ?? this.fixedHead
        const established = delivered ?? (fixed && index < fixed.length ? layoutAt(fixed, index) ?? hole : undefined)
        if (established && !established.transition && !established.pendingPresence && !established.ownFailure &&
            (!isObjectLike(established.value) || !this.indexed?.size && fixedPayloadError(established) ||
                established.layoutChild && !isTraversable(established.value, ctx)))
            return established.present ? established : undefined
        if (delivered && !this.indexed?.size) {
            transferPlacement(delivered, this.producers, String(index), ctx, undefined, undefined, false)
            return getOwnPlacementVersion(this.producers, index, ctx)
        }
        const gate = installPlacementGate(this.producers, String(index), ctx, hole)
        gate.version.transition.selection = true
        ;(this.gates ??= new Map()).set(index, gate)
        // Only this coordinate's absence can complete it before selection.
        const widths = this.sequence?.widths
        if (widths && index >= widths.minimum) gate.unwatchWidth = watchWidthIndex(widths, index, present => {
            gate.unwatchWidth = undefined
            if (!present && gate.owner) finishPoint(gate, hole, ctx)
        })
        this.updatePreservationReaders()
        // The counted open slot becomes this one ordinary pending version.
        for (const owner of this.indexed ?? []) {
            const key = ArrayView.regionKey(owner, index, ctx)
            if (key !== undefined) indexRegionPoint(gate.version, owner, key, ctx)
        }
        const selected = established ?? this.sequence.point(index, false)
        markPromiseHandled(continueGraphTransition(selected, ctx, p => {
            if (!gate.owner) return
            return consumePlacementTransition(p, ctx, selected => {
                if (!gate.owner) return
                if (!selected.transition) return finishPoint(gate, selected, ctx)
                gate.proveObstruction(selected.transition.structuralError)
                return consumePlacementTransition(selected, ctx, ready => {
                    if (gate.owner) return finishPoint(gate, ready, ctx)
                })
            }, undefined, blockedPlacement)
        }), ctx)
        // A completed hole has no backing producer. Existing captures keep
        // the settled version until their own last use.
        if (placementPresent(gate.version)) return gate.version
    }

    // An independently retained point can outlive this backing without
    // making the rest of the publication a prerequisite for its reader.
    capturePoint(index) {
        if (!this.pending || index < this.start || index >= this.end ||
            getOwnPlacementVersion(this.producers, index, this.operationContext)) return
        return this.sequence?.capturePoint?.(index, false)
    }

    // Materialized points, including open gates, have one authoritative backing
    // record. Prefix storage precedes the range counted by this region.
    *pointKeys(first = this.start, end = this.end) {
        const slots = requireMeta(this.producers, this.operationContext).outgoingPlacements
        if (end - first < slots.size) {
            for (let i = first; i < end; i++) if (slots.has(String(i))) yield i
        } else for (const key of slots.keys()) {
            const i = Number(key)
            if (i >= first && i < end) yield i
        }
    }

    // A consumer records a restricted capture, without a gate for every
    // possible index. Later point overrides cannot affect this question.
    visit(range, work, visit, fail, needsOutput) {
        if (!this.pending) return super.visit(range, work, visit, fail, needsOutput)
        if (!needsOutput && this.observeMembership(range, work, visit, fail)) return
        const ctx = work.operationContext
        if (this.placements) return readSelected(this.placements)
        if (this.fixedHead && range.end <= this.fixedHead.length) return readSelected(this.fixedHead)
        const current = this.sequence.current?.node
        if (current) return readSelected(current)
        const { promise, resolve } = Promise.withResolvers()
        const readers = this.readers ??= new Set()
        const release = releaseOnClose(work, () => { readers.delete(read); this.suspendPublication() })
        const read = (node, terminal) => {
            release?.()
            resolve(continueGraphTransition(undefined, ctx, () => terminal ? deliver(node, terminal) : readSelected(node), undefined, work))
        }
        readers.add(read)
        this.updatePreservationReaders()
        return promise

        function readSelected(node) {
            let selected = span(0)
            range.intervals((first, end) => {
                if (first < node.length) selected = join(join(selected, span(first - selected.length)),
                    restrict(node, first, Math.min(end, node.length)))
            })
            selected = visibleLayout(selected)
            return continueGraphTransition(compactLayout(selected, ctx), ctx, captured =>
                deliver(captured, new LayoutRegion(implicitLayout(captured))), undefined, work)
        }
        function deliver(node, terminal) {
            const waits = []
            const clipped = { ...range, intervals: read => range.intervals((first, end) => {
                if (first < node.length) read(first, Math.min(end, node.length))
            }) }
            const implicit = terminal.visit(clipped, work, visit, fail, needsOutput)
            if (isPending(implicit, ctx)) waits.push(implicit)
            clipped.intervals((first, end) => storedPlacements(restrict(node, first, end), (index, placement) => {
                if (!work.open) return
                const result = visit(placement, String(index - range.offset))
                if (isPending(result, ctx)) waits.push(result)
            }, first))
            if (waits.length) return collectInputs(waits, ctx, () => undefined, work)
        }
    }

    // Deep queries need membership, independently of numeric order. Only
    // inspect an occurrence if every possible coordinate is in this capture.
    observeMembership(range, work, visit, fail) {
        const sequence = this.sequence, ctx = work.operationContext
        const seen = new WeakSet(), whole = new WeakSet(), releases = [], todo = []
        function inspect(node) {
            if (!work.open || seen.has(node) || !node.stored && !node.poison && !node.shared) return
            seen.add(node)
            if (node.left) { inspect(node.left); inspect(node.right) }
            else visit(node.placement)
        }
        const inspectRange = (node, first, end) => {
            end = Math.min(end, node.length)
            if (first < end) inspect(restrict(node, first, end))
        }
        if (this.placements) {
            range.intervals((first, end) => inspectRange(this.placements, first, end))
            return true
        }
        // Express each capture in its contribution's coordinates. A shared
        // contribution fully covered once has no additional membership facts.
        const enqueue = (part, first, end) => {
            end = Math.min(end, part.maximum)
            if (first >= end || whole.has(part)) return
            if (!first && end === part.maximum) whole.add(part)
            todo.push([part, first, end])
        }
        const follow = (part, update) => {
            update()
            if (!work.open) return
            const release = watch(part, () => {
                if (work.open) { update(); scan() }
            }, ctx)
            if (release) releases.push(release)
        }
        // Bounds tighten monotonically. Forward only the two newly included
        // edges of a moving restriction, even when its source stays open.
        const extend = visit => {
            let start, stop
            return (from, to) => {
                if (from >= to) return
                if (start === undefined) visit(from, to)
                else {
                    if (from < start) visit(from, start)
                    if (stop < to) visit(stop, to)
                }
                start = from; stop = to
            }
        }
        function scan() {
            while (work.open && todo.length) {
                const [part, first, end] = todo.pop()
                let parts
                if (part.obstructions) {
                    let checked = first
                    const inspectKnown = () => {
                        const stop = Math.min(end, part.minimum)
                        if (checked >= stop) return
                        if (part.obstructions.observe) {
                            const release = part.obstructions.observe(checked, stop, work, inspectRange, fail)
                            if (release) releases.push(release)
                        } else if (part.obstructions.end(checked, stop) > checked) fail()
                        checked = stop
                    }
                    if (end <= part.minimum) inspectKnown()
                    else follow(part, inspectKnown)
                    if (!work.open) break
                }
                if (part.node) inspectRange(part.node, first, end)
                else if (part.capacityInput) {
                    enqueue(part.capacityInput, first, Math.min(end, MAX_ARRAY_LENGTH))
                } else if ((parts = part.parts ?? splitSequence(part, ctx))) {
                    const [left, right] = parts
                    if (first <= left.minimum && end - left.maximum >= right.maximum) enqueue(right, 0, right.maximum)
                    else if (end > left.minimum) {
                        // Only the right restriction moves with the left width.
                        // Forward newly included pieces, never replay the root.
                        const include = extend((from, to) => enqueue(right, from, to))
                        follow(left, () => include(Math.max(0, first - left.minimum), end - left.maximum))
                    }
                    enqueue(left, first, end)
                } else if (part.origins) {
                    const { source, added, cut } = part.origins
                    const oldSlots = extend((from, to) => enqueue(source, from, to))
                    const newSlots = extend((from, to) => inspectRange(added, from, to))
                    follow(cut, () => {
                        oldSlots(beforeInsertion(first, cut.maximum, added.length), beforeInsertion(end, cut.minimum, added.length))
                        newSlots(Math.max(0, first - cut.minimum), end - cut.maximum)
                    })
                } else follow(part, () => {
                    const child = part.current ?? part.prefix
                    if (child) enqueue(child, first, end)
                    else {
                        inspectRange(part.head, first, end)
                        const tail = part.tail
                        if (tail.length) inspectRange(tail, Math.max(0, first - (part.minimum - tail.length)),
                            end - (part.maximum - tail.length))
                    }
                })
            }
        }
        range.intervals((first, end) => enqueue(sequence, first, end))
        scan()
        const complete = sequence.origins?.source.node && range.first === 0 && range.count === sequence.maximum
        if (!work.open || complete) {
            for (const release of releases) release()
            return true
        }
        if (releases.length) releaseOnClose(work, () => { for (const release of releases) release() })
        return false
    }

    restrictRange(range, limit = this.end) {
        return { ...range, intervals: visit => range.intervals((first, end) => {
            if (first < limit) visit(first, Math.min(end, limit))
        }) }
    }

    finishLayout(node) {
        const ctx = this.operationContext
        if (node.stored && individualFixedSlots(node, ctx)) {
            this.attachFixed(node, true)
            this.finishPreservation()
            if (this.pending) {
                this.refine(node.length, node.length)
                for (const read of this.readers ?? []) read(node)
                this.readers = undefined
            }
            return
        }
        const ready = compactLayout(node, ctx)
        if (isPending(ready, ctx)) {
            this.placements = node
            this.refine(node.length, node.length)
            for (const read of this.readers ?? []) read(node)
            this.readers = undefined
        }
        return continueGraphTransition(ready, ctx, layout => this.publish(layout))
    }

    attachFixed(node, complete) {
        // Keep the old listener through potentially synchronous preparation.
        // Unchanged fragments already published at these same coordinates.
        const publishedPrefix = complete && this.fixedUse ? this.fixedHead : undefined
        fixedPayloads(node, this.operationContext)
        this.detachFixed()
        this.fixedHead = complete ? undefined : node
        if (complete) this.placements = node
        this.fixedStorage = complete ? node : undefined
        this.followFixed(publishedPrefix)
    }

    followFixed(publishedPrefix) {
        const node = this.fixedStorage ?? this.fixedHead
        if (!node || this.fixedUse) return
        const delivery = node.delivery
        const use = this.fixedUse = {
            deliver: (first, p, count) => {
                for (let index = first; index < first + count; index++) this.versionAt(index, p)
            },
            finish: this.fixedStorage ? () => this.publish(resolvedFixedLayout(node)) : undefined,
        }
        if (!delivery?.subscribe(use) && this.fixedStorage) return this.publish(resolvedFixedLayout(node))
        followFixedChildren(node, use, 0, publishedPrefix)
        this.indexFixed(publishedPrefix)
    }

    indexFixed(publishedPrefix) {
        const node = this.fixedStorage ?? this.fixedHead, use = this.fixedUse
        if (!this.indexed?.size || !node || !use || use.indexed) return
        use.indexed = true
        node.delivery?.index(use)
        followFixedChildren(node, use, 0, publishedPrefix, true)
    }

    removeIndex(owner) {
        if (!this.indexed?.delete(owner)) return
        if (!this.indexed.size) this.unindexFixed()
        this.suspendPublication()
    }

    unindexFixed() {
        const use = this.fixedUse
        if (!use?.indexed) return
        use.indexed = false
        ;(this.fixedStorage ?? this.fixedHead)?.delivery?.unindex(use)
    }

    detachFixed() {
        const node = this.fixedStorage ?? this.fixedHead
        this.unindexFixed()
        node?.delivery?.unsubscribe(this.fixedUse)
        this.fixedUse = undefined
    }

    resumeLayout() {
        if (this.preservation)
            this.preservation.release ??= retainOperands(this.preservation.operands, this.operationContext, this.producers.backing)
        if (this.publication) {
            const ready = this.publication.attach(this)
            if (this.pending && ready) this.settlement = ready
            markPromiseHandled(ready, this.operationContext)
        }
        this.followFixed()
    }

    updatePreservationReaders() {
        const preservation = this.preservation
        if (!preservation) return
        if (this.gates?.size || this.readers?.size) {
            // Point and range captures can outlive the destination. They own
            // one pooled read use independently of any logical Array owner.
            preservation.readers ??= retainOperands(preservation.operands, this.operationContext)
        } else if (preservation.readers) {
            const release = preservation.readers
            preservation.readers = undefined
            release()
        }
    }

    suspendPublication() {
        this.updatePreservationReaders()
        if (!this.publication || this.producers.backing.owners.size || this.gates?.size || this.readers?.size || this.indexed?.size) return
        this.publication.region = undefined
        const release = this.preservation?.release
        if (release) { this.preservation.release = undefined; release() }
    }

    finishPreservation() {
        const preservation = this.preservation
        this.preservation = undefined
        preservation?.readers?.()
        preservation?.release?.()
    }

    releaseLayout() {
        this.suspendPublication()
        this.detachFixed()
    }

    publish(node) {
        const ctx = this.operationContext
        this.detachFixed()
        this.fixedStorage = this.fixedHead = undefined
        // A counter counted the whole open range. Project only actual stored
        // outputs and already requested point gates when replacing that count.
        if (this.indexed?.size) storedPlacements(node, index => this.versionAt(index))
        const terminal = new LayoutRegion(implicitLayout(node))
        for (const owner of this.indexed ?? []) {
            const range = ArrayView.implicitRange(owner, ctx)
            let errors = 0
            range?.intervals((first, end) => {
                if (first < node.length) errors += terminal.counts(first, Math.min(end, node.length)).poison
            })
            publishRegionCount(owner, errors, terminal, range && this.restrictRange(range, node.length), ctx)
        }
        this.indexed = undefined
        this.end = node.length
        this.layout = terminal.layout
        // A materialized point has its own ordinary backing version and parent
        // edges. Keep a single source of truth for every published key.
        for (const index of this.pointKeys()) if (terminal.versionAt(index))
            this.layout = join(join(restrict(this.layout, 0, index), span(1)), restrict(this.layout, index + 1, node.length))
        ArrayView.linkRegionChildren(this.producers.backing, this, ctx)
        this.implicit = Boolean(this.layout.covered)
        this.pending = false
        try {
            this.shape?.complete(node.length)
            storedPlacements(node, (index, placement) => {
                if (!getOwnPlacementVersion(this.producers, index, ctx)) transferPlacement(placement, this.producers, String(index), ctx,
                    undefined, undefined, false)
            })
            for (const read of this.readers ?? []) read(node, terminal)
        } finally {
            this.finishPreservation()
            this.sequence = this.placements = this.gates = this.producers = this.readers = this.shape = this.settlement = undefined
        }
    }
}

export { ArrayRegion }
