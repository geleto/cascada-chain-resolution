import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"

const ignore = () => {}

// A direct value runs immediately. Data-Promise rejection becomes a Poison
// before the continuation runs; continuation throws are Fatal. Initial
// operation work may be abandoned before admission; graph settlement omits
// that predicate and always completes.
function resolveInitialValueOrPoison(
    value,
    operationContext,
    fn = value => value,
    shouldContinue = () => true,
    rejectionKind = errorUtils.ERROR_KIND.OperationInputRejected,
) {
    return languageValues.consumeValue(
        value,
        operationContext,
        value => {
            if (!shouldContinue()) return undefined
            return errorUtils.runOrFailExecution(operationContext, () => {
                languageValues.admitReadyValue(value, operationContext)
                return fn(value)
            })
        },
        reason => errorUtils.runOrFailExecution(operationContext, () => {
            if (!shouldContinue()) return undefined
            const failure = errorUtils.toPoison(
                reason,
                operationContext,
                rejectionKind,
            )
            languageValues.admitReadyValue(failure, operationContext)
            return fn(failure)
        }),
    )
}

// The initial resolver has already published its value or Poison. A later
// resolver uses the source only as readiness and reads the current mirror.
function onLaterPromiseReady(promise, operationContext, fn) {
    const onReady = () => errorUtils.runOrFailExecution(operationContext, fn)
    return languageValues.consumeValue(promise, operationContext, onReady, onReady)
}

// Continue through the ordinary FIFO subscription. Rejection is Fatal unless the
// exact caller supplies a language-outcome transition.
function continueInternalPromiseOrFatal(
    result,
    operationContext,
    onFulfilled,
    onRejected = reason => {
        throw reason
    },
) {
    return languageValues.consumeValue(
        result,
        operationContext,
        value => errorUtils.runOrFailExecution(operationContext, onFulfilled, value),
        reason => errorUtils.runOrFailExecution(operationContext, onRejected, reason),
    )
}

function markPromiseHandled(promise) {
    // These callbacks cannot reject or assimilate a fulfilled payload. Their
    // returned chain therefore needs no recursive observer.
    if (promise !== null && typeof promise === "object" &&
        !Error.isError(promise) && typeof promise.then === "function") {
        promise.then(ignore, ignore)
    }
}

export {
    continueInternalPromiseOrFatal,
    markPromiseHandled,
    onLaterPromiseReady,
    resolveInitialValueOrPoison,
}
