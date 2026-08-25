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

const CAPTURED_THENABLES = new WeakMap()

function isPromise(value) {
    return !isError(value) && capturedThenableOf(value) !== undefined
}

// Reading `then` may invoke a getter or Proxy trap. The first sample
// permanently fixes this object's Promise behavior; acquisition failure is a
// rejection, and a callable is captured exactly once.
function capturedThenableOf(value) {
    if (!metadata.isObjectLike(value)) return undefined
    if (metadata.metaOf(value)) return undefined

    if (CAPTURED_THENABLES.has(value)) return CAPTURED_THENABLES.get(value)
    const captured = errorUtils.catchUserCodeFailure(
        () => {
            const then = errorUtils.runUserCode(() => value.then)
            return typeof then === "function" ? { then } : undefined
        },
        rejection => ({
            then: (_resolve, reject) => reject(rejection),
        }),
    )
    CAPTURED_THENABLES.set(value, captured)
    return captured
}

function continuePromise(value, onFulfilled, onRejected) {
    const captured = capturedThenableOf(value)
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
    const type = metadata.metaOf(value)?.type
    return type === TYPE_ERROR || (
        type === undefined && Error.isError(value)
    )
}

function admitValue(value) {
    if (!isPromise(value)) admitReadyValue(value)
}

// Thenability has already been sampled at this program position. Ready-value
// admission always preserves the value and creates complete typed metadata.
function admitReadyValue(
    value,
    knownType = undefined,
    knownPrototype = undefined,
) {
    if (metadata.isObjectLike(value)) {
        metadata.getOrCreateMeta(value, knownType, knownPrototype)
    }
}

function typeOf(value) {
    if (typeof value === "string") return TYPE_STRING
    if (!metadata.isObjectLike(value)) return TYPE_PRIMITIVE
    const type = metadata.metaOf(value)?.type
    if (type === undefined) {
        errorUtils.reportFatalError(
            new TypeError("Value was not admitted"),
        )
    }
    return type
}

function isTraversable(value) {
    const type = metadata.metaOf(value)?.type
    return isTraversableType(type)
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
    isError,
    isPromise,
    isTraversable,
    isTraversableType,
    typeOf,
}
