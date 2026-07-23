"use strict"

const {
    isError,
    isPromise,
    isTracked,
} = require("./helpers")
const {
    reportFatalError,
} = require("./error")
const {
    ensureMeta,
    markShared,
    metaOf,
    nodeImportBoundary,
} = require("./meta")
const {
    clearPromiseMirror,
    getOrCreatePromiseMirror,
    getPromiseMirror,
    installPromiseMirror,
    isLivePromiseMirror,
    readLogicalProperty,
} = require("./promise-mirrors")
const {
    clearMetaCycleError,
    getCycleError,
    initImport,
} = require("./import")
const { writeLanguageProperty } = require("./validate")

function getRefCounter(node) {
    const meta = metaOf(node)
    return meta?.parents ? meta : undefined
}

function getRequiredRefCounter(node) {
    const counter = getRefCounter(node)
    if (!counter) {
        reportFatalError(new Error("Ref counts require a ref-indexed value"))
    }
    return counter
}

function getRefCounts(value) {
    if (isPromise(value)) return [1, 0]
    if (isError(value)) return [0, 1]
    if (!isTracked(value)) return [0, 0]

    const counter = getRequiredRefCounter(value)
    return [counter.promiseCount, counter.errorCount]
}

function getPropertyRefCounts(parent, key) {
    const mirror = getPromiseMirror(parent, key)
    if (mirror && mirror.pendingConsumerCount > 0) return [1, 0]
    if (getCycleError(parent, key)) return [0, 1]
    return getRefCounts(readLogicalProperty(parent, key))
}

function getCountedChild(parent, key) {
    const mirror = getPromiseMirror(parent, key)
    if (mirror && mirror.pendingConsumerCount > 0) return undefined
    if (getCycleError(parent, key)) return undefined
    return readLogicalProperty(parent, key)
}

function buildRefIndex(value, inheritedImportBoundary = undefined) {
    if (!isTracked(value)) return value

    const importBoundary = nodeImportBoundary(value, inheritedImportBoundary)
    if (importBoundary) {
        if (!getRefCounter(importBoundary.root)) {
            commitRefIndex(importBoundary.root, importBoundary, true)
        }
        commitRefIndex(value, importBoundary, true)
        return value
    }

    if (getRefCounter(value)) return value
    commitRefIndex(value)
    return value
}

function commitRefIndex(
    node,
    inheritedImportBoundary,
    importGraphPrepared = false,
) {
    if (!isTracked(node)) return [0, 0]

    const existing = getRefCounter(node)
    if (existing) return [existing.promiseCount, existing.errorCount]

    const importBoundary = nodeImportBoundary(node, inheritedImportBoundary)

    let promiseCount = 0
    let errorCount = 0
    const childNodes = []

    for (const key of Object.keys(node)) {
        if (getCycleError(node, key)) {
            errorCount++
            continue
        }

        let mirror = getPromiseMirror(node, key)
        const child = readLogicalProperty(node, key)
        if (isPromise(child)) {
            mirror ??= getOrCreatePromiseMirror(node, key, child, importBoundary)
            promiseCount++
            continue
        }

        if (isError(child)) {
            errorCount++
            continue
        }
        if (!isTracked(child)) continue

        const childImportBoundary = mirror?.importBoundary ??
            nodeImportBoundary(child, importBoundary)
        if (childImportBoundary && !importGraphPrepared) {
            buildRefIndex(child, childImportBoundary)
        }

        const childCounts = commitRefIndex(
            child,
            childImportBoundary,
            importGraphPrepared,
        )
        promiseCount += childCounts[0]
        errorCount += childCounts[1]
        childNodes.push(child)
    }

    // Imported preparation can index this node through a back-reference after
    // publishing a cut on the edge currently being walked. That completed
    // index is authoritative; publishing this older recursive frame would
    // duplicate its child edges and overwrite its totals.
    const completedDuringWalk = getRefCounter(node)
    if (completedDuringWalk) {
        return [completedDuringWalk.promiseCount, completedDuringWalk.errorCount]
    }

    const counter = ensureMeta(node)
    counter.promiseCount = promiseCount
    counter.errorCount = errorCount
    counter.parents = new Map()
    for (const child of childNodes) addParentEdge(child, node)
    return [promiseCount, errorCount]
}

function preparePropertyTransition(
    owner,
    propertyMirror,
    newValue,
    markNewValueShared = false,
) {
    // The next FIFO consumer may mutate this private value before the mirror
    // drains. Publish the irreversible sharing mark now so that advance COWs.
    if (markNewValueShared) markShared(newValue)
    const importBoundary = nodeImportBoundary(
        newValue,
        propertyMirror?.importBoundary,
    )
    if (propertyMirror && importBoundary) {
        propertyMirror.importBoundary = importBoundary
    }

    if (getRefCounter(owner) && isTracked(newValue)) {
        buildRefIndex(newValue, importBoundary)
    }
}

