import { runGraphTransition } from "./ownership.js"
// Entry, continuations, early decisions and complete input collection share
// the execution and owner guards. See AGENTS.md "Operation Work Lifetimes".

import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import { releaseOnClose } from "./operation-lifecycle.js"
import { markPromiseHandled } from "./thenable-subscription.js"

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
    // Reception supplies a missing poison source inside the live-work guard,
    // before the consumer can publish it or perform its failure effects.
    const fulfill = result => onFulfilled(errorUtils.isPoisonError(result)
        ? errorUtils.createPoisonError(result, operationContext, result.kind) : result)
    return languageValues.thenValue(
        value,
        guard(fulfill),
        guard(onRejected),
        operationContext,
    )
}

// Complete required-input collection: poison is data held outside the waits;
// raw or fatal rejection is an internal failure. Successful positions stay ordered.
function collectInputs(inputs, operationContext, onReady, owner) {
    return collectInputResults(inputs, operationContext, onReady, owner)
}

// The first proved answer discharges the other inputs. A proof can inspect
// the ordered pair of controls or count the remaining receipts incrementally.
function decideInputs(inputs, ctx, prove, owner) {
    let remaining = inputs.length, signal, unregister
    if (!remaining) return prove(inputs, undefined, 0)
    for (let i = 0; i < inputs.length; i++) {
        const wait = continueGraphTransition(inputs[i], ctx, value => {
            if (!prove) return
            inputs[i] = value
            const result = prove(inputs, value, --remaining)
            if (result === undefined && remaining) return
            if (signal) signal.resolve(result)
            unregister?.()
            release()
            return result
        }, undefined, owner)
        if (!prove) return wait
        markPromiseHandled(wait, ctx)
    }
    signal = Promise.withResolvers()
    const { promise } = signal
    if (owner) unregister = releaseOnClose(owner, release)
    return promise

    function release() { inputs = prove = signal = unregister = undefined }
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
            return errors?.size ? errorUtils.combineErrors(errors, operationContext) : onReady(values)
        } finally {
            values = onReady = undefined
            errors?.clear()
        }
    }
}

export {
    collectInputs,
    decideInputs,
    continueOperation,
    continueGraphTransition,
    prepareInputs,
    runInternalStep,
}
