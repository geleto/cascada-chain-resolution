import { LinkedWidth } from "./array-width.js"
import { continueGraphTransition, decideInputs } from "./internal-step.js"
import { ArrayView } from "./array-view.js"
import { readLanguagePlacement } from "./language-properties.js"
import { anyPresent, capacityPlacement, captureLayout, span, layoutAt, MAX_ARRAY_LENGTH, MAX_COUNT, projectLoss, restrict, searchRuns, skippedRun } from "./array-layout.js"
import { guaranteedOldWindow, captureOrder, fixed, inRange, markerSequence, sequenceExtent, splitSequence, dropSequence, watch } from "./array-sequence.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import { releaseOnClose } from "./operation-lifecycle.js"
import { insertionRun, InsertionThreshold } from "./array-insertion-ranks.js"

const add = (a, b) => a + Math.min(MAX_COUNT - a, b)

const empty = span(0)

function unorderedOccurrences(source, ctx, wake, unrestrictedSearch = false) {
    const sequence = captureOrder(source, ctx)
    const part = currentPart(sequence)
    if (part?.parts || part?.split || part?.origins || part?.obstructions || part?.awaitSelection || part && !part.node && part.tail.length)
        return new JoinedOccurrences(sequence, ctx, wake, source, unrestrictedSearch)
}

class InsertionOccurrences {
    constructor(run, ctx, wake, unrestrictedSearch) {
        this.run = run
        this.ctx = ctx
        this.wake = wake
        this.unrestrictedSearch = unrestrictedSearch
        this.used = []
        this.firstGroup = this.scan = 0
        this.changed = () => {
            this.scan = this.firstGroup
            this.wake?.()
        }
        const initial = run.groups[0].base
        if (initial) this.base = new JoinedOccurrences(initial, ctx, this.changed, undefined, unrestrictedSearch)
    }
    threshold(previous, bound, needed) {
        if (!needed) { previous?.close(); return }
        if (previous) { previous.move(bound); return previous }
        return new InsertionThreshold(this.run.coordinates(), bound, this.changed)
    }
    window(first, end) {
        if (first !== this.first) {
            this.lower = this.threshold(this.lower, first, first > 0)
            this.first = first
        }
        if (end !== this.end) {
            this.upper = this.threshold(this.upper, end, end < this.run.length)
            this.end = end
        }
        this.scan = this.firstGroup
    }
    next(first, end, search, splitRanks) {
        const { groups, length } = this.run
        const ranks = !search || !this.unrestrictedSearch ? this.run.coordinates() : undefined
        const use = search && !this.unrestrictedSearch && (this.searchUse ??= {})
        if (first !== this.first || end !== this.end) this.window(first, end)
        while (this.scan < groups.length) {
            const i = this.scan, { node, width, cut } = groups[i], local = this.used[i] ?? 0
            if (local === width) { this.scan++; continue }
            const start = Math.max(0, this.lower?.edge(i, true) ?? 0)
            const stop = Math.min(width, this.upper?.edge(i, false) ?? width)
            if (!node) {
                const item = this.base.next(start, stop, search, !this.unrestrictedSearch)
                if (this.base.done(Math.max(0, this.lower?.edge(i, false) ?? 0))) {
                    this.base.close(); this.base = undefined; this.consume(i, width)
                }
                if (!item) { this.scan++; continue }
                const ctx = this.ctx
                const index = (delta = 0) => continueGraphTransition(item.position(delta), ctx, n => ranks.position(i, n))
                return { ...item, high: length - 1, position: index, ranks,
                    eligible: (bound, delta, work) => ranks.eligible(bound, i, item.low + delta, item.high + delta,
                        () => item.position(delta), work, use),
                    first: () => both(item.first(), ranks.endpoint(i), ctx),
                    last: () => both(item.last(), ranks.reversed().endpoint(i), ctx),
                    fromEnd: () => continueGraphTransition(item.fromEnd(), ctx, n => ranks.reversed().position(i, n)) }
            }
            if (local < start || local >= stop) { this.scan++; continue }
            // Search visits captured runs without assigning their occurrences
            // consecutive numeric positions across a later insertion.
            const group = search && restrict(node, local, width)
            const position = (delta = 0) => ranks.position(i, local + delta)
            let markers
            if (!search && node.skipped) {
                position()
                markers = skippedRun(node, local, local + (splitRanks ? 1 : ranks.contiguous(i, local, stop - local)))
            }
            this.consume(i, group ? width : local + (markers?.length ?? 1))
            return { low: (cut?.minimum ?? 0) + local, high: length - width + local, position, group, markers, ranks,
                eligible: (bound, delta, work) => ranks.eligible(bound, i, local + delta, local + delta, undefined, work, use),
                first: () => !local && ranks.endpoint(i),
                last: () => local + 1 === width && ranks.reversed().endpoint(i),
                fromEnd: () => ranks.reversed().position(i, width - 1 - local),
                read: () => layoutAt(node, local) ?? { present: false, value: undefined } }
        }
    }
    consume(i, count) {
        this.used[i] = count
        const { groups } = this.run
        while (this.firstGroup < groups.length && this.used[this.firstGroup] === groups[this.firstGroup].width)
            this.firstGroup++
    }
    done() { return this.firstGroup === this.run.groups.length }
    close() {
        this.lower?.close()
        this.upper?.close()
        this.base?.close()
        this.base = undefined
        this.run = this.wake = this.used = this.lower = this.upper = undefined
    }
}

