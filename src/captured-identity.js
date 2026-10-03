import * as metadata from "./meta.js"
import { visitParentPlacements } from "./parent-placements.js"

// Tokens retain no source. A reader captures one alongside its placements;
// later reuse of that source's storage cannot change the captured identity.
function captureIdentity(value, operationContext) {
    const meta = metadata.metaOf(value, operationContext)
    return metadata.isTraversableType(meta?.type) ? meta.generation ??= {} : value
}

// Equivalent storage representations share language identity, but each may
// have its own fallible inspection. Reusing output must not skip that work.
function visitRepresentation(value, identity, visited) {
    if (visited.get(value) === identity) return false
    visited.set(value, identity)
    return true
}

function advanceIdentity(value, operationContext, visited = new Set()) {
    const meta = metadata.metaOf(value, operationContext)
    if (!metadata.isTraversableType(meta?.type) || visited.has(value)) return
    visited.add(value)
    meta.generation = undefined
    visitParentPlacements(value, operationContext, parent => {
        advanceIdentity(parent, operationContext, visited)
    })
}

export { captureIdentity, advanceIdentity, visitRepresentation }
