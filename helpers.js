// Promise registration is part of the algorithm, not a convenience wrapper:
// - settlePromise must register its handler synchronously at call time.
// - It never rejects; rejection becomes the language Error node.
// - All runtime continuations must use this one wrapper layer, never raw .then.
// - Data objects with a callable `then` are treated as promises by JS and by
//   this kernel; ordinary language data must not rely on callable `then` keys.
function isPromise(x) {
    return (
        x !== null &&
        (typeof x === "object" || typeof x === "function") &&
        typeof x.then === "function"
    )
}

function settlePromise(promise) {
    return Promise.resolve(promise).then(
        value => value,
        reason => reason instanceof Error ? reason : new Error(String(reason)),
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
    return settlePromise(promise).then(value => fn(value))
}

function propagateClean() {
    // CLEAN is intentionally not implemented in this testable kernel.
}

function updateCleanCounts() {
    // CLEAN is intentionally not implemented in this testable kernel.
}

module.exports = {
    isArray,
    isError,
    isPromise,
    isTracked,
    onResolve,
    propagateClean,
    settlePromise,
    updateCleanCounts,
}
