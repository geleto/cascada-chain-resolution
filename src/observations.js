import { markPromiseHandled } from "./thenable-subscription.js"
import * as errorUtils from "./error.js"
import { exportValue } from "./export.js"
import * as internalSteps from "./internal-step.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as refcounts from "./refcounts.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"

class ErrorQueryContext extends operationLifecycle.OperationOwner {
    constructor(operationContext, collect = false) {
        super(operationContext)
        if (collect) this.errors = new Set()
    }
    release() {
        this.errors = undefined
        this.resolveOutcome = undefined
        this.visited = undefined
    }
    run(chain, path, onResolved) {
        return internalSteps.runInternalStep(this.operationContext, () => {
            chain._assertOperationContext(this.operationContext)
            return walkObservationPath(
                chain,
                path,
                this.operationContext,
                value => onResolved(value, this),
                error => this.finish(error),
                errorUtils.ERROR_KIND.QueryReflectionFailed,
            )
        })
    }
    found(error) {
        if (!this.open) return
        if (this.errors) this.errors.add(error)
        else this.finish(true)
    }
    finish(result) {
        if (!this.open) return this.result
        this.result = result
        const resolve = this.resolveOutcome
        operationLifecycle.close(this)
        resolve?.(result)
        return result
    }
    complete(readiness, result) {
        if (!this.open) return this.result
        if (!languageValues.isPending(readiness, this.operationContext))
            return this.finish(result())
        const outcome = new Promise(resolve => {
            this.resolveOutcome = resolve
        })
        const completed = internalSteps.continueOperation(
            readiness,
            this.operationContext,
            () => this.finish(result()),
            undefined,
            this,
        )
        // finish owns both early completion and traversal exhaustion.
        markPromiseHandled(completed, this.operationContext)
        return outcome
    }
}

// --- lookupPath :  = a.k.y --------------------------------------------------
function lookupPath(chain, path, operationContext) {
    return internalSteps.runInternalStep(operationContext, () => {
        chain._assertOperationContext(operationContext)
        return walkObservationPath(chain, path, operationContext, value => {
            metadata.markShared(value, operationContext)
            return value
        })
    })
}

function lookupPathForExpression(chain, path, operationContext) {
    return internalSteps.runInternalStep(operationContext, () => {
        chain._assertOperationContext(operationContext)
        return walkObservationPath(chain, path, operationContext, value => {
            if (errorUtils.isPoisonError(value)) return value
            switch (typeof value) {
                case "string":
                case "number":
                case "boolean":
                case "bigint":
                    return value
                default:
                    return errorUtils.validationError(
                        "Expression lookup requires a string, number, boolean, or bigint",
                        operationContext,
                        errorUtils.ERROR_KIND.InvalidExpressionValue,
                    )
            }
        })
    })
}

// A temporary read or ownership transfer does not create another owner.
function readPath(chain, path, operationContext) {
    return internalSteps.runInternalStep(operationContext, () => {
        chain._assertOperationContext(operationContext)
        return walkObservationPath(chain, path, operationContext, value => value)
    })
}

// --- export : host-ready settled snapshot of a branch -----------------------
function exportPath(chain, path, operationContext) {
    return internalSteps.runInternalStep(operationContext, () => {
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
    if (errorUtils.isPoisonError(value)) return queryContext.finish(true)
    if (!languageValues.isTraversable(value, queryContext.operationContext)) {
        return queryContext.finish(false)
    }
    return searchForFirstError(value, queryContext)
}

// The first discovered Error becomes a synchronous true, an unfindable one
// false, and a pending frontier a first-error-versus-completion race.
function searchForFirstError(value, queryContext) {
    return queryContext.complete(
        collectFencedErrorWaits(value, queryContext),
        () => false,
    )
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path, operationContext) {
    const queryContext = new ErrorQueryContext(operationContext, true)
    return queryContext.run(chain, path, getErrorsAtPathValue)
}

function getErrorsAtPathValue(value, queryContext) {
    if (errorUtils.isPoisonError(value)) return queryContext.finish(value)
    let readiness
    if (languageValues.isTraversable(value, queryContext.operationContext))
        readiness = collectFencedErrorWaits(value, queryContext)
    return queryContext.complete(readiness, () =>
        queryContext.errors.size === 0
            ? null
            : errorUtils.combineErrors(queryContext.errors, "Errors in queried value"),
    )
}

// The fenced walk follows only nodes whose counters contain relevant
// work. A cut blocks count propagation, but its indexed target resumes this
// same walk through the operation-wide visited set.
function collectFencedErrorWaits(value, queryContext) {
    const waits = []
    errorUtils.catchExternalThrow(
        () => {
            refcounts.buildRefIndex(value, queryContext.operationContext)
            queryContext.visited ??= new WeakSet()
            walk(value)
        },
        queryContext.operationContext,
        errorUtils.ERROR_KIND.QueryReflectionFailed,
        failure => queryContext.finish(failure),
    )
    // A synchronous Error proof abandons observed waits, not an aggregate.
    if (!queryContext.open) {
        for (const wait of waits) markPromiseHandled(wait, queryContext.operationContext)
        return undefined
    }
    if (waits.length === 0) return undefined
    return internalSteps.continueOperation(
        Promise.all(waits),
        queryContext.operationContext,
        () => undefined,
        undefined,
        queryContext,
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
            } else if (errorUtils.isPoisonError(child)) {
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
        const result = propertyVersions.continuePromiseVersion(
            parent,
            key,
            promise,
            queryContext.operationContext,
            value => {
                if (!queryContext.open) return undefined
                if (errorUtils.isPoisonError(value)) {
                    queryContext.found(value)
                    return undefined
                }
                if (!languageValues.isTraversable(value, queryContext.operationContext)) {
                    return undefined
                }

                return collectFencedErrorWaits(value, queryContext)
            },
            queryContext,
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
    reflectionKind = errorUtils.ERROR_KIND.LookupReflectionFailed,
) {
    const rootState = chain._state
    const targetPath = ["value", ...path]
    return runTraversal(() => walkFromParent(rootState, 0))

    function walkFromParent(parent, index) {
        const key = languageProperties.normalizePathSegment(
            targetPath[index],
            operationContext,
        )
        if (errorUtils.isPoisonError(key)) {
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
            return propertyVersions.continuePromiseVersion(
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
            errorUtils.isPoisonError(value)
        ) {
            return onResolved(value, present)
        }
        if (typeof value === "string") {
            const key = languageProperties.normalizePathSegment(
                targetPath[index + 1],
                operationContext,
            )
            if (errorUtils.isPoisonError(key)) {
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
        return errorUtils.catchExternalThrow(
            traverse,
            operationContext,
            reflectionKind,
            onUserCodeFailure,
        )
    }
}

export {
    exportPath,
    getErrors,
    hasError,
    lookupPath,
    lookupPathForExpression,
    readPath,
    walkObservationPath,
}
