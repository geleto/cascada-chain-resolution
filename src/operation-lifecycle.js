import * as errorUtils from "./error.js"
import { thenValue } from "./language-values.js"

class OperationOwner {
    open = true
    constructor(operationContext) {
        this.operationContext = operationContext
    }
    close() {
        close(this)
    }
}

function close(operation) {
    if (!operation.open) return
    operation.open = false
    try {
        operation.release?.()
    } finally {
        const releases = operation.releases
        operation.releases = undefined
        if (releases) {
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
    const releases = (operation.releases ??= new Set())
    releases.add(release)
    return () => {
        if (!releases.delete(release)) return
        if (releases.size === 0) operation.releases = undefined
    }
}

const unexpectedRejection = reason => {
    throw reason
}

// A trusted continuation defines its own Error semantics. Shared settlement
// omits an owner; operation-local work stops after that owner's closure.
function continueOperation(
    value,
    operationContext,
    onFulfilled,
    onRejected = unexpectedRejection,
    owner,
) {
    const fatal = operationContext.execution.fatalError
    if (fatal !== null) throw fatal
    if (errorUtils.isFatalError(value))
        errorUtils.failExecution(operationContext, value)
    if (owner && !owner.open) return undefined
    const guard = callback => result => {
        if (
            operationContext.execution.fatalError !== null ||
            (owner && !owner.open)
        )
            return undefined
        return errorUtils.runWithFatalGuard(operationContext, callback, result)
    }
    return thenValue(
        value,
        guard(onFulfilled),
        guard(onRejected),
        operationContext,
    )
}

export { OperationOwner, close, releaseOnClose, continueOperation }
