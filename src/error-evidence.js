import { releaseOnClose } from "./operation-lifecycle.js"

// A pending result or publication can prove a Boolean Error query before it
// can supply a value or a cause. Only a Boolean observer runs the inspection.
// A handoff forwards the inspection without reading through the publication.
export const certainPoison = query => query.found()

export function resultEvidence(delivery) {
    return delivery.errorEvidence ??= {}
}

export function supplyErrorEvidence(evidence, inspect, queue) {
    if (evidence.inspect === inspect) return
    evidence.inspect = inspect
    if (!evidence.listeners?.size) return
    const pending = queue ?? []
    for (const receive of evidence.listeners) pending.push([receive, inspect])
    if (!queue) for (let i = 0; i < pending.length; i++) {
        const [receive, read] = pending[i]
        pending[i] = undefined
        receive(read, pending)
    }
}

export function followErrorEvidence(evidence, owner, receive) {
    if (!evidence) return
    if (evidence.inspect) receive(evidence.inspect)
    if (!owner.open || evidence.inspect === certainPoison) return
    const listeners = evidence.listeners ??= new Set()
    listeners.add(receive)
    releaseOnClose(owner, () => listeners.delete(receive))
}

// The exact outward Promise belongs to this execution. Native Promise
// composition creates a new value and carries its ordinary settlement only.
export function publishResultEvidence(result, evidence, ctx) {
    const pending = ctx.execution._pendingErrorEvidence ??= new WeakMap()
    pending.set(result, evidence)
    return () => { pending.delete(result); evidence.inspect = evidence.listeners = undefined }
}
