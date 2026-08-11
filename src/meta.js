import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"

const META_MAP = new WeakMap()

function metaOf(value) {
    return META_MAP.get(value)
}

function ensureMeta(value) {
    if (!languageValues.isTracked(value)) {
        errorUtils.reportFatalError(
            new TypeError("Cannot attach metadata to this value"),
        )
    }

    let meta = META_MAP.get(value)
    if (!meta) {
        meta = {}
        META_MAP.set(value, meta)
    }
    return meta
}

function requiresCopyOnWrite(value) {
    const meta = metaOf(value)
    return meta?.shared === true ||
        (meta?.readEnterCount ?? 0) > 0
}

function updateReadLease(value, change) {
    const meta = ensureMeta(value)
    const count = meta.readEnterCount ?? 0
    const next = count + change
    if (next < 0) {
        errorUtils.reportFatalError(new Error("Read lease underflow"))
    }
    if (next === 0) delete meta.readEnterCount
    else meta.readEnterCount = next
}

function acquireReadLease(value) {
    if (!languageValues.isTracked(value)) return () => {}
    updateReadLease(value, 1)
    return () => updateReadLease(value, -1)
}

function markShared(value) {
    if (languageValues.isPromise(value)) {
        errorUtils.reportFatalError(
            new TypeError("A Promise must be shared by its property version"),
        )
    }
    if (languageValues.isTracked(value)) ensureMeta(value).shared = true
    return value
}

// Every identity reached by one import shares its attribution token.
function markImported(value, importBoundary) {
    const meta = ensureMeta(value)
    meta.importBoundary ??= importBoundary
    meta.shared = true
}

function importBoundaryOf(value) {
    return metaOf(value)?.importBoundary
}

export {
    acquireReadLease,
    ensureMeta,
    markImported,
    markShared,
    metaOf,
    importBoundaryOf,
    requiresCopyOnWrite,
}
