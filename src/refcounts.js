"use strict"

const {
    isError,
    isPromise,
    isTracked,
    onInternalResolve,
} = require("./helpers")
const {
    cycleError,
    reportFatalError,
} = require("./error")
const {
    clearEdgeMark,
    ensureMeta,
    markShared,
    metaOf,
    nodeImportContext,
    setEdgeMark,
} = require("./meta")
const {
    clearPromiseMirror,
    getCommittedEdgeMark,
    getOrCreatePromiseMirror,
    getPromiseMirror,
    installPromiseMirror,
    isLivePromiseMirror,
    readLogicalProperty,
} = require("./promise-mirrors")
const { prepareImportedData } = require("./import")
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

function getResolvedPlacementMark(placement) {
    if (!placement) return undefined
    if (placement.mirror) return placement.mirror.edgeMark
    return getCommittedEdgeMark(placement.parent, placement.key)
}

function getPropertyRefCounts(parent, key) {
    const mirror = getPromiseMirror(parent, key)
    if (mirror && !mirror.settled) return [1, 0]
    if (getCommittedEdgeMark(parent, key)) return [0, 1]
    return getRefCounts(readLogicalProperty(parent, key))
}

function getCountedChild(parent, key) {
    const mirror = getPromiseMirror(parent, key)
    if (mirror && !mirror.settled) return undefined
    if (getCommittedEdgeMark(parent, key)) return undefined
    return readLogicalProperty(parent, key)
}

function buildRefIndex(value, inheritedImportContext = undefined, placement = undefined) {
    if (!isTracked(value)) return value

    const importContext = nodeImportContext(value, inheritedImportContext)
    if (importContext !== undefined) {
        const preparedImport = prepareImportedData(
            value,
            importContext,
            placement?.parent,
            placement?.mirror,
        )

        let closingEdgeMark = getResolvedPlacementMark(placement)
        if (placement && !closingEdgeMark &&
            reachesProjected(value, placement.parent, preparedImport)) {
            closingEdgeMark = cycleError(placement.key, importContext)
        }
        commitImportedPreparation(preparedImport)
        if (closingEdgeMark) {
            commitPlacementEdgeMark(placement, closingEdgeMark)
        }
        const privateCut = closingEdgeMark &&
            placement.mirror && !placement.mirror.settled
        // A draining mirror's cut is private until its final commit. Indexing
        // these records now could follow the raw back-reference into its owner.
        if (!privateCut) buildPreparedImportRefIndexes(preparedImport)
        if (closingEdgeMark) return value
    }

    if (getRefCounter(value)) return value
    commitRefIndex(value, importContext)
    return value
}

function commitImportedPreparation(preparedImport) {
    preparedImport.commit(commitEdgeMark)
}

function buildPreparedImportRefIndexes(preparedImport) {
    for (const record of preparedImport.records.values()) {
        commitRefIndex(
            record.node,
            record.context,
            preparedImport.records,
        )
    }
}

