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

let commitLiveEdge
let prepareImportedMirrorValue

function initImport(commitLiveEdgeFn, prepareImportedMirrorValueFn) {
    commitLiveEdge = commitLiveEdgeFn
    prepareImportedMirrorValue = prepareImportedMirrorValueFn
}

function importValue(value, errorContext) {
    if (!errorContext) {
        reportFatalError(new Error("import requires an error context"))
    }
    if (isPromise(value)) {
        return onValueResolve(value, settled => importResolvedValue(settled, errorContext))
    }
    return importResolvedValue(value, errorContext)
}

function importResolvedValue(value, errorContext) {
    const createdBoundary = markImported(value, errorContext)
    const importBoundary = nodeImportBoundary(value)
    if (createdBoundary) {
        prepareImportedData(importBoundary)
    }
    return value
}

// Returns the cycle Error currently published by this property:
// - without a mirror, the Error in META (or undefined);
// - with a drained mirror, the mirror's Error (or undefined);
// - with a draining mirror, undefined because the property is still pending.
// An operation that captured the mirror reads mirror.cycleError directly when
// it needs that private pre-publication state.
function getCycleError(node, key) {
    const mirror = getPromiseMirror(node, key)
    return mirror
        ? (mirror.pendingConsumerCount === 0 ? mirror.cycleError : undefined)
        : metaOf(node)?.cycleErrors?.[key]
}

// Detection decides when a cut is needed. Attached publication delegates one
// atomic parent-edge/count transaction to the refcount layer.
function setMetaCycleError(parent, key, importBoundary) {
    if (getCycleError(parent, key)) return

    commitLiveEdge(parent, key, () => {
        const meta = ensureMeta(parent)
        meta.cycleErrors ??= Object.create(null)
        meta.cycleErrors[key] = createCycleError(
            key,
            importBoundary.errorContext,
        )
    })
}

function setMirrorCycleError(mirror, importBoundary) {
    if (mirror.cycleError) return

    const cycleError = createCycleError(
        mirror.key,
        importBoundary.errorContext,
    )
    if (mirror.pendingConsumerCount > 0) {
        mirror.cycleError = cycleError
        return
    }

    commitLiveEdge(mirror.node, mirror.key, () => {
        mirror.cycleError = cycleError
    })
}

function clearMetaCycleError(node, key) {
    const meta = metaOf(node)
    if (meta?.cycleErrors) delete meta.cycleErrors[key]
}

function getPropertyMirror(parent, key, value, inheritedBoundary) {
    const mirror = getPromiseMirror(parent, key)
    if (mirror || !isPromise(value)) return mirror
    return getOrCreatePromiseMirror(parent, key, value, inheritedBoundary)
}

// Imported cycles are the graph fact trusted data cannot contain. The raw edge
// stays accessible to lookup and mutation; error queries see the cycle overlay,
// and getErrors also inspects the raw branch behind it. This preparation walk
// never performs attachment checking.
function prepareImportedData(importBoundary) {
    // META persists first preparation globally. The segment-local set remains
    // useful: it lets one DFS skip an ordinary alias without launching the
    // fixed-path scan needed for an identity prepared in an earlier segment.
    walkValue(
        importBoundary.root,
        importBoundary,
        { currentPath: new Set(), visited: new WeakSet() },
    )

    function walkProperty(parent, key, value, inheritedBoundary, segment) {
        if (getCycleError(parent, key)) return

        const mirror = getPropertyMirror(parent, key, value, inheritedBoundary)
        if (mirror) {
            walkMirror(mirror, value, inheritedBoundary, segment)
        } else if (walkValue(value, inheritedBoundary, segment)) {
            setMetaCycleError(parent, key, inheritedBoundary)
        }
    }

    function walkMirror(mirror, value, inheritedBoundary, segment) {
        if (mirror.cycleError) return
        const importBoundary = mirror.importBoundary ?? inheritedBoundary

        if (isPromise(value)) {
            // The synchronous walk removes ancestors while unwinding, so a
            // Promise continuation keeps its captured path. Its fresh segment
            // set distinguishes new work from nodes prepared before settlement.
            const resumedSegment = {
                currentPath: new Set(segment.currentPath),
                visited: new WeakSet(),
            }
            onImportedPromiseResolve(mirror, importBoundary, (
                resolvedValue,
                resolvedBoundary,
            ) => {
                walkMirror(
                    mirror,
                    resolvedValue,
                    resolvedBoundary,
                    resumedSegment,
                )
            })
        } else if (walkValue(value, importBoundary, segment)) {
            setMirrorCycleError(mirror, importBoundary)
        }
    }

    // Returns true only when this value closes the current path, telling the
    // caller to mark its incoming property. Deeper cuts are handled in place
    // and do not propagate upward.
    function walkValue(value, inheritedBoundary, segment) {
        if (!isTracked(value)) return false
        if (segment.currentPath.has(value)) {
            markShared(value)
            return true
        }
        if (segment.visited.has(value)) {
            markShared(value)
            return false
        }
        segment.visited.add(value)

        // Every first preparation creates META. A later META hit therefore
        // identifies a repeated imported identity globally, not just within
        // this import call. Check its prepared graph against this segment's
        // ancestry without repeating full preparation.
        if (value !== importBoundary.root && metaOf(value)) {
            markShared(value)
            return scanFixedPathCycles(
                value,
                inheritedBoundary,
                new Set(segment.currentPath),
            )
        }
        const meta = ensureMeta(value)
        // markImported already classified the boundary root before adding META.
        if (value !== importBoundary.root) meta.importedOriginal = true

        const valueImportBoundary = nodeImportBoundary(value, inheritedBoundary)
        segment.currentPath.add(value)
        for (const key of Object.keys(value)) {
            walkProperty(
                value,
                key,
                readLogicalProperty(value, key),
                valueImportBoundary,
                segment,
            )
        }
        segment.currentPath.delete(value)
        return false
    }
}

