import { anyPresent, join, MAX_ARRAY_LENGTH, restrict, span } from "./array-layout.js"
import { possibleOldBounds, inRange, sequenceExtent, watch } from "./array-sequence.js"
import { continueGraphTransition } from "./internal-step.js"
import { releaseOnClose } from "./operation-lifecycle.js"
import { markPromiseHandled } from "./thenable-subscription.js"

// Undo insertions newest first. Free slots in final coordinates are exactly
// the preceding command's output. Removing a run occupies its free slots,
// including any intervening slots already occupied by a newer insertion.
const occupied = { value: true, present: true }
const zero = { minimum: 0, maximum: 0, length: 0 }
function freeSlot(tree, rank) {
    let offset = 0
    while (tree.left) {
        const left = tree.left, free = left.length - left.covered
        if (rank < free) tree = left
        else { rank -= free; offset += left.length; tree = tree.right }
    }
    return offset + rank
}
function occupy(tree, start, width) {
    const first = freeSlot(tree, start), end = freeSlot(tree, start + width - 1) + 1
    return join(join(restrict(tree, 0, first), span(end - first, occupied)), restrict(tree, end, tree.length))
}

// A captured run shares its rank questions across readers. This part keeps
// only widths, cuts and slot occupancy. A delivered index can outlive every
// value and cursor. A later group's exact rank never depends on older cuts.
class InsertionRanks {
    constructor(groups, length, ctx) {
        this.records = groups.map(({ cut, backCut, width, before, extent, atEnd }) => {
            if (extent) {
                const size = sequenceExtent(extent)
                cut = atEnd ? size : zero
                backCut = atEnd ? zero : size
            }
            return { cut, backCut, width, before }
        })
        this.length = length
        this.free = span(length)
        this.next = this.records.length - 1
        this.target = this.records.length
        this.ctx = ctx
    }
    advance() {
        while (this.next >= this.target) {
            const record = this.records[this.next], { cut, width } = record
            if (cut && cut.minimum !== cut.maximum) {
                this.projectPending()
                break
            }
            const start = cut?.minimum ?? 0, free = this.free
            record.start = freeSlot(free, start)
            if (width > 1 && freeSlot(free, start + width - 1) !== record.start + width - 1) {
                record.free = free
                record.rank = start
            }
            for (const [local, question] of record.questions ?? []) question.resolve(this.at(record, local))
            record.questions = undefined
            this.free = this.next ? occupy(free, start, width) : undefined
            this.next--
        }
    }
    projectPending() {
        let low = this.free, high = low
        this.projected = []
        const releases = this.releases = []
        const changed = () => {
            if (this.releases !== releases) return
            for (const release of releases) release()
            this.releases = this.projected = undefined
            this.advance()
        }
        for (let i = this.next; i >= this.target; i--) {
            const record = this.records[i], { cut, width, before } = record
            const minimum = cut?.minimum ?? 0, maximum = cut?.maximum ?? 0
            if (minimum !== maximum) {
                this.releases.push(watch(cut, changed))
                // Every real predecessor occurrence can still be on either
                // side. Nothing earlier needs a subscription until this cut
                // narrows, even when the predecessor's own length is open.
                if (!minimum && maximum === before) { this.barrier = i; return }
            }
            const bounds = this.projected[i] = { low, high, minimum, maximum }
            for (const [local, question] of record.questions ?? []) {
                const [a, b] = limits(bounds, local)
                if (a === b) { record.questions.delete(local); question.resolve(a) }
            }
            if (i) { low = occupy(low, maximum, width); high = occupy(high, minimum, width) }
        }
        this.barrier = undefined
    }
    at(record, local) { return record.free ? freeSlot(record.free, record.rank + local) : record.start + local }
    contiguous(group, local, count) {
        const record = this.records[group]
        if (group === this.records.length - 1 || record.start !== undefined && !record.free) return count
        if (!record.free) return 1
        const start = this.at(record, local)
        let low = 1, high = count
        while (low < high) {
            const mid = low + Math.ceil((high - low) / 2)
            if (this.at(record, local + mid - 1) === start + mid - 1) low = mid
            else high = mid - 1
        }
        return low
    }
    position(group, local) {
        if (group < this.target) {
            this.target = group
            if (!this.releases) this.advance()
            else if (this.barrier === undefined) {
                for (const release of this.releases) release()
                this.projectPending()
            }
        }
        const record = this.records[group]
        if (record.start !== undefined) return this.at(record, local)
        const bounds = this.projected?.[group]
        if (bounds) {
            const [low, high] = limits(bounds, local)
            if (low === high) return low
        }
        const questions = record.questions ??= new Map()
        if (!questions.has(local)) questions.set(local, Promise.withResolvers())
        return questions.get(local).promise
    }
    shifted(rank, offset) {
        if (offset === 0 || rank === 0) return offset === 0 ? rank : offset
        if (typeof rank === "number" && typeof offset === "number") return rank + offset
        // The same pending rank under the same captured join is one numeric
        // fact across readers. Neither the reader nor either payload enters
        // its continuation. A spent producer drops its memoized projections.
        const key = typeof rank === "number" ? offset : rank, other = key === rank ? offset : rank
        const cache = this.shifts ??= new WeakMap()
        let offsets = cache.get(key)
        if (!offsets) { offsets = new Map(); cache.set(key, offsets) }
        if (!offsets.has(other)) offsets.set(other, continueGraphTransition(key, this.ctx, n =>
            continueGraphTransition(other, this.ctx, m => n + m)))
        return offsets.get(other)
    }
    reversed() {
        return this.reverse ??= new InsertionRanks(this.records.map(({ cut, backCut, width, before }) =>
            ({ cut: backCut, backCut: cut, width, before })), this.length, this.ctx)
    }
    eligible(bound, group, low, high, position, work, use) {
        let threshold = use.threshold
        if (!threshold) {
            threshold = use.threshold = new InsertionThreshold(this, bound)
            releaseOnClose(work, () => threshold.close())
        }
        return threshold.test(group, low, high, position, work)
    }
    endpoint(group) {
        // Being at an endpoint requires this group's own cut to select it
        // and every later cut to leave that endpoint untouched.
        if (!this.first) {
            const answers = this.first = []
            let displaced = false
            for (let i = this.records.length - 1; i >= 0; i--) {
                const { cut } = this.records[i]
                const absent = cut ? inRange(cut, 0) : false
                answers[i] = continueGraphTransition(anyPresent([absent, displaced], this.ctx), this.ctx, v => !v)
                if (cut) displaced = anyPresent([displaced, continueGraphTransition(absent, this.ctx, v => !v)], this.ctx)
            }
        }
        return this.first[group]
    }
}

