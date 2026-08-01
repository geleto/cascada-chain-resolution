import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as resolution from "./resolution.js"

const STORE_META_IN_WEAKMAP = process.env.CASCADA_META_STORAGE === "weakmap"
const META = Symbol("META")
const META_MAP = new WeakMap()
const hasOwn = Object.prototype.hasOwnProperty

// Inline storage falls back to the WeakMap when an object cannot accept the
// Symbol. Both storage modes therefore behave identically for non-extensible nodes.
function metaOf(value) {
    if (!languageValues.isTracked(value)) return undefined
    if (!STORE_META_IN_WEAKMAP && hasOwn.call(value, META)) {
        return value[META]
    }
    return META_MAP.get(value)
}

function ensureMeta(value) {
    if (!languageValues.isTracked(value)) {
        errorUtils.reportFatalError(
            new TypeError("Cannot attach metadata to this value"),
        )
    }

    let meta = metaOf(value)
    if (!meta) {
        // Fields are added by the subsystems that own them. An empty record can
        // also mean imported preparation has visited the node.
        meta = {}
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

function requiresCopyOnWrite(value) {
    const meta = metaOf(value)
    return meta?.shared === true ||
        (meta?.readEnterCount ?? 0) > 0 ||
        !Object.isExtensible(value)
}

function updateReadLease(value, change) {
    const meta = ensureMeta(value)
    const count = meta.readEnterCount ?? 0
    const next = count + change
    if (next === 0) delete meta.readEnterCount
    else meta.readEnterCount = next
}

// Bare promises crossing an ownership boundary resolve to shared values.
// Mirrored promise properties mark their prepared logical value instead.
function markShared(value) {
    return resolution.resolveInitialValueOrPoison(value, resolved => {
        if (
            !languageValues.isTracked(resolved) ||
            !Object.isExtensible(resolved)
        ) return resolved
        ensureMeta(resolved).shared = true
        return resolved
    })
}

// A direct mark makes the value the root of its own imported boundary and
// returns whether that boundary was created. A metadata-free root is new host
// data; existing META identifies a trusted runtime island. Descendants inherit
// the boundary until independent use creates another one.
function markImported(value, errorContext) {
    if (!languageValues.isTracked(value)) return false

    const meta = ensureMeta(value)
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

export {
    ensureMeta,
    markImported,
    markShared,
    metaOf,
    nodeImportBoundary,
    requiresCopyOnWrite,
    STORE_META_IN_WEAKMAP,
    updateReadLease,
}
