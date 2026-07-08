const {
    isPromise,
    isTracked,
    onResolve,
} = require("./helpers")

const STORE_META_IN_WEAKMAP = false
const META = Symbol("META")
const META_MAP = new WeakMap()
const FROZEN_IMPORT_CONTEXTS = STORE_META_IN_WEAKMAP ? null : new WeakMap()

function createMeta() {
    return {
        shared: false,
        mirrors: null,
        promiseCount: 0,
        errorCount: 0,
        settlementVerifyScheduled: false,
        importContext: undefined,
        parents: undefined,
    }
}

function metaOf(value) {
    if (!isTracked(value)) return undefined
    if (STORE_META_IN_WEAKMAP) return META_MAP.get(value)
    if (!Object.isExtensible(value)) return undefined
    return value[META]
}

function ensureMeta(value) {
    if (!isTracked(value) || (!STORE_META_IN_WEAKMAP && !Object.isExtensible(value))) {
        throw new TypeError("Cannot attach metadata to this value")
    }

    let meta = metaOf(value)
    if (meta === undefined) {
        meta = createMeta()
        if (STORE_META_IN_WEAKMAP) {
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

function setSharedMark(value) {
    if (!isTracked(value) || !Object.isExtensible(value)) return value
    ensureMeta(value).shared = true
    return value
}

// Bare promises crossing an ownership boundary resolve to shared values.
// Promise keys with mirrors are different: promise-mirrors marks
// mirror.currentValue, because currentValue may have advanced away from the raw
// settled value.
function markShared(value) {
    if (isPromise(value)) return onResolve(value, markShared)

    return setSharedMark(value)
}

function markImported(value, importContext) {
    if (isPromise(value)) {
        onResolve(value, settledValueOrError => markImported(settledValueOrError, importContext))
        return value
    }
    if (!isTracked(value)) return value
    if (!Object.isExtensible(value) && !STORE_META_IN_WEAKMAP) {
        if (!FROZEN_IMPORT_CONTEXTS.has(value)) {
            FROZEN_IMPORT_CONTEXTS.set(value, importContext)
        }
        return value
    }

    const meta = ensureMeta(value)
    meta.importContext ??= importContext
    meta.shared = true
    return value
}

function nodeImportContext(node, inherited) {
    const own = metaOf(node)?.importContext
    if (own !== undefined) return own
    if (!STORE_META_IN_WEAKMAP && isTracked(node) && !Object.isExtensible(node)) {
        return FROZEN_IMPORT_CONTEXTS.get(node) ?? inherited
    }
    return inherited
}

module.exports = {
    ensureMeta,
    hasSharedMark,
    markImported,
    markShared,
    metaOf,
    nodeImportContext,
    STORE_META_IN_WEAKMAP,
}
