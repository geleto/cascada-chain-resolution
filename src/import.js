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
    onPromiseMirrorResolve,
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
    if (getResolvedCycleError(placement)) return

    if (mirror?.pendingConsumerCount > 0) {
        mirror.cycleError = cycleError
        return
    }

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
    commitCycleErrorEdge,
) {
    // Each identity maps to the active ancestors already checked below it.
    const visited = new WeakMap()
    walk(importBoundary.root, importBoundary, new Set())

    function walk(value, inheritedBoundary, currentPath, placement) {
        if (getResolvedCycleError(placement)) return
        if (value === writeTarget) return

        if (isPromise(value)) {
            const { parent, key } = placement
            let { mirror } = placement
            if (mirror && mirror === excludedMirror) return
            if (mirror?.promise === value) {
                mirror.importBoundary ??= inheritedBoundary
                mirror.ownerIsImportedOriginal = true
            } else {
                mirror = getOrCreatePromiseMirror(
                    parent,
                    key,
                    value,
                    inheritedBoundary,
                )
            }
            const promisePath = new Set(currentPath)
            onPromiseMirrorResolve(mirror, () => walk(
                mirror.currentValue,
                inheritedBoundary,
                promisePath,
                { parent, key, mirror },
            ))
            return
        }
        if (!isTracked(value)) return

        if (currentPath.has(value)) {
            markShared(value)
            commitPlacementCycleError(
                placement,
                createCycleError(
                    placement.key,
                    inheritedBoundary.errorContext,
                ),
                commitCycleErrorEdge,
            )
            return
        }
        const checkedAncestors = visited.get(value)
        if (checkedAncestors) {
            markShared(value)
            let hasNewAncestor = false
            for (const ancestor of currentPath) {
                if (checkedAncestors.has(ancestor)) continue
                checkedAncestors.add(ancestor)
                hasNewAncestor = true
            }
            // Re-enter only when this path can expose a new back-edge.
            if (!hasNewAncestor) return
        } else {
            visited.set(value, new Set(currentPath))
        }

        const boundary = nodeImportBoundary(value, inheritedBoundary)
        currentPath.add(value)
        for (const key of Object.keys(value)) {
            const mirror = getPromiseMirror(value, key)
            walk(
                readLogicalProperty(value, key),
                boundary,
                currentPath,
                { parent: value, key, mirror },
            )
        }
        currentPath.delete(value)
    }
}

// Imported ref-indexing is one import-owned operation. Refcounting supplies
// only the generic index commit and atomic edge commit.
function buildImportedRefIndex(
    value,
    importBoundary,
    placement,
    prepareRoot,
    commitRefIndex,
    commitCycleErrorEdge,
) {
    const atBoundaryRoot = importBoundary.root === value
    if (prepareRoot) {
        prepareImportedData(
            importBoundary,
            atBoundaryRoot ? placement?.parent : undefined,
            atBoundaryRoot ? placement?.mirror : undefined,
            commitCycleErrorEdge,
        )
    }

    const cycleError = getResolvedCycleError(placement)
    if (cycleError) {
        commitPlacementCycleError(
            placement,
            cycleError,
            commitCycleErrorEdge,
        )
    }

    const privateCut = cycleError &&
        placement.mirror && placement.mirror.pendingConsumerCount > 0
    // A draining mirror's cut is private until its final commit. Indexing
    // this branch now could follow the raw back-reference into its owner.
    if (prepareRoot && !privateCut) {
        commitRefIndex(importBoundary.root, importBoundary, true)
    }
    if (!cycleError) {
        commitRefIndex(value, importBoundary, true)
    }
}

function prepareImportedPropertyTransition(
    owner,
    mirror,
    importBoundary,
    prepareRoot,
    commitRefIndex,
    commitCycleErrorEdge,
) {
    if (prepareRoot) {
        prepareImportedData(
            importBoundary,
            owner,
            mirror,
            commitCycleErrorEdge,
        )
        commitRefIndex(importBoundary.root, importBoundary, true)
    }
}

module.exports = {
    buildImportedRefIndex,
    clearCycleError,
    getCommittedCycleError,
    getResolvedCycleError,
    import: importValue,
    prepareImportedPropertyTransition,
}
