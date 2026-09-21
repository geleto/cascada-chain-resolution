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
import { PathOperation } from "./path-operation.js"
import * as externalTree from "./external-mutation-tree.js"

class ErrorQueryWork extends operationLifecycle.OperationOwner {
    constructor(operationContext, collect = false) {
        super(operationContext)
        if (collect) this.errors = new Set()
    }
    release() {
        if (this.externalReadiness) markPromiseHandled(this.externalReadiness, this.operationContext)
        this.externalReadiness = undefined
        this.errors = undefined
        this.resolveOutcome = undefined
        this.visited = undefined
    }
    run(chain, path, onResolved, firstDynamicSegment = path.length) {
        return internalSteps.runInternalStep(this.operationContext, () => {
            const operation = new PathOperation(chain, path, this.operationContext, undefined, false, firstDynamicSegment)
            const node = operation.route.externalTreeNode
            operation.reserveExternal(node)
            const inspect = value => {
                if (errorUtils.isPoisonError(value) || !node) return onResolved(value, this)
                const effect = operation.externalEffect
                // External metadata capture has its own last use. Managed
                // Error collection may finish earlier, or continue much longer.
                operation.externalEffect = undefined
                const captured = internalSteps.continueOperation(effect.readiness, this.operationContext, () => {
                    if (this.open) {
                        const blocker = operation.externalBlocker(false)
                        if (blocker) this.found(blocker)
                        else for (const error of externalTree.collectPoison(node)) this.found(error)
                    }
                    effect.complete()
                })
                if (languageValues.isPending(captured, this.operationContext)) this.externalReadiness = captured
                return this.open ? onResolved(value, this) : this.result
            }
            const result = operation.observe(inspect,
                access => access.validatePath() ?? this.complete(undefined, () => this.errors ? null : false),
                error => this.finish(error), errorUtils.ERROR_KIND.QueryReflectionFailed)
            return operation.finish(internalSteps.continueOperation(result, this.operationContext,
                value => this.open && errorUtils.isPoisonError(value) ? onResolved(value, this) : value))
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
        if (this.externalReadiness) {
            readiness = Promise.all([readiness, this.externalReadiness])
            this.externalReadiness = undefined
        }
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
function lookupPath(chain, path, operationContext, firstDynamicSegment = path.length) {
    return internalSteps.runInternalStep(operationContext, () => {
        const operation = new PathOperation(chain, path, operationContext, undefined, false, firstDynamicSegment)
        const retain = value => {
            metadata.markShared(value, operationContext)
            return value
        }
        return operation.finish(operation.observe(retain, access =>
            internalSteps.continueOperation(access.read(), operationContext, retain)))
    })
}

function lookupPathForExpression(chain, path, operationContext, firstDynamicSegment = path.length) {
    return internalSteps.runInternalStep(operationContext, () => {
        const operation = new PathOperation(chain, path, operationContext, undefined, false, firstDynamicSegment)
        const validate = value => {
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
        }
        return operation.finish(operation.observe(validate, access =>
            internalSteps.continueOperation(access.read(), operationContext, validate)))
    })
}

// --- export : host-ready settled snapshot of a branch -----------------------
function exportPath(chain, path, operationContext, firstDynamicSegment = path.length) {
    return internalSteps.runInternalStep(operationContext, () => {
        const operation = new PathOperation(chain, path, operationContext, undefined, false, firstDynamicSegment)
        return operation.finish(operation.observe(
            value => exportValue(value, operation),
            access => access.read(true),
        ))
    })
}

// --- hasError : query whether a path or branch contains an Error -------------
function hasError(chain, path, operationContext, firstDynamicSegment = path.length) {
    const queryWork = new ErrorQueryWork(operationContext)
    return queryWork.run(chain, path, hasErrorAtPathValue, firstDynamicSegment)
}

function hasErrorAtPathValue(value, queryWork) {
    if (errorUtils.isPoisonError(value)) return queryWork.finish(true)
    if (!languageValues.isTraversable(value, queryWork.operationContext)) {
        return queryWork.complete(undefined, () => false)
    }
    return searchForFirstError(value, queryWork)
}

// The first discovered Error becomes a synchronous true, an unfindable one
// false, and a pending frontier a first-error-versus-completion race.
function searchForFirstError(value, queryWork) {
    return queryWork.complete(
        collectFencedErrorWaits(value, queryWork),
        () => false,
    )
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path, operationContext, firstDynamicSegment = path.length) {
    const queryWork = new ErrorQueryWork(operationContext, true)
    return queryWork.run(chain, path, getErrorsAtPathValue, firstDynamicSegment)
}

function getErrorsAtPathValue(value, queryWork) {
    if (errorUtils.isPoisonError(value)) return queryWork.finish(value)
    let readiness
    if (languageValues.isTraversable(value, queryWork.operationContext))
        readiness = collectFencedErrorWaits(value, queryWork)
    return queryWork.complete(readiness, () =>
        queryWork.errors.size === 0
            ? null
            : errorUtils.combineErrors(queryWork.errors, "Errors in queried value"),
    )
}

// The fenced walk follows only nodes whose counters contain relevant
// work. A cut blocks count propagation, but its indexed target resumes this
// same walk through the operation-wide visited set.
function collectFencedErrorWaits(value, queryWork) {
    const waits = []
    errorUtils.catchExternalThrow(
        () => {
            refcounts.buildRefIndex(value, queryWork.operationContext)
            queryWork.visited ??= new WeakSet()
            walk(value)
        },
        queryWork.operationContext,
        errorUtils.ERROR_KIND.QueryReflectionFailed,
        failure => queryWork.finish(failure),
    )
    // A synchronous Error proof abandons observed waits, not an aggregate.
    if (!queryWork.open) {
        for (const wait of waits) markPromiseHandled(wait, queryWork.operationContext)
        return undefined
    }
    if (waits.length === 0) return undefined
    return internalSteps.continueOperation(
        Promise.all(waits),
        queryWork.operationContext,
        () => undefined,
        undefined,
        queryWork,
    )

    function walk(node) {
        if (!queryWork.open || queryWork.visited.has(node)) return
        queryWork.visited.add(node)

        const counter = refcounts.getRequiredRefCounter(node, queryWork.operationContext)
        // hasError needs only this proof; getErrors needs Error identities.
        if (queryWork.errors === undefined && counter.errorCount > 0) {
            queryWork.found()
            return
        }
        if (!hasErrorSearchWork(counter)) return

        const hasCycleCuts = counter.cycleCutCount > 0
        for (const key of languageProperties.enumerableLanguageKeys(
            node,
            queryWork.operationContext,
        )) {
            if (!queryWork.open) break
            const child = languageProperties.readLanguageProperty(
                node,
                key,
                queryWork.operationContext,
            )

            if (
                hasCycleCuts &&
                refcounts.hasCycleCut(node, key, queryWork.operationContext)
            ) {
                walk(child)
            } else if (errorUtils.isPoisonError(child)) {
                queryWork.found(child)
            } else if (languageValues.isPending(child, queryWork.operationContext)) {
                const wait = collectPromiseErrors(node, key, child)
                if (languageValues.isPending(wait, queryWork.operationContext)) waits.push(wait)
            } else if (languageValues.isTraversable(child, queryWork.operationContext)) {
                walk(child)
            }
        }
    }

    function collectPromiseErrors(parent, key, promise) {
        const result = propertyVersions.observePromiseVersion(
            promise,
            propertyVersions.requirePromiseVersion(parent, key, queryWork.operationContext),
            queryWork.operationContext,
            value => {
                if (!queryWork.open) return undefined
                if (errorUtils.isPoisonError(value)) {
                    queryWork.found(value)
                    return undefined
                }
                if (!languageValues.isTraversable(value, queryWork.operationContext)) {
                    return undefined
                }

                return collectFencedErrorWaits(value, queryWork)
            },
            queryWork,
        )
        return result
    }
}

function hasErrorSearchWork(counter) {
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
    { onExternal, externalDepth = Infinity, owner } = {},
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
        return readPlacement(parent, key, index)
    }

    function readPlacement(parent, key, index) {
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
        const version = propertyVersions.getPlacementVersion(parent, key, operationContext)
        return readCaptured(value, version, index, present)
    }

    function readCaptured(value, version, index, present) {
        if (version) value = version.value
        if (!languageValues.isPending(value, operationContext)) return walkValue(value, index, present, version?.recovery)
        return propertyVersions.observePromiseVersion(
            value, version, operationContext,
            propertyValue => runTraversal(() => walkValue(propertyValue, index, version.present !== false, version.recovery)), owner,
        )
    }

    function walkValue(value, index, present, recovery) {
        if (onExternal && !errorUtils.isPoisonError(value) &&
            (index === externalDepth || metadata.metaOf(value, operationContext)?.type === languageValues.TYPE.External))
            return onExternal(value, path.slice(index), index)
        if (
            index === targetPath.length - 1 ||
            errorUtils.isPoisonError(value)
        ) {
            return onResolved(value, present, index, recovery)
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
        if (owner && !owner.open) return undefined
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
    walkObservationPath,
}