function both(a, b, ctx) {
    if (a === false || b === false) return false
    if (a === true || b === true) return a === true ? b : a
    return decideInputs([a, b], ctx, (_inputs, present, remaining) => !present ? false : remaining ? undefined : true)
}

// Each leaf owns its local occurrences. Prefix and suffix widths determine
// their coordinates independently. A demand skips unavailable or spent runs.
class JoinedOccurrences {
    constructor(sequence, ctx, wake, source, unrestrictedSearch) {
        this.prefixLength = source ? ArrayView.prefixLength(source, ctx) : 0
        if (this.prefixLength) this.source = source
        this.ctx = ctx
        this.unrestrictedSearch = unrestrictedSearch
        this.wake = wake
        this.releases = new Set()
        this.root = this.leaf(sequence)
    }
    leaf(part) {
        const leaf = contribution(part)
        const release = watch(part, (minimum, maximum) => {
            if (!this.wake || leaf.part !== part) return
            leaf.minimum = minimum
            leaf.maximum = maximum
            if (minimum === maximum) this.unwatch(leaf)
            refresh(leaf)
            this.wake?.()
        })
        if (release) { leaf.unwatch = release; this.releases.add(release) }
        return leaf
    }
    unwatch(leaf) {
        if (!leaf.unwatch) return
        leaf.unwatch()
        this.releases.delete(leaf.unwatch)
        leaf.unwatch = undefined
    }
    expand(node, parts) {
        const source = node.part
        this.unwatch(node)
        // A shared contribution can represent exponentially many occurrences.
        // Open each occurrence only when demand reaches it. Rebalance unique
        // command history iteratively so it cannot deepen the delivery stack.
        this.shared ??= sharedBranches(source)
        node.capacityCause = source.capacityCause
        node.width = source.length
        // Cropped and padded siblings can have correlated widths. Keep an
        // exact enclosing width even while its internal boundary is pending.
        if (source.minimum === source.maximum) node.exactWidth = source.minimum
        const leaves = [], todo = [parts[1], parts[0]]
        while (todo.length) {
            const part = todo.pop()
            if (part.parts && !this.shared.has(part)) todo.push(part.parts[1], part.parts[0])
            else leaves.push(this.leaf(part))
        }
        function build(first, end, parent = {}) {
            if (end - first === 1) return leaves[first]
            const middle = first + Math.floor((end - first) / 2)
            return branch(parent, build(first, middle), build(middle, end))
        }
        build(0, leaves.length, node)
    }
    next(first, end, search = false, splitRanks = false) {
        const { ctx, root } = this, todo = [[root, first, end, 0, 0]]
        while (todo.length) {
            const [node, from, to, low, high, origin] = todo.pop()
            if (!node.available || to <= 0 || node.maximum <= from) continue
            const current = currentPart(node.part)
            if (current?.awaitSelection && !current.origins && !current.parts && !current.split &&
                node.used >= current.head.length && !current.tail.length) {
                if (!node.resumeChoice) {
                    let release
                    release = current.awaitSelection(() => {
                        this.releases.delete(release)
                        node.resumeChoice = undefined
                        this.wake?.()
                    })
                    if (release) {
                        this.releases.add(release)
                        node.resumeChoice = release
                    }
                }
                if (node.resumeChoice) continue
            }
            if (!node.used && !node.inner && current?.origins && !origin && !node.part.capacityInput &&
                root.maximum < MAX_COUNT && low >= this.prefixLength && high <= MAX_ARRAY_LENGTH - current.maximum) {
                const run = insertionRun(current, currentPart)
                if (run) {
                    node.inner = new InsertionOccurrences(run, ctx, this.wake, this.unrestrictedSearch)
                    ;(this.inners ??= new Set()).add(node.inner)
                }
            }
            if (node.inner) {
                const inner = node.inner, part = node.part
                const item = inner.next(Math.max(0, from), to, search, splitRanks)
                if (inner.done()) {
                    this.inners.delete(inner)
                    inner.close()
                    node.inner = undefined
                    this.unwatch(node)
                    node.width = part.length
                    node.used = node.maximum
                    refresh(node)
                }
                if (item) return node === root ? item : occurrence(node, part, low, high, item, root, ctx)
                continue
            }
            // Every comparison in this contribution needs the same earlier
            // status. Resume once and compare its actual runs.
            if (search && current?.status) {
                if (!this.waiting?.has(current.status)) {
                    (this.waiting ??= new WeakSet()).add(current.status)
                    markPromiseHandled(continueGraphTransition(current.status, ctx, () => this.wake?.()), ctx)
                }
                continue
            }
            const parts = !node.used && !current?.origins && (current && (current.parts ?? splitSequence(current, ctx)))
            if (!node.used && current?.origins) {
                const { source, added, cut } = current.origins
                this.unwatch(node)
                node.cut = cut
                node.length = node.part.length
                node.capacityCause = node.part.capacityCause
                branch(node, this.leaf(source), this.leaf(fixed(added)))
                const release = watch(cut, () => {
                    for (let parent = node; parent; parent = parent.parent) summarize(parent)
                    this.wake?.()
                })
                if (release) this.releases.add(release)
            } else if (parts) this.expand(node, parts)
            else if (current?.parts && node.used) {
                // This leaf previously delivered a numeric prefix. Its newly
                // available structure can expose only the remaining occurrences.
                this.unwatch(node)
                node.width = node.part.length
                branch(node, contribution(fixed(span(node.used)), node.used),
                    this.leaf(dropSequence(node.part, node.used, false, ctx)))
            } else if (!node.used && current && !current.node && !current.origins && !current.status &&
                !node.part.capacityInput && current.tail.length) {
                // These final occurrences survive even if their numeric indexes
                // depend on an earlier contribution that never closes.
                this.expand(node, [dropSequence(current, current.tail.length, true, ctx), fixed(current.tail)])
            }
            if (node.left) {
                if (node.cut) {
                    const { minimum, maximum } = node.cut, width = node.right.maximum
                    todo.push([node.right, from - minimum, to - maximum, low, high, origin ?? node],
                        [node.left, ...guaranteedOldWindow(from, to, node.cut, width), low, high, origin ?? node])
                } else {
                    todo.push([node.right, from - node.left.minimum, to - node.left.maximum,
                        origin ? low : add(low, node.left.minimum), origin ? high : add(high, node.left.maximum), origin],
                        [node.left, from, to, low, high, origin])
                }
                continue
            }
            const { used, part } = node
            if (used < from || used >= to) continue
            const absolute = low + used, physical = !origin && low === high && absolute < this.prefixLength
            // Compare the first physical slot directly. A sparse miss can
            // then skip whole hole runs without expanding the backing.
            if (physical && search && absolute && !this.prefixLayout && ArrayView.hasSparsePrefix(this.source, this.prefixLength, ctx))
                this.prefixLayout = captureLayout(this.source, ctx, this.prefixLength)
            const layout = physical ? this.prefixLayout ? restrict(this.prefixLayout, low, this.prefixLength) : empty : part.capacityInput ? part.head :
                current.node ?? current.head
            // Each contiguous skip earns the next position, including when
            // the whole run still has a pending numeric starting position.
            const stop = Math.min(node.minimum, layout.length, splitRanks && !search ? used + 1 : MAX_COUNT, search || origin ? to : MAX_COUNT - high)
            const projection = origin || root.maximum > MAX_ARRAY_LENGTH && Math.max(stop, used + 1) > MAX_ARRAY_LENGTH - high
                ? projectionAt(node, used, origin) : undefined
            const limit = Math.min(stop, projection?.end ?? stop,
                !search && projection?.crossesCut ? used + 1 : MAX_COUNT), loss = projection?.cause
            let group, markers, start = used, provisional = false
            // A permanent cause survives a move across the native boundary.
            // Every other occurrence needs one side of that boundary proved.
            if (used < stop && layout.errors === layout.length) {
                group = markers = restrict(layout, used, origin ? limit : stop)
            } else if (loss && used < limit) {
                const lost = projectLoss(restrict(layout, used, limit), loss, ctx, !search)
                group = lost
                if (!search || lost.errors === lost.length) markers = lost
            } else if (projection?.uncertain) {
                const range = used < limit && restrict(layout, used, limit)
                if (search && range?.errors) {
                    if (range.errors === range.length) group = markers = range
                    else {
                        // Permanent causes are eligible on either side of the
                        // native limit. Search them together; healthy slots in
                        // this same run still need their capacity outcome.
                        start = Math.max(used, node.reportedEnd ?? 0)
                        if (start < limit) {
                            node.reportedEnd = limit
                            group = markers = restrict(layout, start, limit)
                            provisional = true
                        }
                    }
                } else if (range?.errors) {
                    const leading = searchRuns(range, used, false).next().value.node
                    if (leading.errors === leading.length) group = markers = leading
                }
                if (!group) {
                    // The undecided occurrence cannot hold up permanent causes or
                    // a definitely virtual suffix of the same fixed contribution.
                    if (!range || node.minimum !== node.maximum || layout.length !== node.minimum) continue
                    const split = !search && range.errors ? used + range.left.length : limit
                    if (split === layout.length || split >= to) continue
                    const left = contribution(fixed(restrict(layout, 0, split)), used)
                    left.reportedEnd = node.reportedEnd
                    branch(node, left, contribution(fixed(restrict(layout, split, layout.length))))
                    todo.push([node, from, to, low, high, origin])
                    continue
                }
            } else if (used < limit) {
                if (search) group = restrict(layout, used, limit)
                else if (layout.skipped) markers = skippedRun(layout, used, limit)
            }
            // Each contiguous proved skip opens the next place in the window.
            // Stay on the same side of every capacity boundary and insertion.
            let capturedMarkers
            if (!splitRanks && current.obstructions && !physical && !origin && !markers && !group && !loss && !projection?.uncertain) {
                const boundary = projection ?? (root.maximum > MAX_ARRAY_LENGTH ? projectionAt(node, used) : undefined)
                const limit = Math.min(node.minimum, MAX_ARRAY_LENGTH - high, boundary?.end ?? MAX_COUNT)
                if (!boundary?.cause && !boundary?.uncertain && used + 1 < limit) {
                    const end = current.obstructions.end(used, limit)
                    if (end > used + 1) capturedMarkers = markerSequence(current, used, end, ctx)
                }
            }
            if (!provisional) {
                node.used += group?.length ?? markers?.length ?? capturedMarkers?.length ?? 1
                refresh(node)
            }
            const read = () => {
                if (physical) return readLanguagePlacement(this.source, absolute, ctx)
                if (capturedMarkers) return capturedMarkers.point(0, false)
                if (markers) return layoutAt(markers, 0)
                const p = part.point(used, false)
                return loss ? continueGraphTransition(p, ctx, selected => capacityPlacement(selected, loss, ctx)) : p
            }
            const bounds = origin && start !== used ? projectionAt(node, start, origin) : projection
            const position = (delta = 0) => origin ? insertionPosition(node, origin, start + delta, ctx) : start + delta
            return occurrence(origin ?? node, origin ?? part, low, high,
                { low: bounds?.localLow ?? start, high: bounds?.localHigh ?? start, position, group, markers, capturedMarkers, read }, root, ctx)
        }
    }
    done(first = 0) { return this.root.frontier === MAX_COUNT || this.root.remainingEnd <= first }
    get firstUnread() { return this.root.frontier }
    releasePrefix() { this.prefixLength = 0; this.source = this.prefixLayout = undefined }
    close() {
        for (const release of this.releases) release()
        for (const inner of this.inners ?? []) inner.close()
        this.inners = undefined
        this.root = this.releases = this.wake = this.shared = this.source = this.prefixLayout = undefined
    }
}

