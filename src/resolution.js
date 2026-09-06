import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"

// A direct value runs immediately. Data-Promise rejection becomes a Poison
// before the continuation runs; continuation throws are Fatal. Initial
// operation work may be abandoned before admission; graph settlement omits
// that predicate and always completes.
function continueInitialValue(
    value,
    operationContext,
    fn = value => value,
    shouldContinue = () => true,
    rejectionKind = errorUtils.ERROR_KIND.OperationInputRejected,
) {
    return languageValues.thenValue(
        value,
        value => {
            if (!shouldContinue()) return undefined
            return errorUtils.runInternalStep(operationContext, () => {
                languageValues.admitReadyValue(value, operationContext)
                return fn(value)
            })
        },
        reason => errorUtils.runInternalStep(operationContext, () => {
            if (!shouldContinue()) return undefined
            const failure = errorUtils.toPoison(
                reason,
                operationContext,
                rejectionKind,
            )
            languageValues.admitReadyValue(failure, operationContext)
            return fn(failure)
        }),
        operationContext,
    )
}

// The initial resolver has already published its value or Poison. A later
// resolver uses the source only as readiness and reads the current mirror.
function continueWhenSettled(promise, operationContext, fn) {
    const onReady = () => errorUtils.runInternalStep(operationContext, fn)
    return languageValues.thenValue(promise, onReady, onReady, operationContext)
}

// Continue an internal result through the ordinary FIFO subscription. Rejection
// is Fatal unless the exact caller supplies a language-outcome transition.
function continueInternalResultOrFatal(
    internalResult,
    operationContext,
    onFulfilled,
    onRejected = reason => {
        throw reason
    },
) {
    return languageValues.thenValue(
        internalResult,
        value => errorUtils.runInternalStep(operationContext, onFulfilled, value),
        reason => errorUtils.runInternalStep(operationContext, onRejected, reason),
        operationContext,
    )
}

export {
    continueInternalResultOrFatal,
    continueWhenSettled,
    continueInitialValue,
}
