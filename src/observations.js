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
    const query = { open: true }
    return runErrorQuery(chain, path, query, hasErrorAtPathValue)
}

function hasErrorAtPathValue(value, query) {
    if (languageValues.isError(value)) return finishQuery(query, true)
    if (!languageValues.isTraversable(value)) return finishQuery(query, false)
    return searchForFirstError(value, query)
}

// The first discovered Error becomes a synchronous true, an unfindable one
// false, and a pending frontier a first-error-versus-completion race.
function searchForFirstError(value, query) {
    const readiness = collectFencedErrorWaits(value, query)
    // The fenced walk's only non-throwing close is an Error proof.
    if (!query.open) return true
    if (!readiness) return finishQuery(query, false)

    const foundPromise = new Promise(resolve => {
        query.resolveFound = resolve
    })
    // Every non-fatal close resolves foundPromise before readiness can finish.
    return Promise.race([
        foundPromise,
        resolution.continueInternalPromiseOrFatal(
            readiness,
            () => runQueryTransition(
                query,
                () => finishQuery(query, false),
            ),
        ),
    ])
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path) {
    const query = { open: true, errors: new Set() }
    return runErrorQuery(chain, path, query, getErrorsAtPathValue)
}

function getErrorsAtPathValue(value, query) {
    let readiness
    if (languageValues.isError(value)) {
        foundQueryError(query, value)
    } else if (languageValues.isTraversable(value)) {
        readiness = collectFencedErrorWaits(value, query)
    }
    if (!readiness) return finishErrors(query)

    return resolution.continueInternalPromiseOrFatal(
        readiness,
        () => finishErrors(query),
    )
}

// The fenced walk follows only nodes whose counters contain relevant
// work. A cut blocks count propagation, but its indexed target resumes this
// same walk through the operation-wide visited set.
function collectFencedErrorWaits(value, query) {
    propertyVersions.buildRefIndex(value)
    query.visited ??= new WeakSet()
    const waits = []
    walk(value)
    // A synchronous Error proof abandons observed waits, not an aggregate.
    if (!query.open || waits.length === 0) return undefined
    return Promise.all(waits)

    function walk(node) {
        if (!query.open || query.visited.has(node)) return
        query.visited.add(node)

        const counter = refcounts.getRequiredRefCounter(node)
        // hasError needs only this proof; getErrors needs Error identities.
        if (query.errors === undefined && counter.errorCount > 0) {
            foundQueryError(query)
            return
        }
        if (!counterHasErrorSearchWork(counter)) return

        const hasCycleCuts = counter.cycleCutCount > 0
        for (const key of languageProperties.enumerableLanguageKeys(node)) {
            if (!query.open) break
            const child = languageProperties.readLanguageProperty(node, key)

            if (hasCycleCuts && refcounts.hasCycleCut(node, key)) {
                walk(child)
            } else if (languageValues.isError(child)) {
                foundQueryError(query, child)
            } else if (languageValues.isPromise(child)) {
                waits.push(collectPromiseErrors(node, key, child))
            } else if (languageValues.isTraversable(child)) {
                walk(child)
            }
        }
    }

    function collectPromiseErrors(parent, key, promise) {
        return closeOnQueryFatal(
            propertyVersions.continuePropertyValue(
                parent,
                key,
                promise,
                value => runQueryTransition(query, () => {
                    if (languageValues.isError(value)) {
                        foundQueryError(query, value)
                        return undefined
                    }
                    if (!languageValues.isTraversable(value)) return undefined

                    return collectFencedErrorWaits(value, query)
                }),
            ),
            query,
        )
    }
}

function foundQueryError(query, error) {
    if (!query.open) return
    if (query.errors !== undefined) {
        query.errors.add(error)
        return
    }

    const resolve = query.resolveFound
    closeQuery(query)
    if (resolve) resolve(true)
}

function runErrorQuery(chain, path, query, onResolved) {
    return errorUtils.runFatal(() => runQueryTransition(query, () => {
        const result = walkObservationPath(
            chain,
            path,
            value => onResolved(value, query),
            error => failQuery(query, error),
        )
        return closeOnQueryFatal(result, query)
    }))
}

function runQueryTransition(query, transition) {
    if (!query.open) return undefined
    try {
        return errorUtils.catchUserCodeFailure(
            transition,
            error => failQuery(query, error),
        )
    } catch (error) {
        closeQuery(query)
        throw error
    }
}

function failQuery(query, error) {
    // Query reflection is neither a Boolean result nor graph Error data.
    // An asynchronous path failure has no enclosing query transition.
    closeQuery(query)
    return errorUtils.reportFatalError(error)
}

function closeOnQueryFatal(result, query) {
    if (languageValues.isPromise(result)) {
        // Close before rejection propagates beyond this asynchronous layer.
        resolution.observeResultPromise(
            result,
            () => {},
            () => closeQuery(query),
        )
    }
    return result
}

function finishErrors(query) {
    return finishQuery(query, [...query.errors])
}

function finishQuery(query, result) {
    closeQuery(query)
    return result
}

function closeQuery(query) {
    query.open = false
    query.errors = undefined
    query.resolveFound = undefined
    query.visited = undefined
}

function counterHasErrorSearchWork(counter) {
    return counter.promiseCount > 0 ||
        counter.errorCount > 0 ||
        counter.cycleCutCount > 0
}

// Observational path resolution follows raw logical values.
function walkObservationPath(
    chain,
    path,
    onResolved,
    onUserCodeFailure = error => error,
) {
    chain.assertState()
    const state = chain._state
    const targetPath = ["value", ...path]
    return runTraversal(() => walkFromParent(state, 0))

    function walkFromParent(parent, index) {
        const key = targetPath[index]
        const present = languageProperties.hasLanguageProperty(parent, key)
        const value = languageProperties.readLanguageProperty(parent, key)
        if (languageValues.isPromise(value)) {
            return propertyVersions.continuePropertyValue(
                parent,
                key,
                value,
                propertyValue => runTraversal(
                    () => walkValue(propertyValue, index, true),
                ),
            )
        }
        return walkValue(value, index, present)
    }

    function walkValue(value, index, present) {
        if (
            index === targetPath.length - 1 ||
            languageValues.isError(value)
        ) {
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

    function runTraversal(traverse) {
        return errorUtils.catchUserCodeFailure(
            traverse,
            onUserCodeFailure,
        )
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
