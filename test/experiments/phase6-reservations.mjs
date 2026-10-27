// Experimental dependency representation, not a runtime entry point. Uses the
// existing frontier coverage and continuation helpers; path capture, authority,
// managed publication and poison policy remain the caller's responsibilities.
import { TREE_NODE } from "../../src/external-mutation-tree.js"
import { continueGraphTransition } from "../../src/internal-step.js"
import { markPromiseHandled } from "../../src/thenable-subscription.js"
import { OrderedIndex } from "./phase6-ordered-index.mjs"

const SELECTING = 0
const ACTIVE = 1
const FINISHING = 2
const COMPLETE = 3

function contains(ancestor, node) {
    if (!ancestor || !node) return false
    while (node[TREE_NODE].depth > ancestor[TREE_NODE].depth) node = node[TREE_NODE].parent
    return node === ancestor
}

function conflicts(left, right) {
    if (!left.node || !right.node || !(left.mutation || right.mutation)) return false
    return left.node === right.node || left.subtree && contains(left.node, right.node) ||
        right.subtree && contains(right.node, left.node)
}

const join = waits => waits.length > 1 ? Promise.all(waits) : waits[0]

function publish(work) {
    const { kernel } = work
    const selected = kernel.frontier(work.node)
    const memberships = work.memberships = []
    if (work.subtree) memberships.push(work.mutation ? selected.writes : selected.reads)
    for (let ancestor = work.node; ancestor; ancestor = kernel.parent(ancestor)) {
        const state = kernel.frontier(ancestor)
        memberships.push(work.mutation ? state.subtreeWrites : state.subtreeReads)
    }
    for (const membership of memberships) {
        membership.add(work)
        kernel.counts.published++
    }
}

function removeMemberships(work) {
    for (const membership of work.memberships ?? []) membership.delete(work)
    work.memberships = undefined
}

class ReservationKernel {
    constructor(root, operationContext) {
        this.root = root
        this.operationContext = operationContext
        this.frontiers = new WeakMap()
        this.groups = new WeakMap()
        this.counts = {
            inspected: 0, captured: 0, conditional: 0, published: 0, indexSteps: 0, selections: 0,
            sharedHits: 0, waitsCreated: 0, liveWaits: 0, peakWaits: 0,
        }
    }

    parent(node) { return node === this.root ? undefined : node[TREE_NODE].parent }

    frontier(node) {
        let state = this.frontiers.get(node)
        if (!state) {
            state = { reads: new Set(), writes: new Set(), subtreeReads: new Set(), subtreeWrites: new Set() }
            this.frontiers.set(node, state)
        }
        return state
    }

    reserve(node, mutation, subtree = true) { return new Reservation(this, node, mutation, subtree, ACTIVE) }
    selection(prefix, mutation) { return new Reservation(this, prefix, mutation, true, SELECTING) }

    group(node, mutation) {
        let groups = this.groups.get(node)
        if (!groups) this.groups.set(node, groups = {})
        const key = mutation ? "writes" : "reads"
        let group = groups[key]
        // A covering fixed writer can subsume a group. Subsequent selections
        // start another group, while existing captures keep their old cutoff.
        if (!group?.memberships) groups[key] = group = new ReservationGroup(this, node, mutation)
        return group
    }

    pending() {
        const state = this.frontier(this.root)
        return join([...state.subtreeReads, ...state.subtreeWrites].map(work => work.promise).filter(Boolean))
    }

    capture(scope) {
        const predecessors = new Set()
        const add = entries => {
            for (const work of entries) {
                this.counts.inspected++
                predecessors.add(work)
            }
        }
        const selected = this.frontier(scope.node)
        add(scope.subtree ? selected.subtreeWrites : selected.writes)
        if (scope.mutation) add(selected.subtreeReads)
        for (let parent = this.parent(scope.node); parent; parent = this.parent(parent)) {
            const state = this.frontier(parent)
            add(state.writes)
            if (scope.mutation) add(state.reads)
        }
        this.counts.captured += predecessors.size
        return new Set([...predecessors].map(work => work.capture()))
    }
}

