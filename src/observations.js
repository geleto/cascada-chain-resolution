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
function exportValue(chain, path) {
    return helpers.runFatal(() => {
        return walkObservationPath(chain, path, exportAtPathValue)
    })
}

function exportAtPathValue(value, importBoundary) {
    if (helpers.isError(value)) return exportErrorOutcome([value])
    if (!helpers.isTracked(value)) return value

    let output
    const state = rawWalk.createRawWalkState(() => {
        output = undefined
    })
    const readiness = rawWalk.walkRawBranch(value, importBoundary, state)
    if (state.copying) output = state.copies.get(value)
    const finish = () => state.errors.size > 0
        ? exportErrorOutcome(state.errors)
        : output
    return readiness
        ? helpers.onAllPromisesReady(readiness, finish)
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
    if (helpers.isError(value)) return true
    if (!helpers.isTracked(value)) return false

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
        helpers.onAllPromisesReady(readiness, () => false),
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
        if (helpers.isError(value)) {
            state.foundError(value)
        } else if (helpers.isTracked(value)) {
            refcounts.buildRefIndex(value, importBoundary)
            readiness = collectFencedErrorWaits(value, importBoundary, state)
        }
        return readiness
            ? helpers.onAllPromisesReady(readiness, () => [...state.errors])
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
        for (const key of Object.keys(node)) {
            if (state.stopped) break
            const child = languageProperties.readLanguageProperty(node, key)

            if (hasCycleCuts && imports.hasCycleCut(node, key)) {
                walk(child, importBoundary)
            } else if (helpers.isError(child)) {
                state.foundError(child)
            } else if (helpers.isPromise(child)) {
                waits.push(collectPromiseErrors(
                    node,
                    key,
                    child,
                    importBoundary,
                ))
            } else if (helpers.isTracked(child)) {
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
        return helpers.onLaterPromiseReady(promise, () => {
            if (state.stopped) return undefined
            const value = mirror.getValue(parent, key)
            if (helpers.isError(value)) {
                state.foundError(value)
                return undefined
            }
            if (!helpers.isTracked(value)) return undefined

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
        const value = languageProperties.readLanguageProperty(parent, key)
        if (helpers.isPromise(value)) {
            const mirror = promiseMirrors.getOrCreatePromiseMirror(
                parent,
                key,
                value,
                importBoundary,
            )
            return helpers.onLaterPromiseReady(value, () => {
                const propertyValue = mirror.getValue(parent, key)
                return walkValue(
                    propertyValue,
                    index,
                    mirror.importBoundary ?? importBoundary,
                )
            })
        }
        return walkValue(value, index, importBoundary)
    }

    function walkValue(value, index, inheritedImportBoundary) {
        const importBoundary = metadata.nodeImportBoundary(
            value,
            inheritedImportBoundary,
        )
        if (index === targetPath.length - 1 || helpers.isError(value)) {
            return onResolved(value, importBoundary)
        }
        if (!helpers.isTracked(value)) {
            return onResolved(errorUtils.pathAccessError(), importBoundary)
        }
        return walkFromParent(value, index + 1, importBoundary)
    }
}

export {
    exportValue,
    getErrors,
    hasError,
    lookupPath,
    walkObservationPath,
}
