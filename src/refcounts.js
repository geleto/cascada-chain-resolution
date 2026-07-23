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
    if (helpers.isPromise(value)) return [1, 0, 0]
    if (helpers.isError(value)) return [0, 1, 0]
    if (!helpers.isTracked(value)) return [0, 0, 0]

    const counter = getRequiredRefCounter(value)
    return [
        counter.promiseCount,
        counter.errorCount,
        counter.cycleCutCount,
    ]
}

function getPropertyRefState(parent, key) {
    const mirror = promiseMirrors.getPromiseMirror(parent, key)
    if (mirror && !mirror.isDrained()) {
        return { child: undefined, counts: [1, 0, 0] }
    }
    if (imports.hasPublishedCycleCut(parent, key)) {
        return { child: undefined, counts: [0, 0, 1] }
    }
    const child = languageProperties.readLanguageProperty(parent, key)
    return { child, counts: getRefCounts(child) }
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
    if (!helpers.isTracked(node)) return [0, 0, 0]

    const existing = getRefCounter(node)
    if (existing) {
        return [
            existing.promiseCount,
            existing.errorCount,
            existing.cycleCutCount,
        ]
    }

    const importBoundary = metadata.nodeImportBoundary(node, inheritedImportBoundary)

    let promiseCount = 0
    let errorCount = 0
    let cycleCutCount = 0
    const childNodes = []

    for (const key of Object.keys(node)) {
        if (imports.hasPublishedCycleCut(node, key)) {
            cycleCutCount++
            continue
        }

        const child = languageProperties.readLanguageProperty(node, key)
        const mirror = promiseMirrors.getOrCreateMirrorForValue(
            node,
            key,
            child,
            importBoundary,
        )
        if (helpers.isPromise(child)) {
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
        cycleCutCount += childCounts[2]
        childNodes.push(child)
    }

    // Imported preparation can index this node through a back-reference after
    // publishing a cut on the edge currently being walked. That completed
    // index is authoritative; publishing this older recursive frame would
    // duplicate its child edges and overwrite its totals.
    const completedDuringWalk = getRefCounter(node)
    if (completedDuringWalk) {
        return [
            completedDuringWalk.promiseCount,
            completedDuringWalk.errorCount,
            completedDuringWalk.cycleCutCount,
        ]
    }

    const counter = metadata.ensureMeta(node)
    counter.promiseCount = promiseCount
    counter.errorCount = errorCount
    counter.cycleCutCount = cycleCutCount
    counter.parents = new Map()
    for (const child of childNodes) addParentEdge(child, node)
    return [promiseCount, errorCount, cycleCutCount]
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

    if (getRefCounter(owner) &&
        !propertyMirror?.cycleCut &&
        helpers.isTracked(newValue)) {
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
                imports.clearPlainCycleCut(owner, key)
                promiseMirrors.installPromiseMirror(owner, key, propertyMirror)
            } else {
                languageProperties.writeLanguageProperty(owner, key, newValue)
                imports.clearPlainCycleCut(owner, key)
                promiseMirrors.clearPromiseMirror(owner, key)
            }
        },
    )
}

function commitMirrorDrain(mirror) {
    if (!mirror.isLive()) {
        mirror.pendingConsumerCount--
        return
    }

    if (getRefCounter(mirror.node) &&
        !mirror.cycleCut &&
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
            imports.clearPlainCycleCut(mirror.node, mirror.key)
            mirror.pendingConsumerCount--
        },
    )
}

function deleteEdge(parent, key) {
    commitLiveEdge(parent, key, () => {
        delete parent[key]
        promiseMirrors.clearPromiseMirror(parent, key)
        imports.clearPlainCycleCut(parent, key)
    })
}

function commitLiveEdge(owner, key, updateProperty) {
    const counter = getRefCounter(owner)
    const oldState = counter ? getPropertyRefState(owner, key) : undefined

    updateProperty()
    if (!counter) return

    const nextState = getPropertyRefState(owner, key)
    removeParentEdge(oldState.child, owner)
    addParentEdge(nextState.child, owner)
    applyCountDelta(
        owner,
        nextState.counts[0] - oldState.counts[0],
        nextState.counts[1] - oldState.counts[1],
        nextState.counts[2] - oldState.counts[2],
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

function applyCountDelta(node, promiseDelta, errorDelta, cycleCutDelta) {
    if (promiseDelta === 0 && errorDelta === 0 && cycleCutDelta === 0) return

    const counter = getRequiredRefCounter(node)
    const oldPromiseCount = counter.promiseCount
    counter.promiseCount += promiseDelta
    counter.errorCount += errorDelta
    counter.cycleCutCount += cycleCutDelta
    // A mirror retains [1,0,0] until every registered consumer drains, so this
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
        applyCountDelta(
            parent,
            promiseDelta * multiplicity,
            errorDelta * multiplicity,
            cycleCutDelta * multiplicity,
        )
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
    getRefCounter,
    getRequiredRefCounter,
    getRefCounts,
    preparePropertyTransition,
    waitForSettlement,
}
