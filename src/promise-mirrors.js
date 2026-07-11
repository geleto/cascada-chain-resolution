const {
    isTracked,
    onValueResolve,
} = require("./helpers")
const {
    ensureMeta,
    markImported,
    markShared,
    metaOf,
} = require("./meta")

// Live writeback is a language write owned by index.js; private child indexing
// is owned by refcounts.js. Both callbacks are injected once at startup so this
// module stays below those layers.
let writeMirrorValue = null
let refIndexMirrorValue = null

function getPromiseMirrorMap(node) {
    return metaOf(node)?.mirrors
}

function ensurePromiseMirrorMap(node) {
    const meta = ensureMeta(node)
    if (meta.mirrors === null) {
        meta.mirrors = Object.create(null)             // null proto: no inherited keys
    }
    return meta.mirrors
}

function initPromiseMirrors(writeValue, refIndexValue) {
    writeMirrorValue = writeValue
    refIndexMirrorValue = refIndexValue
}

function createPromiseMirror(
    node,
    key,
    promise,
    forkSourceMirror = null,
    markResolvedValueShared = false,
    importContext = undefined,
) {
    const mirror = {
        promise,
        currentValue: undefined,
    }
    ensurePromiseMirrorMap(node)[key] = mirror
    onPromiseMirrorResolved(
        node,
        key,
        mirror,
        forkSourceMirror,
        markResolvedValueShared,
        importContext,
    )
    return mirror
}

// BIRTH 2 - DISCOVERY: find the mirror for a promise reached during a walk, or
// lazily create one for an orphan (imported data, raw literal). COW-copied keys
// must never arrive here mirrorless; they are forked eagerly in shallowCopy —
// a mirror minted lazily here would seed currentValue from the raw resolved
// value and lose every write made by ops issued before the copy.
function getOrCreatePromiseMirror(node, key, promise, importContext = undefined) {
    const map = ensurePromiseMirrorMap(node)
    if (map[key]?.promise === promise) {
        return map[key]
    }

    return createPromiseMirror(node, key, promise, null, false, importContext)
}

// BIRTH 1 - ASSIGN (rationale at the assignPath call site): always a fresh
// mirror, never a map[key] reuse — two assignments of one promise are
// divergent worlds that must not share currentValue.
function createAssignedPromiseMirror(node, key, promise) {
    createPromiseMirror(node, key, promise)
}

// BIRTH 3 - FORK (rationale at the shallowCopy call site).
function forkPromiseMirror(
    source,
    copy,
    key,
    promise,
    markResolvedValueShared,
    importContext,
) {
    // DISCOVERY on the source if it was an orphan. A non-extensible source
    // cannot carry mirrors and nothing can ever replace its key, so the raw
    // settled value is the only version that will ever exist — seeding the
    // copy from the promise itself is exact, and the importContext still
    // flavors the copy's mirror (there is no source mirror to inherit from).
    const forkSourceMirror = Object.isExtensible(source)
        ? getOrCreatePromiseMirror(source, key, promise, importContext)
        : null
    createPromiseMirror(copy, key, promise, forkSourceMirror, markResolvedValueShared, importContext)
}

function clearPromiseMirror(node, key) {
    const map = getPromiseMirrorMap(node)
    if (map === null || map === undefined) return
    delete map[key]
}

function isLivePromiseMirror(node, key, mirror) {
    return getPromiseMirrorMap(node)?.[key] === mirror
}

// Register the mirror's resolved-value handler. Rejected data promises become
// Error values here through onValueResolve; continuation failures are reported
// and rethrown as fatal runtime errors.
// forkSourceMirror is read inside the onValueResolve continuation, so FORK reads
// forkSourceMirror.currentValue at the copier's FIFO slot, not earlier. Imported
// promise keys mark the chosen value with the context captured when the mirror
// is born, before any consumer can observe it. A live mirror writes through the
// property helper; a revoked mirror privately indexes the same logical child
// without touching its former holder.
function onPromiseMirrorResolved(
    node,
    key,
    mirror,
    forkSourceMirror,
    markResolvedValueShared,
    importContext,
) {
    onValueResolve(mirror.promise, settledValueOrError => {
        let value = forkSourceMirror === null
            ? settledValueOrError
            : forkSourceMirror.currentValue
        if (importContext !== undefined) {
            markImported(value, importContext)
        } else if (markResolvedValueShared && isTracked(value)) {
            markShared(value)
        }

        if (isLivePromiseMirror(node, key, mirror)) {
            value = writeMirrorValue(node, key, value)
        } else {
            value = refIndexMirrorValue(node, value)
            // A later op reassigned/deleted the key. Keep the prepared value
            // privately for reads that captured this mirror; leave the key alone.
        }
        mirror.currentValue = value
    })
}

module.exports = {
    clearPromiseMirror,
    createAssignedPromiseMirror,
    forkPromiseMirror,
    getOrCreatePromiseMirror,
    initPromiseMirrors,
    isLivePromiseMirror,
}