class ReservationGroup {
    constructor(kernel, node, mutation) {
        this.kernel = kernel
        this.node = node
        this.mutation = mutation
        this.subtree = true
        this.nextId = this.active = 0
        this.indexes = new WeakMap()
        this.unknown = new OrderedIndex(kernel.counts)
        this.selectionWaiters = new OrderedIndex(kernel.counts)
        publish(this)
    }

    // Fixed and selecting reservations share this representation. Grouping
    // only selections would leave pairwise captures of interleaved fixed reads.

    index(node) {
        let index = this.indexes.get(node)
        if (!index) this.indexes.set(node, index = {
            direct: new OrderedIndex(this.kernel.counts), subtree: new OrderedIndex(this.kernel.counts),
        })
        return index
    }

    add(work) {
        work.selectionId = ++this.nextId
        this.active++
        if (work.state === SELECTING) this.unknown.set(work.selectionId, work)
    }

    select(work) {
        this.unknown.delete(work.selectionId)
        if (work.node) {
            const { selectionId: id } = work
            if (work.subtree) this.index(work.node).direct.set(id, work)
            for (let node = work.node; node; node = this.kernel.parent(node)) this.index(node).subtree.set(id, work)
        }
        // Availability depends only on the earliest still-unknown selection.
        // Completed keys leave no history cells. Release captured cutoffs in
        // a synchronous loop; each waiter is removed exactly once.
        const earliest = this.unknown.first()?.selectionId ?? Infinity
        let waiter
        while ((waiter = this.selectionWaiters.first()) && waiter.limit < earliest) {
            this.selectionWaiters.delete(waiter.limit)
            this.kernel.counts.selections++
            waiter.signal.resolve()
        }
    }

    selectedThrough(limit) {
        if (!this.active || (this.unknown.first()?.selectionId ?? Infinity) > limit) return
        let waiter = this.selectionWaiters.floor(limit)
        if (waiter?.limit !== limit) {
            waiter = { limit, signal: Promise.withResolvers() }
            this.selectionWaiters.set(limit, waiter)
        }
        return waiter.signal.promise
    }

    waitFor(scope, limit) {
        if (!this.active || !conflicts(this, scope)) return
        const wait = this.selectedThrough(limit)
        if (!wait) return this.waitForSelected(scope, limit)
        this.kernel.counts.conditional++
        const capture = { node: scope.node, mutation: scope.mutation, subtree: scope.subtree }
        return continueGraphTransition(wait, this.kernel.operationContext, () => this.waitForSelected(capture, limit))
    }

    waitForSelected(scope, limit) {
        let work = this.find(scope, limit)
        if (!work) return
        // Every key through the original cutoff is decided. Completed or
        // unrelated trailing members cannot change this dependency, so share
        // by its last relevant live effect. Never extend the issuance cutoff.
        limit = work.selectionId
        work = undefined
        const { operationContext, counts } = this.kernel
        const node = scope.node, subtree = scope.subtree
        let scopes = this.scopedWaits?.get(node)
        let waits = subtree ? scopes?.subtree : scopes?.own
        const cached = waits?.get(limit)
        if (cached) {
            counts.sharedHits++
            return cached
        }
        const wait = waitForEffects(this, scope, limit)
        if (!wait) return
        // Mutation mode determines whether this group conflicts at all. Once
        // admitted above, node, subtree coverage and cutoff define the same
        // dependency for every consumer of this group.
        const shared = this.scopedWaits ??= new WeakMap()
        if (!scopes) shared.set(node, scopes = {})
        if (!waits) {
            waits = new Map()
            if (subtree) scopes.subtree = waits
            else scopes.own = waits
        }
        counts.waitsCreated++
        counts.peakWaits = Math.max(counts.peakWaits, ++counts.liveWaits)
        const result = continueGraphTransition(wait, operationContext, () => {
            waits.delete(limit)
            if (!waits.size) {
                if (subtree) scopes.subtree = undefined
                else scopes.own = undefined
                if (!scopes.subtree && !scopes.own) shared.delete(node)
            }
            counts.liveWaits--
        })
        waits.set(limit, result)
        return result
    }

