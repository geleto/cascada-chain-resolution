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
import { ArrayView, isArrayView } from "./array-view.js"
import { consumeArrayValue, MAX_ARRAY_LENGTH } from "./array-layout.js"
import { chainFromPlacement } from "./chain.js"

const SHALLOW = 0, ANY = 1, COLLECT = 2

class ErrorQueryWork extends PathOperation {
    // The initial part keeps synchronous discovery open while pending children
    // register. Each completed part discovers its descendants before retiring.
    pendingParts = 1

    constructor(chain, path, operationContext, firstDynamicSegment, kind) {
        super(chain, path, operationContext, undefined, false, firstDynamicSegment, path.length, true)
        this.deep = kind !== SHALLOW
        if (kind === COLLECT) this.errors = new Set()
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
            const captured = this.metadata.collect(selected, error => this.found(error), true, this.deep)
            this.wait(captured)
            this.completeExternalEffect()
            return this.open ? this.inspectValue(value) : this.result
        }
        const result = this.observe(inspect,
            access => {
                if (!access.boundary && access.start < access.end) {
                    const inspect = value => {
                        this.completeExternalEffect()
                        return this.inspectValue(value)
                    }
                    return this.deep ? access.read(false, inspect) : access.readValue(inspect)
                }
                return this.inspectValue(undefined)
            },
            error => this.settle(error), errorUtils.ERROR_KIND.QueryReflectionFailed)
        return internalSteps.continueGraphTransition(result, this.operationContext,
            value => this.open && errorUtils.isPoisonError(value) ? this.inspectValue(value) : value)
    }
    inspectValue(value) {
        if (errorUtils.isPoisonError(value)) this.found(value)
        if (!this.open) return this.result
        if (this.deep && languageValues.isTraversable(value, this.operationContext)) collectFencedErrors(value, this)
        this.completePart()
        return this.open ? new Promise(resolve => { this.resolveOutcome = resolve }) : this.result
    }
    found(error) {
        if (!this.open) return
        // A virtual slot can prove poison while the exact cause is pending.
        if (!this.errors) return this.settle(true)
        if (error) this.errors.add(error)
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
        this.settle(this.errors ? this.errors.size ? errorUtils.combineErrors(this.errors, this.operationContext) : null : false)
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

function capturePath(chain, path, ctx, mode = chain._mode, firstDynamicSegment = path.length) {
    const operation = new PathOperation(chain, path, ctx, undefined, false, firstDynamicSegment)
    let gate
    const receive = placement => {
        if (!gate) return chainFromPlacement(placement, ctx, mode)
        const destination = gate
        gate = undefined
        return propertyVersions.consumePlacementTransition(placement, ctx, ready =>
            propertyVersions.completePlacementGate(destination, ready, ctx))
    }
    const value = result => receive({ value: result, present: true })
    const selected = operation.finish(operation.observe(value, access => access.read(false, value),
        undefined, errorUtils.ERROR_KIND.LookupReflectionFailed, receive))
    if (!languageValues.isPending(selected, ctx)) return errorUtils.isPoisonError(selected) ? value(selected) : selected
    const empty = { value: undefined, present: true }, holder = chainFromPlacement(empty, ctx, mode)
    gate = propertyVersions.installPlacementGate(holder._state, "value", ctx, empty)
    markPromiseHandled(internalSteps.continueGraphTransition(selected, ctx, result => {
        if (errorUtils.isPoisonError(result)) value(result)
    }), ctx)
    return holder
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
    return new ErrorQueryWork(chain, path, operationContext, firstDynamicSegment, ANY).run()
}

function isPoisoned(chain, path, operationContext, firstDynamicSegment = path.length) {
    return new ErrorQueryWork(chain, path, operationContext, firstDynamicSegment, SHALLOW).run()
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path, operationContext, firstDynamicSegment = path.length) {
    return new ErrorQueryWork(chain, path, operationContext, firstDynamicSegment, COLLECT).run()
}

// The fenced walk follows only nodes whose counters contain relevant
// work. A cut blocks count propagation, but its indexed target resumes this
// same walk through the operation-wide visited set.
function collectFencedErrors(value, queryWork) {
    const ctx = queryWork.operationContext
    let unindexed = false
    queryWork.visited ??= new WeakMap()
    try { walk(value) } finally { value = undefined }

    function walk(node) {
        const identity = captureIdentity(node, queryWork.operationContext)
        if (!queryWork.open || !visitRepresentation(node, identity, queryWork.visited)) return

        if (queryWork.errors)
            queryWork.wait(consumeArrayValue(node, queryWork, inspect, error => queryWork.found(error)))
        else if (isArrayView(node, ctx) && ArrayView.minimumLength(node, ctx) > MAX_ARRAY_LENGTH) queryWork.found()
        else inspect(node)
    }

    function inspect(node) {
        try {
            return errorUtils.catchExternalThrow(() => scan(node), ctx, errorUtils.ERROR_KIND.QueryReflectionFailed,
                failure => queryWork.settle(failure))
        } finally { node = undefined }
    }

    function scan(node) {
        if (!unindexed) unindexed = refcounts.buildRefIndex(node, ctx, withinLimit) === false
        const counter = unindexed ? refcounts.getRefCounter(node, ctx) : refcounts.getRequiredRefCounter(node, ctx)
        // hasError needs only this proof; getErrors needs Error identities.
        if (queryWork.errors === undefined && counter?.errorCount > 0) {
            queryWork.found()
            return
        }
        if (counter && !hasErrorSearchWork(counter)) return

        for (const key of languageProperties.enumerableLanguageKeys(
            node,
            queryWork.operationContext, 0, undefined, undefined, true,
        )) {
            if (!queryWork.open) break
            const placement = languageProperties.readLanguagePlacement(
                node,
                key,
                queryWork.operationContext,
            )
            visit(placement)
        }
        for (const range of ArrayView.implicitRanges(node, queryWork.operationContext)) {
            if (!queryWork.open) break
            queryWork.wait(range.region.visit(range, queryWork, visit, error => queryWork.found(error)))
        }
    }

    function withinLimit(child) {
        return !isArrayView(child, ctx) || ArrayView.maximumLength(child, ctx) <= MAX_ARRAY_LENGTH
    }

    function visit(placement) {
        const child = propertyVersions.placementValue(placement)
        if (errorUtils.isPoisonError(child)) queryWork.found(child)
        else if (languageValues.isPending(child, queryWork.operationContext)) collectPromiseErrors(placement)
        else if (languageValues.isTraversable(child, queryWork.operationContext)) {
            walk(child)
        }
    }

    function collectPromiseErrors(placement) {
        const wait = propertyVersions.observePlacement(
            placement,
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
    capturePath,
    exportPath,
    getErrors,
    hasError,
    isPoisoned,
    lookupPath,
    lookupPathForExpression,
}
