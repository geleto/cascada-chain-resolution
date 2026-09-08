import { failExecution, isFatalError, isPoisonError } from "./error.js"
import * as languageValues from "./language-values.js"
import { createPoisonedValue } from "./poisoned-value.js"
import { markPromiseHandled } from "./thenable-subscription.js"

function returnOperationResult(operationContext, result) {
    if (isFatalError(result)) failExecution(operationContext, result)
    if (
        Error.isError(result) ||
        !languageValues.isPending(result, operationContext)
    )
        return result

    return returnPendingResult(operationContext, result, (value, resolve) => resolve(value))
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
        // The executor owns an escaping subscription failure as well as normal
        // delivery, so the outward Promise cannot be rejected and then lost.
        try {
            const bridge = languageValues.thenValue(
                result,
                value => {
                    unregister()
                    onFulfilled(value, resolve, reject)
                },
                reason => {
                    unregister()
                    reject(reason)
                },
                operationContext,
            )
            markPromiseHandled(bridge, operationContext)
        } catch (failure) {
            unregister()
            failExecution(operationContext, failure)
        }
    })
}

export { returnOperationResult, returnExpressionResult }
