import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as refcounts from "./refcounts.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import * as rawWalk from "./raw-walk.js"
import * as resolution from "./resolution.js"

// --- lookupPath :  = a.k.y --------------------------------------------------
function lookupPath(chain, path) {
    return errorUtils.runFatal(() => {
        return walkObservationPath(chain, path, value => {
            metadata.markShared(value)
            return value
        })
    })
}

// A temporary read or ownership transfer does not create another owner.
function readPath(chain, path) {
    return errorUtils.runFatal(() => {
        return walkObservationPath(chain, path, value => value)
    })
}

// --- export : host-ready settled snapshot of a branch -----------------------
function exportPath(chain, path) {
    return errorUtils.runFatal(() => {
        return walkObservationPath(chain, path, exportBranch)
    })
}

// Native argument export preserves nested Errors. A top-level Error remains
// available for the caller's shallow argument poisoning.
function exportArgument(value) {
    return resolution.resolveInitialValueOrPoison(value, resolved => {
        return languageValues.isError(resolved)
            ? resolved
            : exportTrackedValue(resolved, true)
    })
}

function exportBranch(value) {
    return exportTrackedValue(value, false)
}

function exportTrackedValue(value, preserveErrors) {
    if (languageValues.isError(value)) {
        return preserveErrors ? value : exportErrorOutcome([value])
    }
    if (!languageValues.isTracked(value)) return value

    let output
    const state = rawWalk.createRawWalkState(() => {
        output = undefined
    }, preserveErrors)
    const readiness = rawWalk.walkRawBranch(value, state)
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
    return errorUtils.runFatal(() => {
        return walkObservationPath(chain, path, hasErrorAtPathValue)
    })
}

function hasErrorAtPathValue(value) {
    if (languageValues.isError(value)) return true
    if (!languageValues.isTracked(value)) return false

    propertyVersions.buildRefIndex(value)
    const counter = refcounts.getRequiredRefCounter(value)
    if (counter.errorCount > 0) return true
    if (counter.cycleCutCount === 0 && counter.promiseCount === 0) return false
    return searchForFirstError(value)
}

// The first discovered Error becomes a synchronous true, an unfindable one
// false, and a pending frontier a first-error-versus-completion race.
function searchForFirstError(value) {
    let found = false
    let resolveError
    const state = createErrorSearchState(() => {
        found = true
        if (resolveError) resolveError(true)
    })
    const readiness = collectFencedErrorWaits(value, state)
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
    return errorUtils.runFatal(() => {
        return walkObservationPath(chain, path, finish)
    })

    function finish(value) {
        const state = createErrorSearchState()
        let readiness
        if (languageValues.isError(value)) {
            state.foundError(value)
        } else if (languageValues.isTracked(value)) {
            propertyVersions.buildRefIndex(value)
            readiness = collectFencedErrorWaits(value, state)
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

// The fenced walk follows only nodes whose counters contain relevant
// work. A cut blocks count propagation, but its indexed target resumes this
// same walk through the operation-wide visited set.
function collectFencedErrorWaits(value, state) {
    const waits = []
    walk(value)
    return waits.length === 0 ? undefined : Promise.all(waits)

    function walk(node) {
        if (state.stopped) return
        if (state.visited.has(node)) return
        state.visited.add(node)

        const counter = refcounts.getRequiredRefCounter(node)
        if (state.firstErrorOnly && counter.errorCount > 0) {
            state.foundAnyError()
            return
        }
        if (!hasErrorQueryWork(counter)) return

        const hasCycleCuts = counter.cycleCutCount > 0
        for (const key of languageProperties.enumerableLanguageKeys(node)) {
            if (state.stopped) break
            const child = languageProperties.readLanguageProperty(node, key)

            if (hasCycleCuts && refcounts.hasCycleCut(node, key)) {
                walk(child)
            } else if (languageValues.isError(child)) {
                state.foundError(child)
            } else if (languageValues.isPromise(child)) {
                waits.push(collectPromiseErrors(node, key, child))
            } else if (languageValues.isTracked(child)) {
                const childCounter = refcounts.getRequiredRefCounter(child)
                if (hasErrorQueryWork(childCounter)) {
                    walk(child)
                }
            }
        }
    }

    function collectPromiseErrors(parent, key, promise) {
        return propertyVersions.continuePropertyValue(
            parent,
            key,
            promise,
            value => {
                if (state.stopped) return undefined
                if (languageValues.isError(value)) {
                    state.foundError(value)
                    return undefined
                }
                if (!languageValues.isTracked(value)) return undefined

                return collectFencedErrorWaits(value, state)
            },
        )
    }
}

function hasErrorQueryWork(counter) {
    return counter.promiseCount > 0 ||
        counter.errorCount > 0 ||
        counter.cycleCutCount > 0
}

// Observational path resolution follows raw logical values.
function walkObservationPath(chain, path, onResolved) {
    chain.assertState()
    const state = chain._state
    const targetPath = ["value", ...path]
    return walkFromParent(state, 0)

    function walkFromParent(parent, index) {
        const key = targetPath[index]
        const present = languageProperties.hasLanguageProperty(parent, key)
        const value = languageProperties.readLanguageProperty(parent, key)
        if (languageValues.isPromise(value)) {
            return propertyVersions.continuePropertyValue(
                parent,
                key,
                value,
                propertyValue => walkValue(propertyValue, index, true),
            )
        }
        return walkValue(value, index, present)
    }

    function walkValue(value, index, present) {
        if (index === targetPath.length - 1 || languageValues.isError(value)) {
            return onResolved(value, present)
        }
        if (
            typeof value === "string" &&
            languageProperties.hasLanguageProperty(
                value,
                targetPath[index + 1],
            )
        ) {
            return walkFromParent(value, index + 1)
        }
        if (!languageValues.isTracked(value)) {
            return onResolved(errorUtils.pathAccessError(), false)
        }
        return walkFromParent(value, index + 1)
    }
}

export {
    exportArgument,
    exportPath,
    getErrors,
    hasError,
    lookupPath,
    readPath,
    walkObservationPath,
}
