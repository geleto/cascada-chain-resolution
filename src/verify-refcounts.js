// Test-only consistency oracle. It recounts logical placements independently,
// verifies both directions of every parent edge, and rejects counter cycles.
import * as helpers from "./helpers.js"
import * as errorUtils from "./error.js"
import * as refcounts from "./refcounts.js"

function verifyRefCounts(...roots) {
    const seen = new Set()
    for (const root of roots) verifyReachable(root, seen)

    const parentStates = new Map()
    for (const node of seen) verifyParentGraph(node, parentStates)
}

function verifyReachable(node, seen) {
    if (!helpers.isTracked(node) || seen.has(node)) return
    seen.add(node)

    const counter = refcounts.getRefCounter(node)
    if (counter) {
        let promiseCount = 0
        let errorCount = 0
        const childEdges = new Map()

        for (const key of Object.keys(node)) {
            const child = refcounts.getCountedChild(node, key)
            if (helpers.isTracked(child) && !refcounts.getRefCounter(child)) {
                errorUtils.reportFatalError(new Error("Ref-indexed parent contains non-ref-indexed child"))
            }
            const counts = refcounts.getPropertyRefCounts(node, key)
            promiseCount += counts[0]
            errorCount += counts[1]

            if (refcounts.getRefCounter(child)) {
                childEdges.set(child, (childEdges.get(child) ?? 0) + 1)
            }
        }

        if (counter.promiseCount !== promiseCount || counter.errorCount !== errorCount) {
            errorUtils.reportFatalError(new Error("Counter totals are inconsistent"))
        }
        for (const [child, count] of childEdges) {
            if (refcounts.getRequiredRefCounter(child).parents.get(node) !== count) {
                errorUtils.reportFatalError(new Error("Parent edge count is inconsistent"))
            }
        }
        verifyStoredParentEdges(node)
    }

    for (const key of Object.keys(node)) {
        verifyReachable(refcounts.getCountedChild(node, key), seen)
    }
    if (counter) {
        for (const parent of counter.parents.keys()) verifyReachable(parent, seen)
    }
}

function verifyStoredParentEdges(node) {
    const counter = refcounts.getRequiredRefCounter(node)
    for (const [parent, count] of counter.parents) {
        if (!helpers.isTracked(parent)) {
            errorUtils.reportFatalError(new Error("Parent edge points to untracked parent"))
        }
        if (!refcounts.getRefCounter(parent)) {
            errorUtils.reportFatalError(new Error("Parent edge points to non-ref-indexed parent"))
        }

        let actualCount = 0
        for (const key of Object.keys(parent)) {
            if (refcounts.getCountedChild(parent, key) === node) actualCount++
        }
        if (actualCount !== count) {
            errorUtils.reportFatalError(new Error("Parent edge count is inconsistent"))
        }
    }
}

function verifyParentGraph(node, states) {
    if (!refcounts.getRefCounter(node)) return
    const state = states.get(node)
    if (state === "done") return
    if (state === "active") {
        errorUtils.reportFatalError(new Error("Ref-count parent graph contains a cycle"))
    }

    states.set(node, "active")
    for (const parent of refcounts.getRequiredRefCounter(node).parents.keys()) {
        verifyParentGraph(parent, states)
    }
    states.set(node, "done")
}

export {
    verifyRefCounts,
}
