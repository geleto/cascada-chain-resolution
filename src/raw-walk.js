import * as helpers from "./helpers.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as languageProperties from "./language-properties.js"

// Raw traversal deliberately ignores cycle cuts. Identity state makes cycles
// finite and spans every Promise continuation captured by this operation.
// onError lets export release its local reference to an abandoned partial copy.
function createRawWalkState(onError = undefined) {
    const state = {
        copying: true,
        copies: new WeakMap(),
        errors: new Set(),
        visited: new WeakSet(),
        foundError(error) {
            if (state.errors.has(error)) return
            state.errors.add(error)
            if (!state.copying) return
            state.copying = false
            state.copies = undefined
            if (onError) onError(error)
        },
    }
    return state
}

// Returns only optional readiness; copied values live in state.copies.
function walkRawBranch(value, inheritedImportBoundary, state) {
    if (helpers.isError(value)) {
        state.foundError(value)
        return undefined
    }
    if (!helpers.isTracked(value)) return undefined

    if (state.visited.has(value)) return undefined
    state.visited.add(value)

    const output = state.copying
        ? (Array.isArray(value) ? new Array(value.length) : {})
        : undefined
    if (state.copying) state.copies.set(value, output)

    const importBoundary = metadata.nodeImportBoundary(value, inheritedImportBoundary)
    const waits = []
    // Sanctioned write bypass: export output stays outside the runtime graph.
    for (const key of Object.keys(value)) {
        const child = languageProperties.readLanguageProperty(value, key)
        const mirror = promiseMirrors.getOrCreateMirrorForValue(
            value,
            key,
            child,
            importBoundary,
        )

        if (helpers.isPromise(child)) {
            // Reserve the captured key now so later settlement cannot change
            // the source's observable own-key order.
            if (state.copying) {
                languageProperties.writeLanguageProperty(output, key, undefined)
            }
            waits.push(walkRawPromise(value, key, mirror, importBoundary, state))
            continue
        }

        const propertyImportBoundary = mirror?.importBoundary ?? importBoundary
        const readiness = walkRawBranch(child, propertyImportBoundary, state)
        if (state.copying) {
            languageProperties.writeLanguageProperty(
                output,
                key,
                getCopiedValue(child, state),
            )
        }
        if (readiness) waits.push(readiness)
    }

    return waits.length === 0 ? undefined : Promise.all(waits)
}

// Keep pending continuations independent from the caller's output local. The
// first Error can then drop the copy map without a pending closure retaining it.
function walkRawPromise(parent, key, mirror, importBoundary, state) {
    return mirror.onResolve(() => {
        const readiness = walkRawBranch(
            mirror.currentValue,
            mirror.importBoundary ?? importBoundary,
            state,
        )
        if (state.copying) {
            languageProperties.writeLanguageProperty(
                state.copies.get(parent),
                key,
                getCopiedValue(mirror.currentValue, state),
            )
        }
        return readiness
    })
}

function getCopiedValue(value, state) {
    return helpers.isTracked(value) ? state.copies.get(value) : value
}

export { createRawWalkState, walkRawBranch }
