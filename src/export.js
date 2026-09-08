import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as internalSteps from "./internal-step.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"

function exportValue(value, operationContext) {
    const owner = new operationLifecycle.OperationOwner(operationContext)
    return exportValues([value], owner, outcome => {
        owner.close()
        return errorUtils.isPoisonError(outcome) ? outcome : outcome[0]
    })
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
        copies = outputs = undefined
        errors.clear()
    }

    function collect(error) {
        errors.add(error)
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
        const keys = []
        step(() => {
            for (const key of languageProperties.enumerableLanguageKeyCandidates(
                value,
                operationContext,
            )) {
                const present = step(() => languageProperties.hasLanguageProperty(
                    value,
                    key,
                    operationContext,
                ))
                if (present === true) keys.push(key)
            }
        })
        const waits = []
        for (const key of keys) {
            const child = step(() =>
                languageProperties.readLanguageProperty(
                    value,
                    key,
                    operationContext,
                ),
            )
            if (errorUtils.isPoisonError(child)) continue
            let readiness
            if (languageValues.isPending(child, operationContext)) {
                // Fix output key order at capture, before any settlement.
                if (copies)
                    writeOutputProperty(copies.get(value), key, undefined)
                readiness = propertyVersions.continuePromiseVersion(
                    value,
                    key,
                    child,
                    operationContext,
                    publish,
                    owner,
                )
            } else readiness = publish(child)
            if (languageValues.isPending(readiness, operationContext))
                waits.push(readiness)

            function publish(resolved) {
                const readiness = walk(resolved)
                if (copies)
                    writeOutputProperty(
                        copies.get(value),
                        key,
                        outputOf(resolved),
                    )
                return readiness
            }
        }
        return waits.length === 0
            ? undefined
            : internalSteps.continueOperation(
                  Promise.all(waits),
                  operationContext,
                  () => undefined,
                  undefined,
                  owner,
              )
    }
}

function createOutputContainer(value, operationContext) {
    const meta = metadata.requireMeta(value, operationContext)
    return meta.type === metadata.TYPE.Array
        ? new Array(arrayViews.logicalArrayLength(value, operationContext))
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
