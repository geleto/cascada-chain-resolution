import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"

// A direct value runs immediately. Data-Promise rejection becomes a Poison
// before the continuation runs; continuation throws are Fatal. Initial
// operation work may be abandoned before admission; graph settlement omits
// that predicate and always completes.
function resolveInitialValueOrPoison(
    value,
    operationContext,
    fn = value => value,
    shouldContinue = () => true,
) {
    if (!languageValues.isPromise(value, operationContext)) {
        if (!shouldContinue()) return undefined
        languageValues.admitReadyValue(value, operationContext)
        return errorUtils.runFatal(operationContext, fn, value)
    }
    return languageValues.continuePromise(
        value,
        operationContext,
        value => {
            if (!shouldContinue()) return undefined
            languageValues.admitReadyValue(value, operationContext)
            return errorUtils.runFatal(operationContext, fn, value)
        },
        reason => errorUtils.runFatal(operationContext, () => {
            if (!shouldContinue()) return undefined
            const failure = errorUtils.toPoison(reason)
            languageValues.admitReadyValue(failure, operationContext)
            return fn(failure)
        }),
    )
}

// The initial resolver has already published its value or Poison. A later
// resolver uses the source only as readiness and reads the current mirror.
function onLaterPromiseReady(promise, operationContext, fn) {
    const onReady = () => errorUtils.runFatal(operationContext, fn)
    return languageValues.continuePromise(promise, operationContext, onReady, onReady)
}

// Promise inputs must already be native runtime readiness or continuation
// Promises whose source ordering is established. Never pass an uncanonicalized
// graph or host thenable here. Continue directly; rejection is Fatal.
function continueInternalPromiseOrFatal(
    result,
    operationContext,
    onFulfilled,
) {
    if (!languageValues.isPromise(result, operationContext)) {
        return errorUtils.runFatal(operationContext, onFulfilled, result)
    }
    return result.then(
        value => errorUtils.runFatal(operationContext, onFulfilled, value),
        errorUtils.reportFatalError,
    )
}

// Observe settlement for runtime bookkeeping without replacing the result.
// Registering here ensures this work precedes later Cascada consumers of the
// same thenable. The observer is internal, so consume any Fatal it has already
// reported.
function observeResultPromise(
    promise,
    operationContext,
    onFulfilled,
    onRejected = onFulfilled,
) {
    const observer = languageValues.continuePromise(
        promise,
        operationContext,
        value => errorUtils.runFatal(operationContext, onFulfilled, value),
        reason => errorUtils.runFatal(operationContext, onRejected, reason),
    )
    observer.then(undefined, () => {})
    return promise
}

export {
    continueInternalPromiseOrFatal,
    observeResultPromise,
    onLaterPromiseReady,
    resolveInitialValueOrPoison,
}
