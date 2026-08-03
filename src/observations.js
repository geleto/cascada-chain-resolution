import * as helpers from "./helpers.js"
import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as refcounts from "./refcounts.js"
import * as metadata from "./meta.js"
import * as imports from "./import.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as rawWalk from "./raw-walk.js"
import * as resolution from "./resolution.js"

// --- lookupPath :  = a.k.y --------------------------------------------------
// sharedOwnership is false for a pure read or when ownership is ceded to
// the caller, e.g. the final `return x` from an otherwise unused variable.
function lookupPath(chain, path, sharedOwnership = true) {
    return helpers.runFatal(() => {
        return walkObservationPath(chain, path, (value, importBoundary) => {
            if (importBoundary) {
                imports.import(value, importBoundary.errorContext)
            } else if (sharedOwnership) {
                metadata.markShared(value)
            }
            return value
        })
    })
}

// --- export : host-ready settled snapshot of a branch -----------------------
function exportPath(chain, path) {
    return helpers.runFatal(() => {
        return walkObservationPath(chain, path, exportBranch)
    })
}

// Native argument export preserves nested Errors. A top-level Error remains
// available for the caller's shallow argument poisoning.
function exportArgument(value) {
    return resolution.resolveInitialValueOrPoison(value, resolved => {
        return languageValues.isError(resolved)
            ? resolved
            : exportTrackedValue(resolved, undefined, true)
    })
}

function exportBranch(value, importBoundary = undefined) {
    return exportTrackedValue(value, importBoundary, false)
}

function exportTrackedValue(value, importBoundary, preserveErrors) {
    if (languageValues.isError(value)) {
        return preserveErrors ? value : exportErrorOutcome([value])
    }
    if (!languageValues.isTracked(value)) return value

    let output
    const state = rawWalk.createRawWalkState(() => {
        output = undefined
    }, preserveErrors)
    const readiness = rawWalk.walkRawBranch(value, importBoundary, state)
    if (state.copying) output = state.copies.get(value)
    const finish = () => !preserveErrors && state.errors.size > 0
        ? exportErrorOutcome(state.errors)
        : output
    return readiness
        ? resolution.resolveOperationResultOrFatal(readiness, finish)
        : finish()
}

function exportErrorOutcome(errors) {
    const outcome = new Error("export: branch contains errors")
    outcome.errors = [...errors]
    return outcome
}

// --- hasError : query whether a path or branch contains an Error -------------
function hasError(chain, path) {
    return helpers.runFatal(() => {
        return walkObservationPath(chain, path, hasErrorAtPathValue)
    })
}

function hasErrorAtPathValue(value, importBoundary) {
    if (languageValues.isError(value)) return true
    if (!languageValues.isTracked(value)) return false

    refcounts.buildRefIndex(value, importBoundary)
    const counter = refcounts.getRequiredRefCounter(value)
    if (counter.errorCount > 0) return true
    if (counter.cycleCutCount === 0 && counter.promiseCount === 0) return false
    return searchForFirstError(value, importBoundary)
}

// The first discovered Error becomes a synchronous true, an unfindable one
// false, and a pending frontier a first-error-versus-completion race.
function searchForFirstError(value, importBoundary) {
    let found = false
    let resolveError
    const state = createErrorSearchState(() => {
        found = true
        if (resolveError) resolveError(true)
    })
    const readiness = collectFencedErrorWaits(value, importBoundary, state)
    if (found) return true
    if (!readiness) return false

    const errorPromise = new Promise(resolve => {
        resolveError = resolve
    })
    return Promise.race([
        errorPromise,
        resolution.resolveOperationResultOrFatal(readiness, () => false),
    ])
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path) {
    return helpers.runFatal(() => {
        return walkObservationPath(chain, path, finish)
    })

    function finish(value, importBoundary) {
        const state = createErrorSearchState()
        let readiness
        if (languageValues.isError(value)) {
            state.foundError(value)
        } else if (languageValues.isTracked(value)) {
            refcounts.buildRefIndex(value, importBoundary)
            readiness = collectFencedErrorWaits(value, importBoundary, state)
        }
        return readiness
            ? resolution.resolveOperationResultOrFatal(
                readiness,
                () => [...state.errors],
            )
            : [...state.errors]
    }
}

function createErrorSearchState(onError) {
    const firstErrorOnly = onError !== undefined
    const state = {
        errors: firstErrorOnly ? undefined : new Set(),
        firstErrorOnly,
        stopped: false,
        visited: new WeakSet(),
        foundAnyError() {
            if (state.stopped) return
            state.stopped = true
            onError()
        },
        foundError(error) {
            if (state.firstErrorOnly) {
                state.foundAnyError()
                return
            }
            state.errors.add(error)
        },
    }
    return state
}

