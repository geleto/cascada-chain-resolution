"use strict"

import * as helpers from "./helpers.js"
import * as errorUtils from "./error.js"
import * as refcounts from "./refcounts.js"
import * as metadata from "./meta.js"
import * as imports from "./import.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as rawWalk from "./raw-walk.js"

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
    if (helpers.isError(value) || !helpers.isTracked(value)) return value

    if (!terminalCycle) {
        refcounts.buildRefIndex(value, importBoundary)
    } else if (!cycleIsPrivate && !refcounts.getRefCounter(importBoundary.root)) {
        // The attached projection can be indexed safely because its cycle edge
        // is already cut. A draining mirror's private cut cannot protect it yet.
        refcounts.buildRefIndex(importBoundary.root, importBoundary)
    }

    const counter = refcounts.getRefCounter(value)
    if (!counter) {
        // A private terminal cycle cut is the only raw tracked value that may
        // deliberately sit outside the projected ref index.
        if (!terminalCycle) refcounts.getRequiredRefCounter(value)
    } else if (counter.promiseCount > 0) {
        // The copy cannot be completed yet, so pin this issue-time branch while
        // earlier consumers drain and later mutations COW away.
        metadata.markShared(value)
        return helpers.onInternalResolve(refcounts.waitForSettlement(value), () => {
            return finishNormalize(value, importBoundary, terminalCycle)
        })
    }

    return finishNormalize(value, importBoundary, terminalCycle)
}

function finishNormalize(value, importBoundary, terminalCycle) {
    // A private terminal cycle may deliberately be counterless. Counted
    // terminal cycles still classify first so an ordinary Error wins without
    // waiting for promises reachable only through the raw cycle frontier.
    if (!terminalCycle || refcounts.getRefCounter(value)) {
        const classification = classifyProjectedErrors(value)
        if (classification.hasOrdinaryError) {
            return new Error("normalize: branch contains errors")
        }
        if (!classification.hasCycleError) {
            return rawWalk.copyRawBranch(value, importBoundary).value
        }
    }

    const inspection = rawWalk.copyRawBranch(value, importBoundary)
    const finish = () => {
        if (inspection.hasOrdinaryError) {
            return new Error("normalize: branch contains errors")
        }
        return inspection.value
    }
    if (!inspection.readiness) return finish()

    // Raw cycle traversal found a Promise, so preserve this issue-time branch
    // while its already-registered consumers complete the copy.
    metadata.markShared(value)
    return helpers.onInternalResolve(inspection.readiness, finish)
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
        if (hasOrdinaryError || !helpers.isTracked(node) || visited.has(node)) return
        visited.add(node)
        const counter = refcounts.getRequiredRefCounter(node)
        if (counter.errorCount === 0) return

        for (const key of Object.keys(node)) {
            const cycleError = imports.getCycleError(node, key)
            if (cycleError) {
                hasCycleError = true
                continue
            }

            const child = promiseMirrors.readLogicalProperty(node, key)
            if (helpers.isError(child)) {
                hasOrdinaryError = true
                return
            }
            if (helpers.isTracked(child)) walk(child)
        }
    }
}

