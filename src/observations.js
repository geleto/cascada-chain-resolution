import * as errorUtils from "./error.js"
import { exportValue } from "./export.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as refcounts from "./refcounts.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"
import * as resolution from "./resolution.js"

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

    run(chain, path, onResolved) {
        return errorUtils.runInternalStep(this.operationContext, () => {
            chain._assertOperationContext(this.operationContext)
            return walkObservationPath(
                chain,
                path,
                this.operationContext,
                value => onResolved(value, this),
                error => this.fail(error),
            )
        })
    }

    found(error) {
        if (!this.open) return
        if (this.errors !== undefined) {
            this.errors.add(error)
            return
        }

        const resolve = this.resolveFound
        operationLifecycle.close(this)
        if (resolve) resolve(true)
    }

    fail(error) {
        // Query reflection is neither a Boolean result nor graph Error data.
        // Throw through the enclosing ready or resumed runtime transition.
        throw error
    }

    finish(result) {
        operationLifecycle.close(this)
        return result
    }
}

// --- lookupPath :  = a.k.y --------------------------------------------------
function lookupPath(chain, path, operationContext) {
    return errorUtils.runInternalStep(operationContext, () => {
        chain._assertOperationContext(operationContext)
        return walkObservationPath(chain, path, operationContext, value => {
            metadata.markShared(value, operationContext)
            return value
        })
    })
}

// A temporary read or ownership transfer does not create another owner.
function readPath(chain, path, operationContext) {
    return errorUtils.runInternalStep(operationContext, () => {
        chain._assertOperationContext(operationContext)
        return walkObservationPath(chain, path, operationContext, value => value)
    })
}

// --- export : host-ready settled snapshot of a branch -----------------------
function exportPath(chain, path, operationContext) {
    return errorUtils.runInternalStep(operationContext, () => {
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
    const queryContext = new ErrorQueryContext(operationContext)
    return queryContext.run(chain, path, hasErrorAtPathValue)
}

function hasErrorAtPathValue(value, queryContext) {
    if (languageValues.isError(value)) return queryContext.finish(true)
    if (!languageValues.isTraversable(value, queryContext.operationContext)) {
        return queryContext.finish(false)
    }
    return searchForFirstError(value, queryContext)
}

// The first discovered Error becomes a synchronous true, an unfindable one
// false, and a pending frontier a first-error-versus-completion race.
function searchForFirstError(value, queryContext) {
    const readiness = collectFencedErrorWaits(value, queryContext)
    // The fenced walk's only non-throwing close is an Error proof.
    if (!queryContext.open) return true
    if (!readiness) return queryContext.finish(false)

    const foundPromise = new Promise(resolve => {
        queryContext.resolveFound = resolve
    })
    // Every non-fatal close resolves foundPromise before readiness can finish.
    return Promise.race([
        foundPromise,
        operationLifecycle.continueInternalResultOrFatal(
            queryContext,
            readiness,
            () => queryContext.finish(false),
        ),
    ])
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path, operationContext) {
    const queryContext = new ErrorQueryContext(operationContext, true)
    return queryContext.run(chain, path, getErrorsAtPathValue)
}

function getErrorsAtPathValue(value, queryContext) {
    let readiness
    if (languageValues.isError(value)) {
        queryContext.found(value)
    } else if (languageValues.isTraversable(value, queryContext.operationContext)) {
        readiness = collectFencedErrorWaits(value, queryContext)
    }
    if (!readiness) return queryContext.finish([...queryContext.errors])

    return operationLifecycle.continueInternalResultOrFatal(
        queryContext,
        readiness,
        () => queryContext.finish([...queryContext.errors]),
    )
}

// The fenced walk follows only nodes whose counters contain relevant
// work. A cut blocks count propagation, but its indexed target resumes this
// same walk through the operation-wide visited set.
function collectFencedErrorWaits(value, queryContext) {
    refcounts.buildRefIndex(value, queryContext.operationContext)
    queryContext.visited ??= new WeakSet()
    const waits = []
    walk(value)
    // A synchronous Error proof abandons observed waits, not an aggregate.
    if (!queryContext.open) {
        for (const wait of waits) resolution.markPromiseHandled(wait)
        return undefined
    }
    if (waits.length === 0) return undefined
    return operationLifecycle.continueInternalResultOrFatal(
        queryContext,
        Promise.all(waits),
        () => undefined,
    )

    function walk(node) {
        if (!queryContext.open || queryContext.visited.has(node)) return
        queryContext.visited.add(node)

        const counter = refcounts.getRequiredRefCounter(node, queryContext.operationContext)
        // hasError needs only this proof; getErrors needs Error identities.
        if (queryContext.errors === undefined && counter.errorCount > 0) {
            queryContext.found()
            return
        }
        if (!counterHasErrorSearchWork(counter)) return

        const hasCycleCuts = counter.cycleCutCount > 0
        for (const key of languageProperties.enumerableLanguageKeys(
            node,
            queryContext.operationContext,
        )) {
            if (!queryContext.open) break
            const child = languageProperties.readLanguageProperty(
                node,
                key,
                queryContext.operationContext,
            )

            if (
                hasCycleCuts &&
                refcounts.hasCycleCut(node, key, queryContext.operationContext)
            ) {
                walk(child)
            } else if (languageValues.isError(child)) {
                queryContext.found(child)
            } else if (languageValues.isPending(child, queryContext.operationContext)) {
                const wait = collectPromiseErrors(node, key, child)
                if (languageValues.isPending(wait, queryContext.operationContext)) waits.push(wait)
            } else if (languageValues.isTraversable(child, queryContext.operationContext)) {
                walk(child)
            }
        }
    }

    function collectPromiseErrors(parent, key, promise) {
        const result = propertyVersions.continuePropertyValue(
            parent,
            key,
            promise,
            queryContext.operationContext,
            value => {
                if (!queryContext.open) return undefined
                if (languageValues.isError(value)) {
                    queryContext.found(value)
                    return undefined
                }
                if (!languageValues.isTraversable(value, queryContext.operationContext)) {
                    return undefined
                }

                return collectFencedErrorWaits(value, queryContext)
            },
        )
        return result
    }
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
    onUserCodeFailure = undefined,
) {
    const rootState = chain._state
    const targetPath = ["value", ...path]
    return runTraversal(() => walkFromParent(rootState, 0))

    function walkFromParent(parent, index) {
        const key = languageProperties.normalizePathSegment(
            targetPath[index],
            operationContext,
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
        if (languageValues.isPending(value, operationContext)) {
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
                operationContext,
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
            const failure = errorUtils.pathAccessError(value, operationContext)
            languageValues.admitReadyValue(failure, operationContext)
            return onResolved(failure, false)
        }
        return walkFromParent(value, index + 1)
    }

    function runTraversal(traverse) {
        return onUserCodeFailure
            ? errorUtils.catchRawUserCodeFailure(
                traverse,
                onUserCodeFailure,
                operationContext,
            )
            : errorUtils.catchUserCodeFailure(
                traverse,
                operationContext,
                errorUtils.ERROR_KIND.LookupThrew,
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
