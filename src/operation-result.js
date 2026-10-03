import { createLeaseLedger, runReceivingCommand, exposeReadyDelivery, releaseDetached } from "./ownership.js"
import { failExecution, isFatalError, isPoisonError } from "./error.js"
import * as languageValues from "./language-values.js"
import { createPoisonedValue } from "./poisoned-value.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import { continueGraphTransition } from "./internal-step.js"

function runManagedOperation(operationContext, work) {
    return runReceivingCommand(operationContext, () => {
        const delivery = createLeaseLedger(operationContext)
        let issued = false
        delivery.capture = (value, sourceHeld = false) => sourceHeld && !issued ? value : delivery.acquire(value)
        try {
            const result = work(delivery)
            work = undefined
            issued = true
            return returnOperationResult(operationContext, result, delivery)
        } catch (failure) {
            delivery.release()
            throw failure
        }
    })
}

function returnOperationResult(operationContext, result, delivery) {
    if (isFatalError(result)) failExecution(operationContext, result)
    if (
        Error.isError(result) ||
        !languageValues.isPending(result, operationContext)
    ) {
        if (delivery) exposeReadyDelivery(delivery, operationContext)
        return result
    }

    const outward = returnPendingResult(operationContext, result, (value, resolve) => {
        delivery?.capture(value)
        resolve(value)
    })
    if (delivery) {
        const release = () => queueMicrotask(() => releaseDetached(operationContext, delivery.release))
        // Observe this exact Promise before exposing it. Direct receivers run
        // before the queued release; never return the observer's derived Promise.
        outward.then(release, release)
    }
    return outward
}

function returnExpressionResult(operationContext, result) {
    if (isFatalError(result)) failExecution(operationContext, result)
    if (isPoisonError(result)) return createPoisonedValue(result)
    if (!languageValues.isPending(result, operationContext)) return result
    return returnPendingResult(operationContext, result, (value, resolve, reject) => {
        // Pending failure uses the existing Promise, without a ready container.
        if (isPoisonError(value)) reject(value)
        else resolve(value)
    })
}

// Both outward contracts own the same pending fatal obligation. Only their
// final settlement differs. The source completes validation and graph work
// before delivering its normalized outcome to this boundary.
function returnPendingResult(operationContext, result, onFulfilled) {
    const execution = operationContext.execution
    return new Promise((resolve, reject) => {
        const unregister = execution.registerFatalResultRejection(reject)
        const fulfill = value => { unregister(); resolve(value) }
        const rejectResult = reason => { unregister(); reject(reason) }
        // The executor owns an escaping subscription failure as well as normal
        // delivery, so the outward Promise cannot be rejected and then lost.
        try {
            const bridge = continueGraphTransition(
                result,
                operationContext,
                value => onFulfilled(value, fulfill, rejectResult),
                rejectResult,
            )
            markPromiseHandled(bridge, operationContext)
        } catch (failure) {
            failExecution(operationContext, failure)
        }
    })
}

export { returnOperationResult, returnExpressionResult, runManagedOperation }
