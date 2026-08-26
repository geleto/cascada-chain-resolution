import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import * as resolution from "./resolution.js"

function exportValue(value) {
    const result = exportManyValues([value])
    return resolution.continueInternalPromiseOrFatal(
        result,
        values => languageValues.isError(values) ? values : values[0],
    )
}

function exportManyValues(values) {
    const state = {
        open: true,
        copyBySource: new WeakMap(),
        collectedErrors: new Array(values.length),
        exportedValues: new Array(values.length),
        visited: values.map(() => new WeakSet()),
    }
    let result
    try {
        const readiness = values.map((value, index) => {
            return prepareValue(value, index, state)
        })
        result = resolution.continueInternalPromisesOrFatal(
            readiness,
            () => finishExport(state),
        )
    } catch (error) {
        closeExport(state)
        throw error
    }
    return closeOnFatalRejection(result, state)
}

function prepareValue(value, position, state) {
    // A closed export must not admit or inspect a late input fulfillment.
    const result = languageValues.isPromise(value)
        ? languageValues.continuePromise(
            value,
            resolved => errorUtils.runFatal(prepareReadyRoot, resolved),
            reason => errorUtils.runFatal(() => {
                if (!state.open) return undefined
                return prepareReadyRoot(errorUtils.toPoison(reason))
            }),
        )
        : errorUtils.runFatal(prepareReadyRoot, value)
    return closeOnFatalRejection(result, state)

    function prepareReadyRoot(resolved) {
        if (!state.open) return undefined
        languageValues.admitReadyValue(resolved)
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
    }
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
            // Reserve the key at capture time so settlement cannot reorder it.
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
    return waits.length === 0 ? undefined : Promise.all(waits)
}

function runExportStep(state, position, step) {
    // Only supported user-code failure becomes language data. Any ordinary
    // throw keeps propagating to the fatal transition boundary.
    const result = errorUtils.catchUserCodeFailure(
        step,
        error => error,
    )
    if (languageValues.isError(result)) {
        collectError(state, position, result)
    }
    return result
}

function walkPromise(parent, key, promise, state, position) {
    const result = propertyVersions.continuePropertyValue(
        parent,
        key,
        promise,
        value => {
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
    return closeOnFatalRejection(result, state)
}

function closeOnFatalRejection(result, state) {
    if (languageValues.isPromise(result)) {
        // Close at each async layer so a fatal rejection stops sibling
        // continuations before it propagates through their Promise aggregates.
        resolution.observeResultPromise(
            result,
            () => {},
            () => closeExport(state),
        )
    }
    return result
}

function runExportTransition(state, position, transition) {
    if (!state.open) return undefined
    // A transition contains one synchronous continuation. runExportStep
    // consumes language Errors; anything thrown past it is fatal.
    try {
        return runExportStep(state, position, transition)
    } catch (error) {
        closeExport(state)
        throw error
    }
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
    // Define host data directly so keys such as __proto__ cannot invoke an
    // inherited setter or change the output prototype.
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
    discardOutput(state)
    return undefined
}

function discardOutput(state) {
    if (!state.copyBySource) return
    state.copyBySource = undefined
    state.exportedValues = undefined
}

function finishExport(state) {
    const errors = state.collectedErrors
        .map(errors => errors && errorUtils.combineErrors(
            errors,
            "export: branch contains errors",
        ))
        .filter(languageValues.isError)
    const exportedValues = state.exportedValues
    closeExport(state)
    return errors.length > 0
        ? errorUtils.combineErrors(
            errors,
            "Operation received multiple Errors",
        )
        : exportedValues
}

function closeExport(state) {
    state.open = false
    state.copyBySource = undefined
    state.collectedErrors = undefined
    state.exportedValues = undefined
    state.visited = undefined
}

export { exportManyValues, exportValue }
