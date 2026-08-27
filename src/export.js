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

function exportValue(value, containingOperation = undefined) {
    return exportValues([value], containingOperation, firstValue)
}

function exportManyValues(values, containingOperation = undefined) {
    return exportValues(values, containingOperation, keepValues)
}

function exportValues(values, containingOperation, selectResult) {
    const standalone = containingOperation === undefined
    const owner = standalone
        ? operationLifecycle.createOwner()
        : containingOperation
    const state = new ExportContext(values.length, owner)
    let result
    try {
        const readiness = values.map((value, position) =>
            prepareValue(value, position, state))
        result = operationLifecycle.continueInternalAll(
            owner,
            readiness,
            () => finishExport(state, selectResult),
        )
    } catch (error) {
        state.release()
        operationLifecycle.close(owner)
        throw error
    }
    if (languageValues.isPromise(result)) {
        state.unregisterRelease = operationLifecycle.registerRelease(
            owner,
            () => state.release(),
        )
    }
    return standalone
        ? operationLifecycle.closeWhenDone(owner, result)
        : result
}

function prepareValue(value, position, state) {
    return operationLifecycle.resolveInitial(state.owner, value, resolved => {
        return runExportTransition(state, position, () => {
            if (languageValues.isError(resolved)) {
                collectError(state, position, resolved)
                return undefined
            }
            const readiness = walkValue(resolved, state, position)
            if (state.copyBySource) {
                state.exportedValues[position] = copiedValue(resolved, state)
            }
            return readiness
        })
    })
}

function walkValue(value, state, position) {
    if (languageValues.isError(value)) {
        collectError(state, position, value)
        return undefined
    }
    if (!languageValues.isTraversable(value)) return undefined

    const visited = state.visited[position]
    if (visited.has(value)) return undefined
    visited.add(value)

    if (state.copyBySource && !state.copyBySource.has(value)) {
        const output = runExportStep(
            state,
            position,
            () => createOutput(value),
        )
        if (!languageValues.isError(output)) {
            state.copyBySource.set(value, output)
        }
    }

    const keys = runExportStep(
        state,
        position,
        () => languageProperties.enumerableLanguageKeys(value),
    )
    if (languageValues.isError(keys)) return undefined

    const waits = []
    for (const key of keys) {
        const child = runExportStep(
            state,
            position,
            () => languageProperties.readLanguageProperty(value, key),
        )
        if (languageValues.isError(child)) continue
        if (languageValues.isPromise(child)) {
            // Reserve the key before settlement can reorder it.
            if (state.copyBySource) writeOutput(
                state.copyBySource.get(value),
                key,
                undefined,
            )
            const readiness = runExportStep(
                state,
                position,
                () => walkPromise(value, key, child, state, position),
            )
            if (!languageValues.isError(readiness)) waits.push(readiness)
            continue
        }

        const readiness = walkValue(child, state, position)
        if (state.copyBySource) writeOutput(
            state.copyBySource.get(value),
            key,
            copiedValue(child, state),
        )
        if (readiness) waits.push(readiness)
    }
    return waits.length === 0
        ? undefined
        : operationLifecycle.continueInternal(
            state.owner,
            Promise.all(waits),
            () => undefined,
        )
}

function runExportStep(state, position, step) {
    // Only the exact user-code boundary becomes language Error data.
    const result = errorUtils.catchUserCodeFailure(step, error => error)
    if (languageValues.isError(result)) collectError(state, position, result)
    return result
}

function walkPromise(parent, key, promise, state, position) {
    const result = propertyVersions.continuePropertyValue(
        parent,
        key,
        promise,
        value => {
            if (!operationLifecycle.mayContinue(state.owner)) return undefined
            return runExportTransition(state, position, () => {
                const readiness = walkValue(value, state, position)
                if (state.copyBySource) writeOutput(
                    state.copyBySource.get(parent),
                    key,
                    copiedValue(value, state),
                )
                return readiness
            })
        },
    )
    return operationLifecycle.observeFatal(state.owner, result)
}

function runExportTransition(state, position, transition) {
    return operationLifecycle.run(state.owner, () => {
        return runExportStep(state, position, transition)
    })
}

function createOutput(value) {
    const meta = metadata.requireMeta(value)
    return meta.type === metadata.TYPE_ARRAY
        ? new Array(arrayViews.logicalArrayLength(value))
        : Object.create(meta.admittedPrototype)
}

function copiedValue(value, state) {
    return languageValues.isTraversable(value)
        ? state.copyBySource.get(value)
        : value
}

function writeOutput(parent, key, value) {
    // Never let an inherited __proto__ setter change the copy's prototype.
    Object.defineProperty(parent, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
    })
}

function collectError(state, position, error) {
    const errors = state.collectedErrors[position] ??= new Set()
    errors.add(error)
    state.discardCopies()
}

function finishExport(state, selectResult) {
    const errors = state.collectedErrors
        .map(errors => errors && errorUtils.combineErrors(
            errors,
            "export: branch contains errors",
        ))
        .filter(languageValues.isError)
    const exportedValues = state.exportedValues
    state.release()
    if (errors.length > 0) {
        return errorUtils.combineErrors(
            errors,
            "Operation received multiple Errors",
        )
    }
    return selectResult(exportedValues)
}

export { exportManyValues, exportValue }
