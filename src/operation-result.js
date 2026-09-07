import { failExecution, isFatalError } from "./error.js"
import * as languageValues from "./language-values.js"
import { markPromiseHandled } from "./thenable-subscription.js"

function returnOperationResult(operationContext, result) {
    if (isFatalError(result)) failExecution(operationContext, result)
    if (
        Error.isError(result) ||
        !languageValues.isPending(result, operationContext)
    )
        return result

    const execution = operationContext.execution
    return new Promise((resolve, reject) => {
        const unregister = execution.registerFatalResultRejection(reject)
        const settle = (settlement, value) => {
            unregister()
            settlement(value)
        }
        // The executor owns an escaping subscription failure as well as normal
        // delivery, so the outward Promise cannot be rejected and then lost.
        try {
            const bridge = languageValues.thenValue(
                result,
                value => settle(resolve, value),
                reason => settle(reject, reason),
                operationContext,
            )
            markPromiseHandled(bridge, operationContext)
        } catch (failure) {
            unregister()
            failExecution(operationContext, failure)
        }
    })
}

export { returnOperationResult }