function markResolvedValue(value, importBoundary, sharedOwnership) {
    if (importBoundary) {
        imports.import(value, importBoundary.errorContext)
    } else if (sharedOwnership) {
        metadata.markShared(value)
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
    if (helpers.isError(value)) return true
    if (!helpers.isTracked(value)) return false

    refcounts.buildRefIndex(value, importBoundary)
    return hasErrorInIndexedBranch(value)
}

// The branch is already ref-indexed here: either hasErrorAtPathValue just
// indexed the resolved path value, or a promise mirror writeback indexed the
// resolved value before the hasError wait continuation ran.
function hasErrorInIndexedBranch(value) {
    const counter = refcounts.getRequiredRefCounter(value)
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
    // helpers.onValueResolve-derived; FIFO-sensitive registrations on key promises never
    // happen here.
    return Promise.race([
        errorPromise,
        helpers.onInternalResolve(cleanPromise, () => false),
    ])

    function probeResolvedMirror(mirror) {
        const currentValue = mirror.currentValue
        if (mirror.cycleError || helpers.isError(currentValue)) {
            resolveError()
            return undefined
        }
        if (!helpers.isTracked(currentValue)) return undefined
        return probeIndexedBranch(currentValue)
    }

    // Recursive waits rely on the mirror writeback registered while indexing
    // the parent: it prepares and indexes currentValue before this probe runs.
    function probeIndexedBranch(node) {
        const nodeCounter = refcounts.getRequiredRefCounter(node)
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
        return helpers.onInternalResolve(readiness, () => [...errors])
    }

    function collectErrorsAtPathValue(value, importBoundary, cycleError) {
        // A cut target is always tracked, so it skips directly to raw collection.
        if (!cycleError) {
            if (helpers.isError(value)) {
                errors.add(value)
                return undefined
            }
            if (!helpers.isTracked(value)) return undefined
            refcounts.buildRefIndex(value, importBoundary)
        }
        if (cycleError) {
            return rawWalk.collectRawErrors(
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
                    return rawWalk.collectRawErrors(
                        mirror.currentValue,
                        inheritedImportBoundary,
                        mirror.cycleError,
                        errors,
                        visited,
                    )
                }
                if (helpers.isError(mirror.currentValue)) {
                    errors.add(mirror.currentValue)
                    return undefined
                }
                if (!helpers.isTracked(mirror.currentValue)) return undefined
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
            ? metadata.nodeImportBoundary(node, inheritedBoundary)
            : undefined
        const counter = refcounts.getRequiredRefCounter(node)
        if (counter.promiseCount === 0 &&
            (!errors || counter.errorCount === 0)) return

        for (const key of Object.keys(node)) {
            let mirror = promiseMirrors.getPromiseMirror(node, key)
            const propertyImportBoundary = errors
                ? mirror?.importBoundary ?? importBoundary
                : undefined
            const cycleError = imports.getCycleError(node, key)
            if (cycleError) {
                if (errors) {
                    const readiness = rawWalk.collectRawErrors(
                        promiseMirrors.readLogicalProperty(node, key),
                        propertyImportBoundary,
                        cycleError,
                        errors,
                        visited,
                    )
                    if (readiness) waitPromises.push(readiness)
                }
                continue
            }

            const child = promiseMirrors.readLogicalProperty(node, key)
            if (helpers.isError(child)) {
                if (errors) errors.add(child)
            } else if (helpers.isPromise(child)) {
                mirror ??= promiseMirrors.getRequiredPromiseMirror(node, key, child)
                waitPromises.push(promiseMirrors.onPromiseMirrorResolve(mirror, () => {
                    return onPromiseValue(
                        mirror,
                        errors
                            ? mirror.importBoundary ?? importBoundary
                            : undefined,
                    )
                }))
            } else if (helpers.isTracked(child)) {
                const childCounter = refcounts.getRequiredRefCounter(child)
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
        const importBoundary = metadata.nodeImportBoundary(parent, inheritedImportBoundary)
        // Counter-based observations index from the prepared boundary root before
        // entering a mid-path imported value, preserving downward counter closure.
        if (prepareImportedParents && importBoundary &&
            !refcounts.getRefCounter(importBoundary.root)) {
            refcounts.buildRefIndex(parent, importBoundary)
        }
        const key = targetPath[index]
        let mirror = promiseMirrors.getPromiseMirror(parent, key)
        const value = promiseMirrors.readLogicalProperty(parent, key)
        if (helpers.isPromise(value)) {
            mirror ??= promiseMirrors.getOrCreatePromiseMirror(parent, key, value, importBoundary)
            return promiseMirrors.onPromiseMirrorResolve(mirror, () => {
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
                imports.getCycleError(parent, key),
                false,
            )
        })
    }

    function walkValue(value, index, importBoundary, onTerminal) {
        if (index === targetPath.length - 1 || helpers.isError(value)) {
            return onTerminal(value)
        }
        if (!helpers.isTracked(value)) {
            return onTerminal(errorUtils.pathAccessError())
        }
        return walkFromParent(
            value,
            index + 1,
            importBoundary,
        )
    }
}

export {
    getErrors,
    hasError,
    lookupPath,
    normalize,
}
