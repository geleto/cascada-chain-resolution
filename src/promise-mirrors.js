const { onValueResolve } = require("./helpers")
const {
    ensureMeta,
    metaOf,
} = require("./meta")
const { reportFatalError } = require("./error")

const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

let preparePropertyTransition
let commitMirrorDrain

function initPromiseMirrors(
    preparePropertyTransitionFn,
    commitMirrorDrainFn,
) {
    preparePropertyTransition = preparePropertyTransitionFn
    commitMirrorDrain = commitMirrorDrainFn
}

function getPromiseMirror(node, key) {
    return metaOf(node)?.mirrors?.[key]
}

function getRequiredPromiseMirror(node, key, promise) {
    const mirror = getPromiseMirror(node, key)
    if (!mirror || mirror.promise !== promise) {
        reportFatalError(new Error("Indexed promise property has no matching mirror"))
    }
    return mirror
}

function installPromiseMirror(node, key, mirror) {
    const meta = ensureMeta(node)
    meta.mirrors ??= Object.create(null)
    meta.mirrors[key] = mirror
}

// Creation registers the mandatory consumer; callers publish the mirror only
// when its owner/key placement represents this promise.
function createPromiseMirror(
    node,
    key,
    promise,
    forkSourceMirror = null,
    markResolvedValueShared = false,
    importBoundary = undefined,
    ownerIsImportedOriginal = false,
) {
    const mirror = {
        node,
        key,
        // Mirrors are created for promise properties
        promise,
        // Latest logical value produced by completed FIFO consumers.
        currentValue: undefined,
        // Whether currentValue was prepared while its owner had refcounts.
        preparedWhileOwnerIndexed: false,
        // Registered consumers not yet completed; zero exposes currentValue synchronously.
        pendingConsumerCount: 0,
        // Error queries see this instead of currentValue; other operations use currentValue.
        cycleError: undefined,
        // Import provenance: { root, errorContext } for lazy preparation and attribution.
        importBoundary,
        // Original imported owners retain the physical Promise after settlement.
        ownerIsImportedOriginal,
    }

    // The mandatory writeback is born first. Every later operation on this
    // placement registers through the same counted wrapper.
    onPromiseMirrorResolve(mirror, settledValueOrError => {
        const value = forkSourceMirror === null
            ? settledValueOrError
            : forkSourceMirror.currentValue
        setPromiseMirrorValue(mirror, value, markResolvedValueShared)
    })
    return mirror
}

// ASSIGN: always a fresh mirror. Reusing one would merge two divergent worlds.
// It remains private until the assignment's live-edge commit publishes it.
function createAssignedPromiseMirror(node, key, promise) {
    return createPromiseMirror(node, key, promise)
}

// DISCOVERY: the physical Promise already occupies the imported/raw property.
function getOrCreatePromiseMirror(node, key, promise, importBoundary = undefined) {
    const existing = getPromiseMirror(node, key)
    if (existing?.promise === promise) return existing
    const mirror = createPromiseMirror(
        node,
        key,
        promise,
        null,
        false,
        importBoundary,
        importBoundary !== undefined,
    )
    installPromiseMirror(node, key, mirror)
    return mirror
}

// FORK: read the source mirror at this FIFO position, but prepare the value for
// the copy's own owner/key placement. A fork is language-owned, never external.
function forkPromiseMirror(
    source,
    copy,
    key,
    promise,
    markResolvedValueShared,
    importBoundary,
) {
    const forkSourceMirror = getOrCreatePromiseMirror(
        source,
        key,
        promise,
        importBoundary,
    )
    const mirror = createPromiseMirror(
        copy,
        key,
        promise,
        forkSourceMirror,
        markResolvedValueShared,
        importBoundary,
    )
    installPromiseMirror(copy, key, mirror)
    return mirror
}

function clearPromiseMirror(node, key) {
    const mirrors = metaOf(node)?.mirrors
    if (mirrors) delete mirrors[key]
}

// Revoked mirrors leave the map but may remain referenced by earlier promise
// consumers; only the current map entry may update the property.
function isLivePromiseMirror(node, key, mirror) {
    return getPromiseMirror(node, key) === mirror
}

// The completion hook runs after the continuation's synchronous body, so a
// re-entrant registration keeps the edge pending and a returned Promise does
// not delay this mirror's drain.
function onPromiseMirrorResolve(mirror, fn) {
    // Count every consumer synchronously, before its resolution callback is
    // registered or can run.
    mirror.pendingConsumerCount++
    return onValueResolve(mirror.promise, value => {
        const result = fn(value)
        if (mirror.pendingConsumerCount === 1) commitMirrorDrain(mirror)
        // A thrown consumer or drain commit never reaches this decrement, so
        // its outstanding count permanently prevents publication.
        mirror.pendingConsumerCount--
        return result
    })
}

function setPromiseMirrorValue(mirror, value, markResolvedValueShared = false) {
    const prepared = preparePropertyTransition(
        mirror.node,
        mirror.key,
        mirror,
        value,
        markResolvedValueShared,
    )
    mirror.currentValue = prepared.value
    mirror.cycleError = prepared.cycleError
    mirror.preparedWhileOwnerIndexed = prepared.preparedWhileOwnerIndexed
}

function readLogicalProperty(node, key) {
    const mirror = getPromiseMirror(node, key)
    if (mirror) {
        return mirror.pendingConsumerCount === 0
            ? mirror.currentValue
            : mirror.promise
    }
    return propertyIsEnumerable.call(node, key) ? node[key] : undefined
}

module.exports = {
    clearPromiseMirror,
    createAssignedPromiseMirror,
    forkPromiseMirror,
    getOrCreatePromiseMirror,
    getPromiseMirror,
    getRequiredPromiseMirror,
    initPromiseMirrors,
    installPromiseMirror,
    isLivePromiseMirror,
    onPromiseMirrorResolve,
    readLogicalProperty,
    setPromiseMirrorValue,
}
