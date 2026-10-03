import { captureIdentity, visitRepresentation } from "./captured-identity.js"
import * as errorUtils from "./error.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import * as internalSteps from "./internal-step.js"
import * as languageValues from "./language-values.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import { walkManagedProperties } from "./managed-traversal.js"
import { createEmptyContainer, defineCopyProperty, captureContainerStructure, finishContainerCopy } from "./placement-structure.js"
import { receiveValue } from "./input-preparations.js"

function exportValue(value, owner) {
    return exportValues([value], owner, outcome =>
        errorUtils.isPoisonError(outcome) ? outcome : outcome[0])
}

function exportManyValues(values, owner) {
    return exportValues(values, owner, values => values)
}

// All roots belong to one required frontier. Aliases share both inspection and
// copies; one Error accumulator survives discarded output until every wait ends.
function exportValues(values, owner, onResult) {
    const operationContext = owner.operationContext
    const visited = new WeakMap()
    const errors = new Set()
    let copies = new WeakMap()
    let outputs = new Array(values.length)
    const shapes = new Set()
    let unregister
    const readiness = values.map((value, position) =>
        receiveValue(
            value,
            operationContext,
            { kind: errorUtils.ERROR_KIND.OperationInputFailed },
            resolved => {
                const identity = captureIdentity(resolved, operationContext)
                const readiness = walk(resolved)
                if (copies) outputs[position] = outputOf(resolved, identity)
                return readiness
            },
            owner,
        ),
    )
    values = undefined
    const result = internalSteps.collectInputs(
        readiness,
        operationContext,
        () => {
            const outcome = errors.size
                ? errorUtils.combineErrors(
                    errors,
                    "Operation received multiple Errors",
                )
                : outputs
            unregister?.()
            release()
            return onResult(outcome)
        },
        owner,
    )
    if (languageValues.isPending(result, operationContext))
        unregister = operationLifecycle.releaseOnClose(owner, release)
    return result

    function release() {
        discardOutput()
        errors.clear()
    }

    function collect(error) {
        errors.add(error)
        discardOutput()
        owner.preparationFailed?.()
    }

    function discardOutput() {
        for (const shape of shapes) shape.length?.release?.()
        shapes.clear()
        copies = outputs = undefined
    }

    function step(action) {
        const result = errorUtils.catchExternalThrow(
            action,
            operationContext,
            errorUtils.ERROR_KIND.ExportReflectionFailed,
        )
        if (errorUtils.isPoisonError(result)) collect(result)
        return result
    }

    function outputOf(value, identity) {
        return Object.is(identity, value) ? value : copies.get(identity)
    }

    function walk(value) {
        if (errorUtils.isPoisonError(value)) {
            collect(value)
            return undefined
        }
        if (operationContext.execution._externalIdentities.has(value)) {
            collect(externalCapabilityEscapeError(operationContext))
            return undefined
        }
        const identity = captureIdentity(value, operationContext)
        if (!languageValues.isTraversable(value, operationContext) || !visitRepresentation(value, identity, visited)) return undefined
        if (copies && !copies.has(identity)) {
            const output = step(() =>
                createEmptyContainer(value, operationContext),
            )
            if (copies) copies.set(identity, output)
        }
        const readiness = walkManagedProperties(value, owner, step,
            (resolved, key, present = true) => {
                if (!present) {
                    if (copies) delete copies.get(identity)[key]
                    return undefined
                }
                const childIdentity = captureIdentity(resolved, operationContext)
                const readiness = walk(resolved)
                if (copies) defineCopyProperty(copies.get(identity), key, outputOf(resolved, childIdentity))
                return readiness
            },
            key => {
                // Fix output key order at capture, before any settlement.
                if (copies) defineCopyProperty(copies.get(identity), key, undefined)
            }, keys => {
                if (!copies) return
                const shape = step(() => captureContainerStructure(value, keys, operationContext))
                if (!copies) return
                shapes.add(shape)
                return () => {
                    if (copies) finishContainerCopy(copies.get(identity), shape)
                    shapes.delete(shape)
                }
            })
        value = undefined
        return readiness
    }
}

export { exportManyValues, exportValue }
