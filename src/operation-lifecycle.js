import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as resolution from "./resolution.js"

class OperationOwner {
    open = true

    constructor(operationContext) {
        this.operationContext = operationContext
    }

    close() {
        this.open = false
    }
}

// An owner supplies `open` and idempotent `close()`. Existing operation-work
// owners implement this directly. In a live execution, shared Promise and
// property settlement remains outside it. Callers close owners only through
// close() below so registered resources are released in the same transition.
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
    if (!operation.open) {
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

function run(operation, transition) {
    if (operation.operationContext.execution.fatalError !== null) return undefined
    return operation.open ? transition() : undefined
}

function continueResult(operation, result, onReady, continueValue) {
    return run(
        operation,
        () => continueValue(
            result,
            value => operation.open ? onReady(value) : undefined,
        ),
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
            operation.operationContext,
            next,
            () => operation.open,
        ),
    )
}

function continueInitial(operation, value, onReady) {
    return resolveInitial(
        operation,
        value,
        resolved => languageValues.isError(resolved)
            ? errorUtils.toPoison(
                resolved,
                operation.operationContext,
                errorUtils.ERROR_KIND.OperationInputError,
            )
            : onReady(resolved),
    )
}

function continueInternal(operation, result, onReady) {
    return continueResult(
        operation,
        result,
        onReady,
        (input, next) => resolution.continueInternalPromiseOrFatal(
            input,
            operation.operationContext,
            next,
        ),
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
        const wait = continueInternal(operation, results[index], value => {
            values[index] = value
        })
        if (languageValues.isPending(wait, operation.operationContext)) waits.push(wait)
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
    const operationContext = operation.operationContext
    try {
        return languageValues.consumeValue(
            result,
            operationContext,
            value => errorUtils.runOrFailExecution(operationContext, () => {
                close(operation)
                return value
            }),
            reason => {
                throw errorUtils.runOrFailExecution(operationContext, () => {
                    if (!(reason instanceof errorUtils.PoisonError)) throw reason
                    close(operation)
                    return reason
                })
            },
        )
    } catch (failure) {
        if (failure instanceof errorUtils.PoisonError) return failure
        throw failure
    }
}

export {
    close,
    closeWhenDone,
    continueInitial,
    continueInternal,
    continueInternalAll,
    continuePrepared,
    continuePreparedAll,
    OperationOwner,
    registerRelease,
    resolveInitial,
    run,
}
