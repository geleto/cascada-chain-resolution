import { metaOf } from "./meta.js"

const ignore = () => {}

// Errors, Functions, and already admitted values keep their language category.
// Only unadmitted non-Error objects need a thenability check.
function mayBeThenable(value, operationContext) {
    return value !== null && typeof value === "object" &&
        !Error.isError(value) && !metaOf(value, operationContext)
}

function runSubscription(operationContext, subscribe) {
    let result
    try {
        result = subscribe()
    } finally {
        // Delivery of an older pending callback can fail this execution without
        // throwing from the current subscription: its own chain receives it.
        const fatal = operationContext.execution.fatalError
        if (fatal !== null) {
            try {
                observeRejection(result, operationContext)
            } finally {
                // The committed fatal supersedes a subscription or observation
                // exception already unwinding through either finally block.
                throw fatal
            }
        }
    }
    return result
}

function markPromiseHandled(promise, operationContext) {
    runSubscription(operationContext, () => { observeRejection(promise, operationContext) })
}

function observeRejection(promise, operationContext) {
    // No-op handlers own rejection even after fatality. They cannot throw or
    // assimilate a payload, so their returned chain needs no recursive observer.
    if (mayBeThenable(promise, operationContext) && typeof promise.then === "function") {
        promise.then(ignore, ignore)
    }
}

export { mayBeThenable, runSubscription, markPromiseHandled }
