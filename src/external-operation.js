import * as errors from "./error.js"
import { TREE_NODE, bindingError } from "./external-mutation-tree.js"
import { continueOperation } from "./internal-step.js"
import { markPromiseHandled } from "./thenable-subscription.js"

function externalCapabilityEscapeError(operationContext) {
    return errors.validationError("Mutable external identities cannot leave their context location",
        operationContext, errors.ERROR_KIND.ExternalCapabilityEscape)
}

function externalLocationError(operationContext) {
    return errors.validationError("External access requires its registered context location",
        operationContext, errors.ERROR_KIND.ExternalLocationConflict)
}

function validateExternalAccess(identity, node, operationContext) {
    const entry = operationContext.execution._externalIdentities.get(identity)
    if (node && entry !== node[TREE_NODE].entry)
        throw new Error("External identity changed at its fixed context location")
    if (node) return bindingError(node)
    if (!entry) return null
    return errors.isPoisonError(entry.binding) ? entry.binding : externalLocationError(operationContext)
}

// An entry's outside reservation covers this private view. The same conflict
// algorithm runs inside it, without joining outside work waiting for the entry.
function createExternalReservationView(root) {
    return { root, frontiers: new WeakMap(), effects: new Set() }
}

function frontier(node, view) {
    const record = node[TREE_NODE]
    let current = view ? view.frontiers.get(node) : record.frontier
    if (!current) {
        current = { reads: new Set(), writes: new Set(), subtreeReads: new Set(), subtreeWrites: new Set() }
        if (view) view.frontiers.set(node, current)
        else record.frontier = current
    }
    return current
}

// One reservation at issuance orders required effects even when managed path
// capture is pending. Its completion Promise is allocated only for a waiter.
class ExternalEffect {
    constructor(node, mutation, view, operationContext) {
        this.view = view
        this.operationContext = operationContext
        view?.effects.add(this)
        this.node = node
        const predecessors = new Set()
        const selected = frontier(node, this.view)
        for (const work of selected.subtreeWrites) predecessors.add(work)
        if (mutation) for (const work of selected.subtreeReads) predecessors.add(work)
        for (let parent = node === this.view?.root ? undefined : node[TREE_NODE].parent; parent; parent = parent[TREE_NODE].parent) {
            const state = frontier(parent, this.view)
            for (const work of state.writes) predecessors.add(work)
            if (mutation) for (const work of state.reads) predecessors.add(work)
            if (parent === this.view?.root) break
        }
        // A later mutation transitively covers same-scope/descendant work.
        // Removing frontier membership does not finish that work's lifetime.
        if (mutation) for (const work of predecessors)
            if (work.node[TREE_NODE].path.length >= node[TREE_NODE].path.length) work.removeMemberships()
        const memberships = this.memberships = [mutation ? selected.writes : selected.reads]
        for (let ancestor = node; ancestor; ancestor = ancestor[TREE_NODE].parent) {
            const state = frontier(ancestor, this.view)
            memberships.push(mutation ? state.subtreeWrites : state.subtreeReads)
            if (ancestor === this.view?.root) break
        }
        for (const membership of memberships) membership.add(this)
        const wait = predecessors.size === 1 ? predecessors.values().next().value.promise :
            predecessors.size ? Promise.all([...predecessors].map(work => work.promise)) : undefined
        this.readiness = continueOperation(wait, operationContext, () => { this.readiness = undefined })
    }

    get promise() {
        return (this.completion ??= Promise.withResolvers()).promise
    }

    removeMemberships() {
        for (const membership of this.memberships ?? []) membership.delete(this)
        this.memberships = undefined
    }

    complete() {
        if (!this.node) return
        // A failed managed prefix can finish before native access. Keep its
        // predecessor chain intact for later reservations that captured us.
        const operationContext = this.operationContext
        markPromiseHandled(continueOperation(this.readiness, operationContext, () => {
            this.removeMemberships()
            this.view?.effects.delete(this)
            this.completion?.resolve()
            this.completion = this.view = this.node = this.operationContext = undefined
        }), operationContext)
    }
}

function pendingExternalEffects(view) {
    if (view.effects.size === 1) return view.effects.values().next().value.promise
    if (view.effects.size) return Promise.all([...view.effects].map(work => work.promise))
}

export { externalCapabilityEscapeError, createExternalReservationView, externalLocationError, ExternalEffect, pendingExternalEffects, validateExternalAccess }
