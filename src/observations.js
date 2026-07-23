import * as helpers from "./helpers.js"
import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as refcounts from "./refcounts.js"
import * as metadata from "./meta.js"
import * as imports from "./import.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as rawWalk from "./raw-walk.js"

// --- lookupPath :  = a.k.y --------------------------------------------------
// sharedOwnership is false for a pure read or when ownership is ceded to
// the caller, e.g. the final `return x` from an otherwise unused variable.
function lookupPath(chain, path, sharedOwnership = true) {
    return walkObservationPath(chain, path, (value, importBoundary) => {
        if (importBoundary) {
            imports.import(value, importBoundary.errorContext)
        } else if (sharedOwnership) {
            metadata.markShared(value)
        }
        return value
    })
}

// --- export : host-ready settled snapshot of a branch -----------------------
function exportValue(chain, path) {
    return walkObservationPath(chain, path, exportAtPathValue, true)
}

function exportAtPathValue(value, importBoundary, terminalCycleCut) {
    if (helpers.isError(value) || !helpers.isTracked(value)) return value
    if (terminalCycleCut) return copyExportBranch(value, importBoundary)

    refcounts.buildRefIndex(value, importBoundary)
    const counter = refcounts.getRequiredRefCounter(value)
    if (counter.promiseCount > 0) {
        // Pin this issue-time branch while its projected Promise frontier drains.
        metadata.markShared(value)
        return helpers.onInternalResolve(refcounts.waitForSettlement(value), () => {
            return exportSettledBranch(value, importBoundary)
        })
    }
    return exportSettledBranch(value, importBoundary)
}

function exportSettledBranch(value, importBoundary) {
    if (refcounts.getRequiredRefCounter(value).errorCount > 0) {
        return new Error("export: branch contains errors")
    }
    return copyExportBranch(value, importBoundary)
}

function copyExportBranch(value, importBoundary) {
    const inspection = rawWalk.copyRawBranch(value, importBoundary)
    const finish = () => inspection.hasOrdinaryError
        ? new Error("export: branch contains errors")
        : inspection.value
    if (!inspection.readiness) return finish()

    // A raw frontier can contain Promises hidden behind cycle cuts.
    metadata.markShared(value)
    return helpers.onInternalResolve(inspection.readiness, finish)
}

// --- hasError : query whether a path or branch contains an Error -------------
function hasError(chain, path) {
    return walkObservationPath(chain, path, hasErrorAtPathValue, true)
}

function hasErrorAtPathValue(value, importBoundary, terminalCycleCut) {
    if (helpers.isError(value)) return true
    if (!helpers.isTracked(value)) return false
    if (terminalCycleCut) {
        // A path ending at a cut has a counterless raw target; walk it directly.
        return searchForFirstError(onError =>
            rawWalk.collectRawErrorWaits(
                value,
                importBoundary,
                createErrorSearchState(onError, true),
            ))
    }

    refcounts.buildRefIndex(value, importBoundary)
    const counter = refcounts.getRequiredRefCounter(value)
    if (counter.errorCount > 0) return true
    if (counter.cycleCutCount === 0 && counter.promiseCount === 0) return false
    return searchForFirstError(onError =>
        searchIndexedBranchForErrors(
            value,
            importBoundary,
            createErrorSearchState(onError, true),
        ))
}

// Runs a wait collector that reports through onError: the first discovered Error
// becomes a synchronous true, an unfindable one false, and a pending frontier a
// first-error-versus-completion race.
function searchForFirstError(collectWaits) {
    let found = false
    let resolveError
    const readiness = collectWaits(() => {
        found = true
        if (resolveError) resolveError(true)
    })
    if (found) return true
    if (!readiness) return false

    const errorPromise = new Promise(resolve => {
        resolveError = resolve
    })
    return Promise.race([
        errorPromise,
        helpers.onInternalResolve(readiness, () => false),
    ])
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path) {
    const errors = new Set()
    return walkObservationPath(chain, path, finish, true)

    function finish(value, importBoundary, terminalCycleCut) {
        const readiness = collectErrorsAtPathValue(
            value,
            importBoundary,
            terminalCycleCut,
        )
        if (!readiness) return [...errors]
        return helpers.onInternalResolve(readiness, () => [...errors])
    }

    function collectErrorsAtPathValue(value, importBoundary, terminalCycleCut) {
        if (helpers.isError(value)) {
            errors.add(value)
            return undefined
        }
        if (!helpers.isTracked(value)) return undefined

        const state = createErrorSearchState(error => errors.add(error), false)
        if (terminalCycleCut) {
            return rawWalk.collectRawErrorWaits(value, importBoundary, state)
        }

        refcounts.buildRefIndex(value, importBoundary)
        return searchIndexedBranchForErrors(value, importBoundary, state)
    }
}

