import * as helpers from "./helpers.js"
import * as metadata from "./meta.js"
import * as errorUtils from "./error.js"

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
    return metadata.metaOf(node)?.mirrors?.[key]
}

function getRequiredPromiseMirror(node, key, promise) {
    const mirror = getPromiseMirror(node, key)
    if (!mirror || mirror.promise !== promise) {
        errorUtils.reportFatalError(new Error("Indexed promise property has no matching mirror"))
    }
    return mirror
}

function installPromiseMirror(node, key, mirror) {
    const meta = metadata.ensureMeta(node)
    meta.mirrors ??= Object.create(null)
    meta.mirrors[key] = mirror
}

// Creation registers the mandatory consumer; callers publish the mirror only
// when its owner/key property represents this promise.
function createPromiseMirror(
    node,
    key,
    promise,
    forkSourceMirror = null,
    markResolvedValueShared = false,
    importBoundary = undefined,
) {
    const mirror = {
        node,
        key,
        // Mirrors are created for promise properties
        promise,
        // Latest logical value produced by completed FIFO consumers.
        currentValue: undefined,
        // Registered consumers not yet completed; zero exposes currentValue synchronously.
        pendingConsumerCount: 0,
        // Error queries see this instead of currentValue; other operations use currentValue.
        cycleError: undefined,
        // Import provenance: { root, errorContext } for preparation and attribution.
        importBoundary,
        // Added synchronously when import must classify before generic preparation.
        importPreparationRegistered: false,
    }

    // The mandatory writeback is born first. Every later operation on this
    // property registers through the same counted wrapper.
    onPromiseMirrorResolve(mirror, settledValueOrError => {
        if (forkSourceMirror !== null) {
            // Import provenance is sampled at the same FIFO position as the
            // source value. An earlier path consumer may have consumed it.
            mirror.importBoundary = markResolvedValueShared
                ? forkSourceMirror.importBoundary
                : undefined
        }
        const value = forkSourceMirror === null
            ? settledValueOrError
            : forkSourceMirror.currentValue
        if (mirror.importPreparationRegistered) {
            // Import's next FIFO consumer must classify cycles before this
            // resolved branch can be ref-indexed.
            if (markResolvedValueShared) metadata.markShared(value)
            mirror.currentValue = value
            mirror.cycleError = undefined
        } else {
            setPromiseMirrorValue(mirror, value, markResolvedValueShared)
        }
    })
    return mirror
}

// ASSIGN: always a fresh mirror. Reusing one would merge two divergent worlds.
// It remains private until the assignment's live-edge commit publishes it.
function createAssignedPromiseMirror(node, key, promise) {
    return createPromiseMirror(node, key, promise)
}

// DISCOVERY: the physical Promise already occupies the imported/raw property.
// Promise identity permits reuse here only; ASSIGN always creates a fresh mirror.
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
    )
    installPromiseMirror(node, key, mirror)
    return mirror
}

// FORK: read the source mirror at this FIFO position, but prepare the value for
// the copy's own owner/key property. A fork is language-owned, never external.
function forkPromiseMirror(
    source,
    copy,
    key,
    promise,
    retainedOffPath,
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
        retainedOffPath,
        // Off-path forks retain imported data. A path fork is transformed by
        // the current COW walk, which already carries the inherited boundary.
        retainedOffPath
            ? (forkSourceMirror.importBoundary ?? importBoundary)
            : undefined,
    )
    installPromiseMirror(copy, key, mirror)
    return mirror
}

function clearPromiseMirror(node, key) {
    const mirrors = metadata.metaOf(node)?.mirrors
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
    return helpers.onValueResolve(mirror.promise, value => {
        const result = fn(value)
        if (mirror.pendingConsumerCount === 1) {
            // The drain decrements inside its live-edge update, after the old
            // pending projection is captured and before the new one is read.
            commitMirrorDrain(mirror)
        } else {
            mirror.pendingConsumerCount--
        }
        // A thrown consumer or a drain failure before its property update
        // leaves an outstanding count and prevents publication.
        return result
    })
}

function setPromiseMirrorValue(mirror, value, markResolvedValueShared = false) {
    preparePropertyTransition(
        mirror.node,
        mirror,
        value,
        markResolvedValueShared,
    )
    mirror.currentValue = value
    mirror.cycleError = undefined
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

export {
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
