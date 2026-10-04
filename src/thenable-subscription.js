import { metaOf } from "./meta.js"
import { failExecution, isFatalError, runExternalAction } from "./error.js"

const ignore = () => {}

// Errors, Functions, and already admitted values keep their language category.
// Only unadmitted non-Error objects need a thenability check.
function mayBeThenable(value, operationContext) {
    return value !== null && typeof value === "object" &&
        !Error.isError(value) && !metaOf(value, operationContext)
}

// Callers select eligible values and own lookup-failure classification. Only
// the native property read is external; protocol interpretation stays trusted.
function readCallableThen(value, operationContext) {
    const candidate = runExternalAction(operationContext, () => value.then)
    if (isFatalError(candidate)) failExecution(operationContext, candidate)
    // A non-callable Error is a successful probe, not a language result.
    return typeof candidate === "function" ? candidate : undefined
}

function markPromiseHandled(promise, operationContext) {
    // No-op handlers own rejection even after fatality. They cannot throw or
    // assimilate a payload, so their returned chain needs no recursive observer.
    if (mayBeThenable(promise, operationContext) && typeof promise.then === "function") {
        promise.then(ignore, ignore)
    }
}

export { mayBeThenable, markPromiseHandled, readCallableThen }