// firstErrorOnly is hasError's mode: it stops at the first counted or raw Error.
// getErrors leaves it false to collect every distinct identity.
function createErrorSearchState(onError, firstErrorOnly) {
    return {
        onError,
        firstErrorOnly,
        projectedVisited: new WeakSet(),
        rawVisited: new WeakSet(),
        rawStopped: false,
    }
}

// Search one already-indexed tracked branch: raw traversal when it hides a cut,
// otherwise the counter-pruned projected walk.
function searchIndexedBranchForErrors(value, importBoundary, state) {
    const counter = refcounts.getRequiredRefCounter(value)
    if (state.firstErrorOnly && counter.errorCount > 0) {
        state.onError()
        return undefined
    }
    if (counter.cycleCutCount > 0) {
        return rawWalk.collectRawErrorWaits(value, importBoundary, state)
    }
    return collectProjectedErrorWaits(value, importBoundary, state)
}

// Projected traversal is counter-pruned. A resolved Promise branch is
// redispatched because it can introduce the first cut seen by this operation.
function collectProjectedErrorWaits(value, inheritedImportBoundary, state) {
    const waits = []
    walk(value, inheritedImportBoundary)
    return waits.length === 0 ? undefined : Promise.all(waits)

    function walk(node, inheritedBoundary) {
        if (state.projectedVisited.has(node)) return
        state.projectedVisited.add(node)

        const counter = refcounts.getRequiredRefCounter(node)
        if (state.firstErrorOnly && counter.errorCount > 0) {
            state.onError()
            return
        }
        if (counter.promiseCount === 0 && counter.errorCount === 0) return

        const importBoundary = metadata.nodeImportBoundary(node, inheritedBoundary)
        for (const key of Object.keys(node)) {
            let mirror = promiseMirrors.getPromiseMirror(node, key)
            const child = languageProperties.readLanguageProperty(node, key)

            if (helpers.isError(child)) {
                state.onError(child)
            } else if (helpers.isPromise(child)) {
                mirror ??= promiseMirrors.getRequiredPromiseMirror(node, key, child)
                waits.push(mirror.onResolve(() => {
                    return collectResolvedPromiseErrors(
                        mirror,
                        importBoundary,
                        state,
                    )
                }))
            } else if (helpers.isTracked(child)) {
                const childCounter = refcounts.getRequiredRefCounter(child)
                if (childCounter.promiseCount > 0 || childCounter.errorCount > 0) {
                    walk(child, mirror?.importBoundary ?? importBoundary)
                }
            }
        }
    }
}

function collectResolvedPromiseErrors(mirror, inheritedImportBoundary, state) {
    const value = mirror.currentValue
    if (helpers.isError(value)) {
        state.onError(value)
        return undefined
    }
    if (!helpers.isTracked(value)) return undefined

    const importBoundary = mirror.importBoundary ?? inheritedImportBoundary
    // A captured private cut selects raw mode even though attached counters
    // do not yet contain it.
    if (mirror.cycleCut) {
        return rawWalk.collectRawErrorWaits(value, importBoundary, state)
    }
    return searchIndexedBranchForErrors(value, importBoundary, state)
}

// Observational path resolution follows raw logical values. Only the terminal
// callback receives the exact captured property's cut state.
function walkObservationPath(
    chain,
    path,
    onResolved,
    prepareImportedParents = false,
) {
    const targetPath = ["value", ...path]
    return walkFromParent(chain._state, 0, undefined)

    function walkFromParent(parent, index, inheritedImportBoundary) {
        const importBoundary = metadata.nodeImportBoundary(parent, inheritedImportBoundary)
        if (prepareImportedParents && importBoundary &&
            !refcounts.getRefCounter(importBoundary.root)) {
            refcounts.buildRefIndex(parent, importBoundary)
        }

        const key = targetPath[index]
        const value = languageProperties.readLanguageProperty(parent, key)
        const mirror = promiseMirrors.getOrCreateMirrorForValue(
            parent,
            key,
            value,
            importBoundary,
        )
        if (helpers.isPromise(value)) {
            return mirror.onResolve(() => {
                const propertyImportBoundary = mirror.importBoundary ?? importBoundary
                return walkValue(
                    mirror.currentValue,
                    index,
                    propertyImportBoundary,
                    resolvedValue => onResolved(
                        resolvedValue,
                        propertyImportBoundary,
                        mirror.cycleCut,
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
                    mirror.cycleCut,
                )
            })
        }
        return walkValue(value, index, importBoundary, resolvedValue => {
            return onResolved(
                resolvedValue,
                importBoundary,
                imports.hasPublishedCycleCut(parent, key),
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
        return walkFromParent(value, index + 1, importBoundary)
    }
}

export { exportValue, getErrors, hasError, lookupPath }
