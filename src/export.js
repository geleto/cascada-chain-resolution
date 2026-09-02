import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"

const keepValues = values => values
const firstValue = values => values[0]

class ExportContext {
    constructor(inputCount, owner) {
        this.owner = owner
        this.copyBySource = new WeakMap()
        this.collectedErrors = new Array(inputCount)
        this.exportedValues = new Array(inputCount)
        this.visited = Array.from(
            { length: inputCount },
            () => new WeakSet(),
        )
    }

    discardCopies() {
        this.copyBySource = undefined
        this.exportedValues = undefined
    }

    release() {
        const unregisterRelease = this.unregisterRelease
        this.unregisterRelease = undefined
        unregisterRelease?.()
        this.copyBySource = undefined
        this.collectedErrors = undefined
        this.exportedValues = undefined
        this.visited = undefined
    }
}

function exportValue(value, operationContext) {
    return exportValues(
        [value],
        new operationLifecycle.OperationOwner(operationContext),
        firstValue,
        true,
    )
}

function exportManyValues(values, owner) {
    return exportValues(values, owner, keepValues, false)
}

function exportValues(values, owner, resultFromValues, ownsOwner) {
    const operationContext = owner.operationContext
    const exportContext = new ExportContext(values.length, owner)
    let result
    try {
        const readiness = values.map((value, position) =>
            prepareExportValue(value, position, exportContext))
        result = operationLifecycle.continueInternalAll(
            owner,
            readiness,
            () => finishExport(exportContext, resultFromValues),
        )
    } catch (error) {
        exportContext.release()
        operationLifecycle.close(owner)
        throw error
    }
    if (languageValues.isPromise(result, operationContext)) {
        exportContext.unregisterRelease = operationLifecycle.registerRelease(
            owner,
            () => exportContext.release(),
        )
    }
    return ownsOwner
        ? operationLifecycle.closeWhenDone(owner, result)
        : result
}

function prepareExportValue(value, position, exportContext) {
    return operationLifecycle.resolveInitial(exportContext.owner, value, resolved => {
        return runExportTransition(exportContext, position, () => {
            if (languageValues.isError(resolved)) {
                collectError(exportContext, position, resolved)
                return undefined
            }
            const readiness = walkExportValue(resolved, exportContext, position)
            if (exportContext.copyBySource) {
                exportContext.exportedValues[position] = outputValueOf(resolved, exportContext)
            }
            return readiness
        })
    })
}

function walkExportValue(value, exportContext, position) {
    if (languageValues.isError(value)) {
        collectError(exportContext, position, value)
        return undefined
    }
    if (!languageValues.isTraversable(value, exportContext.owner.operationContext)) {
        return undefined
    }

    const visited = exportContext.visited[position]
    if (visited.has(value)) return undefined
    visited.add(value)

    if (exportContext.copyBySource && !exportContext.copyBySource.has(value)) {
        const output = runExportStep(
            exportContext,
            position,
            () => createOutputContainer(value, exportContext.owner.operationContext),
        )
        if (!languageValues.isError(output)) {
            exportContext.copyBySource.set(value, output)
        }
    }

    const keys = runExportStep(
        exportContext,
        position,
        () => languageProperties.enumerableLanguageKeys(
            value,
            exportContext.owner.operationContext,
        ),
    )
    if (languageValues.isError(keys)) return undefined

    const waits = []
    for (const key of keys) {
        const child = runExportStep(
            exportContext,
            position,
            () => languageProperties.readLanguageProperty(
                value,
                key,
                exportContext.owner.operationContext,
            ),
        )
        if (languageValues.isError(child)) continue
        if (languageValues.isPromise(child, exportContext.owner.operationContext)) {
            // Reserve the key before settlement can reorder it.
            if (exportContext.copyBySource) writeOutputProperty(
                exportContext.copyBySource.get(value),
                key,
                undefined,
            )
            const readiness = runExportStep(
                exportContext,
                position,
                () => walkExportPromise(value, key, child, exportContext, position),
            )
            if (!languageValues.isError(readiness)) waits.push(readiness)
            continue
        }

        const readiness = walkExportValue(child, exportContext, position)
        if (exportContext.copyBySource) writeOutputProperty(
            exportContext.copyBySource.get(value),
            key,
            outputValueOf(child, exportContext),
        )
        if (readiness) waits.push(readiness)
    }
    return waits.length === 0
        ? undefined
        : operationLifecycle.continueInternal(
            exportContext.owner,
            Promise.all(waits),
            () => undefined,
        )
}

function runExportStep(exportContext, position, step) {
    // Only the exact user-code boundary becomes language Error data.
    const result = errorUtils.catchUserCodeFailure(step, error => error)
    if (languageValues.isError(result)) collectError(exportContext, position, result)
    return result
}

function walkExportPromise(parent, key, promise, exportContext, position) {
    const result = propertyVersions.continuePropertyValue(
        parent,
        key,
        promise,
        exportContext.owner.operationContext,
        value => {
            if (!operationLifecycle.mayContinue(exportContext.owner)) return undefined
            return runExportTransition(exportContext, position, () => {
                const readiness = walkExportValue(value, exportContext, position)
                if (exportContext.copyBySource) writeOutputProperty(
                    exportContext.copyBySource.get(parent),
                    key,
                    outputValueOf(value, exportContext),
                )
                return readiness
            })
        },
    )
    return operationLifecycle.observeFatal(exportContext.owner, result)
}

function runExportTransition(exportContext, position, transition) {
    return operationLifecycle.run(exportContext.owner, () => {
        return runExportStep(exportContext, position, transition)
    })
}

function createOutputContainer(value, operationContext) {
    const meta = metadata.requireMeta(value, operationContext)
    return meta.type === metadata.TYPE_ARRAY
        ? new Array(arrayViews.logicalArrayLength(value, operationContext))
        : Object.create(meta.admittedPrototype)
}

function outputValueOf(value, exportContext) {
    return languageValues.isTraversable(value, exportContext.owner.operationContext)
        ? exportContext.copyBySource.get(value)
        : value
}

function writeOutputProperty(parent, key, value) {
    // Never let an inherited __proto__ setter change the copy's prototype.
    Object.defineProperty(parent, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
    })
}

function collectError(exportContext, position, error) {
    const errors = exportContext.collectedErrors[position] ??= new Set()
    errors.add(error)
    exportContext.discardCopies()
}

function finishExport(exportContext, resultFromValues) {
    const errors = exportContext.collectedErrors
        .map(errors => errors && errorUtils.combineErrors(
            errors,
            "export: branch contains errors",
        ))
        .filter(languageValues.isError)
    const exportedValues = exportContext.exportedValues
    exportContext.release()
    if (errors.length > 0) {
        return errorUtils.combineErrors(
            errors,
            "Operation received multiple Errors",
        )
    }
    return resultFromValues(exportedValues)
}

export { exportManyValues, exportValue }
