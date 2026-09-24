import { isArrayIndex } from "./array-view.js"
import * as errors from "./error.js"
import * as properties from "./language-properties.js"
import * as metadata from "./meta.js"

// String keys belong exclusively to the compiler's property map.
const TREE_NODE = Symbol("external scope")

function prepareExternalMutationTree(root, requests, operationContext, factsOf, registrations, admitExternal) {
    return visit(root, requests)

    function visit(value, request, parent, native = false) {
        if (value === null || typeof value !== "object" || Error.isError(value)) return undefined
        let facts = factsOf(value)
        // Original thenables never grant authority, even after synchronous
        // import delivery. Discovery subscribes to nothing.
        if (!facts) {
            if (!native || !isDirectlyAvailable(value, operationContext)) return undefined
            facts = admitExternal(value)
        }
        const external = facts.type === metadata.TYPE.External
        if (!external && !metadata.isTraversableType(facts.type)) return undefined
        const node = Object.create(null)
        const record = node[TREE_NODE] = { parent, depth: parent ? parent[TREE_NODE].depth + 1 : 0 }
        if (external) {
            if (registrations.has(value)) return errors.validationError(
                "External identity has multiple context locations", operationContext,
                errors.ERROR_KIND.ExternalLocationConflict)
            record.identity = value
            registrations.set(value, node)
        }
        for (const key of Object.keys(request)) {
            const placement = external ? errors.runExternalAction(operationContext, () => Object.getOwnPropertyDescriptor(value, key)) :
                properties.getLanguagePlacementDescriptor(value, key, operationContext)
            if (!placement || !placement.enumerable || !("value" in placement)) continue
            const child = visit(placement.value, request[key], node, external)
            if (errors.isPoisonError(child)) return child
            if (child) node[key] = child
        }
        return external || Object.keys(node).length ? node : undefined
    }
}

// Discovery examines descriptors, never executes a getter or subscribes. An
// accessor cannot establish a directly available mutable location.
function isDirectlyAvailable(value, operationContext) {
    for (let owner = value; owner; owner = errors.runExternalAction(operationContext, () => Object.getPrototypeOf(owner))) {
        const descriptor = errors.runExternalAction(operationContext, () => Object.getOwnPropertyDescriptor(owner, "then"))
        if (descriptor) return "value" in descriptor && typeof descriptor.value !== "function"
    }
    return true
}

function commitExternalLocations(registrations, operationContext) {
    const identities = operationContext.execution._externalIdentities
    for (const [identity, node] of registrations) {
        let entry = identities.get(identity)
        if (!entry) identities.set(identity, entry = { binding: node })
        else if (!errors.isPoisonError(entry.binding)) {
            const previous = entry.binding
            entry.binding = errors.validationError(
                "External identity is registered in competing contexts", operationContext,
                errors.ERROR_KIND.ExternalLocationConflict)
            updatePoisonPresence(previous)
        }
        node[TREE_NODE].entry = entry
        updatePoisonPresence(node)
    }
}

function findBranch(node, path) {
    for (const key of path) {
        if (!node || (typeof key !== "string" && typeof key !== "number")) return undefined
        node = node[key]
    }
    return node
}

// Capture the first native crossing, the scope covering the requested prefix,
// and the deepest crossed scope. The final node exists only for an exact route.
function tracePath(node, path, scopeDepth = path.length) {
    let boundary, scope, crossed
    for (let depth = 0; node; depth++) {
        if (node[TREE_NODE].identity) {
            boundary ??= node
            crossed = node
            if (depth <= scopeDepth) scope = node
        }
        if (depth === path.length) break
        const key = path[depth]
        node = typeof key === "string" || typeof key === "number" ? node[key] : undefined
    }
    return { externalTreeNode: node, externalBoundary: boundary, externalScope: scope, deepestExternalScope: crossed }
}

function bindingError(node) {
    const binding = node[TREE_NODE].entry?.binding
    return errors.isPoisonError(binding) ? binding : null
}

function hasPoison(node) {
    const record = node[TREE_NODE]
    return Boolean(record.ownPoison || bindingError(node) || record.poisonedChildren?.size)
}

function updatePoisonPresence(node) {
    const parent = node[TREE_NODE].parent
    if (!parent) return
    const record = parent[TREE_NODE]
    const before = hasPoison(parent)
    if (hasPoison(node)) (record.poisonedChildren ??= new Set()).add(node)
    else record.poisonedChildren?.delete(node)
    if (before !== hasPoison(parent)) updatePoisonPresence(parent)
}

function poisonScope(node, error) {
    node[TREE_NODE].ownPoison ??= error
    updatePoisonPresence(node)
}

function scopeBlocker(node, includeSelected = true) {
    if (!node) return null
    const conflict = bindingError(node)
    if (conflict) return conflict
    for (let parent = node[TREE_NODE].parent; parent; parent = parent[TREE_NODE].parent) {
        const failure = bindingError(parent) ?? parent[TREE_NODE].ownPoison
        if (failure) return failure
    }
    if (!includeSelected || !hasPoison(node)) return null
    const found = collectPoison(node)
    return found.size ? errors.combineErrors(found, "External scope is poisoned") : null
}

function truncatesLocations(node, length) {
    return node && Object.keys(node).some(key => isArrayIndex(key) && Number(key) >= length)
}

function collectPoison(node, errorsFound = new Set()) {
    if (!node) return errorsFound
    const record = node[TREE_NODE]
    const conflict = bindingError(node)
    if (conflict) errorsFound.add(conflict)
    if (record.ownPoison) errorsFound.add(record.ownPoison)
    for (const child of record.poisonedChildren ?? []) collectPoison(child, errorsFound)
    return errorsFound
}

function clearPoison(node) {
    if (!node) return
    const record = node[TREE_NODE]
    record.ownPoison = undefined
    for (const child of [...record.poisonedChildren ?? []]) clearPoison(child)
    updatePoisonPresence(node)
}

export {
    TREE_NODE, bindingError, clearPoison, collectPoison,
    commitExternalLocations, findBranch, poisonScope, prepareExternalMutationTree,
    scopeBlocker, tracePath, truncatesLocations,
}
