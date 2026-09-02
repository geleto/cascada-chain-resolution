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

function isPromise(value, operationContext) {
    return !isError(value) && capturedThenableOf(value, operationContext) !== undefined
}

// Reading `then` may invoke a getter or Proxy trap. The first sample
// permanently fixes this object's Promise behavior; acquisition failure is a
// rejection, and a callable is captured exactly once.
function capturedThenableOf(value, operationContext) {
    if (!metadata.isObjectLike(value)) return undefined
    if (metadata.metaOf(value, operationContext)) return undefined
    return captureThenable(value, operationContext.execution._thenables, operationContext)
}

function captureThenable(value, thenables, operationContext = undefined) {
    if (!metadata.isObjectLike(value)) return undefined
    if (thenables.has(value)) return thenables.get(value)
    const captured = errorUtils.catchUserCodeFailure(
        () => {
            const then = errorUtils.runUserCode(() => value.then)
            return typeof then === "function" ? { then } : undefined
        },
        rejection => ({
            // Acquisition failure belongs to the operation that first sampled it.
            acquisitionOperationContext: operationContext,
            then: (_resolve, reject) => reject(rejection),
        }),
    )
    thenables.set(value, captured)
    return captured
}

function continuePromise(value, operationContext, onFulfilled, onRejected) {
    const captured = capturedThenableOf(value, operationContext)
    if (!captured) {
        errorUtils.reportFatalError(
            new TypeError("Value is not a captured Promise"),
        )
    }

    // A local native Promise already is the FIFO queue. Register directly so
    // its reaction keeps that queue position; failed registration runs the
    // rejection continuation synchronously because no reaction was installed.
    if (
        captured.canonical === undefined &&
        captured.then === Promise.prototype.then
    ) {
        return errorUtils.catchUserCodeFailure(
            () => errorUtils.runUserCode(() => Reflect.apply(
                captured.then,
                value,
                [onFulfilled, onRejected],
            )),
            onRejected,
        )
    }
    if (captured.canonical === undefined) {
        const { promise, resolve, reject } = Promise.withResolvers()
        captured.canonical = promise
        // Invocation failure belongs to the first operation that invokes it.
        captured.invocationOperationContext = operationContext
        errorUtils.catchUserCodeFailure(
            () => errorUtils.runUserCode(() => Reflect.apply(
                captured.then,
                value,
                [resolve, reject],
            )),
            reject,
        )
    }
    return captured.canonical.then(onFulfilled, onRejected)
}

function isError(value) {
    return Error.isError(value)
}

function admitValue(value, operationContext) {
    if (!isPromise(value, operationContext)) admitReadyValue(value, operationContext)
}

// Thenability has already been sampled at this program position. Ready-value
// admission always preserves the value and creates complete typed metadata.
function admitReadyValue(
    value,
    operationContext,
    knownType = undefined,
    knownAdmittedPrototype = undefined,
) {
    if (metadata.isObjectLike(value)) {
        metadata.getOrCreateMeta(
            value,
            operationContext,
            knownType,
            knownAdmittedPrototype,
        )
    }
}

function typeOf(value, operationContext) {
    if (typeof value === "string") return TYPE_STRING
    if (!metadata.isObjectLike(value)) return TYPE_PRIMITIVE
    const type = metadata.metaOf(value, operationContext)?.type
    if (type === undefined) {
        errorUtils.reportFatalError(
            new TypeError("Value was not admitted"),
        )
    }
    return type
}

function isTraversable(value, operationContext) {
    const type = metadata.metaOf(value, operationContext)?.type
    return isTraversableType(type)
}

function createPromiseProbe() {
    // One declaration may reach an identity through validation and aliases.
    // Sample an effectful `then` only once without entering an execution cache.
    const thenables = new WeakMap()
    return value => !isError(value) &&
        captureThenable(value, thenables) !== undefined
}

export {
    TYPE_ARRAY,
    TYPE_ERROR,
    TYPE_EXTERNAL,
    TYPE_FUNCTION,
    TYPE_MANAGED_CLASS,
    TYPE_PRIMITIVE,
    TYPE_RECORD,
    TYPE_STRING,
    admitReadyValue,
    admitValue,
    continuePromise,
    createPromiseProbe,
    isError,
    isPromise,
    isTraversable,
    isTraversableType,
    typeOf,
}
