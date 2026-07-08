const {
    isError,
    isPromise,
    isTracked,
} = require("./helpers")
const {
    ensureMeta,
    metaOf,
} = require("./meta")

const hasOwn = Object.prototype.hasOwnProperty

let mintPromiseMirror = null

function initRef(hooks) {
    mintPromiseMirror = hooks.mintPromiseMirror
}

function getRefCounter(node) {
    const meta = metaOf(node)
    return meta?.parents !== undefined ? meta : undefined
}

function readOwnProperty(node, key) {
    return hasOwn.call(node, key) ? node[key] : undefined
}

function ensureCounter(node) {
    return ensureMeta(node)
}

// `parents` is both the ref-indexed marker and the exact reverse-edge multiset.
// Undefined means counters are not live; an empty Map means a ref-indexed root
// with no ref-indexed parents. Never delete the Map itself.
function isRefIndexed(node) {
    return metaOf(node)?.parents !== undefined
}

function getRefCounts(value) {
    if (isPromise(value)) return [1, 0]
    if (isError(value)) return [0, 1]
    if (!isTracked(value) || !Object.isExtensible(value)) {
        return [0, 0]
    }

    refIndexBranch(value)

    const counter = getRefCounter(value)
    return [counter.promiseCount, counter.errorCount]
}

function refIndexBranch(value) {
    if (!isTracked(value)) return value
    if (!Object.isExtensible(value)) return value
    if (isRefIndexed(value)) return value

    if (mintPromiseMirror === null) {
        assertNoPromisesToRefIndex(value, new Set())
    }

    commitRefIndex(value, new Set())
    return value
}

function assertNoPromisesToRefIndex(value, visited) {
    if (!isTracked(value) || !Object.isExtensible(value) || isRefIndexed(value)) return
    if (visited.has(value)) return
    visited.add(value)

    for (const key of Object.keys(value)) {
        const child = value[key]
        if (isPromise(child)) {
            throw new Error("initRef must be called before ref-indexing promises")
        }
        assertNoPromisesToRefIndex(child, visited)
    }
}

function commitRefIndex(node, visited) {
    if (!isTracked(node) || !Object.isExtensible(node)) {
        return [0, 0]
    }

    const existing = getRefCounter(node)
    if (existing?.parents !== undefined) {
        return [existing.promiseCount, existing.errorCount]
    }

    if (visited.has(node)) {
        const counter = getRefCounter(node)
        return [counter.promiseCount, counter.errorCount]
    }

    visited.add(node)

    let promiseCount = 0
    let errorCount = 0
    const childNodes = []

    for (const key of Object.keys(node)) {
        const child = node[key]
        let childPromiseCount = 0
        let childErrorCount = 0
        if (isPromise(child)) {
            mintPromiseMirror(node, key, child)
            childPromiseCount = 1
        } else if (isError(child)) {
            childErrorCount = 1
        } else {
            const childCounts = commitRefIndex(child, visited)
            childPromiseCount = childCounts[0]
            childErrorCount = childCounts[1]
        }
        promiseCount += childPromiseCount
        errorCount += childErrorCount

        if (isTracked(child) && Object.isExtensible(child)) {
            childNodes.push(child)
        }
    }

    // Atomic commit point: after every child has been counted, publish this node's
    // totals and parent edges together. This keeps failed/bailed walks from leaving
    // partial nodes or dangling child -> parent edges.
    const counter = ensureCounter(node)
    counter.promiseCount = promiseCount
    counter.errorCount = errorCount
    counter.parents = new Map()

    for (const child of childNodes) {
        addParentEdge(child, node)
    }

    return [promiseCount, errorCount]
}

function refSetProperty(parent, key, value) {
    const counter = getRefCounter(parent)
    if (counter?.parents === undefined) {
        return value
    }

    const oldValue = readOwnProperty(parent, key)
    const [oldPromiseCount, oldErrorCount] = getRefCounts(oldValue)
    const refIndexedValue = refIndexBranch(value)
    const [newPromiseCount, newErrorCount] = getRefCounts(refIndexedValue)

    removeParentEdge(oldValue, parent)
    addParentEdge(refIndexedValue, parent)

    applyCountDelta(
        parent,
        newPromiseCount - oldPromiseCount,
        newErrorCount - oldErrorCount,
    )

    return refIndexedValue
}

function refDeleteProperty(parent, key) {
    const counter = getRefCounter(parent)
    if (counter?.parents === undefined) {
        return
    }

    const oldValue = readOwnProperty(parent, key)
    const [oldPromiseCount, oldErrorCount] = getRefCounts(oldValue)

    removeParentEdge(oldValue, parent)
    applyCountDelta(parent, -oldPromiseCount, -oldErrorCount)
}

function addParentEdge(value, parent) {
    if (!isTracked(value) || !Object.isExtensible(value)) return

    const counter = getRefCounter(value)
    if (counter?.parents === undefined) return

    counter.parents.set(parent, (counter.parents.get(parent) ?? 0) + 1)
}

function removeParentEdge(value, parent) {
    if (!isTracked(value) || !Object.isExtensible(value)) return

    const parents = getRefCounter(value)?.parents
    if (parents === undefined) return

    const count = parents.get(parent)
    if (count === 1) {
        parents.delete(parent)
    } else if (count !== undefined) {
        parents.set(parent, count - 1)
    }
}

function applyCountDelta(node, promiseDelta, errorDelta) {
    if (promiseDelta === 0 && errorDelta === 0) return

    const counter = getRefCounter(node)
    counter.promiseCount += promiseDelta
    counter.errorCount += errorDelta

    for (const [parent, multiplicity] of counter.parents) {
        applyCountDelta(parent, promiseDelta * multiplicity, errorDelta * multiplicity)
    }
}

function copyCounters(source, copy) {
    const sourceCounter = getRefCounter(source)
    if (sourceCounter?.parents === undefined) return

    const copyCounter = ensureCounter(copy)
    copyCounter.promiseCount = sourceCounter.promiseCount
    copyCounter.errorCount = sourceCounter.errorCount
    copyCounter.parents = new Map()

    for (const key of Object.keys(copy)) {
        addParentEdge(copy[key], copy)
    }
}

module.exports = {
    copyCounters,
    getRefCounter,
    getRefCounts,
    initRef,
    refIndexBranch,
    refDeleteProperty,
    refSetProperty,
}