// Translate a local occurrence once. Prefix and suffix metadata can settle
// independently, including for an insertion whose precise rank is pending.
function occurrence(node, part, low, high, local, root, ctx) {
    const before = () => node.prefix ??= outsideWidth(node, false, ctx)
    const position = !high ? local.position : local.ranks ? delta =>
        local.ranks.shifted(local.position(delta), low === high ? low : before()) :
        delta => low === high ? continueGraphTransition(local.position(delta), ctx, i => low + i) :
        continueGraphTransition(before(), ctx, n => continueGraphTransition(local.position(delta), ctx, i => n + i))
    const none = value => continueGraphTransition(value, ctx, present => !present)
    return { ...local, low: low + local.low, high: high + local.high, position,
        eligible: local.eligible && ((bound, delta, work) => local.eligible(
            low === high && typeof bound === "number" ? bound - low :
                node.searchBound ??= relativeSearchBound(node, bound, work), delta, work)),
        first: () => local.first ? both(local.first(), none(outsidePresent(node, false, ctx)), ctx) :
            !local.low && none(either(continueGraphTransition(local.position(), ctx, i => i > 0),
            outsidePresent(node, false, ctx), ctx)),
        last: () => local.last ? both(local.last(), none(outsidePresent(node, true, ctx)), ctx) :
            local.high < node.minimum - 1 ? false : none(either(
            continueGraphTransition(local.position(), ctx, i => inRange(part, i + 1)), outsidePresent(node, true, ctx), ctx)),
        fromEnd() {
            const suffix = node.suffix ??= outsideWidth(node, true, ctx)
            if (local.fromEnd) return local.ranks.shifted(local.fromEnd(), suffix)
            const extent = node.minimum === node.maximum ? node.minimum : part.length
            return continueGraphTransition(suffix, ctx, n => continueGraphTransition(extent, ctx, width =>
                continueGraphTransition(local.position(), ctx, i => {
                    const after = add(n, width - i - 1)
                    return !root.clips || after <= MAX_COUNT - 1 - (high + i) ? after :
                        continueGraphTransition(position(), ctx, at => Math.min(after, MAX_COUNT - 1 - at))
                })))
        } }
}

