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

class PromiseMirror {
    constructor(node, key, promise, importBoundary) {
        this.node = node
        this.key = key
        this.promise = promise
        // Latest logical value produced by completed FIFO consumers.
        this.currentValue = undefined
        // Registered consumers not yet completed; zero exposes currentValue.
        this.pendingConsumerCount = 0
        // Cycle-aware observations consult this diagnostic; raw traversal,
        // lookup, and mutation continue through currentValue.
        this.cycleError = undefined
        // Imported boundary root and error context used for preparation/attribution.
        this.importBoundary = importBoundary
        // Set when import must classify the initial value before generic preparation.
        this.importPreparationRegistered = false
    }

    isDrained() {
        return this.pendingConsumerCount === 0
    }

    // Revoked mirrors leave the map but remain valid for captured consumers.
    isLive() {
        return getPromiseMirror(this.node, this.key) === this
    }

    // Count registration synchronously so FIFO order and pending visibility agree.
    // Only fn's synchronous body counts: re-entrant registration extends the
    // drain, while a Promise returned by fn does not delay it.
    onResolve(fn) {
        this.pendingConsumerCount++
        return helpers.onValueResolve(this.promise, value => {
            const result = fn(value)
            if (this.pendingConsumerCount === 1) {
                // The drain decrements inside its live-edge update, after the old
                // pending projection is captured and before the new one is read.
                commitMirrorDrain(this)
            } else {
                this.pendingConsumerCount--
            }
            // A thrown consumer or drain failure before its property update
            // leaves an outstanding count and prevents publication.
            return result
        })
    }

    setValue(value, shouldMarkResolvedValueShared = false) {
        if (this.importPreparationRegistered) {
            // Import registers its classifier directly after mandatory writeback,
            // so no later FIFO consumer can observe this flag.
            // Import's next FIFO consumer classifies cycles before this branch
            // may be ref-indexed.
            if (shouldMarkResolvedValueShared) metadata.markShared(value)
        } else {
            preparePropertyTransition(
                this.node,
                this,
                value,
                shouldMarkResolvedValueShared,
            )
        }
        this.currentValue = value
        this.cycleError = undefined
    }
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
    const mirror = new PromiseMirror(node, key, promise, importBoundary)

    // The mandatory writeback is born first. Every later operation on this
    // property registers through the same counted wrapper.
    mirror.onResolve(settledValueOrError => {
        if (forkSourceMirror !== null) {
            // Import attribution is sampled at the same FIFO position as the
            // source value. An earlier path consumer may have consumed it.
            mirror.importBoundary = markResolvedValueShared
                ? forkSourceMirror.importBoundary
                : undefined
        }
        const value = forkSourceMirror === null
            ? settledValueOrError
            : forkSourceMirror.currentValue
        mirror.setValue(value, markResolvedValueShared)
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

function readLogicalProperty(node, key) {
    const mirror = getPromiseMirror(node, key)
    if (mirror) {
        return mirror.isDrained()
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
    readLogicalProperty,
}