// Search an already prepared graph only for references into one fixed path.
// A synchronous match propagates to the placement that entered this graph:
// storing a path-dependent cut on a shared inner node would leave a phantom if
// that placement were revoked. A Promise reached during the scan resumes later
// and owns its own placement cut. The immutable path needs one local visited set.
function scanFixedPathCycles(
    value,
    inheritedBoundary,
    fixedPath,
    pathRootToPin = undefined,
) {
    // A permanently pending Promise can retain this walk indefinitely, so its
    // membership table must not keep the already visited graph alive.
    const visited = new WeakSet()
    return walkValue(value, inheritedBoundary)

    function walkProperty(parent, key, value, inheritedBoundary) {
        if (getCycleError(parent, key)) return false

        const mirror = getPropertyMirror(parent, key, value, inheritedBoundary)
        if (mirror) {
            return walkMirror(mirror, value, inheritedBoundary)
        }
        return walkValue(value, inheritedBoundary)
    }

    function walkMirror(mirror, value, inheritedBoundary) {
        if (mirror.cycleError) return false
        const importBoundary = mirror.importBoundary ?? inheritedBoundary

        if (isPromise(value)) {
            if (pathRootToPin) markShared(pathRootToPin)
            onImportedPromiseResolve(mirror, importBoundary, (
                resolvedValue,
                resolvedBoundary,
            ) => {
                if (walkMirror(mirror, resolvedValue, resolvedBoundary)) {
                    setMirrorCycleError(mirror, resolvedBoundary)
                }
            })
            return false
        }
        return walkValue(value, importBoundary)
    }

    function walkValue(value, inheritedBoundary) {
        if (!isTracked(value)) return false
        if (fixedPath.has(value)) {
            markShared(value)
            return true
        }
        if (visited.has(value)) {
            markShared(value)
            return false
        }
        visited.add(value)

        const importBoundary = nodeImportBoundary(value, inheritedBoundary)
        for (const key of Object.keys(value)) {
            if (walkProperty(
                value,
                key,
                readLogicalProperty(value, key),
                importBoundary,
            )) return true
        }
        return false
    }
}

// Assignment supplies the fixed post-COW destination path. Root placement and
// asynchronous path retention are attachment-specific; recursive checking is
// shared with META-bearing nodes reached by full-preparation continuations.
function attachImportedDataToImportedData(
    parent,
    key,
    attachmentPath,
    pathRootToPin,
) {
    const mirror = getPromiseMirror(parent, key)
    const value = readLogicalProperty(parent, key)
    const importBoundary = mirror?.importBoundary ?? nodeImportBoundary(value)
    if (!importBoundary) return

    // Later COW descent may extend attachmentPath; this property's owner can
    // cycle only to the ancestors that already exist at its attachment point.
    const fixedPath = new Set(attachmentPath.ancestors)
    if (mirror && isPromise(value)) {
        if (pathRootToPin) markShared(pathRootToPin)
        onImportedPromiseResolve(mirror, undefined, (
            resolvedValue,
            resolvedBoundary,
        ) => {
            if (resolvedBoundary && scanFixedPathCycles(
                resolvedValue,
                resolvedBoundary,
                fixedPath,
                pathRootToPin,
            )) {
                setMirrorCycleError(mirror, resolvedBoundary)
            }
        })
        return
    }

    if (scanFixedPathCycles(
        value,
        importBoundary,
        fixedPath,
        attachmentPath.root,
    )) {
        if (mirror) {
            setMirrorCycleError(mirror, importBoundary)
        } else {
            setMetaCycleError(parent, key, importBoundary)
        }
    }
}

// The mirror object is the property-version identity. Same-Promise assignment
// installs a fresh mirror; an earlier walk intentionally keeps this captured one.
function onImportedPromiseResolve(mirror, inheritedBoundary, onResolved) {
    mirror.importPreparationRegistered = true
    onPromiseMirrorResolve(mirror, () => {
        const importBoundary = mirror.importBoundary ?? inheritedBoundary
        if (importBoundary) {
            mirror.importBoundary = importBoundary
            onResolved(mirror.currentValue, importBoundary)
        }
        // This builds a child index only when the owner is already indexed.
        // A later walk may still publish additional path-dependent cuts.
        prepareImportedMirrorValue(mirror)
    })
}

module.exports = {
    attachImportedDataToImportedData,
    clearMetaCycleError,
    getCycleError,
    initImport,
    import: importValue,
}
