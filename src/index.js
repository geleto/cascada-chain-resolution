"use strict"

// --- Notation ---------------------------------------------------------------
//   a.k.y = 1   -> assignPath(a, ["k", "y"], 1)
//   = a.k.y     -> lookupPath(a, ["k", "y"])
//   delete a.k  -> deletePath(a, ["k"])
//   P(V)        -> a promise P that resolves to value V
//
// A promise mirror lives in node's META mirror map:
//   promise              : the exact promise instance assigned to this key
//   currentValue         : the newest resolved value, V -> V' -> V''
//   pendingConsumerCount : registered FIFO consumers not yet completed
// Every mirror consumer registers at its program position. The mirror remains
// pending while this count is positive, then publishes one final value.
//
// A mirror is born at ASSIGN, DISCOVERY, or FORK. ASSIGN and DISCOVERY seed from
// the raw settled value. FORK seeds from the source mirror at the copier's FIFO
// position, so the copied world diverges at exactly that program point.

const {
    isError,
    isPromise,
    isTracked,
    onInternalResolve,
} = require("./helpers")
const {
    pathAccessError,
} = require("./error")
const {
    buildRefIndex,
    commitPropertyTransition,
    commitMirrorDrain,
    copyCounters,
    deleteEdge,
    getRefCounter,
    getRequiredRefCounter,
    preparePropertyTransition,
    waitForSettlement,
} = require("./refcounts")
const {
    assertCanDeleteLanguageProperty,
    assertCanMutateLanguageProperty,
    assertCanSetLanguageProperty,
    writeLanguageProperty,
} = require("./validate")
const {
    hasSharedMark,
    markImported,
    markShared,
    nodeImportBoundary,
} = require("./meta")
const {
    getCommittedCycleError,
    getResolvedCycleError,
    import: importValue,
} = require("./import")
const {
    createAssignedPromiseMirror,
    forkPromiseMirror,
    getOrCreatePromiseMirror,
    getPromiseMirror,
    getRequiredPromiseMirror,
    initPromiseMirrors,
    onPromiseMirrorResolve,
    readLogicalProperty,
    setPromiseMirrorValue,
} = require("./promise-mirrors")
// Load-bearing helper contract:
// Generic data promises use onValueResolve. Property-promise consumers use
// onPromiseMirrorResolve so registration order and the drain counter advance
// together. Rejection becomes a language Error before either continuation runs.

class Chain {
    constructor(initialValue) {
        this._state = { value: initialValue }
        this._commands = []
    }
}

function setProperty(parent, key, value, importBoundary = undefined) {
    assertCanSetLanguageProperty(parent, key, importBoundary?.errorContext)
    // BIRTH 1 - ASSIGN: assigning a promise to a key always creates a fresh
    // mirror. Two assignments of the same promise are divergent worlds.
    const mirror = isPromise(value)
        ? createAssignedPromiseMirror(parent, key, value)
        : null
    const prepared = preparePropertyTransition(parent, mirror, value)
    commitPropertyTransition(parent, key, mirror, prepared)
}

function deleteProperty(parent, key, importBoundary = undefined) {
    assertCanDeleteLanguageProperty(parent, key, importBoundary?.errorContext)
    deleteEdge(parent, key)
}

initPromiseMirrors(preparePropertyTransition, commitMirrorDrain)

