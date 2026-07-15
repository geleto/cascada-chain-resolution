const {
    isPromise,
    isTracked,
    onValueResolve,
} = require("./helpers")
const { reportFatalError } = require("./error")

const STORE_META_IN_WEAKMAP = process.env.CASCADA_META_STORAGE === "weakmap"
const META = Symbol("META")
const META_MAP = new WeakMap()
const hasOwn = Object.prototype.hasOwnProperty

function createMeta() {
    return {
        // shared: added when ownership first becomes shared.
        // mirrors: added when the first promise mirror is installed.
        // cycleErrors: added when the first cycle cut is published.
        // promiseCount, errorCount, parents: added together by ref-indexing.
        // settlementPromise, settlementResolve: added by a pending normalize.
        // importContext: added at a direct import boundary.
        // importPrepared: added after imported-graph preparation commits.
    }
}

// Inline storage falls back to the WeakMap when an object cannot accept the
// Symbol. Both storage modes therefore behave identically for non-extensible nodes.
function metaOf(value) {
    if (!isTracked(value)) return undefined
    if (!STORE_META_IN_WEAKMAP && hasOwn.call(value, META)) {
        return value[META]
    }
    return META_MAP.get(value)
}

function ensureMeta(value) {
    if (!isTracked(value)) {
        reportFatalError(new TypeError("Cannot attach metadata to this value"))
    }

    let meta = metaOf(value)
    if (!meta) {
        meta = createMeta()
        if (STORE_META_IN_WEAKMAP || !Object.isExtensible(value)) {
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

function hasSharedMark(value) {
    return isTracked(value) &&
        (metaOf(value)?.shared === true || !Object.isExtensible(value))
}

// Bare promises crossing an ownership boundary resolve to shared values.
// Mirrored promise properties mark their prepared logical value instead.
function markShared(value) {
    if (isPromise(value)) return onValueResolve(value, markShared)
    if (!isTracked(value) || !Object.isExtensible(value)) return value
    ensureMeta(value).shared = true
    return value
}

// importValue resolves bare promises before marking the boundary root.
// Descendants inherit its context during a walk and are marked shared by lazy
// imported preparation.
function markImported(value, importContext) {
    if (!isTracked(value)) return value

    const meta = ensureMeta(value)
    meta.importContext ??= importContext
    meta.shared = true
    return value
}

function nodeImportContext(node, inherited) {
    const own = metaOf(node)?.importContext
    return own === undefined ? inherited : own
}

function getCycleError(node, key) {
    return metaOf(node)?.cycleErrors?.[key]
}

// Each cycle cut stores its attributed Error directly on the owner/key placement.
function setCycleError(node, key, cycleError) {
    const meta = ensureMeta(node)
    meta.cycleErrors ??= Object.create(null)
    meta.cycleErrors[key] = cycleError
}

function clearCycleError(node, key) {
    const meta = metaOf(node)
    if (meta?.cycleErrors) delete meta.cycleErrors[key]
}

module.exports = {
    clearCycleError,
    ensureMeta,
    getCycleError,
    hasSharedMark,
    markImported,
    markShared,
    metaOf,
    nodeImportContext,
    setCycleError,
    STORE_META_IN_WEAKMAP,
}
