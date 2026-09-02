import * as errorUtils from "./error.js"
import { exportValue } from "./export.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as refcounts from "./refcounts.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"

class ErrorQueryContext {
    open = true

    constructor(operationContext, collectErrors = false) {
        this.operationContext = operationContext
        if (collectErrors) this.errors = new Set()
    }

    close() {
        if (!this.open) return
        this.open = false
        this.errors = undefined
        this.resolveFound = undefined
        this.visited = undefined
    }
}

// --- lookupPath :  = a.k.y --------------------------------------------------
function lookupPath(chain, path, operationContext) {
    return errorUtils.runFatal(operationContext, () => {
        chain._assertOperationContext(operationContext)
        return walkObservationPath(chain, path, operationContext, value => {
            metadata.markShared(value, operationContext)
            return value
        })
    })
}

// A temporary read or ownership transfer does not create another owner.
function readPath(chain, path, operationContext) {
    return errorUtils.runFatal(operationContext, () => {
        chain._assertOperationContext(operationContext)
        return walkObservationPath(chain, path, operationContext, value => value)
    })
}

// --- export : host-ready settled snapshot of a branch -----------------------
function exportPath(chain, path, operationContext) {
    return errorUtils.runFatal(operationContext, () => {
        chain._assertOperationContext(operationContext)
        return walkObservationPath(
            chain,
            path,
            operationContext,
            value => exportValue(value, operationContext),
        )
    })
}

// --- hasError : query whether a path or branch contains an Error -------------
function hasError(chain, path, operationContext) {
    const query = new ErrorQueryContext(operationContext)
    return runErrorQuery(chain, path, query, hasErrorAtPathValue)
}

function hasErrorAtPathValue(value, query) {
    if (languageValues.isError(value)) return finishQuery(query, true)
    if (!languageValues.isTraversable(value, query.operationContext)) {
        return finishQuery(query, false)
    }
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
        operationLifecycle.continueInternal(
            query,
            readiness,
            () => runQueryTransition(
                query,
                () => finishQuery(query, false),
            ),
        ),
    ])
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path, operationContext) {
    const query = new ErrorQueryContext(operationContext, true)
    return runErrorQuery(chain, path, query, getErrorsAtPathValue)
}

function getErrorsAtPathValue(value, query) {
    let readiness
    if (languageValues.isError(value)) {
        foundQueryError(query, value)
    } else if (languageValues.isTraversable(value, query.operationContext)) {
        readiness = collectFencedErrorWaits(value, query)
    }
    if (!readiness) return finishErrors(query)

    return operationLifecycle.continueInternal(
        query,
        readiness,
        () => finishErrors(query),
    )
}

// The fenced walk follows only nodes whose counters contain relevant
// work. A cut blocks count propagation, but its indexed target resumes this
// same walk through the operation-wide visited set.
function collectFencedErrorWaits(value, query) {
    propertyVersions.buildRefIndex(value, query.operationContext)
    query.visited ??= new WeakSet()
    const waits = []
    walk(value)
    // A synchronous Error proof abandons observed waits, not an aggregate.
    if (!query.open || waits.length === 0) return undefined
    return operationLifecycle.continueInternal(
        query,
        Promise.all(waits),
        () => undefined,
    )

    function walk(node) {
        if (!query.open || query.visited.has(node)) return
        query.visited.add(node)

        const counter = refcounts.getRequiredRefCounter(node, query.operationContext)
        // hasError needs only this proof; getErrors needs Error identities.
        if (query.errors === undefined && counter.errorCount > 0) {
            foundQueryError(query)
            return
        }
        if (!counterHasErrorSearchWork(counter)) return

        const hasCycleCuts = counter.cycleCutCount > 0
        for (const key of languageProperties.enumerableLanguageKeys(
            node,
            query.operationContext,
        )) {
            if (!query.open) break
            const child = languageProperties.readLanguageProperty(
                node,
                key,
                query.operationContext,
            )

            if (
                hasCycleCuts &&
                refcounts.hasCycleCut(node, key, query.operationContext)
            ) {
                walk(child)
            } else if (languageValues.isError(child)) {
                foundQueryError(query, child)
            } else if (languageValues.isPromise(child, query.operationContext)) {
                waits.push(collectPromiseErrors(node, key, child))
            } else if (languageValues.isTraversable(child, query.operationContext)) {
                walk(child)
            }
        }
    }

    function collectPromiseErrors(parent, key, promise) {
        const result = propertyVersions.continuePropertyValue(
            parent,
            key,
            promise,
            query.operationContext,
            value => runQueryTransition(query, () => {
                if (languageValues.isError(value)) {
                    foundQueryError(query, value)
                    return undefined
                }
                if (!languageValues.isTraversable(value, query.operationContext)) {
                    return undefined
                }

                return collectFencedErrorWaits(value, query)
            }),
        )
        return operationLifecycle.observeFatal(query, result)
    }
}

function foundQueryError(query, error) {
    if (!query.open) return
    if (query.errors !== undefined) {
        query.errors.add(error)
        return
    }

    const resolve = query.resolveFound
    operationLifecycle.close(query)
    if (resolve) resolve(true)
}

function runErrorQuery(chain, path, query, onResolved) {
    return errorUtils.runFatal(query.operationContext, () => {
        chain._assertOperationContext(query.operationContext)
        return runQueryTransition(query, () => {
            const result = walkObservationPath(
                chain,
                path,
                query.operationContext,
                value => onResolved(value, query),
                error => failQuery(query, error),
            )
            return operationLifecycle.observeFatal(query, result)
        })
    })
}

function runQueryTransition(query, transition) {
    return operationLifecycle.run(query, () => {
        return errorUtils.catchUserCodeFailure(
            transition,
            error => failQuery(query, error),
        )
    })
}

function failQuery(query, error) {
    // Query reflection is neither a Boolean result nor graph Error data.
    // An asynchronous path failure has no enclosing query transition.
    operationLifecycle.close(query)
    return errorUtils.reportFatalError(error)
}

function finishErrors(query) {
    return finishQuery(query, [...query.errors])
}

function finishQuery(query, result) {
    operationLifecycle.close(query)
    return result
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
    operationContext,
    onResolved,
    onUserCodeFailure = error => error,
) {
    const state = chain._state
    const targetPath = ["value", ...path]
    return runTraversal(() => walkFromParent(state, 0))

    function walkFromParent(parent, index) {
        const key = languageProperties.normalizePathSegment(
            targetPath[index],
        )
        if (languageValues.isError(key)) {
            languageValues.admitReadyValue(key, operationContext)
            return onResolved(key, false)
        }
        const present = languageProperties.hasLanguageProperty(
            parent,
            key,
            operationContext,
        )
        const value = languageProperties.readLanguageProperty(
            parent,
            key,
            operationContext,
        )
        if (languageValues.isPromise(value, operationContext)) {
            return propertyVersions.continuePropertyValue(
                parent,
                key,
                value,
                operationContext,
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
        if (typeof value === "string") {
            const key = languageProperties.normalizePathSegment(
                targetPath[index + 1],
            )
            if (languageValues.isError(key)) {
                languageValues.admitReadyValue(key, operationContext)
                return onResolved(key, false)
            }
            if (languageProperties.hasLanguageProperty(value, key, operationContext)) {
                return walkFromParent(value, index + 1)
            }
        }
        if (!languageValues.isTraversable(value, operationContext)) {
            const failure = errorUtils.pathAccessError()
            languageValues.admitReadyValue(failure, operationContext)
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
