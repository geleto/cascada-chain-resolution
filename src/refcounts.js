const {
    isError,
    isPromise,
    isTracked,
    onInternalResolve,
} = require("./helpers")
const {
    ensureMeta,
    metaOf,
    nodeImportContext,
} = require("./meta")
const { reportFatalError } = require("./error")
const {
    getOrCreatePromiseMirror,
} = require("./promise-mirrors")
const { validateCountable } = require("./validate")

const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

function getRefCounter(node) {
    const meta = metaOf(node)
    return meta?.parents !== undefined ? meta : undefined
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

    const counter = getRefCounter(value)
    // A tracked child of a ref-indexed parent must already carry counters.
    // Repairing it here would hide a broken downward-closure invariant.
    if (counter === undefined) {
        reportFatalError(new Error("Ref counts require a ref-indexed value"))
    }
    return [counter.promiseCount, counter.errorCount]
}

function buildRefIndex(value, inheritedImportContext = undefined) {
    if (!isTracked(value)) return value
    if (!Object.isExtensible(value)) {
        // Frozen roots are validated (no promises/Errors anywhere beneath) but
        // receive no metadata: they are permanently [0,0] by the frozen rule.
        return validateCountable(value, undefined, isRefIndexed, inheritedImportContext) ?? value
    }
    if (isRefIndexed(value)) return value

    // Validate-then-commit, two passes: the validate pass is pure and the
    // commit pass cannot fail, so a rejection leaves no partial counters,
    // edges, or mirrors behind.
    const failure = validateCountable(value, undefined, isRefIndexed, inheritedImportContext)
    if (failure) return failure

    commitRefIndex(value, new Set(), inheritedImportContext)
    return value
}

function commitRefIndex(node, visited, inheritedImportContext) {
    if (!isTracked(node) || !Object.isExtensible(node)) {
        return [0, 0]
    }

    const importContext = nodeImportContext(node, inheritedImportContext)

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
            getOrCreatePromiseMirror(node, key, child, importContext)
            childPromiseCount = 1
        } else if (isError(child)) {
            childErrorCount = 1
        } else {
            const childCounts = commitRefIndex(child, visited, importContext)
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

    const nextValue = indexChildValue(parent, value)
    const [nextPromiseCount, nextErrorCount] = getRefCounts(nextValue)

    updatePropertyCounts(
        parent,
        key,
        nextValue,
        nextPromiseCount,
        nextErrorCount,
    )

    return nextValue
}

// A value entering a ref-indexed parent must be validated and carry exact
// subtree counters before it can become observable. Live property writes use
// this through refSetProperty; revoked promise mirrors use it without changing
// the parent property or its counts.
function refIndexChildValue(parent, value) {
    if (getRefCounter(parent)?.parents === undefined) return value
    return indexChildValue(parent, value)
}

function indexChildValue(parent, value) {
    // A write-created cycle must pass through the written parent, so validation
    // uses that parent as its back-edge target before the infallible commit.
    const failure = validateCountable(value, parent, isRefIndexed)
    if (failure) return failure

    if (isTracked(value) && Object.isExtensible(value)) {
        commitRefIndex(value, new Set(), undefined)
    }
    return value
}

function refDeleteProperty(parent, key) {
    const counter = getRefCounter(parent)
    if (counter?.parents === undefined) {
        return
    }

    updatePropertyCounts(parent, key, undefined, 0, 0)
}

function updatePropertyCounts(parent, key, nextValue, nextPromiseCount, nextErrorCount) {
    const oldValue = propertyIsEnumerable.call(parent, key) ? parent[key] : undefined
    const [oldPromiseCount, oldErrorCount] = getRefCounts(oldValue)

    removeParentEdge(oldValue, parent)
    addParentEdge(nextValue, parent)

    applyCountDelta(
        parent,
        nextPromiseCount - oldPromiseCount,
        nextErrorCount - oldErrorCount,
    )
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
    const oldPromiseCount = counter.promiseCount
    counter.promiseCount += promiseDelta
    counter.errorCount += errorDelta
    if (oldPromiseCount > 0 && counter.promiseCount === 0) {
        scheduleSettlementVerify(counter)
    }

    for (const [parent, multiplicity] of counter.parents) {
        applyCountDelta(parent, promiseDelta * multiplicity, errorDelta * multiplicity)
    }
}

function waitForSettlement(node) {
    const counter = getRefCounter(node)

    if (counter.settlementPromise === undefined) {
        counter.settlementPromise = new Promise(resolve => {
            counter.settlementResolve = resolve
        })
    }
    return counter.settlementPromise
}

function scheduleSettlementVerify(counter) {
    if (counter.settlementPromise === undefined || counter.settlementVerifyScheduled) return

    counter.settlementVerifyScheduled = true
    // Use Promise.resolve(), not a sync fast-path: same-promise FIFO jobs
    // queued after this one may still change the count; the queued recheck
    // runs after them. A re-arm just means the next zero-crossing re-schedules.
    //
    // Why a stable zero is final: earlier-issued remainders that could still
    // land in this branch are each suspended on a promise it counts [1,0] —
    // zero means none are left. Later-issued ops never touch this counter at
    // all: the pin mark makes them COW away, onto a copy with its own META.
    onInternalResolve(Promise.resolve(), () => {
        counter.settlementVerifyScheduled = false
        if (counter.settlementPromise !== undefined && counter.promiseCount === 0) {
            const resolve = counter.settlementResolve
            counter.settlementPromise = undefined
            counter.settlementResolve = undefined
            resolve()
        }
    })
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
    buildRefIndex,
    copyCounters,
    getRefCounter,
    getRefCounts,
    refDeleteProperty,
    refIndexChildValue,
    refSetProperty,
    waitForSettlement,
}