function commitRefIndex(
    node,
    inheritedImportContext,
    preparedRecords = undefined,
) {
    if (!isTracked(node)) return [0, 0]

    const existing = getRefCounter(node)
    if (existing) return [existing.promiseCount, existing.errorCount]

    const importContext = nodeImportContext(node, inheritedImportContext)
    const preparedRecord = preparedRecords?.get(node)

    let promiseCount = 0
    let errorCount = 0
    const childNodes = []
    const edges = preparedRecord?.edges ?? Object.keys(node)

    for (const edge of edges) {
        const key = preparedRecord ? edge.key : edge
        if ((preparedRecord ? edge.edgeMark : getCommittedEdgeMark(node, key))) {
            errorCount++
            continue
        }

        let mirror = preparedRecord ? edge.mirror : getPromiseMirror(node, key)
        const child = preparedRecord ? edge.value : readLogicalProperty(node, key)
        if (isPromise(child)) {
            mirror ??= getOrCreatePromiseMirror(node, key, child, importContext)
            promiseCount++
            continue
        }

        if (isError(child)) {
            errorCount++
            continue
        }
        if (!isTracked(child)) continue

        const childImportContext = mirror?.importContext ??
            nodeImportContext(child, importContext)
        if (childImportContext !== undefined && !preparedRecords?.has(child)) {
            buildRefIndex(child, childImportContext, {
                parent: node,
                key,
                mirror,
            })
            if (getCommittedEdgeMark(node, key)) {
                errorCount++
                continue
            }
        }

        const childCounts = commitRefIndex(
            child,
            childImportContext,
            preparedRecords,
        )
        promiseCount += childCounts[0]
        errorCount += childCounts[1]
        childNodes.push(child)
    }

    // Imported preparation can index this node through a back-reference after
    // staging a cut on the edge currently being walked. That completed index is
    // authoritative; publishing this older recursive frame would duplicate its
    // child edges and overwrite its totals.
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

function prepareEdgeTransition(
    owner,
    key,
    mirror,
    candidate,
    markCandidateShared = false,
) {
    const ownerCounter = getRefCounter(owner)
    const prepared = {
        value: candidate,
        edgeMark: undefined,
        promiseCount: isPromise(candidate) ? 1 : 0,
        errorCount: isError(candidate) ? 1 : 0,
        preparedForIndexedOwner: !!ownerCounter,
    }
    // The next FIFO consumer may mutate this private value before the mirror
    // drains. Publish the irreversible sharing mark now so that advance COWs.
    if (markCandidateShared) markShared(candidate)
    if (!ownerCounter || !isTracked(candidate)) {
        return prepared
    }

    const importContext = mirror?.importContext ?? nodeImportContext(candidate)
    if (importContext !== undefined) {
        const imported = prepareImportedData(
            candidate,
            importContext,
            owner,
            mirror,
        )
        const closesCycle = reachesProjected(candidate, owner, imported)
        commitImportedPreparation(imported)
        buildPreparedImportRefIndexes(imported)
        if (closesCycle) {
            prepared.edgeMark = cycleError(key, importContext)
            prepared.errorCount = 1
            return prepared
        }
    }

    buildRefIndex(candidate, importContext)
    const counts = getRefCounts(candidate)
    prepared.promiseCount = counts[0]
    prepared.errorCount = counts[1]
    return prepared
}

function reachesProjected(value, target, preparedImport, visited = new Set()) {
    if (value === target) return true
    if (!isTracked(value) || visited.has(value)) return false
    visited.add(value)

    const record = preparedImport.records.get(value)
    const edges = record?.edges ?? Object.keys(value)
    for (const edge of edges) {
        const key = record ? edge.key : edge
        const edgeMark = record ? edge.edgeMark : getCommittedEdgeMark(value, key)
        if (edgeMark) continue
        const child = record ? edge.value : readLogicalProperty(value, key)
        if (isTracked(child) && reachesProjected(child, target, preparedImport, visited)) {
            return true
        }
    }
    return false
}

function commitEdgeTransition(owner, key, mirror, prepared) {
    const nextChild = prepared.edgeMark || isPromise(prepared.value)
        ? undefined
        : prepared.value
    commitLiveEdge(
        owner,
        key,
        [prepared.promiseCount, prepared.errorCount],
        nextChild,
        () => {
            if (mirror) {
                writeLanguageProperty(owner, key, mirror.promise)
                clearEdgeMark(owner, key)
                installPromiseMirror(owner, key, mirror)
                mirror.edgeMark = prepared.edgeMark
            } else {
                writeLanguageProperty(owner, key, prepared.value)
                clearEdgeMark(owner, key)
                clearPromiseMirror(owner, key)
                if (prepared.edgeMark) setEdgeMark(owner, key, prepared.edgeMark)
            }
        },
    )
}

function commitMirrorDrain(mirror) {
    if (!mirror.prepared || !isLivePromiseMirror(mirror.node, mirror.key, mirror)) return

    // settled is flipped by promise-mirrors immediately after this commit; the
    // prepared counts are therefore supplied explicitly instead of rereading.
    const counter = getRefCounter(mirror.node)
    let prepared = mirror.prepared
    if (counter && !prepared.preparedForIndexedOwner) {
        const previousEdgeMark = mirror.edgeMark
        prepared = prepareEdgeTransition(
            mirror.node,
            mirror.key,
            mirror,
            mirror.currentValue,
        )
        if (previousEdgeMark && prepared.edgeMark) {
            prepared.edgeMark = previousEdgeMark
        }
        mirror.prepared = prepared
        mirror.currentValue = prepared.value
        mirror.edgeMark = prepared.edgeMark
    }
    const nextChild = prepared.edgeMark ? undefined : prepared.value
    commitLiveEdge(
        mirror.node,
        mirror.key,
        [prepared.promiseCount, prepared.errorCount],
        nextChild,
        () => {
            if (!mirror.externalHolder && Object.isExtensible(mirror.node)) {
                writeLanguageProperty(mirror.node, mirror.key, prepared.value)
            }
            clearEdgeMark(mirror.node, mirror.key)
        },
    )
}

function commitEdgeMark(parent, key, edgeMark) {
    commitPlacementEdgeMark({ parent, key, mirror: getPromiseMirror(parent, key) }, edgeMark)
}

function commitPlacementEdgeMark(placement, edgeMark) {
    const { parent, key, mirror } = placement
    if (mirror && (!mirror.settled || !isLivePromiseMirror(parent, key, mirror))) {
        setMirrorEdgeMark(mirror, edgeMark)
        return
    }

    if (getCommittedEdgeMark(parent, key) === edgeMark) return

    const counter = getRefCounter(parent)
    let nextCounts
    let nextChild
    if (counter) {
        const nextValue = mirror ? mirror.currentValue : readLogicalProperty(parent, key)
        nextCounts = edgeMark ? [0, 1] : getRefCounts(nextValue)
        nextChild = edgeMark || isPromise(nextValue) || isError(nextValue)
            ? undefined
            : nextValue
    }
    commitLiveEdge(parent, key, nextCounts, nextChild, () => {
        if (mirror) {
            setMirrorEdgeMark(mirror, edgeMark, nextCounts)
        } else {
            clearEdgeMark(parent, key)
            if (edgeMark) setEdgeMark(parent, key, edgeMark)
        }
    })
}

function setMirrorEdgeMark(mirror, edgeMark, counts = undefined) {
    mirror.edgeMark = edgeMark
    if (mirror.prepared) {
        mirror.prepared.edgeMark = edgeMark
        if (edgeMark) {
            mirror.prepared.promiseCount = 0
            mirror.prepared.errorCount = 1
        } else if (counts) {
            mirror.prepared.promiseCount = counts[0]
            mirror.prepared.errorCount = counts[1]
        }
    }
}

function deleteEdge(parent, key) {
    commitLiveEdge(parent, key, [0, 0], undefined, () => {
        delete parent[key]
        clearPromiseMirror(parent, key)
        clearEdgeMark(parent, key)
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
    if (oldPromiseCount > 0 && counter.promiseCount === 0) {
        scheduleSettlementVerify(counter)
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

function scheduleSettlementVerify(counter) {
    if (!counter.settlementPromise || counter.settlementVerifyScheduled) return
    counter.settlementVerifyScheduled = true
    // FIFO jobs already registered on the settling promise can raise the count
    // again; this verification runs after those jobs have had their turn.
    onInternalResolve(Promise.resolve(), () => {
        counter.settlementVerifyScheduled = false
        if (counter.settlementPromise && counter.promiseCount === 0) {
            const resolve = counter.settlementResolve
            counter.settlementPromise = undefined
            counter.settlementResolve = undefined
            resolve()
        }
    })
}

function copyCounters(source, copy, inheritedImportContext = undefined) {
    if (!getRefCounter(source)) return
    commitRefIndex(copy, inheritedImportContext)
}

module.exports = {
    buildRefIndex,
    commitEdgeTransition,
    commitMirrorDrain,
    copyCounters,
    deleteEdge,
    getCountedChild,
    getPropertyRefCounts,
    getRefCounter,
    getRequiredRefCounter,
    getRefCounts,
    getResolvedPlacementMark,
    prepareEdgeTransition,
    waitForSettlement,
}
