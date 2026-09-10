import * as errors from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

const EXTERNAL_BOUNDARY = Symbol("external boundary")

function prepareExternalMutationTree(root, requests, context, operationContext, factsOf, registrations) {
    const path = []
    return visit(root, requests)

    function visit(value, request) {
        if (!metadata.isObjectLike(value) || Error.isError(value)) return undefined
        // Import admits available identities, never their thenable sources.
        // Read original placements so even a settled overlay grants no authority.
        const type = factsOf(value)?.type
        if (type === languageValues.TYPE.External) {
            if (registrations.has(value)) {
                return errors.validationError(
                    "External identity has multiple context locations",
                    operationContext,
                    errors.ERROR_KIND.ExternalLocationConflict,
                )
            }
            const location = { path: Object.freeze([...path]), context }
            registrations.set(value, location)
            return location
        }
        if (!languageValues.isTraversableType(type)) return undefined

        let branch
        for (const key of Object.keys(request)) {
            const placement = languageProperties.getLanguagePlacementDescriptor(value, key, operationContext)
            if (!placement) continue
            path.push(key)
            const child = visit(placement.value, request[key])
            path.pop()
            if (errors.isPoisonError(child)) return child
            if (child) (branch ??= Object.create(null))[key] = child
        }
        return branch
    }
}

function commitExternalLocations(registrations, operationContext) {
    const identities = operationContext.execution._externalIdentities
    for (const [identity, location] of registrations) {
        let entry = identities.get(identity)
        if (!entry) {
            entry = { binding: location, phase: undefined }
            identities.set(identity, entry)
        } else if (!errors.isPoisonError(entry.binding)) {
            entry.binding = errors.validationError(
                "External identity is registered in competing contexts",
                operationContext,
                errors.ERROR_KIND.ExternalLocationConflict,
            )
        }
        location[EXTERNAL_BOUNDARY] = entry
        Object.freeze(location)
    }
}

// Paths are relative to the selected node. Location paths remain canonical
// from their originating ContextChain, including through nested entry.
function reach(node, path) {
    let depth = 0
    while (node && !node[EXTERNAL_BOUNDARY] && depth < path.length) {
        const key = path[depth++]
        // Entry passes raw operation inputs. Leave invalid keys to language
        // validation without coercing them during tree selection.
        if (typeof key !== "string" && typeof key !== "number") return undefined
        node = node[key]
    }
    return node ? { node, complete: depth === path.length } : undefined
}

function findBranch(node, path) {
    const reached = reach(node, path)
    return reached?.complete ? reached.node : undefined
}

function findBoundary(node, path) {
    const boundary = reach(node, path)?.node
    return boundary?.[EXTERNAL_BOUNDARY] ? boundary : undefined
}

function findExactBoundary(node, path) {
    const boundary = findBranch(node, path)
    return boundary?.[EXTERNAL_BOUNDARY] ? boundary : undefined
}

function findDescendantBoundaries(node, path) {
    const boundaries = []
    collect(reach(node, path)?.node)
    return boundaries

    function collect(branch) {
        if (!branch) return
        if (branch[EXTERNAL_BOUNDARY]) boundaries.push(branch)
        else for (const child of Object.values(branch)) collect(child)
    }
}

export {
    EXTERNAL_BOUNDARY,
    commitExternalLocations,
    findBoundary,
    findBranch,
    findDescendantBoundaries,
    findExactBoundary,
    prepareExternalMutationTree,
}
