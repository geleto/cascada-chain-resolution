// Test-only consistency oracle. It independently recounts projected
// placements, verifies cycle-cut shape and both parent-edge directions, and
// rejects cycles in the projected parent graph.
import * as errorUtils from "../src/error.js"
import * as metadata from "../src/meta.js"
import * as promiseMirrors from "../src/promise-mirrors.js"
import * as languageProperties from "../src/language-properties.js"
import * as languageValues from "../src/language-values.js"

function verifyRefCounts(...roots) {
    const seen = new Set()
    for (const root of roots) verifyReachable(root, seen)

    const parentStates = new Map()
    for (const node of seen) verifyParentGraph(node, parentStates)
}

function verifyReachable(node, seen) {
    if (!languageValues.isTracked(node) || seen.has(node)) return
    seen.add(node)
    verifyCycleCuts(node)

    const counter = getRefCounter(node)
    if (counter) {
        let promiseCount = 0
        let errorCount = 0
        let cycleCutCount = 0
        const childEdges = new Map()

        for (const key of languageProperties.enumerableLanguageKeys(node)) {
            const { child, counts } = recountProperty(node, key)
            if (languageValues.isTracked(child) && !getRefCounter(child)) {
                fatal("Ref-indexed parent contains non-ref-indexed child")
            }

            promiseCount += counts[0]
            errorCount += counts[1]
            cycleCutCount += counts[2]
            if (getRefCounter(child)) {
                childEdges.set(child, (childEdges.get(child) ?? 0) + 1)
            }
        }

        if (counter.promiseCount !== promiseCount ||
            counter.errorCount !== errorCount ||
            counter.cycleCutCount !== cycleCutCount) {
            fatal("Counter totals are inconsistent")
        }
        for (const [child, count] of childEdges) {
            if (getRefCounter(child).parents.get(node) !== count) {
                fatal("Parent edge count is inconsistent")
            }
        }
        verifyStoredParentEdges(node)
    }

    // Cuts omit parent edges and count propagation, but every tracked target in
    // a ref-indexed raw graph still owns an independent counter.
    for (const key of languageProperties.enumerableLanguageKeys(node)) {
        const child = readPropertyForRecount(node, key)
        if (
            counter &&
            languageValues.isTracked(child) &&
            !getRefCounter(child)
        ) {
            fatal("Ref-indexed parent contains non-ref-indexed child")
        }
        verifyReachable(child, seen)
    }
    if (counter) {
        for (const parent of counter.parents.keys()) verifyReachable(parent, seen)
    }
}

function verifyCycleCuts(node) {
    const meta = metadata.metaOf(node)
    const plainCuts = meta?.cycleCuts
    if (plainCuts && !(plainCuts instanceof Set)) {
        fatal("Plain cycle cuts must be stored in a Set")
    }

    if (plainCuts) {
        for (const key of plainCuts) {
            if (typeof key !== "string") {
                fatal("Cycle cut keys must be strings")
            }
            if (!languageProperties.hasLanguageProperty(node, key)) {
                fatal("Cycle cut names a missing or non-enumerable property")
            }
            if (languageValues.isPromise(
                languageProperties.readLanguageProperty(node, key),
            )) {
                fatal("Pending Promise property also has a cycle cut")
            }
            if (!languageValues.isTracked(
                languageProperties.readLanguageProperty(node, key),
            )) {
                fatal("Cycle cut must contain a tracked value")
            }
        }
    }

    for (const key of Object.keys(meta?.mirrors ?? {})) {
        const mirror = promiseMirrors.getPromiseMirror(node, key)
        const descriptor = languageProperties.getLanguagePropertyDescriptor(
            node,
            key,
        )
        const preservesPromise = mirror &&
            Object.hasOwn(mirror, "resolvedValue")
        const physicalPromise = languageValues.isPromise(descriptor?.value)
        const imported = metadata.importBoundaryOf(node) !== undefined
        if (!mirror || !descriptor?.enumerable ||
            !("value" in descriptor) ||
            (
                (!descriptor.writable || preservesPromise) &&
                (!imported || !physicalPromise)
            )) {
            fatal("Live Promise mirror has no valid language property")
        }
    }
}

function verifyStoredParentEdges(node) {
    const counter = getRefCounter(node)
    for (const [parent, count] of counter.parents) {
        if (!languageValues.isTracked(parent)) {
            fatal("Parent edge points to untracked parent")
        }
        if (!getRefCounter(parent)) {
            fatal("Parent edge points to non-ref-indexed parent")
        }

        let actualCount = 0
        for (const key of languageProperties.enumerableLanguageKeys(parent)) {
            if (recountProperty(parent, key).child === node) actualCount++
        }
        if (actualCount !== count) {
            fatal("Parent edge count is inconsistent")
        }
    }
}

function verifyParentGraph(node, states) {
    if (!getRefCounter(node)) return
    const state = states.get(node)
    if (state === "done") return
    if (state === "active") fatal("Ref-count parent graph contains a cycle")

    states.set(node, "active")
    for (const parent of getRefCounter(node).parents.keys()) {
        verifyParentGraph(parent, states)
    }
    states.set(node, "done")
}

// Recount each property here instead of using the count helpers being checked.
function recountProperty(node, key) {
    const mirror = promiseMirrors.getPromiseMirror(node, key)
    const child = readPropertyForRecount(node, key)
    if (languageValues.isPromise(child)) {
        if (!mirror) {
            fatal("Indexed promise property has no mirror")
        }
        if (metadata.metaOf(node)?.cycleCuts?.has(key)) {
            fatal("Pending Promise property also has a cycle cut")
        }
        return { child: undefined, counts: [1, 0, 0] }
    }
    if (metadata.metaOf(node)?.cycleCuts?.has(key)) {
        return { child: undefined, counts: [0, 0, 1] }
    }

    if (languageValues.isError(child)) return { child, counts: [0, 1, 0] }
    if (!languageValues.isTracked(child)) {
        return { child, counts: [0, 0, 0] }
    }

    const counter = getRefCounter(child)
    if (!counter) return { child, counts: [0, 0, 0] }
    return {
        child,
        counts: [
            counter.promiseCount,
            counter.errorCount,
            counter.cycleCutCount,
        ],
    }
}

function readPropertyForRecount(node, key) {
    return languageProperties.readLanguageProperty(node, key)
}

function getRefCounter(node) {
    const meta = metadata.metaOf(node)
    return meta?.parents ? meta : undefined
}

function fatal(message) {
    errorUtils.reportFatalError(new Error(message))
}

export { verifyRefCounts }
