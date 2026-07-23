import * as helpers from "./helpers.js"
import * as errorUtils from "./error.js"

const STORE_META_IN_WEAKMAP = process.env.CASCADA_META_STORAGE === "weakmap"
const META = Symbol("META")
const META_MAP = new WeakMap()
const hasOwn = Object.prototype.hasOwnProperty

function createMeta() {
    return {
        // An empty record can also mean imported preparation visited the node.
        // shared: added when ownership first becomes shared.
        // mirrors: added when the first promise mirror is installed.
        // cycleErrors: added when the first cycle cut is published.
        // promiseCount, errorCount, parents: added together by ref-indexing.
        // settlementPromise, settlementResolve: added by a pending normalize.
        // importBoundary: added at a direct import boundary.
        // importedOriginal: added to objects owned by imported host data.
    }
}

// Inline storage falls back to the WeakMap when an object cannot accept the
// Symbol. Both storage modes therefore behave identically for non-extensible nodes.
function metaOf(value) {
    if (!helpers.isTracked(value)) return undefined
    if (!STORE_META_IN_WEAKMAP && hasOwn.call(value, META)) {
        return value[META]
    }
    return META_MAP.get(value)
}

function ensureMeta(value) {
    if (!helpers.isTracked(value)) {
        errorUtils.reportFatalError(
            new TypeError("Cannot attach metadata to this value"),
        )
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
    return helpers.isTracked(value) &&
        (metaOf(value)?.shared === true || !Object.isExtensible(value))
}

// Bare promises crossing an ownership boundary resolve to shared values.
// Mirrored promise properties mark their prepared logical value instead.
function markShared(value) {
    if (helpers.isPromise(value)) return helpers.onValueResolve(value, markShared)
    if (!helpers.isTracked(value) || !Object.isExtensible(value)) return value
    ensureMeta(value).shared = true
    return value
}

// A direct mark makes the value the root of its own imported boundary and
// returns whether that boundary was created. A metadata-free root is new host
// data; existing META identifies a trusted runtime island. Descendants inherit
// the boundary until independent use creates another one.
function markImported(value, errorContext) {
    if (!helpers.isTracked(value)) return false

    let meta = metaOf(value)
    if (!meta) {
        meta = ensureMeta(value)
        meta.importedOriginal = true
    }
    const createdBoundary = !meta.importBoundary
    if (createdBoundary) {
        meta.importBoundary = { root: value, errorContext }
    }
    meta.shared = true
    return createdBoundary
}

function nodeImportBoundary(node, inherited) {
    const own = metaOf(node)?.importBoundary
    return own === undefined ? inherited : own
}

// Each cycle cut stores its attributed Error directly on the owner/key property.
export {
    ensureMeta,
    hasSharedMark,
    markImported,
    markShared,
    metaOf,
    nodeImportBoundary,
    STORE_META_IN_WEAKMAP,
}
