const ignore = () => {}

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
                observeRejection(result)
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
    runSubscription(operationContext, () => { observeRejection(promise) })
}

function observeRejection(promise) {
    // No-op handlers own rejection even after fatality. They cannot throw or
    // assimilate a payload, so their returned chain needs no recursive observer.
    if (promise !== null && typeof promise === "object" &&
        !Error.isError(promise) && typeof promise.then === "function") {
        promise.then(ignore, ignore)
    }
}

export { runSubscription, markPromiseHandled }
