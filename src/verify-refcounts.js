// Test-only consistency oracle. It independently recounts projected
// placements, verifies cycle-cut shape and both parent-edge directions, and
// rejects cycles in the projected parent graph.
import * as helpers from "./helpers.js"
import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"

const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

function verifyRefCounts(...roots) {
    const seen = new Set()
    for (const root of roots) verifyReachable(root, seen)

    const parentStates = new Map()
    for (const node of seen) verifyParentGraph(node, parentStates)
}

function verifyReachable(node, seen) {
    if (!helpers.isTracked(node) || seen.has(node)) return
    seen.add(node)
    verifyCycleCuts(node)

    const counter = getRefCounter(node)
    if (counter) {
        let promiseCount = 0
        let errorCount = 0
        let cycleCutCount = 0
        const childEdges = new Map()

        for (const key of Object.keys(node)) {
            const { child, counts } = recountProperty(node, key)
            if (helpers.isTracked(child) && !getRefCounter(child)) {
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

    // Raw traversal validates markers beyond a cut without requiring counters
    // there. Ordinary projected edges are checked above before reaching here.
    for (const key of Object.keys(node)) {
        const mirror = promiseMirrors.getPromiseMirror(node, key)
        const child = mirror?.cycleCut
            ? mirror.currentValue
            : readPropertyForRecount(node, key, mirror)
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
            if (promiseMirrors.getPromiseMirror(node, key)) {
                fatal("Mirrored property also has a plain cycle cut")
            }
            if (!propertyIsEnumerable.call(node, key)) {
                fatal("Cycle cut names a missing or non-enumerable property")
            }
            if (!helpers.isTracked(node[key])) {
                fatal("Cycle cut must contain a tracked value")
            }
        }
    }

    for (const key of Object.keys(meta?.mirrors ?? {})) {
        const mirror = promiseMirrors.getPromiseMirror(node, key)
        if (!mirror?.cycleCut) continue
        if (!propertyIsEnumerable.call(node, key)) {
            fatal("Promise cycle cut names a missing or non-enumerable property")
        }
        if (!helpers.isTracked(mirror.currentValue)) {
            fatal("Promise cycle cut must contain a prepared tracked value")
        }
    }
}

function verifyStoredParentEdges(node) {
    const counter = getRefCounter(node)
    for (const [parent, count] of counter.parents) {
        if (!helpers.isTracked(parent)) {
            fatal("Parent edge points to untracked parent")
        }
        if (!getRefCounter(parent)) {
            fatal("Parent edge points to non-ref-indexed parent")
        }

        let actualCount = 0
        for (const key of Object.keys(parent)) {
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
    if (mirror && !mirror.isDrained()) {
        return { child: undefined, counts: [1, 0, 0] }
    }
    if (mirror?.cycleCut || (!mirror && metadata.metaOf(node)?.cycleCuts?.has(key))) {
        return { child: undefined, counts: [0, 0, 1] }
    }

    const child = readPropertyForRecount(node, key, mirror)
    if (helpers.isPromise(child)) return { child, counts: [1, 0, 0] }
    if (helpers.isError(child)) return { child, counts: [0, 1, 0] }
    if (!helpers.isTracked(child)) return { child, counts: [0, 0, 0] }

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

function readPropertyForRecount(node, key, mirror) {
    if (mirror) return mirror.isDrained() ? mirror.currentValue : mirror.promise
    return propertyIsEnumerable.call(node, key) ? node[key] : undefined
}

function getRefCounter(node) {
    const meta = metadata.metaOf(node)
    return meta?.parents ? meta : undefined
}

function fatal(message) {
    errorUtils.reportFatalError(new Error(message))
}

export { verifyRefCounts }
