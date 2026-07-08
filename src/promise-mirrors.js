const {
    isTracked,
    onResolve,
} = require("./helpers")
const {
    ensureMeta,
    markImported,
    markShared,
    metaOf,
} = require("./meta")

let writeMirrorValue = null

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

function initPromiseMirrors(writeValue) {
    writeMirrorValue = writeValue
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

function getOrCreatePromiseMirror(node, key, promise, importContext = undefined) {
    const map = ensurePromiseMirrorMap(node)
    if (map[key]?.promise === promise) {
        return map[key]
    }

    return createPromiseMirror(node, key, promise, null, false, importContext)
}

function createAssignedPromiseMirror(node, key, promise) {
    createPromiseMirror(node, key, promise)
}

function forkPromiseMirror(
    source,
    copy,
    key,
    promise,
    markResolvedValueShared,
    importContext,
) {
    // DISCOVERY if source was an orphan. Non-extensible sources cannot carry
    // mirrors, so the copy is seeded from the raw settled value instead.
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
// Error values here through onResolve/settlePromise; runtime bugs thrown by
// this continuation are intentionally not caught.
// forkSourceMirror is read inside the onResolve continuation, so FORK reads
// forkSourceMirror.currentValue at the copier's FIFO slot, not earlier. Imported
// promise keys mark the chosen value with the context captured when the mirror
// is born, before any consumer can observe it. The value is stored as
// currentValue, then written to the live key only if this exact mirror still
// owns it.
function onPromiseMirrorResolved(
    node,
    key,
    mirror,
    forkSourceMirror,
    markResolvedValueShared,
    importContext,
) {
    onResolve(mirror.promise, settledValueOrError => {
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
        }
        mirror.currentValue = value
        // Else a later op reassigned/deleted the key: keep currentValue alive
        // privately for reads that captured this mirror; leave the property alone.
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