function shallowCopy(obj, pathKey, importBoundary) {
    const copy = Array.isArray(obj) ? new Array(obj.length) : {}
    const pathKeyString = String(pathKey)
    const keys = Object.keys(obj)

    // Copy only language-visible own enumerable string keys; META lives outside
    // that surface (non-enumerable Symbol or WeakMap entry), so mirrors,
    // counters, and marks never enter the copy. The source keeps its own marks.
    // Reused children from a shared branch are marked shared so their shared
    // references stay protected — except the path key, which the walk's
    // inherited shared state covers. Reused children of an imported node are
    // marked imported instead, path key included: provenance is about origin,
    // not aliasing, and imported data must COW regardless.
    for (const key of keys) {
        const isPathKey = key === pathKeyString
        const markCopiedValueShared = !isPathKey
        const value = readLogicalProperty(obj, key)
        // Sanctioned write bypass: the copy is unobservable until it is installed
        // through setProperty, or copyCounters reconstructs its indexed edges.
        writeLanguageProperty(copy, key, value)
        if (isPromise(value)) {
            // BIRTH 3 - FORK. For every copied key holding a promise, mint the
            // copy's mirror NOW, at the copier's program position.
            //
            // Why eager: a mirror minted lazily by a later walk would seed
            // currentValue from the RAW resolved value, stranding every advance
            // (V -> V' -> ...) made by ops issued BEFORE this copy; their writes
            // silently vanish from the copied world.
            //
            // Why seeding from the source mirror is correct: this initializer is
            // registered at the copier's FIFO slot, so it runs after every
            // continuation of earlier ops and before every continuation of later
            // ops. The two worlds diverge at exactly this point in program order.
            //
            // Why mark non-path captured values: they are reused by two worlds,
            // so the first advance on either side must COW. The path key itself
            // is protected by the walk's inherited shared state if we enter it,
            // and may simply be replaced/deleted at the target. Imported
            // captures are marked imported (which implies shared) regardless of
            // path position — provenance must survive the copy.
            forkPromiseMirror(obj, copy, key, value, markCopiedValueShared, importBoundary)
        } else if (importBoundary && isTracked(value)) {
            // A retained external child becomes the boundary through which the
            // language-owned copy can reach the host graph.
            markImported(value, importBoundary.errorContext)
        } else if (markCopiedValueShared && isTracked(value)) {
            markShared(value)
        }
    }
    copyCounters(obj, copy)
    return copy
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignPath(chain, path, value) {
    walkMutationPath(chain._state, path, (parent, key, importBoundary) => {
        setProperty(parent, key, value, importBoundary)
    })
}

// path identifies the complete mutation target. The walk starts at the private
// holder, where an empty path targets its value key, and recursive callers
// install copied branches back into their key.
function walkMutationPath(rootHolder, path, onTarget) {
    const targetPath = ["value", ...path]
    return walk(rootHolder, 0, false, undefined)

    function walk(value, index, inheritedSharedBranch, inheritedImportBoundary) {
        if (isError(value)) return value
        if (!isTracked(value)) return pathAccessError()

        // Root-only import attribution is inherited until a nested boundary
        // overrides it; the shared-branch bit independently drives path COW.
        const valueImportBoundary = nodeImportBoundary(value, inheritedImportBoundary)
        let parent = value
        const parentInsideSharedBranch = inheritedSharedBranch || hasSharedMark(value)

        const key = targetPath[index]
        if (parentInsideSharedBranch) {
            parent = shallowCopy(parent, key, valueImportBoundary)
        }
        if (index === targetPath.length - 1) {
            onTarget(parent, key, valueImportBoundary)
            return parent
        }

        // Asserted after the COW: copies carry only own enumerable keys, so
        // this fires only on genuinely un-shadowable intermediate shapes.
        assertCanMutateLanguageProperty(
            parent,
            key,
            valueImportBoundary?.errorContext,
        )

        const child = readLogicalProperty(parent, key)
        if (isPromise(child)) {
            const mirror = getOrCreatePromiseMirror(
                parent,
                key,
                child,
                valueImportBoundary,
            )
            onPromiseMirrorResolve(mirror, () => {
                const next = walk(
                    mirror.currentValue,
                    index + 1,
                    parentInsideSharedBranch,
                    valueImportBoundary,
                )
                setPromiseMirrorValue(mirror, next)
            })
            return parent
        }

        const next = walk(
            child,
            index + 1,
            parentInsideSharedBranch,
            valueImportBoundary,
        )
        if (next !== child) {
            setProperty(parent, key, next, valueImportBoundary)
        }
        return parent
    }
}

// --- lookupPath :  = a.k.y --------------------------------------------------
// sharedOwnership is false for a pure read or when ownership is ceded to
// the caller, e.g. the final `return x` from an otherwise unused variable.
// Imported values are marked on extraction even without shared ownership:
// provenance is about origin, not aliasing, and an ownership-transferred
// external branch is still external. (markImported implies the shared mark.)
function lookupPath(chain, path, sharedOwnership = true) {
    return walkObservationPath(chain, path, (value, importBoundary) => {
        return markResolvedValue(value, importBoundary, sharedOwnership)
    })
}

// --- normalize : settled snapshot of a branch -------------------------------
// Returns a direct value when the answer is available in the synchronous prefix;
// returns a promise only when path resolution or branch settlement must suspend.
// sharedOwnership matches lookupPath for settled returns; pending branches still
// mark to pin the snapshot while promises settle.
function normalize(chain, path, sharedOwnership = true, plainCopy = false) {
    return walkObservationPath(chain, path, (value, importBoundary, placement) => {
        return normalizeResolved(
            value,
            importBoundary,
            placement,
            sharedOwnership,
            plainCopy,
        )
    }, true)
}

function normalizeResolved(value, importBoundary, placement, sharedOwnership, plainCopy) {
    let cycleError = getResolvedCycleError(placement)
    let terminalCycle = !!cycleError
    if (isError(value) || !isTracked(value)) return value

    buildRefIndex(value, importBoundary, placement)
    cycleError = getResolvedCycleError(placement)
    terminalCycle ||= !!cycleError

    const counter = getRefCounter(value)
    if (!counter) {
        // A private terminal cycle cut is the only raw tracked value that may
        // deliberately sit outside the projected ref index.
        if (!terminalCycle) getRequiredRefCounter(value)
    } else if (counter.promiseCount > 0) {
        markResolvedValue(value, importBoundary, true) // pin regardless of sharedOwnership
        return onInternalResolve(waitForSettlement(value), () => {
            return finishNormalize(
                value,
                importBoundary,
                sharedOwnership,
                plainCopy,
                terminalCycle,
            )
        })
    }

    return finishNormalize(
        value,
        importBoundary,
        sharedOwnership,
        plainCopy,
        terminalCycle,
    )
}

function finishNormalize(
    value,
    importBoundary,
    sharedOwnership,
    plainCopy,
    terminalCycle,
) {
    // A private terminal cycle may deliberately be counterless. Counted
    // terminal cycles still classify first so an ordinary Error wins without
    // waiting for promises reachable only through the raw cycle frontier.
    if (!terminalCycle || getRefCounter(value)) {
        const classification = classifyProjectedErrors(value)
        if (classification.hasOrdinaryError) {
            return new Error("normalize: branch contains errors")
        }
        if (!classification.hasCycleError) {
            if (plainCopy) return copyToPlainValue(value)
            markResolvedValue(value, importBoundary, sharedOwnership)
            return value
        }
    }

    markResolvedValue(value, importBoundary, true)
    const inspection = inspectRawCycleBranch(value, plainCopy)
    const finish = () => {
        if (inspection.hasOrdinaryError) {
            return new Error("normalize: branch contains errors")
        }
        return inspection.value
    }
    return inspection.readiness
        ? onInternalResolve(inspection.readiness, finish)
        : finish()
}

function classifyProjectedErrors(value) {
    // This walk cannot cross an async boundary, so repeated identities remain
    // stable for its duration and can be skipped even when not marked shared.
    const visited = new Set()
    let hasCycleError = false
    let hasOrdinaryError = false
    walk(value)
    return { hasCycleError, hasOrdinaryError }

    function walk(node) {
        if (hasOrdinaryError || !isTracked(node) || visited.has(node)) return
        visited.add(node)
        const counter = getRequiredRefCounter(node)
        if (counter.errorCount === 0) return

        for (const key of Object.keys(node)) {
            const cycleError = getCommittedCycleError(node, key)
            if (cycleError) {
                hasCycleError = true
                continue
            }

            const child = readLogicalProperty(node, key)
            if (isError(child)) {
                hasOrdinaryError = true
                return
            }
            if (isTracked(child)) walk(child)
        }
    }
}

function inspectRawCycleBranch(value, plainCopy) {
    const visited = new Map()
    const result = {
        hasOrdinaryError: false,
        readiness: undefined,
        value: undefined,
    }
    const root = walk(value)
    result.value = root.value
    result.readiness = root.readiness
    return result

    function walk(node) {
        if (isError(node)) {
            result.hasOrdinaryError = true
            return { value: node, readiness: undefined }
        }
        if (!isTracked(node)) return { value: node, readiness: undefined }

        const existing = visited.get(node)
        if (existing) return { value: existing, readiness: undefined }

        const output = plainCopy
            ? (Array.isArray(node) ? new Array(node.length) : {})
            : node
        visited.set(node, output)
        const keys = Object.keys(node)

        const waits = []
        for (const key of keys) {
            const child = readLogicalProperty(node, key)
            if (isPromise(child)) {
                const mirror = getRequiredPromiseMirror(node, key, child)
                waits.push(onPromiseMirrorResolve(mirror, () => {
                    const nested = walk(mirror.currentValue)
                    if (plainCopy) writeLanguageProperty(output, key, nested.value)
                    return nested.readiness
                }))
            } else {
                const nested = walk(child)
                if (plainCopy) writeLanguageProperty(output, key, nested.value)
                if (nested.readiness) waits.push(nested.readiness)
            }
        }
        return {
            value: output,
            readiness: waits.length === 0 ? undefined : Promise.all(waits),
        }
    }
}

function markResolvedValue(value, importBoundary, sharedOwnership) {
    if (importBoundary) {
        markImported(value, importBoundary.errorContext)
    } else if (sharedOwnership) {
        markShared(value)
    }
    return value
}

// --- hasError : query whether a path or branch contains an Error -------------
function hasError(chain, path) {
    return walkObservationPath(chain, path, (value, importBoundary, placement) => {
        return hasErrorAtPathValue(value, importBoundary, placement)
    }, true)
}

// Entry for the value reached by hasError's path resolution. This boundary must
// build the index because its parent need not have been ref-indexed.
function hasErrorAtPathValue(value, importBoundary, placement) {
    if (getResolvedCycleError(placement)) return true
    if (isError(value)) return true
    if (!isTracked(value)) return false

    buildRefIndex(value, importBoundary, placement)
    if (getResolvedCycleError(placement)) return true

    return hasErrorInIndexedBranch(value)
}

// The branch is already ref-indexed here: either hasErrorAtPathValue just
// indexed the resolved path value, or a promise mirror writeback indexed the
// resolved value before the hasError wait continuation ran.
function hasErrorInIndexedBranch(value) {
    const counter = getRequiredRefCounter(value)
    if (counter.errorCount > 0) return true
    if (counter.promiseCount === 0) return false

    const visited = new WeakSet()
    let resolveError
    const errorPromise = new Promise(resolve => {
        resolveError = () => resolve(true)
    })
    const cleanPromise = collectErrorSearchWaits(
        value,
        probeResolvedMirror,
        visited,
    )
    // Promise.race aggregates hasError-internal waits, which are all
    // onValueResolve-derived; FIFO-sensitive registrations on key promises never
    // happen here.
    return Promise.race([
        errorPromise,
        onInternalResolve(cleanPromise, () => false),
    ])

    function probeResolvedMirror(mirror) {
        const currentValue = mirror.currentValue
        if (mirror.cycleError || isError(currentValue)) {
            resolveError()
            return undefined
        }
        if (!isTracked(currentValue)) return undefined
        return probeIndexedBranch(currentValue)
    }

    // Recursive waits rely on the mirror writeback registered while indexing
    // the parent: it prepares and indexes currentValue before this probe runs.
    function probeIndexedBranch(node) {
        const nodeCounter = getRequiredRefCounter(node)
        if (nodeCounter.errorCount > 0) {
            resolveError()
            return undefined
        }
        if (nodeCounter.promiseCount === 0) return undefined
        return collectErrorSearchWaits(node, probeResolvedMirror, visited)
    }
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path) {
    const errors = new Set()
    let visited
    return walkObservationPath(chain, path, (value, importBoundary, placement) => {
        const readiness = collectErrorsAtPathValue(
            value,
            importBoundary,
            placement,
        )
        if (!readiness) return [...errors]
        return onInternalResolve(readiness, () => [...errors])
    }, true)

    function collectErrorsAtPathValue(value, importBoundary, placement) {
        let cycleError = getResolvedCycleError(placement)
        if (cycleError) {
            errors.add(cycleError)
            return undefined
        }
        if (isError(value)) {
            errors.add(value)
            return undefined
        }
        if (!isTracked(value)) return undefined

        buildRefIndex(value, importBoundary, placement)
        cycleError = getResolvedCycleError(placement)
        if (cycleError) {
            errors.add(cycleError)
            return undefined
        }

        visited = new WeakSet()
        return collectErrorsInIndexedBranch(value)
    }

    function collectErrorsInIndexedBranch(value) {
        return collectErrorSearchWaits(
            value,
            mirror => {
                if (mirror.cycleError) {
                    errors.add(mirror.cycleError)
                    return undefined
                }
                if (isError(mirror.currentValue)) {
                    errors.add(mirror.currentValue)
                    return undefined
                }
                if (!isTracked(mirror.currentValue)) return undefined
                return collectErrorsInIndexedBranch(mirror.currentValue)
            },
            visited,
            errors,
        )
    }
}

// Shared synchronous walk for error queries. hasError follows only promises;
// getErrors also visits counted Error branches by supplying its result Set.
function collectErrorSearchWaits(
    value,
    onPromiseValue,
    visited,
    errors = undefined,
) {
    const waitPromises = []
    walk(value)
    return waitPromises.length === 0 ? undefined : Promise.all(waitPromises)

    function walk(node) {
        // Query-local identity is enough here: repeated paths reach the same
        // logical node, while each query still owns an independent frontier.
        if (visited.has(node)) return
        visited.add(node)

        const counter = getRequiredRefCounter(node)
        if (counter.promiseCount === 0 &&
            (!errors || counter.errorCount === 0)) return

        for (const key of Object.keys(node)) {
            const cycleError = getCommittedCycleError(node, key)
            if (cycleError) {
                if (errors) errors.add(cycleError)
                continue
            }

            const child = readLogicalProperty(node, key)
            if (isError(child)) {
                if (errors) errors.add(child)
            } else if (isPromise(child)) {
                const mirror = getRequiredPromiseMirror(node, key, child)
                waitPromises.push(onPromiseMirrorResolve(mirror, () => onPromiseValue(mirror)))
            } else if (isTracked(child)) {
                const childCounter = getRequiredRefCounter(child)
                if (childCounter.promiseCount > 0 ||
                    (errors && childCounter.errorCount > 0)) {
                    walk(child)
                }
            }
        }
    }
}

// Observational path resolution through the Chain's private root holder. Callers
// decide whether the reached value escapes and therefore whether to mark it.
// Every preceding value must be trackable; only the final target may be
// missing, and an empty path targets the root.
function walkObservationPath(chain, path, onResolved, prepareImportedParents = false) {
    const targetPath = ["value", ...path]
    return walkFromParent(chain._state, 0, undefined)

    function walkFromParent(
        parent,
        index,
        inheritedImportBoundary,
    ) {
        if (isError(parent)) {
            return onResolved(parent, inheritedImportBoundary)
        }
        if (!isTracked(parent)) {
            return onResolved(pathAccessError(), inheritedImportBoundary)
        }

        const importBoundary = nodeImportBoundary(parent, inheritedImportBoundary)
        if (prepareImportedParents && importBoundary &&
            !getRefCounter(importBoundary.root)) {
            buildRefIndex(parent, importBoundary)
        }
        const key = targetPath[index]
        let mirror = getPromiseMirror(parent, key)
        const value = readLogicalProperty(parent, key)
        if (isPromise(value)) {
            mirror ??= getOrCreatePromiseMirror(parent, key, value, importBoundary)
            return onPromiseMirrorResolve(mirror, () => {
                return walkValue(
                    mirror.currentValue,
                    index,
                    mirror.importBoundary ?? importBoundary,
                    { parent, key, mirror },
                )
            })
        }
        return walkValue(value, index, importBoundary, { parent, key, mirror })
    }

    function walkValue(value, index, importBoundary, placement) {
        if (index === targetPath.length - 1 || isError(value)) {
            return onResolved(value, importBoundary, placement)
        }
        if (!isTracked(value)) {
            return onResolved(pathAccessError(), importBoundary, placement)
        }
        return walkFromParent(
            value,
            index + 1,
            importBoundary,
        )
    }
}

function copyToPlainValue(value, copies = new Map()) {
    if (!isTracked(value)) return value

    const existing = copies.get(value)
    if (existing) return existing

    const copy = Array.isArray(value) ? new Array(value.length) : {}
    copies.set(value, copy)

    for (const key of Object.keys(value)) {
        // Sanctioned write bypass: normalize(..., plainCopy) creates output data
        // outside the runtime graph, so there is no metadata to bookkeep.
        const child = readLogicalProperty(value, key)
        writeLanguageProperty(copy, key, copyToPlainValue(child, copies))
    }
    return copy
}

// --- deletePath :  delete a.k ----------------------------------------------
function deletePath(chain, path) {
    const deletesRoot = path.length === 0
    walkMutationPath(chain._state, path, (parent, key, importBoundary) => {
        if (deletesRoot) {
            setProperty(parent, key, null, importBoundary)
        } else {
            deleteProperty(parent, key, importBoundary)
        }
    })
}

module.exports = {
    Chain,
    assignPath,
    deletePath,
    getErrors,
    hasError,
    import: importValue,
    lookupPath,
    normalize,
}
