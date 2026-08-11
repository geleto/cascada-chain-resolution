import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"

const CANONICAL_PROMISES = new WeakMap()

// Canonicalize only sources whose runtime continuations require FIFO order.
// Returning a result alone does not come through here. Raw .then belongs only
// in this module.
function getCanonicalPromise(promise) {
    let canonical = CANONICAL_PROMISES.get(promise)
    if (!canonical) {
        canonical = Promise.resolve(promise)
        CANONICAL_PROMISES.set(promise, canonical)
    }
    return canonical
}

// A direct value runs immediately. Data-Promise rejection becomes a Poison
// before the continuation runs; continuation throws are Fatal.
function resolveInitialValueOrPoison(
    value,
    fn = value => value,
) {
    if (!languageValues.isPromise(value)) return errorUtils.runFatal(fn, value)
    return getCanonicalPromise(value).then(
        value => errorUtils.runFatal(fn, value),
        reason => errorUtils.runFatal(
            () => fn(errorUtils.toPoison(reason)),
        ),
    )
}

// The initial resolver has already published its value or Poison. A later
// resolver uses the source only as readiness and reads the current mirror.
function onLaterPromiseReady(promise, fn) {
    const onReady = () => errorUtils.runFatal(fn)
    return getCanonicalPromise(promise).then(onReady, onReady)
}

// Promise inputs must already be native runtime readiness or continuation
// Promises whose source ordering is established. Never pass an uncanonicalized
// graph or host thenable here. Continue directly; rejection is Fatal.
function continueInternalPromiseOrFatal(
    result,
    onFulfilled,
) {
    if (!languageValues.isPromise(result)) {
        return errorUtils.runFatal(onFulfilled, result)
    }
    return result.then(
        value => errorUtils.runFatal(onFulfilled, value),
        errorUtils.reportFatalError,
    )
}

// Observe settlement for runtime bookkeeping without replacing the result.
// Registering here ensures this work precedes later Cascada consumers of the
// same thenable. The observer is internal, so consume any Fatal it has already
// reported.
function observeResultPromise(promise, onFulfilled, onRejected) {
    const observer = getCanonicalPromise(promise).then(
        value => errorUtils.runFatal(onFulfilled, value),
        reason => errorUtils.runFatal(onRejected, reason),
    )
    observer.then(undefined, () => {})
    return promise
}

function unlessPoison(onResolved) {
    return value => languageValues.isError(value) ? value : onResolved(value)
}

function continueInitialValueUnlessPoison(
    value,
    onResolved,
) {
    return resolveInitialValueOrPoison(
        value,
        unlessPoison(onResolved),
    )
}

function continuePreparedValueUnlessPoison(result, onResolved) {
    return continueInternalPromiseOrFatal(result, unlessPoison(onResolved))
}

function continueInternalPromisesOrFatal(results, onResolved) {
    const values = new Array(results.length)
    const waits = []
    for (let index = 0; index < results.length; index++) {
        const result = results[index]
        if (!languageValues.isPromise(result)) {
            values[index] = result
            continue
        }
        waits.push(continueInternalPromiseOrFatal(
            result,
            value => {
                values[index] = value
            },
        ))
    }
    if (waits.length === 0) return errorUtils.runFatal(onResolved, values)
    return continueInternalPromiseOrFatal(
        Promise.all(waits),
        () => onResolved(values),
    )
}

function continuePreparedValuesUnlessPoison(results, onResolved) {
    return continueInternalPromisesOrFatal(
        results,
        values => {
            const errors = values.filter(languageValues.isError)
            return errors.length > 0
                ? errorUtils.combineErrors(
                    errors,
                    "Operation received multiple Errors",
                )
                : onResolved(values)
        },
    )
}

export {
    continueInitialValueUnlessPoison,
    continueInternalPromiseOrFatal,
    continueInternalPromisesOrFatal,
    continuePreparedValueUnlessPoison,
    continuePreparedValuesUnlessPoison,
    observeResultPromise,
    onLaterPromiseReady,
    resolveInitialValueOrPoison,
}
