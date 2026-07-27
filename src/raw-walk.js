import * as helpers from "./helpers.js"
import * as metadata from "./meta.js"
import * as languageProperties from "./language-properties.js"
import * as promiseMirrors from "./promise-mirrors.js"

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
        if (helpers.isPromise(child)) {
            // Reserve the captured key now so later settlement cannot change
            // the source's observable own-key order.
            if (state.copying) {
                languageProperties.writeLanguageProperty(output, key, undefined)
            }
            waits.push(walkRawPromise(
                value,
                key,
                child,
                importBoundary,
                state,
            ))
            continue
        }

        const readiness = walkRawBranch(child, importBoundary, state)
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
function walkRawPromise(
    parent,
    key,
    promise,
    importBoundary,
    state,
) {
    const mirror = promiseMirrors.getOrCreatePromiseMirror(
        parent,
        key,
        promise,
        importBoundary,
    )
    return helpers.onLaterPromiseReady(promise, () => {
        const value = mirror.getValue(parent, key)
        const readiness = walkRawBranch(
            value,
            mirror.importBoundary ?? importBoundary,
            state,
        )
        if (state.copying) {
            languageProperties.writeLanguageProperty(
                state.copies.get(parent),
                key,
                getCopiedValue(value, state),
            )
        }
        return readiness
    })
}

function getCopiedValue(value, state) {
    return helpers.isTracked(value) ? state.copies.get(value) : value
}

export { createRawWalkState, walkRawBranch }
