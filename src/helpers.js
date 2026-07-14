const {
    errorFromRejection,
    reportFatalError,
} = require("./error")

// Promise registration is part of the algorithm, not a convenience wrapper:
// - onValueResolve registers its handler synchronously at call time.
// - Rejection becomes the language Error node before the continuation runs.
// - Continuation throws and returned rejections go through reportFatalError;
//   they are not converted to language Error.
// - Runtime value continuations use onValueResolve; internal aggregate waits
//   use onInternalResolve. Runtime code must not use raw .then.
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

function isTracked(x) {
    return (
        x !== null &&
        typeof x === "object" &&
        !isPromise(x) &&
        !isError(x)
    )
}

function runFatal(fn, value) {
    try {
        const result = fn(value)
        return isPromise(result)
            ? Promise.resolve(result).then(value => value, reportFatalError)
            : result
    } catch (error) {
        return reportFatalError(error)
    }
}

// Rejected data promises arrive at fn as Error values. Exceptions thrown by fn
// and rejections returned by it are runtime bugs and go through reportFatalError.
function onValueResolve(promise, fn) {
    return Promise.resolve(promise).then(
        value => value,
        errorFromRejection,
    ).then(
        value => runFatal(fn, value),
        reportFatalError,
    )
}

// Internal promises already carry runtime failures, not language data
// rejections, so rejection is fatal instead of converted to Error.
function onInternalResolve(promise, fn) {
    return Promise.resolve(promise).then(
        value => runFatal(fn, value),
        reportFatalError,
    )
}

module.exports = {
    isError,
    isPromise,
    isTracked,
    onInternalResolve,
    onValueResolve,
}
