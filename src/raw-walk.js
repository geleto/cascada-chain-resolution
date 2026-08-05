import * as arrayViews from "./array-view.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as resolution from "./resolution.js"

// Raw traversal deliberately ignores cycle cuts. Identity state makes cycles
// finite and spans every Promise continuation captured by this operation.
// onError lets export release an abandoned partial copy. Argument export sets
// preserveErrors so nested Error values remain in that copy.
function createRawWalkState(
    onError = undefined,
    preserveErrors = false,
) {
    const state = {
        copying: true,
        copies: new WeakMap(),
        errors: new Set(),
        visited: new WeakSet(),
        foundError(error) {
            if (preserveErrors) return
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
function walkRawBranch(value, state) {
    if (languageValues.isError(value)) {
        state.foundError(value)
        return undefined
    }
    if (!languageValues.isTracked(value)) return undefined

    if (state.visited.has(value)) return undefined
    state.visited.add(value)

    const output = state.copying
        ? (
            arrayViews.isLogicalArray(value)
                ? new Array(arrayViews.logicalArrayLength(value))
                : {}
        )
        : undefined
    if (state.copying) state.copies.set(value, output)

    const waits = []
    // Sanctioned write bypass: export output stays outside the runtime graph.
    for (const key of languageProperties.enumerableLanguageKeys(value)) {
        const child = languageProperties.readLanguageProperty(value, key)
        if (languageValues.isPromise(child)) {
            // Reserve the captured key now so later settlement cannot change
            // the source's observable own-key order.
            if (state.copying) {
                languageProperties.writeLanguageProperty(output, key, undefined)
            }
            waits.push(walkRawPromise(value, key, child, state))
            continue
        }

        const readiness = walkRawBranch(child, state)
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
function walkRawPromise(parent, key, promise, state) {
    const mirror = promiseMirrors.getOrCreatePromiseMirror(
        parent,
        key,
        promise,
    )
    return resolution.onLaterPromiseReady(promise, () => {
        const value = mirror.getValue(parent, key)
        const readiness = walkRawBranch(value, state)
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
    return languageValues.isTracked(value) ? state.copies.get(value) : value
}

export { createRawWalkState, walkRawBranch }
