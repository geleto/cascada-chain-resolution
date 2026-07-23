import * as helpers from "./helpers.js"
import * as imports from "./import.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as languageProperties from "./language-properties.js"

// One logical traversal serves metadata-free normalization copying and
// exhaustive Error collection behind cycle cuts. Callers supply operation-local
// identity state; getErrors shares its visited set with the counted collector.
function copyRawBranch(value, importBoundary) {
    const state = {
        copies: new Map(),
        hasOrdinaryError: false,
    }
    const result = walkRawBranch(value, importBoundary, undefined, state)
    return {
        hasOrdinaryError: state.hasOrdinaryError,
        readiness: result.readiness,
        value: result.value,
    }
}

function collectRawErrors(
    value,
    importBoundary,
    cycleError,
    errors,
    visited,
) {
    const state = { errors, visited }
    return walkRawBranch(value, importBoundary, cycleError, state).readiness
}

function walkRawBranch(value, inheritedImportBoundary, cycleError, state) {
    if (cycleError && state.errors) state.errors.add(cycleError)

    if (helpers.isError(value)) {
        if (state.errors) {
            state.errors.add(value)
        } else {
            state.hasOrdinaryError = true
        }
        return { value, readiness: undefined }
    }
    if (!helpers.isTracked(value)) return { value, readiness: undefined }

    if (state.copies) {
        const copy = state.copies.get(value)
        if (copy) return { value: copy, readiness: undefined }
    } else if (state.visited.has(value)) {
        return { value, readiness: undefined }
    }

    const output = state.copies
        ? (Array.isArray(value) ? new Array(value.length) : {})
        : value
    if (state.copies) {
        state.copies.set(value, output)
    } else {
        state.visited.add(value)
    }

    const importBoundary = metadata.nodeImportBoundary(value, inheritedImportBoundary)
    const waits = []
    // Sanctioned write bypass: plain-copy output stays outside the runtime
    // graph, so these writes have no metadata or counters to bookkeep.
    for (const key of Object.keys(value)) {
        let mirror = promiseMirrors.getPromiseMirror(value, key)
        const child = promiseMirrors.readLogicalProperty(value, key)
        const propertyImportBoundary = mirror?.importBoundary ?? importBoundary
        const childCycleError = mirror
            ? mirror.cycleError
            : imports.getCycleError(value, key)

        if (helpers.isPromise(child)) {
            mirror ??= promiseMirrors.getOrCreatePromiseMirror(
                value,
                key,
                child,
                importBoundary,
            )
            waits.push(promiseMirrors.onPromiseMirrorResolve(mirror, () => {
                const resolvedImportBoundary = mirror.importBoundary ?? importBoundary
                const nested = walkRawBranch(
                    mirror.currentValue,
                    resolvedImportBoundary,
                    mirror.cycleError,
                    state,
                )
                if (state.copies) {
                    languageProperties.writeLanguageProperty(
                        output,
                        key,
                        nested.value,
                    )
                }
                return nested.readiness
            }))
            continue
        }

        const nested = walkRawBranch(
            child,
            propertyImportBoundary,
            childCycleError,
            state,
        )
        if (state.copies) {
            languageProperties.writeLanguageProperty(output, key, nested.value)
        }
        if (nested.readiness) waits.push(nested.readiness)
    }

    return {
        value: output,
        readiness: waits.length === 0 ? undefined : Promise.all(waits),
    }
}

export {
    collectRawErrors,
    copyRawBranch,
}