function commitPropertyTransition(owner, key, propertyMirror, newValue) {
    commitLiveEdge(
        owner,
        key,
        () => {
            if (propertyMirror) {
                writeLanguageProperty(owner, key, propertyMirror.promise)
                clearMetaCycleError(owner, key)
                installPromiseMirror(owner, key, propertyMirror)
            } else {
                writeLanguageProperty(owner, key, newValue)
                clearMetaCycleError(owner, key)
                clearPromiseMirror(owner, key)
            }
        },
    )
}

function commitMirrorDrain(mirror) {
    if (!isLivePromiseMirror(mirror.node, mirror.key, mirror)) {
        mirror.pendingConsumerCount--
        return
    }

    if (getRefCounter(mirror.node) &&
        !mirror.cycleError &&
        isTracked(mirror.currentValue) &&
        !getRefCounter(mirror.currentValue)) {
        buildRefIndex(mirror.currentValue, mirror.importBoundary)
    }

    commitLiveEdge(
        mirror.node,
        mirror.key,
        () => {
            if (!metaOf(mirror.node)?.importedOriginal &&
                Object.isExtensible(mirror.node)) {
                writeLanguageProperty(mirror.node, mirror.key, mirror.currentValue)
            }
            clearMetaCycleError(mirror.node, mirror.key)
            mirror.pendingConsumerCount--
        },
    )
}

function deleteEdge(parent, key) {
    commitLiveEdge(parent, key, () => {
        delete parent[key]
        clearPromiseMirror(parent, key)
        clearMetaCycleError(parent, key)
    })
}

function commitLiveEdge(owner, key, updateProperty) {
    const counter = getRefCounter(owner)
    const oldCounts = counter ? getPropertyRefCounts(owner, key) : undefined
    const oldChild = counter ? getCountedChild(owner, key) : undefined

    updateProperty()
    if (!counter) return

    const nextCounts = getPropertyRefCounts(owner, key)
    const nextChild = getCountedChild(owner, key)
    removeParentEdge(oldChild, owner)
    addParentEdge(nextChild, owner)
    applyCountDelta(
        owner,
        nextCounts[0] - oldCounts[0],
        nextCounts[1] - oldCounts[1],
    )
}

function addParentEdge(value, parent) {
    if (!isTracked(value)) return
    const counter = getRequiredRefCounter(value)
    counter.parents.set(parent, (counter.parents.get(parent) ?? 0) + 1)
}

function removeParentEdge(value, parent) {
    if (!isTracked(value)) return
    const counter = getRequiredRefCounter(value)
    const count = counter.parents.get(parent)
    if (count === 1) {
        counter.parents.delete(parent)
    } else if (count > 1) {
        counter.parents.set(parent, count - 1)
    }
}

function applyCountDelta(node, promiseDelta, errorDelta) {
    if (promiseDelta === 0 && errorDelta === 0) return

    const counter = getRequiredRefCounter(node)
    const oldPromiseCount = counter.promiseCount
    counter.promiseCount += promiseDelta
    counter.errorCount += errorDelta
    // A mirror retains [1,0] until every registered consumer drains, so this
    // zero is final for the pinned settlement generation.
    if (
        oldPromiseCount > 0 &&
        counter.promiseCount === 0 &&
        counter.settlementPromise
    ) {
        const resolve = counter.settlementResolve
        counter.settlementPromise = undefined
        counter.settlementResolve = undefined
        resolve()
    }
    for (const [parent, multiplicity] of counter.parents) {
        applyCountDelta(parent, promiseDelta * multiplicity, errorDelta * multiplicity)
    }
}

function waitForSettlement(node) {
    const counter = getRequiredRefCounter(node)
    if (!counter.settlementPromise) {
        counter.settlementPromise = new Promise(resolve => {
            counter.settlementResolve = resolve
        })
    }
    return counter.settlementPromise
}

function copyCounters(source, copy) {
    if (!getRefCounter(source)) return
    commitRefIndex(copy)
}

initImport(commitLiveEdge, mirror => {
    preparePropertyTransition(
        mirror.node,
        mirror,
        mirror.currentValue,
    )
})

module.exports = {
    buildRefIndex,
    commitPropertyTransition,
    commitMirrorDrain,
    copyCounters,
    deleteEdge,
    getCountedChild,
    getPropertyRefCounts,
    getRefCounter,
    getRequiredRefCounter,
    getRefCounts,
    preparePropertyTransition,
    waitForSettlement,
}
