const { onValueResolveWithCompletion } = require("./helpers")
const {
    ensureMeta,
    getEdgeMark,
    metaOf,
} = require("./meta")
const { reportFatalError } = require("./error")

const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

let prepareMirrorValue
let commitMirrorDrain

function initPromiseMirrors(prepareValue, commitDrain) {
    prepareMirrorValue = prepareValue
    commitMirrorDrain = commitDrain
}

function getPromiseMirrorMap(node) {
    return metaOf(node)?.mirrors
}

function ensurePromiseMirrorMap(node) {
    const meta = ensureMeta(node)
    meta.mirrors ??= Object.create(null)
    return meta.mirrors
}

function getPromiseMirror(node, key) {
    return getPromiseMirrorMap(node)?.[key]
}

// A mirrored placement stores its mark only on the mirror; mirror installation
// and removal keep meta.edgeMarks[key] absent. Counters see only attached state,
// so a draining mirror's private mark stays hidden until every consumer commits.
function getCommittedEdgeMark(node, key) {
    const mirror = getPromiseMirror(node, key)
    return mirror
        ? (mirror.settled ? mirror.edgeMark : undefined)
        : getEdgeMark(node, key)
}

function getRequiredPromiseMirror(node, key, promise) {
    const mirror = getPromiseMirror(node, key)
    if (!mirror || (promise !== undefined && mirror.promise !== promise)) {
        reportFatalError(new Error("Indexed promise property has no matching mirror"))
    }
    return mirror
}

function installPromiseMirror(node, key, mirror) {
    ensurePromiseMirrorMap(node)[key] = mirror
}

function createPromiseMirror(
    node,
    key,
    promise,
    forkSourceMirror = null,
    markResolvedValueShared = false,
    importContext = undefined,
    externalHolder = false,
    install = true,
) {
    const mirror = {
        node,
        key,
        promise,
        currentValue: undefined,
        prepared: undefined,
        pendingConsumerCount: 0,
        settled: false,
        failedDrain: false,
        edgeMark: undefined,
        importContext,
        externalHolder,
    }
    if (install) installPromiseMirror(node, key, mirror)

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
    return createPromiseMirror(node, key, promise, null, false, undefined, false, false)
}

// DISCOVERY: the physical Promise already occupies the imported/raw property.
function getOrCreatePromiseMirror(node, key, promise, importContext = undefined) {
    const existing = getPromiseMirror(node, key)
    if (existing?.promise === promise) return existing
    return createPromiseMirror(
        node,
        key,
        promise,
        null,
        false,
        importContext,
        importContext !== undefined,
    )
}

// FORK: read the source mirror at this FIFO position, but prepare the value for
// the copy's own owner/key placement. A fork is language-owned, never external.
function forkPromiseMirror(
    source,
    copy,
    key,
    promise,
    markResolvedValueShared,
    importContext,
) {
    const forkSourceMirror = getOrCreatePromiseMirror(
        source,
        key,
        promise,
        importContext,
    )
    return createPromiseMirror(
        copy,
        key,
        promise,
        forkSourceMirror,
        markResolvedValueShared,
        importContext,
    )
}

function clearPromiseMirror(node, key) {
    const map = getPromiseMirrorMap(node)
    if (map) delete map[key]
}

function isLivePromiseMirror(node, key, mirror) {
    return getPromiseMirror(node, key) === mirror
}

// Incrementing happens before registration. The completion hook runs after the
// continuation's synchronous body, so a re-entrant registration keeps the edge
// pending and a returned Promise does not delay this mirror's drain.
function onPromiseMirrorResolve(mirror, fn) {
    mirror.pendingConsumerCount++
    return onValueResolveWithCompletion(
        mirror.promise,
        fn,
        failed => finishPromiseMirrorConsumer(mirror, failed),
    )
}

function finishPromiseMirrorConsumer(mirror, failed) {
    if (failed) mirror.failedDrain = true
    mirror.pendingConsumerCount--
    if (mirror.pendingConsumerCount !== 0 || mirror.failedDrain) return

    try {
        commitMirrorDrain(mirror)
        mirror.settled = true
    } catch (error) {
        mirror.failedDrain = true
        throw error
    }
}

function setPromiseMirrorValue(mirror, value, markResolvedValueShared = false) {
    const prepared = prepareMirrorValue(mirror, value, markResolvedValueShared)
    mirror.prepared = prepared
    mirror.currentValue = prepared.value
    mirror.edgeMark = prepared.edgeMark
    return mirror.currentValue
}

function readLogicalProperty(node, key) {
    const mirror = getPromiseMirror(node, key)
    if (mirror) return mirror.settled ? mirror.currentValue : mirror.promise
    if (key === "__proto__") return undefined
    return propertyIsEnumerable.call(node, key) ? node[key] : undefined
}

module.exports = {
    clearPromiseMirror,
    createAssignedPromiseMirror,
    forkPromiseMirror,
    getCommittedEdgeMark,
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
