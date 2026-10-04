import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"
import { mayBeThenable, readCallableThen } from "./thenable-subscription.js"

// Only normalized transition results and logical placements use this test.
function isPending(value, operationContext) {
    return mayBeThenable(value, operationContext) && typeof value.then === "function"
}

function thenValue(value, onFulfilled, onRejected, operationContext) {
    if (errorUtils.isFatalError(value))
        errorUtils.failExecution(operationContext, value)
    if (!mayBeThenable(value, operationContext)) return onFulfilled(value)

    const then = errorUtils.catchExternalThrow(
        () => readCallableThen(value, operationContext),
        operationContext,
        errorUtils.ERROR_KIND.ThenAccessFailed,
    )
    if (errorUtils.isPoisonError(then)) return onRejected(then)
    if (then === undefined) return onFulfilled(value)

    let continuationStarted = false
    const deliver = callback => result => {
        // Distinguish a continuation escape from a failure of the then body.
        // Readiness is determined only by the returned transition result.
        continuationStarted = true
        if (operationContext.execution.fatalError !== null) return undefined
        if (errorUtils.isFatalError(result))
            errorUtils.failExecution(operationContext, result)
        return callback(result)
    }
    try {
        return Reflect.apply(then, value, [deliver(onFulfilled), deliver(onRejected)])
    } catch (reason) {
        if (continuationStarted) throw reason
        return onRejected(errorUtils.createPoisonError(
            reason, operationContext, errorUtils.ERROR_KIND.ThenInvocationFailed))
    }
}

function admitReadyValue(
    value,
    operationContext,
    knownType,
    knownAdmittedPrototype,
) {
    if (errorUtils.isFatalError(value))
        errorUtils.failExecution(operationContext, value)
    if (Error.isError(value) && !errorUtils.isPoisonError(value)) {
        throw new TypeError(
            "Raw Error reached admission without a causal boundary",
        )
    }
    if (metadata.isObjectLike(value))
        metadata.getOrCreateMeta(value, operationContext, knownType, knownAdmittedPrototype)
}

function typeOf(value, operationContext) {
    if (typeof value === "string") return metadata.TYPE.String
    if (!metadata.isObjectLike(value)) return metadata.TYPE.Primitive
    const type = metadata.metaOf(value, operationContext)?.type
    if (type === undefined) throw new TypeError("Value was not admitted")
    return type
}

function isTraversable(value, operationContext) {
    return metadata.isTraversableType(metadata.metaOf(value, operationContext)?.type)
}

export {
    admitReadyValue,
    isPending,
    isTraversable,
    thenValue,
    typeOf,
}

export { TYPE, isTraversableType } from "./meta.js"
