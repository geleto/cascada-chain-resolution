import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"

const STORE_META_IN_WEAKMAP = process.env.CASCADA_META_STORAGE === "weakmap"
const META = Symbol("META")
const META_MAP = new WeakMap()
const hasOwn = Object.prototype.hasOwnProperty

function metaOf(value) {
    if (!languageValues.isTracked(value)) return undefined
    if (!STORE_META_IN_WEAKMAP && hasOwn.call(value, META)) {
        return value[META]
    }
    return META_MAP.get(value)
}

function ensureMeta(value, imported = false) {
    if (!languageValues.isTracked(value)) {
        errorUtils.reportFatalError(
            new TypeError("Cannot attach metadata to this value"),
        )
    }

    const hasInlineMeta = !STORE_META_IN_WEAKMAP && hasOwn.call(value, META)
    let meta = hasInlineMeta ? value[META] : META_MAP.get(value)
    if (
        meta &&
        imported &&
        hasInlineMeta
    ) {
        // Move runtime metadata out before this identity becomes borrowed.
        delete value[META]
        META_MAP.set(value, meta)
    }
    if (!meta) {
        // Import creates external records before other metadata is needed.
        // Each subsystem adds only the fields it owns.
        meta = {}
        // Import must not add even hidden properties to borrowed host data.
        if (STORE_META_IN_WEAKMAP || imported) {
            META_MAP.set(value, meta)
        } else {
            Object.defineProperty(value, META, {
                value: meta,
                enumerable: false,
                writable: true,
                configurable: true,
            })
        }
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
    const meta = ensureMeta(value, true)
    meta.importBoundary ??= importBoundary
    meta.shared = true
}

function importBoundaryOf(value) {
    return metaOf(value)?.importBoundary
}

export {
    ensureMeta,
    markImported,
    markShared,
    metaOf,
    importBoundaryOf,
    requiresCopyOnWrite,
    STORE_META_IN_WEAKMAP,
    updateReadLease,
}
