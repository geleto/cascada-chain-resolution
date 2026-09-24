import { ArrayView } from "./array-view.js"
import * as errorUtils from "./error.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import * as internalSteps from "./internal-step.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import { walkManagedProperties } from "./managed-traversal.js"
import { captureContainerStructure, finishContainerCopy } from "./placement-structure.js"

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
    const visited = new WeakSet()
    const errors = new Set()
    let copies = new WeakMap()
    let outputs = new Array(values.length)
    const shapes = new Set()
    let unregister
    const readiness = values.map((value, position) =>
        internalSteps.consumeValue(
            value,
            operationContext,
            errorUtils.ERROR_KIND.OperationInputFailed,
            resolved => {
                const readiness = walk(resolved)
                if (copies) outputs[position] = outputOf(resolved)
                return readiness
            },
            owner,
        ),
    )
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

    function outputOf(value) {
        return languageValues.isTraversable(value, operationContext)
            ? copies.get(value)
            : value
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
        if (
            !languageValues.isTraversable(value, operationContext) ||
            visited.has(value)
        )
            return undefined
        visited.add(value)
        if (copies) {
            const output = step(() =>
                createOutputContainer(value, operationContext),
            )
            if (copies) copies.set(value, output)
        }
        return walkManagedProperties(value, owner, step,
            (resolved, key, present = true) => {
                if (!present) {
                    if (copies) delete copies.get(value)[key]
                    return undefined
                }
                const readiness = walk(resolved)
                if (copies) writeOutputProperty(copies.get(value), key, outputOf(resolved))
                return readiness
            },
            key => {
                // Fix output key order at capture, before any settlement.
                if (copies) writeOutputProperty(copies.get(value), key, undefined)
            }, keys => {
                if (!copies) return
                const shape = step(() => captureContainerStructure(value, keys, operationContext))
                if (!copies) return
                shapes.add(shape)
                return () => {
                    if (copies) finishContainerCopy(copies.get(value), shape)
                    shapes.delete(shape)
                }
            })
    }
}

function createOutputContainer(value, operationContext) {
    const meta = metadata.requireMeta(value, operationContext)
    return meta.type === metadata.TYPE.Array
        ? new Array(ArrayView.minimumLength(value, operationContext))
        : Object.create(meta.admittedPrototype)
}

function writeOutputProperty(parent, key, value) {
    // Never invoke an inherited setter on the fresh runtime-owned copy.
    Object.defineProperty(parent, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
    })
}

export { exportManyValues, exportValue }
