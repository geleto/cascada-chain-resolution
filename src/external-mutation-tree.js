import { isArrayIndex } from "./array-view.js"
import * as errors from "./error.js"
import * as metadata from "./meta.js"

// String keys belong exclusively to the compiler's property map.
const TREE_NODE = Symbol("external scope")

function prepareExternalMutationTree(root, requests, operationContext, factsOf, registrations, classifyNative, readManagedPlacement) {
    return visit(root, requests)

    function visit(value, request, parent, native = false) {
        try {
            if (value === null || typeof value !== "object" || Error.isError(value)) return undefined
            // Original thenables never grant authority, even after synchronous
            // import delivery. Admission does not establish native availability:
            // an ordinary read may have consumed an accessor's value.
            if (native && !isDirectlyAvailable(value, operationContext)) return undefined
            let facts = factsOf(value)
            if (!facts) {
                if (!native) return undefined
                facts = classifyNative(value)
                if (errors.isPoisonError(facts)) return facts
            }
            const external = facts.type === metadata.TYPE.External
            // Native authority cannot cross managed storage, even if a later
            // descendant would independently be external.
            if (native && !external) return undefined
            if (!external && !metadata.isTraversableType(facts.type)) return undefined
            const node = Object.create(null)
            const record = node[TREE_NODE] = { parent, depth: parent ? parent[TREE_NODE].depth + 1 : 0 }
            if (external) {
                if (registrations.has(value) || operationContext.execution._externalIdentities.has(value)) return errors.validationError(
                    "External identity has multiple context locations", operationContext,
                    errors.ERROR_KIND.ExternalLocationConflict)
                record.identity = value
                registrations.add(value)
            }
            let childCount = 0
            for (const key of Object.keys(request)) {
                const placement = external ? errors.runExternalAction(operationContext, () => Object.getOwnPropertyDescriptor(value, key)) :
                    readManagedPlacement(value, key)
                if (!placement || !placement.enumerable || !("value" in placement)) continue
                const child = visit(placement.value, request[key], node, external)
                if (errors.isPoisonError(child)) return child
                if (child) {
                    child[TREE_NODE].index = childCount++
                    node[key] = child
                }
            }
            record.span = 1
            while (record.span < childCount) record.span *= 2
            return external || Object.keys(node).length ? node : undefined
        } finally { value = undefined }
    }
}

// Discovery examines descriptors, never executes a getter or subscribes. An
// accessor cannot establish a directly available mutable location.
function isDirectlyAvailable(value, operationContext) {
    let owner = value
    try {
        for (; owner; owner = errors.runExternalAction(operationContext, () => Object.getPrototypeOf(owner))) {
            const descriptor = errors.runExternalAction(operationContext, () => Object.getOwnPropertyDescriptor(owner, "then"))
            if (descriptor) return "value" in descriptor && typeof descriptor.value !== "function"
        }
        return true
    } finally { value = owner = undefined }
}

function commitExternalLocations(registrations, operationContext) {
    const identities = operationContext.execution._externalIdentities
    for (const identity of registrations) identities.add(identity)
    if (registrations.size) operationContext.execution._externalRegistrationRevision++
}

function truncatesLocations(node, length) {
    return node && Object.keys(node).some(key => isArrayIndex(key) && Number(key) >= length)
}

export {
    TREE_NODE, commitExternalLocations, prepareExternalMutationTree,
    truncatesLocations,
}
