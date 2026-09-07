import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import { releaseOnClose } from "./operation-lifecycle.js"

function runInternalStep(operationContext, work, value) {
    const fatal = operationContext.execution.fatalError
    if (fatal !== null) throw fatal
    return errorUtils.runWithFatalGuard(operationContext, work, value)
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
    return languageValues.thenValue(
        value,
        guard(onFulfilled),
        guard(onRejected),
        operationContext,
    )
}

// Initial value consumption is a causal boundary. Later property continuations
// consume the source mirror's published value and never contextualize it again.
function consumeValue(
    value,
    operationContext,
    kind,
    onValue = value => value,
    owner,
) {
    const accept = value => {
        if (Error.isError(value))
            value = errorUtils.createPoisonError(value, operationContext, kind)
        languageValues.admitReadyValue(value, operationContext)
        return onValue(value)
    }
    return continueOperation(
        value,
        operationContext,
        accept,
        reason =>
            accept(
                errorUtils.createPoisonError(reason, operationContext, kind),
            ),
        owner,
    )
}

// Complete required-input collection: poison is data held outside the waits;
// raw or fatal rejection is an internal failure. Successful positions stay ordered.
function collectInputs(inputs, operationContext, onReady, owner) {
    const values = new Array(inputs.length)
    const waits = []
    for (let index = 0; index < inputs.length; index++) {
        const record = value => {
            values[index] = value
        }
        const wait = continueOperation(
            inputs[index],
            operationContext,
            record,
            reason => {
                if (!errorUtils.isPoisonError(reason)) throw reason
                record(reason)
            },
            owner,
        )
        if (languageValues.isPending(wait, operationContext)) waits.push(wait)
    }
    if (waits.length === 0)
        return owner && !owner.open ? undefined : onReady(values)
    const unregister =
        owner && releaseOnClose(owner, () => values.fill(undefined))
    return continueOperation(
        Promise.all(waits),
        operationContext,
        () => {
            unregister?.()
            return onReady(values)
        },
        undefined,
        owner,
    )
}

// Required preparation consumes every input before deciding whether the next
// step can run. Structural payload joins use collectInputs directly instead.
function prepareInputs(inputs, operationContext, onReady, owner) {
    return collectInputs(
        inputs,
        operationContext,
        values => {
            const errors = values.filter(errorUtils.isPoisonError)
            return errors.length
                ? errorUtils.combineErrors(
                      errors,
                      "Operation received multiple Errors",
                  )
                : onReady(values)
        },
        owner,
    )
}

export {
    collectInputs,
    consumeValue,
    continueOperation,
    prepareInputs,
    runInternalStep,
}
