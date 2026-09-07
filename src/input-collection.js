import * as errorUtils from "./error.js"
import { continueOperation, releaseOnClose } from "./operation-lifecycle.js"
import { isPending } from "./language-values.js"

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
        if (isPending(wait, operationContext)) waits.push(wait)
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

export { collectInputs, prepareInputs }
