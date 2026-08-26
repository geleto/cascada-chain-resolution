import * as errorUtils from "./error.js"
import { exportValue } from "./export.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as refcounts from "./refcounts.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
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
        return walkObservationPath(chain, path, exportValue)
    })
}

// --- hasError : query whether a path or branch contains an Error -------------
function hasError(chain, path) {
    return errorUtils.runFatal(() => {
        return walkObservationPath(chain, path, hasErrorAtPathValue)
    })
}

function hasErrorAtPathValue(value) {
    if (languageValues.isError(value)) return true
    if (!languageValues.isTraversable(value)) return false

    propertyVersions.buildRefIndex(value)
    const counter = refcounts.getRequiredRefCounter(value)
    if (counter.errorCount > 0) return true
    if (!counterHasErrorSearchWork(counter)) return false
    return searchForFirstError(value)
}

// The first discovered Error becomes a synchronous true, an unfindable one
// false, and a pending frontier a first-error-versus-completion race.
function searchForFirstError(value) {
    let found = false
    let resolveError
    const strategy = {
        stopsAtCountedError: true,
        shouldStop: () => found,
        foundError() {
            found = true
            if (resolveError) resolveError(true)
        },
    }
    const readiness = collectFencedErrorWaits(value, strategy)
    if (found) return true
    if (!readiness) return false

    const errorPromise = new Promise(resolve => {
        resolveError = resolve
    })
    return Promise.race([
        errorPromise,
        resolution.continueInternalPromiseOrFatal(readiness, () => false),
    ])
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path) {
    return errorUtils.runFatal(() => {
        return walkObservationPath(chain, path, finish)
    })

    function finish(value) {
        const errors = new Set()
        const strategy = {
            stopsAtCountedError: false,
            shouldStop: () => false,
            foundError: error => errors.add(error),
        }
        let readiness
        if (languageValues.isError(value)) {
            strategy.foundError(value)
        } else if (languageValues.isTraversable(value)) {
            readiness = collectFencedErrorWaits(value, strategy)
        }
        return readiness
            ? resolution.continueInternalPromiseOrFatal(
                readiness,
                () => [...errors],
            )
            : [...errors]
    }
}

// The fenced walk follows only nodes whose counters contain relevant
// work. A cut blocks count propagation, but its indexed target resumes this
// same walk through the operation-wide visited set.
function collectFencedErrorWaits(
    value,
    strategy,
    visited = new WeakSet(),
) {
    propertyVersions.buildRefIndex(value)
    const waits = []
    walk(value)
    return waits.length === 0 ? undefined : Promise.all(waits)

    function walk(node) {
        if (strategy.shouldStop() || visited.has(node)) return
        visited.add(node)

        const counter = refcounts.getRequiredRefCounter(node)
        if (strategy.stopsAtCountedError && counter.errorCount > 0) {
            strategy.foundError()
            return
        }
        if (!counterHasErrorSearchWork(counter)) return

        const hasCycleCuts = counter.cycleCutCount > 0
        for (const key of languageProperties.enumerableLanguageKeys(node)) {
            if (strategy.shouldStop()) break
            const child = languageProperties.readLanguageProperty(node, key)

            if (hasCycleCuts && refcounts.hasCycleCut(node, key)) {
                walk(child)
            } else if (languageValues.isError(child)) {
                strategy.foundError(child)
            } else if (languageValues.isPromise(child)) {
                waits.push(collectPromiseErrors(node, key, child))
            } else if (languageValues.isTraversable(child)) {
                const childCounter = refcounts.getRequiredRefCounter(child)
                if (counterHasErrorSearchWork(childCounter)) {
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
                if (strategy.shouldStop()) return undefined
                if (languageValues.isError(value)) {
                    strategy.foundError(value)
                    return undefined
                }
                if (!languageValues.isTraversable(value)) return undefined

                return collectFencedErrorWaits(value, strategy, visited)
            },
        )
    }
}

function counterHasErrorSearchWork(counter) {
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
        if (!languageValues.isTraversable(value)) {
            const failure = errorUtils.pathAccessError()
            languageValues.admitReadyValue(failure)
            return onResolved(failure, false)
        }
        return walkFromParent(value, index + 1)
    }
}

export {
    exportPath,
    getErrors,
    hasError,
    lookupPath,
    readPath,
    walkObservationPath,
}