// A search in a joined contribution needs its fromIndex relative to that
// contribution. Track the widths still able to move the threshold. Keep
// this question alive after discovery releases its tree and until the
// comparison or its owner finishes.
function relativeSearchBound(node, bound, work) {
    const ctx = work.operationContext, terms = [], stack = []
    let minimum = 0, maximum = 0
    for (let parent = node.parent; parent; node = parent, parent = node.parent)
        if (node === parent.right) stack.push(parent.left)
    while (stack.length) {
        const side = stack.pop()
        if (side.minimum !== side.maximum && side.left) {
            stack.push(side.left, side.right)
            continue
        }
        minimum += side.minimum
        maximum += side.maximum
        if (side.minimum !== side.maximum) terms.push(sequenceExtent(side.part))
    }
    let start = typeof bound === "number" ? bound : bound.minimum
    let end = typeof bound === "number" ? bound : bound.maximum
    const low = Math.max(0, start - maximum), high = Math.max(0, end - minimum)
    if (low === high) return low
    const result = LinkedWidth.pending(low, high, ctx), releases = []
    let unregister
    const release = () => {
        for (const remove of releases) remove()
        releases.length = 0
        unregister?.()
    }
    const update = active => {
        if (!work.open || result.minimum === result.maximum) return
        const lo = Math.max(0, start - maximum), hi = Math.max(0, end - minimum)
        result.narrow(lo, hi, active)
        if (lo === hi) release()
    }
    for (const term of terms) {
        let low = term.minimum, high = term.maximum
        const remove = watch(term, (lo, hi, active) => {
            minimum += lo - low
            maximum += hi - high
            low = lo; high = hi
            update(active)
        })
        if (remove) releases.push(remove)
    }
    if (typeof bound !== "number") {
        const remove = watch(bound, (lo, hi, active) => { start = lo; end = hi; update(active) })
        if (remove) releases.push(remove)
    }
    if (result.minimum !== result.maximum) unregister = releaseOnClose(work, release)
    return result
}

