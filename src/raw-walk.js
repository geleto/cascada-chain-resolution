import * as helpers from "./helpers.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as languageProperties from "./language-properties.js"

// Raw traversal deliberately ignores cycle cuts. Identity state makes cycles
// finite and spans every Promise continuation captured by this operation.
function copyRawBranch(value, importBoundary) {
    const inspection = {
        hasOrdinaryError: false,
        readiness: undefined,
        value: undefined,
    }
    const state = {
        copies: new Map(),
        onError() {
            inspection.hasOrdinaryError = true
        },
    }
    const result = walkRawBranch(value, importBoundary, state)
    inspection.readiness = result.readiness
    inspection.value = result.value
    return inspection
}

function collectRawErrorWaits(
    value,
    importBoundary,
    state,
) {
    return walkRawBranch(value, importBoundary, state).readiness
}

function walkRawBranch(value, inheritedImportBoundary, state) {
    if (state.rawStopped) return { value, readiness: undefined }
    if (helpers.isError(value)) {
        state.onError(value)
        if (state.firstErrorOnly) state.rawStopped = true
        return { value, readiness: undefined }
    }
    if (!helpers.isTracked(value)) return { value, readiness: undefined }

    if (state.copies) {
        if (state.copies.has(value)) {
            return { value: state.copies.get(value), readiness: undefined }
        }
    } else if (state.rawVisited.has(value)) {
        return { value, readiness: undefined }
    }

    const output = state.copies
        ? (Array.isArray(value) ? new Array(value.length) : {})
        : value
    if (state.copies) {
        state.copies.set(value, output)
    } else {
        state.rawVisited.add(value)
    }

    const importBoundary = metadata.nodeImportBoundary(value, inheritedImportBoundary)
    const waits = []
    // Sanctioned write bypass: export output stays outside the runtime graph.
    for (const key of Object.keys(value)) {
        if (state.rawStopped) break
        const child = languageProperties.readLanguageProperty(value, key)
        const mirror = promiseMirrors.getOrCreateMirrorForValue(
            value,
            key,
            child,
            importBoundary,
        )
        const propertyImportBoundary = mirror?.importBoundary ?? importBoundary

        if (helpers.isPromise(child)) {
            waits.push(mirror.onResolve(() => {
                const nested = walkRawBranch(
                    mirror.currentValue,
                    mirror.importBoundary ?? importBoundary,
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

        const nested = walkRawBranch(child, propertyImportBoundary, state)
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

export { collectRawErrorWaits, copyRawBranch }