    remove(work) {
        if (work.node) {
            const { selectionId: id } = work
            if (work.subtree) this.index(work.node).direct.delete(id)
            for (let node = work.node; node; node = this.kernel.parent(node)) this.index(node).subtree.delete(id)
        }
        if (--this.active === 0) {
            removeMemberships(this)
            this.kernel = this.node = this.indexes = this.unknown = this.selectionWaiters = this.scopedWaits = undefined
        }
    }

    capture() { return new SelectionCapture(this, this.nextId) }
    get promise() { return this.capture().waitFor({ node: this.kernel.root, mutation: true, subtree: true }) }

    find(scope, limit) {
        if (!this.active || !(scope.mutation || this.mutation)) return
        let found
        const consider = index => {
            const candidate = index?.floor(limit)
            if (candidate && (!found || candidate.selectionId > found.selectionId)) found = candidate
        }
        const selected = this.indexes.get(scope.node)
        consider(scope.subtree ? selected?.subtree : selected?.direct)
        for (let parent = this.kernel.parent(scope.node); parent; parent = this.kernel.parent(parent))
            consider(this.indexes.get(parent)?.direct)
        return found
    }
}

class SelectionCapture {
    constructor(group, limit) {
        this.group = group
        this.limit = limit
        this.node = group.node
    }

    removeMemberships() {
        // A narrowed selection cannot remove group members appended after its
        // capture. It is never allowed to acquire them as predecessors either.
        if (this.group.nextId <= this.limit) removeMemberships(this.group)
    }

    waitFor(scope) { return this.group.waitFor(scope, this.limit) }
}

function waitForEffects(group, scope, limit) {
    const operationContext = group.kernel.operationContext
    const capture = { node: scope.node, mutation: scope.mutation, subtree: scope.subtree }
    return resume()

    function resume() {
        let work = group.find(capture, limit)
        if (!work) return
        const wait = work.promise
        // A covering write itself waits for every conflicting earlier member.
        // Reads and narrower writes do not provide that coverage.
        const covered = work.mutation && work.subtree && contains(work.node, capture.node)
        limit = work.selectionId - 1
        work = undefined
        return covered ? wait : continueGraphTransition(wait, operationContext, resume)
    }
}

class Reservation {
    constructor(kernel, node, mutation, subtree, state) {
        this.kernel = kernel
        this.node = node
        this.mutation = mutation
        this.subtree = subtree
        this.state = state
        const predecessors = kernel.capture(this)
        if (state === SELECTING) this.predecessors = predecessors
        else this.prepare(predecessors)
        this.group = kernel.group(node, mutation)
        this.group.add(this)
        if (state !== SELECTING) this.group.select(this)
    }

    prepare(predecessors) {
        const waits = []
        for (const predecessor of predecessors) {
            const wait = predecessor.waitFor(this)
            if (wait) waits.push(wait)
            if (this.mutation && contains(this.node, predecessor.node)) predecessor.removeMemberships()
        }
        this.readiness = continueGraphTransition(join(waits), this.kernel.operationContext,
            () => { this.readiness = undefined })
    }

    select(node, subtree = true) {
        this.node = node
        this.subtree = subtree
        this.state = ACTIVE
        this.group.select(this)
        const predecessors = this.predecessors
        this.predecessors = undefined
        if (node) this.prepare(predecessors)
        else this.complete()
        return this.readiness
    }

    get promise() {
        if (this.state === COMPLETE) return undefined
        return (this.completion ??= Promise.withResolvers()).promise
    }

    complete() {
        if (this.state >= FINISHING) return
        this.state = FINISHING
        const operationContext = this.kernel.operationContext
        markPromiseHandled(continueGraphTransition(this.readiness, operationContext, () => {
            this.group.remove(this)
            this.state = COMPLETE
            const completion = this.completion
            this.completion = this.node = this.kernel = this.group = undefined
            completion?.resolve()
        }), operationContext)
    }
}

export { ReservationKernel }