// The upper extent leaves unused slots beyond an open base. No real cut or
// occurrence can select that padding. An open base keeps its own discovery
// and each earlier capacity boundary keeps its own loss rules.
function insertionRun(part, current) {
    if (!part?.origins || part.maximum > MAX_ARRAY_LENGTH) return
    const outer = part.origins
    // A pending predecessor may expose a different partition after it
    // settles. The group numbers and their coordinates belong to one capture.
    if (outer.run) return outer.run
    const length = part.maximum, groups = []
    for (;;) {
        if (part.origins) {
            const { source, added, cut, backCut } = part.origins
            groups.push({ node: added, cut, backCut, width: added.length, before: source.maximum })
            part = current(source)
        } else if (part.parts && !part.cappedEnd && part.maximum <= MAX_ARRAY_LENGTH) {
            const [left, right] = part.parts
            const atEnd = Boolean(right.node), node = atEnd ? right.node : left.node
            if (!node) break
            const extent = atEnd ? left : right
            groups.push({ node, width: node.length, before: extent.maximum, extent, atEnd })
            part = current(extent)
        } else break
    }
    if (part.maximum) groups.push({ node: part.node, base: part.node ? undefined : part, width: part.maximum, before: 0 })
    groups.reverse()
    let ranks
    return outer.run = { groups, length, coordinates() { return ranks ??= new InsertionRanks(groups, length, outer.context) } }
}

function limits(bounds, local) {
    return [freeSlot(bounds.low, bounds.minimum + local), freeSlot(bounds.high, bounds.maximum + local)]
}

// Translate a window edge or fromIndex backwards through the cuts. A
// change stops as soon as the preceding threshold is unchanged. These
// Boolean questions can settle independently of every exact rank.
class InsertionThreshold {
    constructor(ranks, bound, wake) {
        this.records = ranks.records
        this.ctx = ranks.ctx
        this.wake = wake
        this.states = []
        this.releases = []
        let low = typeof bound === "number" ? bound : bound.minimum
        let high = typeof bound === "number" ? bound : bound.maximum
        for (let i = this.records.length - 1; i >= 0; i--) {
            const { cut, width } = this.records[i]
            this.states[i] = { low, high }
            if (cut) {
                ;[low, high] = possibleOldBounds(low, high, cut, width)
                const release = watch(cut, () => this.update(i))
                if (release) this.releases.push(release)
            }
        }
        if (typeof bound !== "number") {
            const release = watch(bound, (lo, hi) => this.move(lo, hi))
            if (release) this.releases.push(release)
        }
    }
    close() {
        for (const release of this.releases) release()
        this.states = this.records = this.releases = this.wake = undefined
    }
    move(low, high = low) {
        if (!this.states) return
        const i = this.records.length - 1
        this.states[i].low = low
        this.states[i].high = high
        this.update(i)
    }
    edge(i, lower) {
        const cut = this.records[i].cut, state = this.states[i]
        return lower ? state.high - (cut?.minimum ?? 0) : state.low - (cut?.maximum ?? 0)
    }
    answer(i, low, high) {
        if (low >= this.edge(i, true)) return true
        if (high < this.edge(i, false)) return false
    }
    update(i) {
        if (!this.states) return
        for (; i >= 0; i--) {
            const state = this.states[i], { cut, width } = this.records[i]
            for (const q of state.questions ?? []) {
                const answer = this.answer(i, q.low, q.high)
                if (answer !== undefined) { state.questions.delete(q); q.resolve(answer) }
            }
            if (!i) break
            const [low, high] = possibleOldBounds(state.low, state.high, cut, width)
            const preceding = this.states[i - 1]
            if (low === preceding.low && high === preceding.high) break
            preceding.low = low
            preceding.high = high
        }
        this.wake?.()
    }
    test(i, low, high, position, work) {
        const answer = this.answer(i, low, high)
        if (answer !== undefined) return answer
        const { promise, resolve } = Promise.withResolvers(), q = { low, high, resolve }
        const questions = this.states[i].questions ??= new Set()
        questions.add(q)
        if (low !== high) markPromiseHandled(continueGraphTransition(position(), this.ctx, local => {
            if (!questions.has(q)) return
            q.low = q.high = local
            this.update(i)
        }, undefined, work), this.ctx)
        return promise
    }
}

export { insertionRun, InsertionThreshold }
