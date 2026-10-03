import { metaOf } from "./meta.js"

const ignore = () => {}

// Errors, Functions, and already admitted values keep their language category.
// Only unadmitted non-Error objects need a thenability check.
function mayBeThenable(value, operationContext) {
    return value !== null && typeof value === "object" &&
        !Error.isError(value) && !metaOf(value, operationContext)
}

function markPromiseHandled(promise, operationContext) {
    // No-op handlers own rejection even after fatality. They cannot throw or
    // assimilate a payload, so their returned chain needs no recursive observer.
    if (mayBeThenable(promise, operationContext) && typeof promise.then === "function") {
        promise.then(ignore, ignore)
    }
}

export { mayBeThenable, markPromiseHandled }
