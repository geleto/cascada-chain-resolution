import { captureIdentity, visitRepresentation } from "./captured-identity.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import * as errorUtils from "./error.js"
import { exportValue } from "./export.js"
import * as internalSteps from "./internal-step.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as refcounts from "./refcounts.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import { PathOperation } from "./path-operation.js"
import * as externalTree from "./external-mutation-tree.js"

class ErrorQueryWork extends PathOperation {
    constructor(chain, path, operationContext, firstDynamicSegment, collect = false) {
        super(chain, path, operationContext, undefined, false, firstDynamicSegment)
        if (collect) this.errors = new Set()
    }
    release() {
        super.release()
        if (this.externalReadiness) markPromiseHandled(this.externalReadiness, this.operationContext)
        this.externalReadiness = undefined
        this.errors = undefined
        this.resolveOutcome = undefined
        this.visited = undefined
    }
    run() {
        const node = this.route.externalTreeNode
        this.reserveExternal(node)
        const inspect = value => {
            if (errorUtils.isPoisonError(value) || !node) return this.inspectValue(value)
            const effect = this.externalEffect
            // External metadata capture has its own last use. Managed
            // Error collection may finish earlier, or continue much longer.
            this.externalEffect = undefined
            const captured = internalSteps.continueGraphTransition(effect.readiness, this.operationContext, () => {
                if (this.open) {
                    const blocker = this.externalBlocker(false)
                    if (blocker) this.found(blocker)
                    else for (const error of externalTree.collectPoison(node)) this.found(error)
                }
                effect.complete()
            })
            if (languageValues.isPending(captured, this.operationContext)) this.externalReadiness = captured
            return this.open ? this.inspectValue(value) : this.result
        }
        const result = this.observe(inspect,
            access => access.validatePath() ?? this.complete(undefined, () => this.errors ? null : false),
            error => this.settle(error), errorUtils.ERROR_KIND.QueryReflectionFailed)
        return internalSteps.continueGraphTransition(result, this.operationContext,
            value => this.open && errorUtils.isPoisonError(value) ? this.inspectValue(value) : value)
    }
    inspectValue(value) {
        if (errorUtils.isPoisonError(value)) return this.settle(this.errors ? value : true)
        const readiness = languageValues.isTraversable(value, this.operationContext)
            ? collectFencedErrorWaits(value, this) : undefined
        return this.complete(readiness, () => {
            if (!this.errors) return false
            return this.errors.size ? errorUtils.combineErrors(this.errors, "Errors in queried value") : null
        })
    }
    found(error) {
        if (!this.open) return
        if (this.errors) this.errors.add(error)
        else this.settle(true)
    }
    settle(result) {
        if (!this.open) return this.result
        this.result = result
        const resolve = this.resolveOutcome
        this.completeExternalEffect()
        this.close()
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
            return this.settle(result())
        const outcome = new Promise(resolve => {
            this.resolveOutcome = resolve
        })
        const completed = internalSteps.continueGraphTransition(
            readiness,
            this.operationContext,
            () => this.settle(result()),
            undefined,
            this,
        )
        // settle owns both early completion and traversal exhaustion.
        markPromiseHandled(completed, this.operationContext)
        return outcome
    }
}

// --- lookupPath :  = a.k.y --------------------------------------------------
function lookupPath(chain, path, operationContext, firstDynamicSegment = path.length, delivery) {
    return internalSteps.runInternalStep(operationContext, () => {
        const operation = new PathOperation(chain, path, operationContext, undefined, false, firstDynamicSegment)
        const retain = value => {
            return delivery ? delivery.capture(value, true) : value
        }
        return operation.finish(operation.observe(retain, access =>
            access.read(false, value => delivery ? delivery.capture(value) : value)))
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
            internalSteps.continueGraphTransition(access.read(), operationContext, validate)))
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
    return internalSteps.runInternalStep(operationContext, () =>
        new ErrorQueryWork(chain, path, operationContext, firstDynamicSegment).run())
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path, operationContext, firstDynamicSegment = path.length) {
    return internalSteps.runInternalStep(operationContext, () =>
        new ErrorQueryWork(chain, path, operationContext, firstDynamicSegment, true).run())
}

// The fenced walk follows only nodes whose counters contain relevant
// work. A cut blocks count propagation, but its indexed target resumes this
// same walk through the operation-wide visited set.
function collectFencedErrorWaits(value, queryWork) {
    const waits = []
    try {
        errorUtils.catchExternalThrow(
            () => {
                refcounts.buildRefIndex(value, queryWork.operationContext)
                queryWork.visited ??= new WeakMap()
                walk(value)
            },
            queryWork.operationContext,
            errorUtils.ERROR_KIND.QueryReflectionFailed,
            failure => queryWork.settle(failure),
        )
    } finally { value = undefined }
    // A synchronous Error proof abandons observed waits, not an aggregate.
    if (!queryWork.open) {
        for (const wait of waits) markPromiseHandled(wait, queryWork.operationContext)
        return undefined
    }
    return waits.length > 1 ? Promise.all(waits) : waits[0]

    function walk(node) {
        const identity = captureIdentity(node, queryWork.operationContext)
        if (!queryWork.open || !visitRepresentation(node, identity, queryWork.visited)) return

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

export {
    exportPath,
    getErrors,
    hasError,
    lookupPath,
    lookupPathForExpression,
}
