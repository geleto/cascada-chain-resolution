import * as metadata from "./meta.js"
import { runWithFatalGuard } from "./error.js"
import { retireRelationships, visitRetentionParents } from "./parent-placements.js"

function reconsider(value, operationContext) {
    const execution = operationContext.execution
    ;(execution._retirementCandidates ??= new Set()).add(value)
}

function retireCandidates(operationContext) {
    const execution = operationContext.execution
    const candidates = execution._retirementCandidates
    if (!candidates) return
    execution._retirementCandidates = undefined
    if (execution.fatalError !== null) return
    // Downstream removals join this same batch and reuse its proofs.
    execution._retirementCandidates = candidates
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
        const meta = metadata.metaOf(node, operationContext)
        if (!meta?.relationshipsActive) return
        let proof = proofs.get(node)
        if (proof) {
            if (dependent) {
                if (proof.live) markLive(dependent)
                else (proof.dependents ??= []).push(dependent)
            }
            return
        }
        proof = { live: false, dependents: dependent ? [dependent] : undefined }
        proofs.set(node, proof)
        discovered.push(node)
        if (meta.pinCount || meta.readLeaseCount) { markLive(proof); return }
        visitRetentionParents(node, operationContext, parent => {
            visit(parent, proof)
            return !proof.live
        })
    }
    try {
        for (const candidate of candidates) {
            candidates.delete(candidate)
            if (proofs.has(candidate)) continue
            discovered = []
            visit(candidate)
            const dead = discovered.filter(node => !proofs.get(node).live)
            for (const node of dead) metadata.requireMeta(node, operationContext).relationshipsActive = false
            for (const node of dead) retireRelationships(node, operationContext)
        }
    } finally {
        candidates.clear()
        execution._retirementCandidates = undefined
    }
}

function runGraphTransition(operationContext, work, value) {
    const execution = operationContext.execution
    const fatal = execution.fatalError
    if (fatal !== null) throw fatal
    execution._graphDepth = (execution._graphDepth ?? 0) + 1
    try { return runWithFatalGuard(operationContext, work, value) }
    finally {
        if (--execution._graphDepth === 0)
            runWithFatalGuard(operationContext, retireCandidates, operationContext)
    }
}

function runOutsideGraphTransition(operationContext, work) {
    const execution = operationContext.execution
    const depth = execution._graphDepth ?? 0
    if (!depth) return work()
    retireCandidates(operationContext)
    execution._graphDepth = 0
    try { return work() }
    finally { execution._graphDepth = depth }
}

// One consumer owns one ledger. Storage is allocated only for managed inputs;
// multiple appearances within that use share a lease, other consumers do not.
function createLeaseLedger(operationContext) {
    let values
    let closed = false
    return { acquire, release, get empty() { return !values?.size } }

    function acquire(value) {
        if (!closed && !values?.has(value) && metadata.isTraversableType(metadata.metaOf(value, operationContext)?.type) &&
            metadata.incrementReadLease(value, operationContext))
            (values ??= new Set()).add(value)
        return value
    }

    function release() {
        if (closed) return
        closed = true
        if (values && operationContext.execution.fatalError === null)
            for (const value of values) metadata.decrementReadLease(value, operationContext)
        values = undefined
        operationContext = undefined
    }
}

// A pending writer retains its destination but does not freeze its contents.
// A pending cycle may return to its descendants. Keep their parent edges so
// another owner's mutation still copies, even after this destination detaches.
// Property versions order later writes; treating this as a read lease would
// incorrectly COW private Chain holders and detach those writes from the Chain.
function retainWriter(owner, operationContext) {
    const meta = metadata.requireMeta(owner, operationContext)
    meta.pinCount = (meta.pinCount ?? 0) + 1
    return () => {
        if (!owner) return
        releasePin(owner, operationContext)
        owner = operationContext = undefined
    }
}

// Chain holders and pending writers both keep topology alive without forcing COW.
function releasePin(owner, operationContext) {
    const meta = metadata.requireMeta(owner, operationContext)
    if (--meta.pinCount === 0) delete meta.pinCount
    reconsider(owner, operationContext)
}

// Ready delivery belongs to the interval before the next receiving command.
// The single queued fallback captures the execution, never individual values.
function exposeReadyDelivery(delivery, operationContext) {
    if (delivery.empty) { delivery.release(); return }
    const execution = operationContext.execution
    ;(execution._readyDeliveries ??= new Set()).add(delivery)
    if (execution._readyDeliveryQueued) return
    execution._readyDeliveryQueued = true
    queueMicrotask(() => {
        execution._readyDeliveryQueued = false
        releaseDetached(operationContext, () => expireReadyDeliveries(execution))
    })
}

function expireReadyDeliveries(execution) {
    const previous = execution._readyDeliveries
    execution._readyDeliveries = undefined
    if (previous) for (const delivery of previous) delivery.release()
}

function releaseDetached(operationContext, release) {
    try {
        if (operationContext.execution.fatalError !== null) { release(); return }
        runGraphTransition(operationContext, release)
    }
    catch (failure) {
        // The common transition has committed the authoritative fatal.
        // A detached cleanup reaction must not throw into the host queue,
        // including a further cleanup defect after an earlier fatal commit.
        if (operationContext.execution.fatalError === null) throw failure
    }
}

function runReceivingCommand(operationContext, work) {
    return runGraphTransition(operationContext, () => {
        expireReadyDeliveries(operationContext.execution)
        return work()
    })
}

export { createLeaseLedger, retainWriter, releasePin, reconsider, runGraphTransition, runOutsideGraphTransition,
    runReceivingCommand, exposeReadyDelivery, releaseDetached }
