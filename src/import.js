const {
    isPromise,
    isTracked,
    onValueResolve,
} = require("./helpers")
const {
    createCycleError,
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
    getPromiseMirror,
    getOrCreatePromiseMirror,
    readLogicalProperty,
} = require("./promise-mirrors")

function importValue(value, errorContext) {
    if (!errorContext) {
        reportFatalError(new Error("import requires an error context"))
    }
    if (isPromise(value)) {
        return onValueResolve(value, settled => markImported(settled, errorContext))
    }
    return markImported(value, errorContext)
}

// Counters and queries see only attached cycle state. A draining mirror keeps
// its prepared Error private until every consumer has completed.
function getCommittedCycleError(node, key) {
    const mirror = getPromiseMirror(node, key)
    return mirror
        ? (mirror.pendingConsumerCount === 0 ? mirror.cycleError : undefined)
        : metaOf(node)?.cycleErrors?.[key]
}

// The operation that captured a placement may see its mirror's private state.
function getResolvedCycleError(placement) {
    if (!placement) return undefined
    if (placement.mirror) return placement.mirror.cycleError
    return getCommittedCycleError(placement.parent, placement.key)
}

// Detection decides when a cut is needed. Attached publication delegates one
// atomic parent-edge/count transaction to the refcount layer.
function commitPlacementCycleError(
    placement,
    cycleError,
    commitEdge,
) {
    const { parent, key, mirror } = placement
    if (mirror?.pendingConsumerCount > 0) {
        mirror.cycleError = cycleError
        return
    }

    if (getCommittedCycleError(parent, key) === cycleError) return

    const nextValue = mirror
        ? mirror.currentValue
        : readLogicalProperty(parent, key)
    commitEdge(parent, key, nextValue, cycleError, () => {
        if (mirror) {
            mirror.cycleError = cycleError
        } else {
            clearCycleError(parent, key)
            if (cycleError) setCycleError(parent, key, cycleError)
        }
    })
}

function setCycleError(node, key, cycleError) {
    const meta = ensureMeta(node)
    meta.cycleErrors ??= Object.create(null)
    meta.cycleErrors[key] = cycleError
}

function clearCycleError(node, key) {
    const meta = metaOf(node)
    if (meta?.cycleErrors) delete meta.cycleErrors[key]
}

// Imported aliases and cycles are the only graph facts trusted data cannot
// contain. One depth-first walk marks repeated identities shared and overlays
// every detected cycle edge with one Error. The raw edge stays accessible to
// lookup and mutation; error queries see the overlay and do not enter the cycle.
// Cuts belong to owner/key placements, so extracting a value from inside a
// cycle does not invalidate or relocate the existing cut.
function prepareImportedData(
    importBoundary,
    writeTarget,
    excludedMirror,
    commitCycleError,
) {
    const visited = new Set()
    const currentPath = new Set()
    walkImportedData(importBoundary.root, importBoundary)

    function walkImportedData(node, inheritedBoundary) {
        if (node === writeTarget) return

        const boundary = nodeImportBoundary(node, inheritedBoundary)
        visited.add(node)
        currentPath.add(node)

        for (const key of Object.keys(node)) {
            if (getCommittedCycleError(node, key)) continue

            const mirror = getPromiseMirror(node, key)
            const child = readLogicalProperty(node, key)
            if (isPromise(child)) {
                if (mirror === excludedMirror) continue
                if (mirror?.promise === child) {
                    mirror.importBoundary ??= boundary
                    mirror.ownerIsImportedOriginal = true
                } else {
                    getOrCreatePromiseMirror(node, key, child, boundary)
                }
                continue
            }
            if (!isTracked(child)) continue

            if (child === writeTarget) continue
            if (visited.has(child)) {
                markShared(child)
                if (currentPath.has(child)) {
                    commitCycleError(
                        node,
                        key,
                        createCycleError(key, boundary.errorContext),
                    )
                }
                continue
            }
            walkImportedData(child, boundary)
        }
        currentPath.delete(node)
    }
}

function scanForClosingCycleError(value, target, key, importBoundary) {
    const visited = new Set()
    if (!reaches(value)) return undefined
    return createCycleError(key, importBoundary.errorContext)

    function reaches(node) {
        if (node === target) return true
        if (!isTracked(node) || visited.has(node)) return false
        visited.add(node)

        for (const childKey of Object.keys(node)) {
            if (getCommittedCycleError(node, childKey)) continue
            const child = readLogicalProperty(node, childKey)
            if (isTracked(child) && reaches(child)) return true
        }
        return false
    }
}

module.exports = {
    clearCycleError,
    commitPlacementCycleError,
    getCommittedCycleError,
    getResolvedCycleError,
    import: importValue,
    prepareImportedData,
    scanForClosingCycleError,
    setCycleError,
}
