"use strict"

import * as helpers from "./helpers.js"
import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as imports from "./import.js"
import * as languageProperties from "./language-properties.js"

function getRefCounter(node) {
    const meta = metadata.metaOf(node)
    return meta?.parents ? meta : undefined
}

function getRequiredRefCounter(node) {
    const counter = getRefCounter(node)
    if (!counter) {
        errorUtils.reportFatalError(new Error("Ref counts require a ref-indexed value"))
    }
    return counter
}

function getRefCounts(value) {
    if (helpers.isPromise(value)) return [1, 0]
    if (helpers.isError(value)) return [0, 1]
    if (!helpers.isTracked(value)) return [0, 0]

    const counter = getRequiredRefCounter(value)
    return [counter.promiseCount, counter.errorCount]
}

function getPropertyRefCounts(parent, key) {
    const mirror = promiseMirrors.getPromiseMirror(parent, key)
    if (mirror && mirror.pendingConsumerCount > 0) return [1, 0]
    if (imports.getCycleError(parent, key)) return [0, 1]
    return getRefCounts(promiseMirrors.readLogicalProperty(parent, key))
}

function getCountedChild(parent, key) {
    const mirror = promiseMirrors.getPromiseMirror(parent, key)
    if (mirror && mirror.pendingConsumerCount > 0) return undefined
    if (imports.getCycleError(parent, key)) return undefined
    return promiseMirrors.readLogicalProperty(parent, key)
}

function buildRefIndex(value, inheritedImportBoundary = undefined) {
    if (!helpers.isTracked(value)) return value

    const importBoundary = metadata.nodeImportBoundary(value, inheritedImportBoundary)
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
    if (!helpers.isTracked(node)) return [0, 0]

    const existing = getRefCounter(node)
    if (existing) return [existing.promiseCount, existing.errorCount]

    const importBoundary = metadata.nodeImportBoundary(node, inheritedImportBoundary)

    let promiseCount = 0
    let errorCount = 0
    const childNodes = []

    for (const key of Object.keys(node)) {
        if (imports.getCycleError(node, key)) {
            errorCount++
            continue
        }

        let mirror = promiseMirrors.getPromiseMirror(node, key)
        const child = promiseMirrors.readLogicalProperty(node, key)
        if (helpers.isPromise(child)) {
            mirror ??= promiseMirrors.getOrCreatePromiseMirror(node, key, child, importBoundary)
            promiseCount++
            continue
        }

        if (helpers.isError(child)) {
            errorCount++
            continue
        }
        if (!helpers.isTracked(child)) continue

        const childImportBoundary = mirror?.importBoundary ??
            metadata.nodeImportBoundary(child, importBoundary)
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

    const counter = metadata.ensureMeta(node)
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
    if (markNewValueShared) metadata.markShared(newValue)
    const importBoundary = metadata.nodeImportBoundary(
        newValue,
        propertyMirror?.importBoundary,
    )
    if (propertyMirror && importBoundary) {
        propertyMirror.importBoundary = importBoundary
    }

    if (getRefCounter(owner) && helpers.isTracked(newValue)) {
        buildRefIndex(newValue, importBoundary)
    }
}

function commitPropertyTransition(owner, key, propertyMirror, newValue) {
    commitLiveEdge(
        owner,
        key,
        () => {
            if (propertyMirror) {
                languageProperties.writeLanguageProperty(
                    owner,
                    key,
                    propertyMirror.promise,
                )
                imports.clearMetaCycleError(owner, key)
                promiseMirrors.installPromiseMirror(owner, key, propertyMirror)
            } else {
                languageProperties.writeLanguageProperty(owner, key, newValue)
                imports.clearMetaCycleError(owner, key)
                promiseMirrors.clearPromiseMirror(owner, key)
            }
        },
    )
}

function commitMirrorDrain(mirror) {
    if (!promiseMirrors.isLivePromiseMirror(mirror.node, mirror.key, mirror)) {
        mirror.pendingConsumerCount--
        return
    }

    if (getRefCounter(mirror.node) &&
        !mirror.cycleError &&
        helpers.isTracked(mirror.currentValue) &&
        !getRefCounter(mirror.currentValue)) {
        buildRefIndex(mirror.currentValue, mirror.importBoundary)
    }

    commitLiveEdge(
        mirror.node,
        mirror.key,
        () => {
            if (!metadata.metaOf(mirror.node)?.importedOriginal &&
                Object.isExtensible(mirror.node)) {
                languageProperties.writeLanguageProperty(
                    mirror.node,
                    mirror.key,
                    mirror.currentValue,
                )
            }
            imports.clearMetaCycleError(mirror.node, mirror.key)
            mirror.pendingConsumerCount--
        },
    )
}

function deleteEdge(parent, key) {
    commitLiveEdge(parent, key, () => {
        delete parent[key]
        promiseMirrors.clearPromiseMirror(parent, key)
        imports.clearMetaCycleError(parent, key)
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
    if (!helpers.isTracked(value)) return
    const counter = getRequiredRefCounter(value)
    counter.parents.set(parent, (counter.parents.get(parent) ?? 0) + 1)
}

function removeParentEdge(value, parent) {
    if (!helpers.isTracked(value)) return
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

imports.initImport(commitLiveEdge, mirror => {
    preparePropertyTransition(
        mirror.node,
        mirror,
        mirror.currentValue,
    )
})

export {
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
