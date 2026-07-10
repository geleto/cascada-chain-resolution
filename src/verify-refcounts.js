// Test-only consistency oracle: independently recompute every ref-indexed
// node's totals from its own keys and check that stored parent edges match the
// live key graph in both directions. The traversal follows child keys AND
// stored parent edges, so disconnected-but-retained COW worlds are reached too.
const {
    isError,
    isPromise,
    isTracked,
} = require("./helpers")
const { reportFatalError } = require("./error")
const { getRefCounter } = require("./refcounts")

function verifyRefCounts(...roots) {
    const seen = new Set()
    for (const root of roots) {
        verifyRefIndexedNode(root, seen)
    }
}

function verifyRefIndexedNode(node, seen) {
    if (!isTracked(node) || !Object.isExtensible(node) || seen.has(node)) return

    const counter = getRefCounter(node)
    if (counter?.parents === undefined) return

    seen.add(node)

    const expectedCounts = recountRefIndexedNode(node)
    if (counter.promiseCount !== expectedCounts.promiseCount ||
        counter.errorCount !== expectedCounts.errorCount) {
        reportFatalError(new Error("Counter totals are inconsistent"))
    }

    verifyStoredParentEdges(node)

    for (const key of Object.keys(node)) {
        verifyRefIndexedNode(node[key], seen)
    }
    for (const parent of counter.parents.keys()) {
        verifyRefIndexedNode(parent, seen)
    }
}

function recountRefIndexedNode(node) {
    let promiseCount = 0
    let errorCount = 0
    const childEdges = new Map()

    for (const key of Object.keys(node)) {
        const child = node[key]
        if (isPromise(child)) {
            promiseCount++
        } else if (isError(child)) {
            errorCount++
        } else if (isTracked(child) && Object.isExtensible(child)) {
            const childCounter = getRefCounter(child)
            if (childCounter?.parents === undefined) {
                reportFatalError(new Error("Ref-indexed parent contains non-ref-indexed child"))
            }

            promiseCount += childCounter.promiseCount
            errorCount += childCounter.errorCount
            childEdges.set(child, (childEdges.get(child) ?? 0) + 1)
        }
    }

    for (const [child, count] of childEdges) {
        if (getRefCounter(child).parents.get(node) !== count) {
            reportFatalError(new Error("Parent edge count is inconsistent"))
        }
    }

    return { promiseCount, errorCount }
}

function verifyStoredParentEdges(node) {
    const counter = getRefCounter(node)
    for (const [parent, count] of counter.parents) {
        if (!isTracked(parent) || !Object.isExtensible(parent)) {
            reportFatalError(new Error("Parent edge points to untracked parent"))
        }
        if (getRefCounter(parent)?.parents === undefined) {
            reportFatalError(new Error("Parent edge points to non-ref-indexed parent"))
        }

        let actualCount = 0
        for (const key of Object.keys(parent)) {
            if (parent[key] === node) actualCount++
        }
        if (actualCount !== count) {
            reportFatalError(new Error("Parent edge count is inconsistent"))
        }
    }
}

module.exports = {
    verifyRefCounts,
}
