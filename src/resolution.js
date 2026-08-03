import * as errorUtils from "./error.js"
import * as helpers from "./helpers.js"
import * as languageValues from "./language-values.js"

const CANONICAL_PROMISES = new WeakMap()

// Every callable thenable is canonicalized once. Runtime Promise consumers
// register synchronously through this module so each source runs one FIFO
// reaction batch. Raw .then belongs only here.
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
    if (!languageValues.isPromise(value)) return helpers.runFatal(fn, value)
    return getCanonicalPromise(value).then(
        value => helpers.runFatal(fn, value),
        reason => helpers.runFatal(
            () => fn(errorUtils.toPoison(reason)),
        ),
    )
}

// The initial resolver has already published its value or Poison. A later
// resolver uses the source only as readiness and reads the current mirror.
function onLaterPromiseReady(promise, fn) {
    const onReady = () => helpers.runFatal(fn)
    return getCanonicalPromise(promise).then(onReady, onReady)
}

// An operation result may be direct or promised. Its rejection is Fatal.
function resolveOperationResultOrFatal(
    result,
    onFulfilled,
    onRejected,
) {
    if (!languageValues.isPromise(result)) {
        return helpers.runFatal(onFulfilled, result)
    }
    return getCanonicalPromise(result).then(
        value => helpers.runFatal(onFulfilled, value),
        reason => {
            if (onRejected) helpers.runFatal(onRejected, reason)
            return errorUtils.reportFatalError(reason)
        },
    )
}

function runOperationCallbackOrFatal(
    callback,
    argument,
    onFulfilled,
    onRejected,
) {
    let result
    try {
        result = callback(argument)
    } catch (error) {
        helpers.runFatal(onRejected, error)
        return errorUtils.reportFatalError(error)
    }
    return resolveOperationResultOrFatal(result, onFulfilled, onRejected)
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

function continueOperationUnlessPoison(result, onResolved) {
    return resolveOperationResultOrFatal(result, unlessPoison(onResolved))
}

function resolveOperationResultsOrFatal(results, onResolved) {
    const values = new Array(results.length)
    const waits = []
    for (let index = 0; index < results.length; index++) {
        const result = results[index]
        if (!languageValues.isPromise(result)) {
            values[index] = result
            continue
        }
        waits.push(resolveOperationResultOrFatal(
            result,
            value => {
                values[index] = value
            },
        ))
    }
    if (waits.length === 0) return helpers.runFatal(onResolved, values)
    return resolveOperationResultOrFatal(
        Promise.all(waits),
        () => onResolved(values),
    )
}

function continueOperationsUnlessPoison(results, onResolved) {
    return resolveOperationResultsOrFatal(
        results,
        values => values.find(languageValues.isError) ?? onResolved(values),
    )
}

export {
    continueInitialValueUnlessPoison,
    continueOperationUnlessPoison,
    continueOperationsUnlessPoison,
    onLaterPromiseReady,
    resolveInitialValueOrPoison,
    resolveOperationResultOrFatal,
    resolveOperationResultsOrFatal,
    runOperationCallbackOrFatal,
}
