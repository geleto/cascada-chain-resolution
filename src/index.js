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
    markShared,
    nodeImportBoundary,
} = require("./meta")
const {
    attachImportedDataToImportedData,
    getCycleError,
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
const {
    collectRawErrors,
    copyRawBranch,
} = require("./raw-walk")
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

function setProperty(
    parent,
    key,
    value,
    importBoundary = undefined,
    attachmentPath = undefined,
) {
    assertCanSetLanguageProperty(parent, key, importBoundary?.errorContext)
    // BIRTH 1 - ASSIGN: assigning a promise to a key always creates a fresh
    // mirror. Two assignments of the same promise are divergent worlds.
    const mirror = isPromise(value)
        ? createAssignedPromiseMirror(parent, key, value)
        : null
    preparePropertyTransition(parent, mirror, value)
    commitPropertyTransition(parent, key, mirror, value)
    if (attachmentPath) {
        attachImportedDataToImportedData(
            parent,
            key,
            attachmentPath,
            attachmentPath.root,
        )
    }
}

function deleteProperty(parent, key, importBoundary = undefined) {
    assertCanDeleteLanguageProperty(parent, key, importBoundary?.errorContext)
    deleteEdge(parent, key)
}

initPromiseMirrors(preparePropertyTransition, commitMirrorDrain)

function shallowCopy(obj, pathKey, importBoundary, attachmentPath) {
    const copy = Array.isArray(obj) ? new Array(obj.length) : {}
    const pathKeyString = String(pathKey)
    const keys = Object.keys(obj)
    attachmentPath.root ??= copy
    attachmentPath.ancestors.add(copy)

    // Copy only language-visible own enumerable string keys; META lives outside
    // that surface (non-enumerable Symbol or WeakMap entry), so mirrors,
    // counters, and marks never enter the copy. The source keeps its own marks.
    // Reused children from a shared branch are marked shared so their shared
    // references stay protected — except the path key, which the walk's
    // inherited state protects until it is replaced or copied. Every tracked
    // child of an imported node receives its own import boundary. A path
    // child's next shallow copy omits that META, so every new path node remains
    // language-owned without a separate path exception here.
    for (const key of keys) {
        const isPathKey = key === pathKeyString
        const retainedOffPath = !isPathKey
        const sourceMirror = getPromiseMirror(obj, key)
        const value = readLogicalProperty(obj, key)
        const propertyImportBoundary = sourceMirror?.importBoundary ?? importBoundary
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
            // is protected by the walk's inherited state if we enter it, and
            // may simply be replaced/deleted at the target.
            forkPromiseMirror(
                obj,
                copy,
                key,
                value,
                retainedOffPath,
                propertyImportBoundary,
            )
            if (retainedOffPath && propertyImportBoundary) {
                attachImportedDataToImportedData(
                    copy,
                    key,
                    attachmentPath,
                )
            }
        } else if (propertyImportBoundary && isTracked(value)) {
            // The source child remains external; a later shallow copy of a path
            // child drops this boundary together with its other META.
            importValue(value, propertyImportBoundary.errorContext)
        } else if (retainedOffPath && isTracked(value)) {
            markShared(value)
        }
    }
    copyCounters(obj, copy)
    return copy
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignPath(chain, path, value) {
    walkMutationPath(chain._state, path, (
        parent,
        key,
        importBoundary,
        attachmentPath,
    ) => {
        setProperty(parent, key, value, importBoundary, attachmentPath)
    })
}

// path identifies the complete mutation target. The walk starts at the private
// holder, where an empty path targets its value key, and recursive callers
// install copied branches back into their key.
function walkMutationPath(rootHolder, path, onTarget) {
    const targetPath = ["value", ...path]
    return walk(rootHolder, 0, false, undefined, undefined)

    function walk(
        value,
        index,
        inheritedSharedBranch,
        inheritedImportBoundary,
        attachmentPath,
    ) {
        if (isError(value)) return value
        if (!isTracked(value)) return pathAccessError()

        // Root-only import attribution is inherited until a nested boundary
        // overrides it; the shared-branch bit independently drives path COW.
        const valueImportBoundary = nodeImportBoundary(value, inheritedImportBoundary)
        let parent = value
        const parentInsideSharedBranch = inheritedSharedBranch || hasSharedMark(value)

        const key = targetPath[index]
        if (parentInsideSharedBranch) {
            attachmentPath ??= {
                root: undefined,
                ancestors: new Set(),
            }
            parent = shallowCopy(
                parent,
                key,
                valueImportBoundary,
                attachmentPath,
            )
        }
        if (index === targetPath.length - 1) {
            onTarget(parent, key, valueImportBoundary, attachmentPath)
            return parent
        }

        // Asserted after the COW: copies carry only own enumerable keys, so
        // this fires only on genuinely un-shadowable intermediate shapes.
        assertCanMutateLanguageProperty(
            parent,
            key,
            valueImportBoundary?.errorContext,
        )

        let mirror = getPromiseMirror(parent, key)
        const child = readLogicalProperty(parent, key)
        if (isPromise(child)) {
            mirror ??= getOrCreatePromiseMirror(
                parent,
                key,
                child,
                valueImportBoundary,
            )
            onPromiseMirrorResolve(mirror, () => {
                const childImportBoundary = mirror.importBoundary ?? valueImportBoundary
                const next = walk(
                    mirror.currentValue,
                    index + 1,
                    parentInsideSharedBranch,
                    childImportBoundary,
                    attachmentPath,
                )
                // The active path has now produced an owned value. Unlike an
                // off-path fork, this placement no longer carries provenance.
                mirror.importBoundary = undefined
                setPromiseMirrorValue(mirror, next)
            })
            return parent
        }

        const childImportBoundary = mirror?.importBoundary ?? valueImportBoundary
        const next = walk(
            child,
            index + 1,
            parentInsideSharedBranch,
            childImportBoundary,
            attachmentPath,
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

// --- normalize : host-ready settled snapshot of a branch --------------------
// Returns a metadata-free deep copy directly when the answer is available in
// the synchronous prefix, or a promise when path resolution/settlement suspends.
function normalize(chain, path) {
    return walkObservationPath(chain, path, normalizeAtPathValue, true)
}

function normalizeAtPathValue(value, importBoundary, cycleError, cycleIsPrivate) {
    const terminalCycle = !!cycleError
    if (isError(value) || !isTracked(value)) return value

    if (!terminalCycle) {
        buildRefIndex(value, importBoundary)
    } else if (!cycleIsPrivate && !getRefCounter(importBoundary.root)) {
        // The attached projection can be indexed safely because its cycle edge
        // is already cut. A draining mirror's private cut cannot protect it yet.
        buildRefIndex(importBoundary.root, importBoundary)
    }

    const counter = getRefCounter(value)
    if (!counter) {
        // A private terminal cycle cut is the only raw tracked value that may
        // deliberately sit outside the projected ref index.
        if (!terminalCycle) getRequiredRefCounter(value)
    } else if (counter.promiseCount > 0) {
        // The copy cannot be completed yet, so pin this issue-time branch while
        // earlier consumers drain and later mutations COW away.
        markShared(value)
        return onInternalResolve(waitForSettlement(value), () => {
            return finishNormalize(value, importBoundary, terminalCycle)
        })
    }

    return finishNormalize(value, importBoundary, terminalCycle)
}

function finishNormalize(value, importBoundary, terminalCycle) {
    // A private terminal cycle may deliberately be counterless. Counted
    // terminal cycles still classify first so an ordinary Error wins without
    // waiting for promises reachable only through the raw cycle frontier.
    if (!terminalCycle || getRefCounter(value)) {
        const classification = classifyProjectedErrors(value)
        if (classification.hasOrdinaryError) {
            return new Error("normalize: branch contains errors")
        }
        if (!classification.hasCycleError) {
            return copyRawBranch(value, importBoundary).value
        }
    }

    const inspection = copyRawBranch(value, importBoundary)
    const finish = () => {
        if (inspection.hasOrdinaryError) {
            return new Error("normalize: branch contains errors")
        }
        return inspection.value
    }
    if (!inspection.readiness) return finish()

    // Raw cycle traversal found a Promise, so preserve this issue-time branch
    // while its already-registered consumers complete the copy.
    markShared(value)
    return onInternalResolve(inspection.readiness, finish)
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
            const cycleError = getCycleError(node, key)
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

function markResolvedValue(value, importBoundary, sharedOwnership) {
    if (importBoundary) {
        importValue(value, importBoundary.errorContext)
    } else if (sharedOwnership) {
        markShared(value)
    }
    return value
}

// --- hasError : query whether a path or branch contains an Error -------------
function hasError(chain, path) {
    return walkObservationPath(chain, path, hasErrorAtPathValue, true)
}

// Entry for the value reached by hasError's path resolution. This boundary must
// build the index because its parent need not have been ref-indexed.
function hasErrorAtPathValue(value, importBoundary, cycleError) {
    if (cycleError) return true
    if (isError(value)) return true
    if (!isTracked(value)) return false

    buildRefIndex(value, importBoundary)
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
        return collectErrorSearchWaits(
            node,
            probeResolvedMirror,
            visited,
        )
    }
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path) {
    const errors = new Set()
    const visited = new WeakSet()
    return walkObservationPath(chain, path, finish, true)

    function finish(value, importBoundary, cycleError) {
        const readiness = collectErrorsAtPathValue(value, importBoundary, cycleError)
        if (!readiness) return [...errors]
        return onInternalResolve(readiness, () => [...errors])
    }

    function collectErrorsAtPathValue(value, importBoundary, cycleError) {
        // A cut target is always tracked, so it skips directly to raw collection.
        if (!cycleError) {
            if (isError(value)) {
                errors.add(value)
                return undefined
            }
            if (!isTracked(value)) return undefined
            buildRefIndex(value, importBoundary)
        }
        if (cycleError) {
            return collectRawErrors(
                value,
                importBoundary,
                cycleError,
                errors,
                visited,
            )
        }
        return collectErrorsInIndexedBranch(value, importBoundary)
    }

    function collectErrorsInIndexedBranch(value, importBoundary) {
        return collectErrorSearchWaits(
            value,
            (mirror, inheritedImportBoundary) => {
                if (mirror.cycleError) {
                    return collectRawErrors(
                        mirror.currentValue,
                        inheritedImportBoundary,
                        mirror.cycleError,
                        errors,
                        visited,
                    )
                }
                if (isError(mirror.currentValue)) {
                    errors.add(mirror.currentValue)
                    return undefined
                }
                if (!isTracked(mirror.currentValue)) return undefined
                return collectErrorsInIndexedBranch(
                    mirror.currentValue,
                    inheritedImportBoundary,
                )
            },
            visited,
            errors,
            importBoundary,
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
    inheritedImportBoundary = undefined,
) {
    const waitPromises = []
    walk(value, inheritedImportBoundary)
    return waitPromises.length === 0 ? undefined : Promise.all(waitPromises)

    function walk(node, inheritedBoundary) {
        // Query-local identity is enough here: repeated paths reach the same
        // logical node, while each query still owns an independent frontier.
        if (visited.has(node)) return
        visited.add(node)

        const importBoundary = errors
            ? nodeImportBoundary(node, inheritedBoundary)
            : undefined
        const counter = getRequiredRefCounter(node)
        if (counter.promiseCount === 0 &&
            (!errors || counter.errorCount === 0)) return

        for (const key of Object.keys(node)) {
            let mirror = getPromiseMirror(node, key)
            const propertyImportBoundary = errors
                ? mirror?.importBoundary ?? importBoundary
                : undefined
            const cycleError = getCycleError(node, key)
            if (cycleError) {
                if (errors) {
                    const readiness = collectRawErrors(
                        readLogicalProperty(node, key),
                        propertyImportBoundary,
                        cycleError,
                        errors,
                        visited,
                    )
                    if (readiness) waitPromises.push(readiness)
                }
                continue
            }

            const child = readLogicalProperty(node, key)
            if (isError(child)) {
                if (errors) errors.add(child)
            } else if (isPromise(child)) {
                mirror ??= getRequiredPromiseMirror(node, key, child)
                waitPromises.push(onPromiseMirrorResolve(mirror, () => {
                    return onPromiseValue(
                        mirror,
                        errors
                            ? mirror.importBoundary ?? importBoundary
                            : undefined,
                    )
                }))
            } else if (isTracked(child)) {
                const childCounter = getRequiredRefCounter(child)
                if (childCounter.promiseCount > 0 ||
                    (errors && childCounter.errorCount > 0)) {
                    walk(child, propertyImportBoundary)
                }
            }
        }
    }
}

// Observational path resolution through the Chain's private root holder. Callers
// decide whether the reached value escapes and therefore whether to mark it.
// Every preceding value must be trackable; only the final target may be
// missing, and an empty path targets the root. The terminal callback receives
// cycle state from either the plain property or the exact captured mirror.
function walkObservationPath(
    chain,
    path,
    onResolved,
    prepareImportedParents = false,
) {
    const targetPath = ["value", ...path]
    return walkFromParent(chain._state, 0, undefined)

    function walkFromParent(
        parent,
        index,
        inheritedImportBoundary,
    ) {
        const importBoundary = nodeImportBoundary(parent, inheritedImportBoundary)
        // Counter-based observations index from the prepared boundary root before
        // entering a mid-path imported value, preserving downward counter closure.
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
                const propertyImportBoundary = mirror.importBoundary ?? importBoundary
                return walkValue(
                    mirror.currentValue,
                    index,
                    propertyImportBoundary,
                    resolvedValue => onResolved(
                        resolvedValue,
                        propertyImportBoundary,
                        mirror.cycleError,
                        mirror.pendingConsumerCount > 0,
                    ),
                )
            })
        }
        if (mirror) {
            const propertyImportBoundary = mirror.importBoundary ?? importBoundary
            return walkValue(value, index, propertyImportBoundary, resolvedValue => {
                return onResolved(
                    resolvedValue,
                    propertyImportBoundary,
                    mirror.cycleError,
                    mirror.pendingConsumerCount > 0,
                )
            })
        }
        return walkValue(value, index, importBoundary, resolvedValue => {
            return onResolved(
                resolvedValue,
                importBoundary,
                getCycleError(parent, key),
                false,
            )
        })
    }

    function walkValue(value, index, importBoundary, onTerminal) {
        if (index === targetPath.length - 1 || isError(value)) {
            return onTerminal(value)
        }
        if (!isTracked(value)) {
            return onTerminal(pathAccessError())
        }
        return walkFromParent(
            value,
            index + 1,
            importBoundary,
        )
    }
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