// The fenced walk follows only nodes whose counter triple contains relevant
// work. A cut blocks count propagation, but its indexed target resumes this
// same walk through the operation-wide visited set.
function collectFencedErrorWaits(value, inheritedImportBoundary, state) {
    const waits = []
    walk(value, inheritedImportBoundary)
    return waits.length === 0 ? undefined : Promise.all(waits)

    function walk(node, inheritedBoundary) {
        if (state.stopped) return
        if (state.visited.has(node)) return
        state.visited.add(node)

        const counter = refcounts.getRequiredRefCounter(node)
        if (state.firstErrorOnly && counter.errorCount > 0) {
            state.foundAnyError()
            return
        }
        if (!hasErrorQueryWork(counter)) return

        const importBoundary = metadata.nodeImportBoundary(node, inheritedBoundary)
        const hasCycleCuts = counter.cycleCutCount > 0
        for (const key of languageProperties.enumerableLanguageKeys(node)) {
            if (state.stopped) break
            const child = languageProperties.readLanguageProperty(node, key)

            if (hasCycleCuts && imports.hasCycleCut(node, key)) {
                walk(child, importBoundary)
            } else if (languageValues.isError(child)) {
                state.foundError(child)
            } else if (languageValues.isPromise(child)) {
                waits.push(collectPromiseErrors(
                    node,
                    key,
                    child,
                    importBoundary,
                ))
            } else if (languageValues.isTracked(child)) {
                const childCounter = refcounts.getRequiredRefCounter(child)
                if (hasErrorQueryWork(childCounter)) {
                    walk(child, importBoundary)
                }
            }
        }
    }

    function collectPromiseErrors(
        parent,
        key,
        promise,
        inheritedImportBoundary,
    ) {
        const mirror = promiseMirrors.getRequiredPromiseMirror(parent, key)
        return resolution.onLaterPromiseReady(promise, () => {
            if (state.stopped) return undefined
            const value = mirror.getValue(parent, key)
            if (languageValues.isError(value)) {
                state.foundError(value)
                return undefined
            }
            if (!languageValues.isTracked(value)) return undefined

            return collectFencedErrorWaits(
                value,
                mirror.importBoundary ?? inheritedImportBoundary,
                state,
            )
        })
    }
}

function hasErrorQueryWork(counter) {
    return counter.promiseCount > 0 ||
        counter.errorCount > 0 ||
        counter.cycleCutCount > 0
}

// Observational path resolution follows raw logical values.
function walkObservationPath(
    chain,
    path,
    onResolved,
) {
    chain.assertState()
    const state = chain._state
    const targetPath = ["value", ...path]
    return walkFromParent(
        state,
        0,
        metadata.nodeImportBoundary(state),
    )

    function walkFromParent(parent, index, importBoundary) {
        const key = targetPath[index]
        const present = languageProperties.hasLanguageProperty(parent, key)
        const value = languageProperties.readLanguageProperty(parent, key)
        if (languageValues.isPromise(value)) {
            const mirror = promiseMirrors.getOrCreatePromiseMirror(
                parent,
                key,
                value,
                importBoundary,
            )
            return resolution.onLaterPromiseReady(value, () => {
                const propertyValue = mirror.getValue(parent, key)
                return walkValue(
                    propertyValue,
                    index,
                    mirror.importBoundary ?? importBoundary,
                    parent,
                    key,
                    true,
                )
            })
        }
        return walkValue(
            value,
            index,
            importBoundary,
            parent,
            key,
            present,
        )
    }

    function walkValue(
        value,
        index,
        inheritedImportBoundary,
        parent,
        key,
        present,
    ) {
        const importBoundary = metadata.nodeImportBoundary(
            value,
            inheritedImportBoundary,
        )
        if (index === targetPath.length - 1 || languageValues.isError(value)) {
            return onResolved(
                value,
                importBoundary,
                present,
                parent,
                key,
            )
        }
        if (
            typeof value === "string" &&
            languageProperties.hasLanguageProperty(
                value,
                targetPath[index + 1],
            )
        ) {
            return walkFromParent(value, index + 1, importBoundary)
        }
        if (!languageValues.isTracked(value)) {
            return onResolved(
                errorUtils.pathAccessError(),
                importBoundary,
                false,
                parent,
                key,
            )
        }
        return walkFromParent(value, index + 1, importBoundary)
    }
}

export {
    exportArgument,
    exportPath,
    getErrors,
    hasError,
    lookupPath,
    walkObservationPath,
}
