const {
    isPromise,
    isTracked,
    onValueResolve,
} = require("./helpers")
const { reportFatalError } = require("./error")

const STORE_META_IN_WEAKMAP = false
const META = Symbol("META")
const META_MAP = new WeakMap()
const hasOwn = Object.prototype.hasOwnProperty
// Inline Symbol storage cannot attach records to non-extensible values, but
// import attribution must survive on them (they are exactly the values most
// likely to fail counting validation). Written only by markImported, read only
// by nodeImportContext's non-extensible branch — never on the hasSharedMark
// hot path. WeakMap storage needs no side table.
const FROZEN_IMPORT_CONTEXTS = STORE_META_IN_WEAKMAP ? null : new WeakMap()

function createMeta() {
    return {
        shared: false,             // set once, never cleared; false at birth = "no mark"
        mirrors: null,             // lazy promise mirror map (promise-mirrors.js)
        promiseCount: 0,           // counter totals, meaningful only once ref-indexed
        errorCount: 0,
        settlementPromise: undefined, // one pending settlement promise for normalize
        settlementResolve: undefined,
        settlementVerifyScheduled: false,   // normalize settlement verification latch
        importContext: undefined,  // undefined = not imported; else the import's error attribution
        parents: undefined,        // undefined = not ref-indexed; Map<parent, edgeCount> once live
    }
}

// WeakMap storage can hold records for non-extensible nodes; inline Symbol
// storage cannot, so frozen/sealed values have no record in that mode (their
// import attribution lives in FROZEN_IMPORT_CONTEXTS instead).
function metaOf(value) {
    if (!isTracked(value)) return undefined
    if (STORE_META_IN_WEAKMAP) return META_MAP.get(value)
    if (!Object.isExtensible(value)) return undefined
    // META belongs to this exact node; runtime objects may themselves be prototypes.
    return hasOwn.call(value, META) ? value[META] : undefined
}

function ensureMeta(value) {
    if (!isTracked(value) || (!STORE_META_IN_WEAKMAP && !Object.isExtensible(value))) {
        reportFatalError(new TypeError("Cannot attach metadata to this value"))
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
    if (isPromise(value)) return onValueResolve(value, markShared)

    return setSharedMark(value)
}

// The import marker: importContext is both the "came from outside" flag and
// the error attribution for later validation failures. First import wins, and
// marking implies the shared mark — imported data is never owned. Frozen
// values cannot carry the inline record; their attribution goes to the side
// table (implicitly shared already via non-extensibility).
function markImported(value, importContext) {
    if (isPromise(value)) {
        onValueResolve(value, settledValueOrError => markImported(settledValueOrError, importContext))
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

// The context a walk should carry after touching this node: the node's own
// marker wins, then (for frozen nodes, which carry no inline record) the side
// table, then whatever the walk inherited from a marked ancestor.
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
