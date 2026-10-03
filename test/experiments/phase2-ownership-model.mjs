// Experiment support, not production ownership code. No execution-wide node list.
// The independent oracle in the runner owns the fixture inventory.
export class Ownership {
    constructor() {
        this.nodes = new WeakMap()
        this.candidates = new Set()
        this.depth = 0
        this.metrics = { activated: 0, reverse: 0, reverseEdges: 0,
            proofRecords: 0, proofLinks: 0, retired: 0 }
    }
    state(node) {
        let state = this.nodes.get(node)
        if (!state) {
            state = { active: false, holds: 0, outgoing: new Map(), incoming: undefined }
            this.nodes.set(node, state)
        }
        return state
    }
    *placements(node) {
        const incoming = this.state(node).incoming
        if (incoming instanceof Map) {
            for (const [owner, keys] of incoming) for (const key of keys) yield [owner, key]
        } else if (incoming) yield [incoming.owner, incoming.key]
    }
    *parents(node) {
        const incoming = this.state(node).incoming
        if (incoming instanceof Map) {
            yield* incoming.keys()
        } else if (incoming) yield incoming.owner
    }
    addIncoming(owner, key, target) {
        const state = this.state(target)
        if (!state.incoming) state.incoming = { owner, key }
        else if (state.incoming instanceof Map) {
            let keys = state.incoming.get(owner)
            if (!keys) state.incoming.set(owner, keys = new Set())
            keys.add(key)
        } else if (state.incoming.owner !== owner || state.incoming.key !== key) {
            const previous = state.incoming
            state.incoming = new Map([[previous.owner, new Set([previous.key])]])
            this.addIncoming(owner, key, target)
        }
    }
    removeIncoming(owner, key, target) {
        const state = this.state(target), incoming = state.incoming
        if (incoming instanceof Map) {
            const keys = incoming.get(owner)
            keys?.delete(key)
            if (keys?.size === 0) incoming.delete(owner)
            if (!incoming.size) state.incoming = undefined
        } else if (incoming?.owner === owner && incoming.key === key) state.incoming = undefined
    }
    activate(node) {
        const state = this.state(node)
        if (state.active) return
        state.active = true
        this.metrics.activated++
        this.candidates.add(node)
        for (const [key, target] of state.outgoing) {
            this.activate(target)
            this.addIncoming(node, key, target)
        }
    }
    set(owner, key, target) {
        this.activate(owner)
        const state = this.state(owner), previous = state.outgoing.get(key)
        if (previous && previous === target) return
        if (previous) {
            this.removeIncoming(owner, key, previous)
            this.candidates.add(previous)
            state.outgoing.delete(key)
        }
        if (target !== undefined) {
            state.outgoing.set(key, target)
            this.activate(target)
            this.addIncoming(owner, key, target)
        }
    }
    retain(node) { this.activate(node); this.state(node).holds++ }
    release(node) {
        const state = this.state(node)
        if (state.holds < 1) throw Error('Experiment hold underflow')
        state.holds--
        this.candidates.add(node)
    }
    transition(work) {
        this.depth++
        try { return work() }
        finally { if (--this.depth === 0) this.flush() }
    }
    flush() {
        if (this.depth) return
        // A proof edge says that a visited child survives if this parent does.
        // Cycles stay unresolved until a root is found or the search returns.
        const proofs = new Map()
        let discovered
        const markLive = proof => {
            if (proof.live) return
            proof.live = true
            const dependents = proof.dependents
            proof.dependents = undefined
            for (const dependent of dependents ?? []) markLive(dependent)
        }
        const visit = (node, dependent) => {
            if (!this.state(node).active) return
            let proof = proofs.get(node)
            if (proof) {
                if (dependent) {
                    if (proof.live) markLive(dependent)
                    else {
                        (proof.dependents ??= []).push(dependent)
                        this.metrics.proofLinks++
                    }
                }
                return
            }
            proof = { live: false, dependents: dependent ? [dependent] : undefined }
            proofs.set(node, proof)
            discovered.push(node)
            this.metrics.proofRecords++
            if (dependent) this.metrics.proofLinks++
            if (this.state(node).holds) { markLive(proof); return }
            this.metrics.reverse++
            for (const parent of this.parents(node)) {
                this.metrics.reverseEdges++
                visit(parent, proof)
                if (proof.live) break
            }
        }
        // Retirement only removes dead edges. A proved live path therefore
        // remains valid for downstream candidates throughout this batch.
        for (const candidate of this.candidates) {
            this.candidates.delete(candidate)
            if (!this.state(candidate).active || proofs.has(candidate)) continue
            discovered = []
            visit(candidate)
            // After recursion returns, each unresolved node exhausted its
            // parents. Root proofs have propagated through all recorded edges,
            // so the remaining group is incoming-closed and can retire together.
            this.retire(discovered.filter(node => !proofs.get(node).live))
        }
    }
    retire(nodes) {
        for (const node of nodes) this.state(node).active = false
        for (const node of nodes) {
            for (const [key, target] of this.state(node).outgoing) {
                this.removeIncoming(node, key, target)
                this.candidates.add(target)
            }
            this.metrics.retired++
        }
    }
}
