import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"
import { runSubscription } from "./thenable-subscription.js"

const {
    TYPE,
    isTraversableType,
} = metadata

// Only normalized transition results and logical placements use this test.
function isPending(value, operationContext) {
    return value !== null && typeof value === "object" &&
        !Error.isError(value) && !metadata.metaOf(value, operationContext) &&
        typeof value.then === "function"
}

function thenValue(value, onFulfilled, onRejected, operationContext) {
    if (errorUtils.isFatalError(value))
        errorUtils.failExecution(operationContext, value)
    if (
        value === null || typeof value !== "object" || Error.isError(value) ||
            metadata.metaOf(value, operationContext)
    )
        return onFulfilled(value)

    const then = errorUtils.runExternalBoundary(
        operationContext,
        errorUtils.ERROR_KIND.ThenAccessFailed,
        () => {
            const candidate = value.then
            if (errorUtils.isFatalError(candidate)) throw candidate
            // A non-callable Error is a successful protocol probe, not a language result.
            return typeof candidate === "function" ? candidate : undefined
        },
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
        return runSubscription(operationContext, () =>
            Reflect.apply(then, value, [
                deliver(onFulfilled),
                deliver(onRejected),
            ]),
        )
    } catch (reason) {
        if (continuationStarted) throw reason
        return onRejected(
            errorUtils.createPoisonError(
                reason,
                operationContext,
                errorUtils.ERROR_KIND.ThenInvocationFailed,
            ),
        )
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
    if (typeof value === "string") return TYPE.String
    if (!metadata.isObjectLike(value)) return TYPE.Primitive
    const type = metadata.metaOf(value, operationContext)?.type
    if (type === undefined) throw new TypeError("Value was not admitted")
    return type
}

function isTraversable(value, operationContext) {
    return isTraversableType(metadata.metaOf(value, operationContext)?.type)
}

export {
    TYPE,
    admitReadyValue,
    isPending,
    isTraversable,
    isTraversableType,
    thenValue,
    typeOf,
}
