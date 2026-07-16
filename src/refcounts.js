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
    markImported,
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
    buildImportedRefIndex,
    clearCycleError,
    getCommittedCycleError,
    prepareImportedPropertyTransition,
    setCycleError,
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
    if (getCommittedCycleError(parent, key)) return [0, 1]
    return getRefCounts(readLogicalProperty(parent, key))
}

function getCountedChild(parent, key) {
    const mirror = getPromiseMirror(parent, key)
    if (mirror && mirror.pendingConsumerCount > 0) return undefined
    if (getCommittedCycleError(parent, key)) return undefined
    return readLogicalProperty(parent, key)
}

function buildRefIndex(value, inheritedImportBoundary = undefined, placement = undefined) {
    if (!isTracked(value)) return value

    const importBoundary = nodeImportBoundary(value, inheritedImportBoundary)
    if (importBoundary) {
        buildImportedRefIndex(
            value,
            importBoundary,
            placement,
            !getRefCounter(importBoundary.root),
            commitRefIndex,
            commitCycleErrorEdge,
        )
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
        if (getCommittedCycleError(node, key)) {
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
            buildRefIndex(child, childImportBoundary, {
                parent: node,
                key,
                mirror,
            })
            if (getCommittedCycleError(node, key)) {
                errorCount++
                continue
            }
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
    key,
    propertyMirror,
    newValue,
    markNewValueShared = false,
) {
    const ownerCounter = getRefCounter(owner)
    const prepared = {
        value: newValue,
        cycleError: undefined,
        preparedWhileOwnerIndexed: !!ownerCounter,
    }
    // The next FIFO consumer may mutate this private value before the mirror
    // drains. Publish the irreversible sharing mark now so that advance COWs.
    if (markNewValueShared) markShared(newValue)

    let importBoundary = nodeImportBoundary(newValue)
    if (propertyMirror?.importBoundary && !importBoundary) {
        markImported(newValue, propertyMirror.importBoundary.errorContext)
        importBoundary = nodeImportBoundary(newValue)
    }
    if (propertyMirror && importBoundary) {
        propertyMirror.importBoundary = importBoundary
    }

    if (!ownerCounter || !isTracked(newValue)) {
        return prepared
    }

    if (importBoundary) {
        prepared.cycleError = prepareImportedPropertyTransition(
            newValue,
            owner,
            key,
            propertyMirror,
            importBoundary,
            !getRefCounter(importBoundary.root),
            commitRefIndex,
            commitCycleErrorEdge,
        )
        if (prepared.cycleError) {
            return prepared
        }
    }

    buildRefIndex(newValue, importBoundary)
    return prepared
}

function commitPropertyTransition(owner, key, propertyMirror, prepared) {
    const nextCounts = prepared.preparedWhileOwnerIndexed
        ? (prepared.cycleError ? [0, 1] : getRefCounts(prepared.value))
        : undefined
    const nextChild = prepared.cycleError || isPromise(prepared.value)
        ? undefined
        : prepared.value
    commitLiveEdge(
        owner,
        key,
        nextCounts,
        nextChild,
        () => {
            if (propertyMirror) {
                writeLanguageProperty(owner, key, propertyMirror.promise)
                clearCycleError(owner, key)
                installPromiseMirror(owner, key, propertyMirror)
                propertyMirror.cycleError = prepared.cycleError
            } else {
                writeLanguageProperty(owner, key, prepared.value)
                clearCycleError(owner, key)
                clearPromiseMirror(owner, key)
                if (prepared.cycleError) {
                    setCycleError(owner, key, prepared.cycleError)
                }
            }
        },
    )
}

function commitMirrorDrain(mirror) {
    if (!isLivePromiseMirror(mirror.node, mirror.key, mirror)) return

    const counter = getRefCounter(mirror.node)
    if (counter && !mirror.preparedWhileOwnerIndexed) {
        const previousCycleError = mirror.cycleError
        const prepared = preparePropertyTransition(
            mirror.node,
            mirror.key,
            mirror,
            mirror.currentValue,
        )
        if (previousCycleError && prepared.cycleError) {
            prepared.cycleError = previousCycleError
        }
        mirror.currentValue = prepared.value
        mirror.cycleError = prepared.cycleError
        mirror.preparedWhileOwnerIndexed = prepared.preparedWhileOwnerIndexed
    }

    let nextCounts
    if (counter) {
        nextCounts = mirror.cycleError
            ? [0, 1]
            : getRefCounts(mirror.currentValue)
    }
    const nextChild = mirror.cycleError ? undefined : mirror.currentValue
    commitLiveEdge(
        mirror.node,
        mirror.key,
        nextCounts,
        nextChild,
        () => {
            if (!mirror.ownerIsImportedOriginal && Object.isExtensible(mirror.node)) {
                writeLanguageProperty(mirror.node, mirror.key, mirror.currentValue)
            }
            clearCycleError(mirror.node, mirror.key)
        },
    )
}

function commitCycleErrorEdge(parent, key, nextValue, cycleError, publish) {
    const counter = getRefCounter(parent)
    let nextCounts
    let nextChild
    if (counter) {
        nextCounts = cycleError ? [0, 1] : getRefCounts(nextValue)
        nextChild = cycleError || isPromise(nextValue) || isError(nextValue)
            ? undefined
            : nextValue
    }
    commitLiveEdge(parent, key, nextCounts, nextChild, publish)
}

function deleteEdge(parent, key) {
    commitLiveEdge(parent, key, [0, 0], undefined, () => {
        delete parent[key]
        clearPromiseMirror(parent, key)
        clearCycleError(parent, key)
    })
}

function commitLiveEdge(owner, key, nextCounts, nextChild, updatePlacement) {
    const counter = getRefCounter(owner)
    const oldCounts = counter ? getPropertyRefCounts(owner, key) : undefined
    const oldChild = counter ? getCountedChild(owner, key) : undefined

    updatePlacement()
    if (!counter) return

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
