import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as resolution from "./resolution.js"

const ignore = () => {}

function createOwner(state = {}) {
    state.open = true
    state.close = closeDefaultOwner
    return state
}

// Installed as owner.close(), so `this` is that owner. Sharing this method
// avoids allocating one closure per owner.
function closeDefaultOwner() {
    this.open = false
}

// An owner supplies `open` and idempotent `close()`. Existing operation
// contexts implement this directly. Shared Promise and property settlement
// remains outside it and always finishes. Callers close owners only through
// close() below so registered resources are released in the same transition.
function mayContinue(operation) {
    return operation.open === true
}

function close(operation) {
    try {
        if (operation.open) operation.close()
    } finally {
        const releases = operation.releases
        if (releases) {
            operation.releases = undefined
            // Releases are trusted, non-throwing runtime cleanup. A violation
            // propagates as Fatal; clearing still severs unregister closures.
            try {
                for (const release of releases) release()
            } finally {
                releases.clear()
            }
        }
    }
}

function registerRelease(operation, release) {
    if (!mayContinue(operation)) {
        release()
        return undefined
    }
    let releases = operation.releases
    if (!releases) {
        releases = new Set()
        operation.releases = releases
    }
    releases.add(release)
    return () => {
        if (!releases.delete(release)) return
        if (releases.size === 0) operation.releases = undefined
    }
}

function observeFatal(operation, result, onFatal = ignore) {
    if (!languageValues.isPromise(result)) return result
    resolution.observeResultPromise(
        result,
        ignore,
        reason => {
            close(operation)
            onFatal(reason)
        },
    )
    return result
}

function run(operation, transition) {
    if (!mayContinue(operation)) return undefined
    try {
        return transition()
    } catch (error) {
        close(operation)
        throw error
    }
}

function continueResult(operation, result, onReady, continueValue) {
    return run(
        operation,
        () => observeFatal(operation, continueValue(
            result,
            value => mayContinue(operation) ? onReady(value) : undefined,
        )),
    )
}

function resolveInitial(operation, value, onReady) {
    // This primitive admits and passes Errors; continueInitial consumes them.
    return continueResult(
        operation,
        value,
        onReady,
        (input, next) => resolution.resolveInitialValueOrPoison(
            input,
            next,
            () => mayContinue(operation),
        ),
    )
}

function continueInitial(operation, value, onReady) {
    return resolveInitial(
        operation,
        value,
        resolved => languageValues.isError(resolved)
            ? resolved
            : onReady(resolved),
    )
}

function continueInternal(operation, result, onReady) {
    return continueResult(
        operation,
        result,
        onReady,
        resolution.continueInternalPromiseOrFatal,
    )
}

function continuePrepared(operation, result, onReady) {
    return continueInternal(
        operation,
        result,
        value => languageValues.isError(value) ? value : onReady(value),
    )
}

function continueInternalAll(operation, results, onReady) {
    const values = new Array(results.length)
    const waits = []
    for (let index = 0; index < results.length; index++) {
        const result = results[index]
        if (!languageValues.isPromise(result)) {
            values[index] = result
            continue
        }
        waits.push(continueInternal(operation, result, value => {
            values[index] = value
        }))
    }
    if (waits.length === 0) {
        return continueInternal(operation, values, onReady)
    }

    const unregisterRelease = registerRelease(
        operation,
        () => values.fill(undefined),
    )
    const result = continueInternal(
        operation,
        Promise.all(waits),
        () => {
            unregisterRelease?.()
            return onReady(values)
        },
    )
    return result
}

function continuePreparedAll(operation, results, onReady) {
    return continueInternalAll(operation, results, values => {
        const errors = values.filter(languageValues.isError)
        return errors.length === 0
            ? onReady(values)
            : errorUtils.combineErrors(
                errors,
                "Operation received multiple Errors",
            )
    })
}

function closeWhenDone(operation, result) {
    // Unlike observeFatal, final fulfillment also closes the operation.
    if (!languageValues.isPromise(result)) {
        close(operation)
        return result
    }
    resolution.observeResultPromise(
        result,
        () => close(operation),
        () => close(operation),
    )
    return result
}

export {
    close,
    closeWhenDone,
    continueInitial,
    continueInternal,
    continueInternalAll,
    continuePrepared,
    continuePreparedAll,
    createOwner,
    mayContinue,
    observeFatal,
    registerRelease,
    resolveInitial,
    run,
}
