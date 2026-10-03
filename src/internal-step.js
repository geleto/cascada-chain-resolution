import { runGraphTransition } from "./ownership.js"
// This module owns the one guarded operation-work family: immediate entry, continuation
// after one result, initial value consumption, complete input collection, and clean-input
// preparation. These share the execution and owner checks; do not grow them into
// configurable lifecycle or Error-policy variants. See AGENTS.md "Operation Work Lifetimes".

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
    return continueGuarded(value, operationContext, onFulfilled, onRejected, owner, errorUtils.runWithFatalGuard)
}

function continueGraphTransition(value, operationContext, onFulfilled, onRejected = unexpectedRejection, owner) {
    return continueGuarded(value, operationContext, onFulfilled, onRejected, owner, runGraphTransition)
}

function continueGuarded(
    value,
    operationContext,
    onFulfilled,
    onRejected,
    owner,
    run,
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
        return run(operationContext, callback, result)
    }
    return languageValues.thenValue(
        value,
        guard(onFulfilled),
        guard(onRejected),
        operationContext,
    )
}

// Initial value consumption is a causal boundary. Later property continuations
// consume the source Promise version's published value and never contextualize it again.
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
    return continueGraphTransition(
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
    return collectInputResults(inputs, operationContext, onReady, owner)
}

// Required preparation keeps collecting Errors after success becomes impossible,
// but no longer retains successful values or the success-only continuation.
function prepareInputs(inputs, operationContext, onReady, owner) {
    return collectInputResults(inputs, operationContext, onReady, owner, new Set())
}

function collectInputResults(inputs, operationContext, onReady, owner, errors) {
    let values = new Array(inputs.length)
    const waits = []
    let unregister
    for (let index = 0; index < inputs.length; index++) {
        const wait = continueGraphTransition(inputs[index], operationContext, value => {
            if (errors && errorUtils.isPoisonError(value)) {
                errors.add(value)
                values = onReady = undefined
                owner?.preparationFailed?.()
            } else if (values) values[index] = value
        }, undefined, owner)
        if (languageValues.isPending(wait, operationContext)) waits.push(wait)
    }
    inputs = undefined
    if (!waits.length) return owner && !owner.open ? undefined : finish()
    if (owner) unregister = releaseOnClose(owner, () => {
        values = onReady = undefined
        errors?.clear()
    })
    return continueGraphTransition(Promise.all(waits), operationContext, finish, undefined, owner)

    function finish() {
        unregister?.()
        try {
            return errors?.size ? errorUtils.combineErrors(errors, "Operation received multiple Errors") : onReady(values)
        } finally {
            values = onReady = undefined
            errors?.clear()
        }
    }
}

export {
    collectInputs,
    consumeValue,
    continueOperation,
    continueGraphTransition,
    prepareInputs,
    runInternalStep,
}
