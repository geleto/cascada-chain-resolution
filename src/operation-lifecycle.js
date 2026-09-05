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

function releaseOnClose(operation, release) {
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

function doOperationWorkIfStillRelevant(operation, work) {
    if (operation.operationContext.execution.fatalError !== null) return undefined
    return operation.open ? work() : undefined
}

function continueResult(operation, result, onReady, continueValue) {
    return doOperationWorkIfStillRelevant(
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
        (input, next) => resolution.continueInitialValue(
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

function continueInternalResultOrFatal(operation, internalResult, onReady) {
    return continueResult(
        operation,
        internalResult,
        onReady,
        (input, next) => resolution.continueInternalResultOrFatal(
            input,
            operation.operationContext,
            next,
        ),
    )
}

function continuePrepared(operation, result, onReady) {
    return continueInternalResultOrFatal(
        operation,
        result,
        value => languageValues.isError(value) ? value : onReady(value),
    )
}

function continueAllInternalResultsOrFatal(operation, internalResults, onReady) {
    const values = new Array(internalResults.length)
    const waits = []
    for (let index = 0; index < internalResults.length; index++) {
        const wait = continueInternalResultOrFatal(operation, internalResults[index], value => {
            values[index] = value
        })
        if (languageValues.isPending(wait, operation.operationContext)) waits.push(wait)
    }
    if (waits.length === 0) {
        return continueInternalResultOrFatal(operation, values, onReady)
    }

    const unregisterRelease = releaseOnClose(
        operation,
        () => values.fill(undefined),
    )
    const result = continueInternalResultOrFatal(
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
    return continueAllInternalResultsOrFatal(operation, results, values => {
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
        return languageValues.thenValue(
            result,
            value => errorUtils.runInternalStep(operationContext, () => {
                close(operation)
                return value
            }),
            reason => {
                throw errorUtils.runInternalStep(operationContext, () => {
                    if (!(reason instanceof errorUtils.PoisonError)) throw reason
                    close(operation)
                    return reason
                })
            },
            operationContext,
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
    continueInternalResultOrFatal,
    continueAllInternalResultsOrFatal,
    continuePrepared,
    continuePreparedAll,
    doOperationWorkIfStillRelevant,
    OperationOwner,
    releaseOnClose,
    resolveInitial,
}
