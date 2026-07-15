// Test-only consistency oracle. It recounts logical placements independently,
// verifies both directions of every parent edge, and rejects counter cycles.
const { isTracked } = require("./helpers")
const { reportFatalError } = require("./error")
const {
    getCountedChild,
    getPropertyRefCounts,
    getRefCounter,
    getRequiredRefCounter,
} = require("./refcounts")

function verifyRefCounts(...roots) {
    const seen = new Set()
    for (const root of roots) verifyReachable(root, seen)

    const parentStates = new Map()
    for (const node of seen) verifyParentGraph(node, parentStates)
}

function verifyReachable(node, seen) {
    if (!isTracked(node) || seen.has(node)) return
    seen.add(node)

    const counter = getRefCounter(node)
    if (counter) {
        let promiseCount = 0
        let errorCount = 0
        const childEdges = new Map()

        for (const key of Object.keys(node)) {
            const child = getCountedChild(node, key)
            if (isTracked(child) && !getRefCounter(child)) {
                reportFatalError(new Error("Ref-indexed parent contains non-ref-indexed child"))
            }
            const counts = getPropertyRefCounts(node, key)
            promiseCount += counts[0]
            errorCount += counts[1]

            if (getRefCounter(child)) {
                childEdges.set(child, (childEdges.get(child) ?? 0) + 1)
            }
        }

        if (counter.promiseCount !== promiseCount || counter.errorCount !== errorCount) {
            reportFatalError(new Error("Counter totals are inconsistent"))
        }
        for (const [child, count] of childEdges) {
            if (getRequiredRefCounter(child).parents.get(node) !== count) {
                reportFatalError(new Error("Parent edge count is inconsistent"))
            }
        }
        verifyStoredParentEdges(node)
    }

    for (const key of Object.keys(node)) {
        verifyReachable(getCountedChild(node, key), seen)
    }
    if (counter) {
        for (const parent of counter.parents.keys()) verifyReachable(parent, seen)
    }
}

function verifyStoredParentEdges(node) {
    const counter = getRequiredRefCounter(node)
    for (const [parent, count] of counter.parents) {
        if (!isTracked(parent)) {
            reportFatalError(new Error("Parent edge points to untracked parent"))
        }
        if (!getRefCounter(parent)) {
            reportFatalError(new Error("Parent edge points to non-ref-indexed parent"))
        }

        let actualCount = 0
        for (const key of Object.keys(parent)) {
            if (getCountedChild(parent, key) === node) actualCount++
        }
        if (actualCount !== count) {
            reportFatalError(new Error("Parent edge count is inconsistent"))
        }
    }
}

function verifyParentGraph(node, states) {
    if (!getRefCounter(node)) return
    const state = states.get(node)
    if (state === "done") return
    if (state === "active") {
        reportFatalError(new Error("Ref-count parent graph contains a cycle"))
    }

    states.set(node, "active")
    for (const parent of getRequiredRefCounter(node).parents.keys()) {
        verifyParentGraph(parent, states)
    }
    states.set(node, "done")
}

module.exports = {
    verifyRefCounts,
}
