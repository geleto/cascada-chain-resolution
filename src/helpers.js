import * as errorUtils from "./error.js"

const CANONICAL_PROMISES = new WeakMap()

// Promise registration is part of the algorithm, not a convenience wrapper:
// - Every callable thenable is canonicalized once to one native Promise.
// - Each helper registers its handler synchronously on that shared FIFO queue.
// - Rejection becomes the language Error node before the continuation runs.
// - Synchronous continuation throws go through reportFatalError.
// - Initial property resolvers use onInitialPromiseResolve; later property
//   resolvers use onLaterPromiseReady; aggregate waits use onAllPromisesReady.
// - Runtime code must not use raw .then.
// - Data objects with a callable `then` are treated as promises by JS and by
//   this kernel; ordinary language data must not rely on callable `then` keys.
function isPromise(x) {
    return (
        x !== null &&
        (typeof x === "object" || typeof x === "function") &&
        typeof x.then === "function"
    )
}

function isError(x) {
    return x instanceof Error
}

// Includes arrays, plain objects, frozen objects, and class instances.
function isTracked(x) {
    return (
        x !== null &&
        typeof x === "object" &&
        !isPromise(x) &&
        !isError(x)
    )
}

// Catch only the synchronous body. Data-Promise rejection belongs to
// onInitialPromiseResolve; aggregate rejection belongs to onAllPromisesReady.
function runFatal(fn, value = undefined) {
    try {
        return fn(value)
    } catch (error) {
        return errorUtils.reportFatalError(error)
    }
}

function getCanonicalPromise(promise) {
    let canonical = CANONICAL_PROMISES.get(promise)
    if (!canonical) {
        canonical = Promise.resolve(promise)
        CANONICAL_PROMISES.set(promise, canonical)
    }
    return canonical
}

// The initial resolver receives fulfillment or a rejection converted to a
// language Error. Exceptions thrown by fn are fatal runtime bugs.
function onInitialPromiseResolve(promise, fn) {
    return getCanonicalPromise(promise).then(
        value => runFatal(fn, value),
        reason => {
            let value
            try {
                value = errorUtils.errorFromRejection(reason)
            } catch (error) {
                return errorUtils.reportFatalError(error)
            }
            return runFatal(fn, value)
        },
    )
}

// The first resolver has already converted and published either fulfillment or
// rejection. Later resolvers use the source only as a FIFO readiness signal.
function onLaterPromiseReady(promise, fn) {
    const onReady = () => runFatal(fn)
    return getCanonicalPromise(promise).then(onReady, onReady)
}

// Callers pass the Promise.all readiness tree for their captured frontier.
// The result is not data; fulfillment calls fn without a readiness payload,
// while rejection is an internal failure and remains fatal.
function onAllPromisesReady(promise, fn) {
    return getCanonicalPromise(promise).then(
        () => runFatal(fn),
        errorUtils.reportFatalError,
    )
}

// Operation callback completion is control flow rather than language data.
// A Promise result stays on the canonical FIFO queue; rejection first lets the
// owner close its scope, then remains fatal rather than becoming language data.
function runOperationCallback(
    callback,
    argument,
    onFulfilled,
    onRejected,
) {
    let result
    try {
        result = callback(argument)
    } catch (error) {
        onRejected(error)
        throw error
    }
    if (!isPromise(result)) return onFulfilled(result)

    return getCanonicalPromise(result).then(
        value => runFatal(onFulfilled, value),
        reason => {
            runFatal(onRejected, reason)
            return errorUtils.reportFatalError(reason)
        },
    )
}

export {
    isError,
    isPromise,
    isTracked,
    onAllPromisesReady,
    onInitialPromiseResolve,
    onLaterPromiseReady,
    runOperationCallback,
    runFatal,
}