// Rank follows the path only when a consumer asks for the numeric index.
function insertionPosition(node, origin, index, ctx) {
    while (node !== origin) {
        const parent = node.parent, cut = parent.cut
        if (cut && node === parent.left) {
            const width = parent.right.maximum
            index = continueGraphTransition(index, ctx, i => continueGraphTransition(inRange(cut, i), ctx,
                before => before ? i : i + width))
        } else if (node === parent.right) {
            const offset = cut ? cut.minimum === cut.maximum ? cut.minimum : cut.length : width(parent.left, ctx)
            index = continueGraphTransition(index, ctx, i => continueGraphTransition(offset, ctx, n => add(n, i)))
        }
        node = parent
    }
    return index
}

function currentPart(sequence) {
    let part = sequence?.capacityInput ?? sequence
    while (part && !part.parts && !part.origins) {
        const child = part.current
        if (!child) break
        part = child
    }
    return part
}

// Lift a run through each enclosing command. Split it at cut knees and
// native boundaries so its coordinate bounds advance uniformly across it.
function projectionAt(node, used, origin) {
    let low = used, high = used, room = MAX_COUNT - used, cause, uncertain, localLow, localHigh, crossesCut
    for (let parent = node.parent; parent; node = parent, parent = node.parent) {
        const cut = parent.cut
        if (cut && node === parent.left) {
            const width = parent.right.maximum
            if (low < cut.maximum) room = Math.min(room, cut.maximum - low)
            else low = add(low, width)
            if (high < cut.minimum) room = Math.min(room, cut.minimum - high)
            else high = add(high, width)
            // A cursor's skip credit must name a contiguous range. A cut
            // inside it can separate consecutive old slots.
            if (cut.minimum !== cut.maximum && low !== high) crossesCut = true
        } else if (node === parent.right) {
            low = add(low, (cut ?? parent.left).minimum)
            high = add(high, (cut ?? parent.left).maximum)
        }
        if (parent === origin) { localLow = low; localHigh = high }
        if (!parent.capacityCause || cause || uncertain) continue
        if (low >= MAX_ARRAY_LENGTH) cause = parent.capacityCause
        else if (high >= MAX_ARRAY_LENGTH) { uncertain = true; room = Math.min(room, MAX_ARRAY_LENGTH - low) }
        else room = Math.min(room, MAX_ARRAY_LENGTH - high)
    }
    return { end: used + room, cause, uncertain, localLow, localHigh, crossesCut }
}

