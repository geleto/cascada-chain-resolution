// Test-only consistency oracle. It independently recounts projected
// placements, verifies cycle-cut shape and both parent-edge directions, and
// rejects cycles in the projected parent graph.
import * as errorUtils from "../src/error.js"
import * as metadata from "../src/meta.js"
import * as propertyVersions from "../src/property-versions.js"
import * as languageProperties from "../src/language-properties.js"
import * as languageValues from "../src/language-values.js"

function verifyRefCounts(operationContext, ...roots) {
    const seen = new Set()
    for (const root of roots) verifyReachable(root, seen, operationContext)

    const parentStates = new Map()
    for (const node of seen) verifyParentGraph(node, parentStates, operationContext)
}

function verifyReachable(node, seen, operationContext) {
    if (!languageValues.isTraversable(node, operationContext) || seen.has(node)) return
    seen.add(node)
    verifyCycleCuts(node, operationContext)

    const counter = getRefCounter(node, operationContext)
    if (counter) {
        let promiseCount = 0
        let errorCount = 0
        let cycleCutCount = 0
        const childEdges = new Map()

        for (const key of languageProperties.enumerableLanguageKeys(
            node,
            operationContext,
        )) {
            const state = recountProperty(node, key, operationContext)
            const { child } = state
            if (
                languageValues.isTraversable(child, operationContext) &&
                !getRefCounter(child, operationContext)
            ) {
                fatal("Ref-indexed parent contains non-ref-indexed child")
            }

            promiseCount += state.promiseCount
            errorCount += state.errorCount
            cycleCutCount += state.cycleCutCount
            if (getRefCounter(child, operationContext)) {
                childEdges.set(child, (childEdges.get(child) ?? 0) + 1)
            }
        }

        if (counter.promiseCount !== promiseCount ||
            counter.errorCount !== errorCount ||
            counter.cycleCutCount !== cycleCutCount) {
            fatal("Counter totals are inconsistent")
        }
        for (const [child, count] of childEdges) {
            if (getRefCounter(child, operationContext).parents.get(node) !== count) {
                fatal("Parent edge count is inconsistent")
            }
        }
        verifyStoredParentEdges(node, operationContext)
    }

    // Cuts omit parent edges and count propagation, but every traversable
    // target in a ref-indexed raw graph still owns an independent counter.
    for (const key of languageProperties.enumerableLanguageKeys(
        node,
        operationContext,
    )) {
        const child = readPropertyForRecount(node, key, operationContext)
        if (
            counter &&
            languageValues.isTraversable(child, operationContext) &&
            !getRefCounter(child, operationContext)
        ) {
            fatal("Ref-indexed parent contains non-ref-indexed child")
        }
        verifyReachable(child, seen, operationContext)
    }
    if (counter) {
        for (const parent of counter.parents.keys()) {
            verifyReachable(parent, seen, operationContext)
        }
    }
}

function verifyCycleCuts(node, operationContext) {
    const meta = metadata.metaOf(node, operationContext)
    const plainCuts = meta?.cycleCuts
    if (plainCuts && !(plainCuts instanceof Set)) {
        fatal("Plain cycle cuts must be stored in a Set")
    }

    if (plainCuts) {
        for (const key of plainCuts) {
            if (typeof key !== "string") {
                fatal("Cycle cut keys must be strings")
            }
            if (!languageProperties.hasLanguageProperty(node, key, operationContext)) {
                fatal("Cycle cut names a missing or non-enumerable property")
            }
            if (languageValues.isPromise(
                languageProperties.readLanguageProperty(node, key, operationContext),
                operationContext,
            )) {
                fatal("Pending Promise property also has a cycle cut")
            }
            if (!languageValues.isTraversable(
                languageProperties.readLanguageProperty(node, key, operationContext),
                operationContext,
            )) {
                fatal("Cycle cut must contain a traversable value")
            }
        }
    }

    for (const key of Object.keys(meta?.placementVersions ?? {})) {
        const mirror = propertyVersions.getPromiseMirror(node, key, operationContext)
        if (!mirror) continue
        const descriptor = languageProperties.getLanguagePropertyDescriptor(
            node,
            key,
            operationContext,
        )
        const imported = metadata.isImported(
            node,
            operationContext,
        )
        const validShape = mirror &&
            Object.hasOwn(mirror, "value") &&
            descriptor?.enumerable &&
            "value" in descriptor
        const physicalMatches = Object.is(descriptor?.value, mirror?.value)
        const preservedPromise = !languageValues.isPromise(
            mirror?.value,
            operationContext,
        ) && languageValues.isPromise(descriptor?.value, operationContext)
        const validStorage = (imported || descriptor?.writable) &&
            (physicalMatches || preservedPromise)
        if (!validShape || !validStorage) {
            fatal("Live Promise mirror has no valid language property")
        }
    }
}

function verifyStoredParentEdges(node, operationContext) {
    const counter = getRefCounter(node, operationContext)
    for (const [parent, count] of counter.parents) {
        if (!languageValues.isTraversable(parent, operationContext)) {
            fatal("Parent edge points to a non-traversable value")
        }
        if (!getRefCounter(parent, operationContext)) {
            fatal("Parent edge points to non-ref-indexed parent")
        }

        let actualCount = 0
        for (const key of languageProperties.enumerableLanguageKeys(
            parent,
            operationContext,
        )) {
            if (recountProperty(parent, key, operationContext).child === node) {
                actualCount++
            }
        }
        if (actualCount !== count) {
            fatal("Parent edge count is inconsistent")
        }
    }
}

function verifyParentGraph(node, states, operationContext) {
    if (!getRefCounter(node, operationContext)) return
    const state = states.get(node)
    if (state === "done") return
    if (state === "active") fatal("Ref-count parent graph contains a cycle")

    states.set(node, "active")
    for (const parent of getRefCounter(node, operationContext).parents.keys()) {
        verifyParentGraph(parent, states, operationContext)
    }
    states.set(node, "done")
}

// Recount each property here instead of using the count helpers being checked.
function recountProperty(node, key, operationContext) {
    const mirror = propertyVersions.getPromiseMirror(node, key, operationContext)
    let child = readPropertyForRecount(node, key, operationContext)
    let promiseCount = 0
    let errorCount = 0
    let cycleCutCount = 0
    if (languageValues.isPromise(child, operationContext)) {
        if (!mirror) {
            fatal("Indexed promise property has no mirror")
        }
        if (metadata.metaOf(node, operationContext)?.cycleCuts?.has(key)) {
            fatal("Pending Promise property also has a cycle cut")
        }
        child = undefined
        promiseCount = 1
    } else if (metadata.metaOf(node, operationContext)?.cycleCuts?.has(key)) {
        child = undefined
        cycleCutCount = 1
    } else if (languageValues.isError(child)) {
        errorCount = 1
    } else if (languageValues.isTraversable(child, operationContext)) {
        const counter = getRefCounter(child, operationContext)
        if (counter) {
            promiseCount = counter.promiseCount
            errorCount = counter.errorCount
            cycleCutCount = counter.cycleCutCount
        }
    }
    return { child, promiseCount, errorCount, cycleCutCount }
}

function readPropertyForRecount(node, key, operationContext) {
    return languageProperties.readLanguageProperty(node, key, operationContext)
}

function getRefCounter(node, operationContext) {
    const meta = metadata.metaOf(node, operationContext)
    return meta?.parents ? meta : undefined
}

function fatal(message) {
    errorUtils.reportFatalError(new Error(message))
}

export { verifyRefCounts }
