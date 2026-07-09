// Promise registration is part of the algorithm, not a convenience wrapper:
// - onResolve registers its handler synchronously at call time.
// - Rejection becomes the language Error node before the continuation runs.
// - Continuation throws stay fatal; they are not converted to language Error.
// - All runtime continuations must use this helper, never raw .then.
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

function isArray(x) {
    return Array.isArray(x)
}

// Rejected data promises arrive at fn as Error values. Exceptions thrown by fn
// are runtime bugs and are intentionally not caught here.
function onResolve(promise, fn) {
    return Promise.resolve(promise).then(
        value => value,
        reason => reason instanceof Error ? reason : new Error(String(reason)),
    ).then(value => fn(value))
}

module.exports = {
    isArray,
    isError,
    isPromise,
    isTracked,
    onResolve,
}