function sharedBranches(root) {
    const visited = new Set(), shared = new WeakSet(), todo = [root]
    // Count materialized branches. A deferred occurrence opens only when
    // the cursor reaches it, including when it already has a known prefix.
    while (todo.length) {
        const part = todo.pop(), children = (part.capacityInput ?? part).parts
        if (!children) continue
        if (visited.has(part)) shared.add(part)
        else { visited.add(part); todo.push(...children) }
    }
    return shared
}
function contribution(part, used = 0) {
    return { part, used, minimum: part.minimum, maximum: part.maximum, available: used < part.minimum,
        frontier: used < part.maximum ? used : MAX_COUNT, remainingEnd: used < part.maximum ? part.maximum : 0 }
}
function branch(node, left, right) {
    node.left = left
    node.right = right
    node.part = undefined
    left.parent = right.parent = node
    summarize(node)
    return node
}
function summarize(node) {
    const { left, right } = node
    const minimum = node.exactWidth ?? add(left.minimum, right.minimum)
    const maximum = node.exactWidth ?? add(left.maximum, right.maximum)
    node.minimum = minimum
    node.maximum = maximum
    node.clips = left.clips || right.clips || right.maximum > MAX_COUNT - left.maximum
    node.available = left.available || right.available
    if (node.cut) {
        const { minimum: cutMin, maximum: cutMax } = node.cut, width = right.maximum
        node.frontier = Math.min(left.frontier < cutMax ? left.frontier : add(left.frontier, width), add(cutMin, right.frontier))
        node.remainingEnd = Math.max(left.remainingEnd <= cutMin ? left.remainingEnd : add(left.remainingEnd, width),
            right.remainingEnd ? add(cutMax, right.remainingEnd) : 0)
    } else {
        node.frontier = Math.min(left.frontier, add(left.minimum, right.frontier))
        node.remainingEnd = right.remainingEnd ? add(left.maximum, right.remainingEnd) : left.remainingEnd
    }
}
function refresh(leaf) {
    leaf.available = leaf.used < leaf.minimum
    leaf.frontier = leaf.used === leaf.maximum ? MAX_COUNT : leaf.used
    leaf.remainingEnd = leaf.used < leaf.maximum ? leaf.maximum : 0
    if (leaf.frontier === MAX_COUNT) leaf.part = undefined
    for (let node = leaf.parent; node; node = node.parent) summarize(node)
}
function outsideWidth(node, suffix, ctx) {
    let total = 0
    for (let parent = node.parent; parent; node = parent, parent = node.parent) {
        const other = suffix ? parent.right : parent.left
        if (node !== other) {
            const n = width(other, ctx)
            if (total === 0) total = n
            else if (n !== 0) total = continueGraphTransition(total, ctx, a => continueGraphTransition(n, ctx, b => add(a, b)))
        }
    }
    return total
}
function width(node, ctx) {
    if (node.minimum === node.maximum) return node.minimum
    if (node.cut) return node.length
    if (!node.left) return node.width ?? node.part.length
    if (node.width === undefined) {
        const a = width(node.left, ctx), b = width(node.right, ctx)
        node.width = continueGraphTransition(a, ctx, n => continueGraphTransition(b, ctx, m => add(n, m)))
    }
    return node.width
}

// A single nonempty sibling proves a Boolean endpoint even if the total
// width of other siblings never settles. Numeric metadata still needs width.
function either(a, b, ctx) {
    if (a === true || b === true) return true
    if (a === false || b === false) return a === false ? b : a
    return anyPresent([a, b], ctx)
}
function present(node, ctx) {
    if (node.minimum) return true
    if (!node.maximum) return false
    return node.present ??= node.left ? either(present(node.left, ctx), present(node.right, ctx), ctx) :
        inRange(node.part, 0)
}
function outsidePresent(node, suffix, ctx) {
    const sides = []
    for (let parent = node.parent; parent; node = parent, parent = node.parent) {
        const other = suffix ? parent.right : parent.left
        if (node === other) continue
        if (other.minimum) return true
        if (other.maximum) sides.push(other)
    }
    return sides.reduce((answer, side) => either(answer, present(side, ctx), ctx), false)
}

export { unorderedOccurrences }
