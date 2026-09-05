import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"

const {
    TYPE_ARRAY,
    TYPE_ERROR,
    TYPE_EXTERNAL,
    TYPE_FUNCTION,
    TYPE_MANAGED_CLASS,
    TYPE_PRIMITIVE,
    TYPE_RECORD,
    TYPE_STRING,
    isTraversableType,
} = metadata

// Only normalized transition results and logical placements use this test.
// Raw inputs are consumed below, at their causal boundary. Validation-only
// callers may inspect prohibited thenables under their own host envelope,
// without invoking them.
function isPending(value, operationContext) {
    return value !== null && typeof value === "object" &&
        !Error.isError(value) && !metadata.metaOf(value, operationContext) &&
        typeof value.then === "function"
}

function consumeValue(value, operationContext, onFulfilled, onRejected) {
    const fulfilled = guardContinuation(operationContext, onFulfilled)
    const rejected = guardContinuation(operationContext, onRejected)
    if (errorUtils.isFatalError(value)) throw value
    if (value === null || typeof value !== "object" || Error.isError(value) ||
        metadata.metaOf(value, operationContext)) return fulfilled(value)

    let then
    try {
        then = errorUtils.catchUserCodeFailure(
            () => errorUtils.runUserCode(() => value.then),
            operationContext,
            errorUtils.ERROR_KIND.ThenAccessThrew,
            failure => { throw failure },
        )
    } catch (failure) {
        if (errorUtils.isFatalError(failure)) throw failure
        return rejected(failure)
    }
    if (typeof then !== "function") return fulfilled(value)

    // The source owns FIFO scheduling. In particular, its supplied callback
    // must run outside the generic host-code re-entry guard.
    try {
        return Reflect.apply(then, value, [fulfilled, rejected])
    } catch (reason) {
        if (errorUtils.isFatalError(reason)) throw reason
        return rejected(errorUtils.toPoison(
            reason, operationContext, errorUtils.ERROR_KIND.ThenInvocationThrew,
        ))
    }
}

function guardContinuation(operationContext, continuation) {
    return value => operationContext.execution.fatalError === null
        ? continuation(value)
        : undefined
}

function valueWithOrigin(value, operationContext, valueKind, rejectionKind) {
    // A language rejection delivered inside then returns its ready Error.
    // Deferred delivery throws from its callback and rejects the source chain.
    try {
        return consumeValue(
            value,
            operationContext,
            resolved => errorUtils.runOrFailExecution(operationContext, () => {
                if (errorUtils.isFatalError(resolved)) throw resolved
                return Error.isError(resolved)
                    ? errorUtils.toPoison(resolved, operationContext, valueKind)
                    : resolved
            }),
            reason => {
                throw errorUtils.runOrFailExecution(operationContext, () => {
                    const failure = errorUtils.toPoison(reason, operationContext, rejectionKind)
                    if (errorUtils.isFatalError(failure)) throw failure
                    return failure
                })
            },
        )
    } catch (failure) {
        if (failure instanceof errorUtils.PoisonError) return failure
        throw failure
    }
}

function isError(value) {
    return Error.isError(value) && !errorUtils.isFatalError(value)
}

function admitReadyValue(
    value,
    operationContext,
    knownType = undefined,
    knownAdmittedPrototype = undefined,
) {
    if (errorUtils.isFatalError(value)) throw value
    if (metadata.isObjectLike(value)) {
        metadata.getOrCreateMeta(value, operationContext, knownType, knownAdmittedPrototype)
    }
}

function typeOf(value, operationContext) {
    if (typeof value === "string") return TYPE_STRING
    if (!metadata.isObjectLike(value)) return TYPE_PRIMITIVE
    const type = metadata.metaOf(value, operationContext)?.type
    if (type === undefined) {
        throw new TypeError("Value was not admitted")
    }
    return type
}

function isTraversable(value, operationContext) {
    const type = metadata.metaOf(value, operationContext)?.type
    return isTraversableType(type)
}

export {
    TYPE_ARRAY, TYPE_ERROR, TYPE_EXTERNAL, TYPE_FUNCTION, TYPE_MANAGED_CLASS,
    TYPE_PRIMITIVE, TYPE_RECORD, TYPE_STRING,
    admitReadyValue, consumeValue, isError, isPending, isTraversable,
    isTraversableType, typeOf, valueWithOrigin,
}
