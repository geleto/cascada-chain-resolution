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

class ErrorQueryWork extends PathOperation {
    // The initial part keeps synchronous discovery open while pending children
    // register. Each completed part discovers its descendants before retiring.
    pendingParts = 1

    constructor(chain, path, operationContext, firstDynamicSegment, collect = false) {
        super(chain, path, operationContext, undefined, false, firstDynamicSegment, path.length, true)
        if (collect) this.errors = new Set()
    }
    release() {
        super.release()
        this.errors = undefined
        this.resolveOutcome = undefined
        this.visited = undefined
    }
    run() {
        const inspect = (value, present, depth) => {
            if (errorUtils.isPoisonError(value) && (depth !== this.route.path.length || !this.errors)) return this.settle(value)
            const selected = this.metadataNode()
            if (!selected) return this.inspectValue(value)
            const captured = this.metadata.collect(selected, error => this.found(error))
            this.wait(captured)
            this.completeExternalEffect()
            return this.open ? this.inspectValue(value) : this.result
        }
        const result = this.observe(inspect,
            access => {
                if (!access.boundary && access.start < access.end) return access.read(false, value => {
                    this.completeExternalEffect()
                    return this.inspectValue(value)
                })
                return this.inspectValue(undefined)
            },
            error => this.settle(error), errorUtils.ERROR_KIND.QueryReflectionFailed)
        return internalSteps.continueGraphTransition(result, this.operationContext,
            value => this.open && errorUtils.isPoisonError(value) ? this.inspectValue(value) : value)
    }
    inspectValue(value) {
        if (errorUtils.isPoisonError(value)) this.found(value)
        if (!this.open) return this.result
        if (languageValues.isTraversable(value, this.operationContext)) collectFencedErrors(value, this)
        this.completePart()
        return this.open ? new Promise(resolve => { this.resolveOutcome = resolve }) : this.result
    }
    found(error) {
        if (!this.open) return
        if (this.errors) this.errors.add(error)
        else this.settle(true)
    }
    settle(result) {
        if (!this.open) return this.result
        if (!this.errors && errorUtils.isPoisonError(result)) result = true
        this.result = result
        const resolve = this.resolveOutcome
        this.completeExternalEffect()
        this.close()
        resolve?.(result)
        return result
    }
    wait(readiness) {
        if (!languageValues.isPending(readiness, this.operationContext)) return
        if (!this.open) { markPromiseHandled(readiness, this.operationContext); return }
        this.pendingParts++
        const completed = internalSteps.continueGraphTransition(
            readiness,
            this.operationContext,
            () => this.completePart(),
            undefined,
            this,
        )
        markPromiseHandled(completed, this.operationContext)
    }
    completePart() {
        if (!this.open || --this.pendingParts) return
        this.settle(this.errors ? this.errors.size ? errorUtils.combineErrors(this.errors) : null : false)
    }
}

// --- lookupPath :  = a.k.y --------------------------------------------------
function lookupPath(chain, path, operationContext, firstDynamicSegment = path.length, delivery) {
    const operation = new PathOperation(chain, path, operationContext, undefined, false, firstDynamicSegment)
    const retain = value => {
        return delivery ? delivery.capture(value, true) : value
    }
    return operation.finish(operation.observe(retain, access =>
        access.read(false, value => delivery ? delivery.capture(value) : value)))
}

function lookupPathForExpression(chain, path, operationContext, firstDynamicSegment = path.length) {
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
    return operation.finish(operation.observe(validate, access => access.readValue(validate)))
}

// --- export : host-ready settled snapshot of a branch -----------------------
function exportPath(chain, path, operationContext, firstDynamicSegment = path.length) {
    const operation = new PathOperation(chain, path, operationContext, undefined, false, firstDynamicSegment)
    return operation.finish(operation.observe(
        value => exportValue(value, operation),
        access => access.read(true),
    ))
}

// --- hasError : query whether a path or branch contains an Error -------------
function hasError(chain, path, operationContext, firstDynamicSegment = path.length) {
    return new ErrorQueryWork(chain, path, operationContext, firstDynamicSegment).run()
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path, operationContext, firstDynamicSegment = path.length) {
    return new ErrorQueryWork(chain, path, operationContext, firstDynamicSegment, true).run()
}

// The fenced walk follows only nodes whose counters contain relevant
// work. A cut blocks count propagation, but its indexed target resumes this
// same walk through the operation-wide visited set.
function collectFencedErrors(value, queryWork) {
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

        for (const key of languageProperties.enumerableLanguageKeys(
            node,
            queryWork.operationContext,
        )) {
            if (!queryWork.open) break
            const placement = languageProperties.readLanguagePlacement(
                node,
                key,
                queryWork.operationContext,
            )
            const child = propertyVersions.placementValue(placement)

            if (errorUtils.isPoisonError(child)) {
                queryWork.found(child)
            } else if (languageValues.isPending(child, queryWork.operationContext)) {
                collectPromiseErrors(placement)
            } else if (languageValues.isTraversable(child, queryWork.operationContext)) {
                walk(child)
            }
        }
    }

    function collectPromiseErrors(placement) {
        const wait = propertyVersions.observePromiseVersion(
            placement.value,
            placement.sourceVersion,
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

                collectFencedErrors(value, queryWork)
            },
            queryWork,
        )
        queryWork.wait(wait)
    }
}

function hasErrorSearchWork(counter) {
    return counter.frontierCount > 0 || counter.errorCount > 0
}

export {
    exportPath,
    getErrors,
    hasError,
    lookupPath,
    lookupPathForExpression,
}
