import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as resolution from "./resolution.js"

let setMirrorValue

function initPromiseMirrors(setMirrorValueFn) {
    setMirrorValue = setMirrorValueFn
}

function getPromiseMirror(parent, key) {
    return metadata.metaOf(parent)?.mirrors?.[key]
}

function getRequiredPromiseMirror(parent, key) {
    const mirror = getPromiseMirror(parent, key)
    if (!mirror) {
        errorUtils.reportFatalError(
            new Error("Indexed promise property has no mirror"),
        )
    }
    return mirror
}

function installPromiseMirror(parent, key, mirror) {
    const meta = metadata.ensureMeta(parent)
    meta.mirrors ??= Object.create(null)
    meta.mirrors[key] = mirror
}

// resolvedValue is the logical value of a live property whose physical Promise
// is preserved. detachedValue belongs to a detached property version.
class PromiseMirror {
    isLive(parent, key) {
        return getPromiseMirror(parent, key) === this
    }

    getValue(parent, key) {
        return this.isLive(parent, key)
            ? languageProperties.readLanguageProperty(parent, key)
            : this.detachedValue
    }

    detach(parent, key) {
        this.detachedValue = this.getValue(parent, key)
        delete this.resolvedValue
        const mirrors = metadata.metaOf(parent)?.mirrors
        if (mirrors) delete mirrors[key]
    }
}

// The first FIFO reaction publishes settlement before later consumers run.
function createPromiseMirror(
    parent,
    key,
    promise,
    importBoundary = undefined,
) {
    const mirror = new PromiseMirror()
    resolution.resolveInitialValueOrPoison(promise, value => {
        setMirrorValue(parent, key, mirror, value, {
            importBoundary,
        })
    })
    return mirror
}

// ASSIGN always creates a fresh property version, even for the same Promise.
function createAssignedPromiseMirror(
    parent,
    key,
    promise,
) {
    return createPromiseMirror(parent, key, promise)
}

// DISCOVERY is lazy for trusted literals and derived import Promises. A
// completed ref index must already contain every required mirror.
function getOrCreatePromiseMirror(
    parent,
    key,
    promise,
) {
    const meta = metadata.metaOf(parent)
    const existing = meta?.mirrors?.[key]
    if (existing) return existing
    const importBoundary = meta?.importBoundary

    // A completed index already contains every Promise mirror. Unindexed
    // runtime-owned or imported data may still discover one lazily.
    if (meta?.parents) {
        return getRequiredPromiseMirror(parent, key)
    }

    if (importBoundary) {
        languageProperties.assertPromisePropertyShape(
            parent,
            key,
            importBoundary.errorContext,
        )
    } else {
        languageProperties.assertCanSetLanguageProperty(parent, key)
    }
    const mirror = createPromiseMirror(
        parent,
        key,
        promise,
        importBoundary,
    )
    installPromiseMirror(parent, key, mirror)
    return mirror
}

// FORK creates a destination version that samples the source at this FIFO slot.
function forkPromiseMirror(
    source,
    destination,
    sourceKey,
    promise,
    {
        retained = false,
        sourceMirror = getOrCreatePromiseMirror(
            source,
            sourceKey,
            promise,
        ),
        destinationKey = sourceKey,
        install = true,
        sharedBacking = false,
    } = {},
) {
    const mirror = new PromiseMirror()
    const importBoundary = metadata.importBoundaryOf(destination)
    resolution.onLaterPromiseReady(promise, () => {
        const value = sourceMirror.getValue(source, sourceKey)
        setMirrorValue(
            destination,
            destinationKey,
            mirror,
            value,
            { importBoundary, sharedBacking },
        )
        // The resolver is synchronous, so sharing is established before the
        // next FIFO resolver can observe this retained value.
        if (retained) metadata.markShared(value)
    })
    if (install) installPromiseMirror(destination, destinationKey, mirror)
    return mirror
}

// Callers materialize imported arrays because a derived view shares their
// physical slots and cannot represent a resolved mirror overlay.
function prepareRetainedArrayProperties(
    source,
    destination,
    destinationKeyFor,
) {
    for (const key of languageProperties.enumerableLanguageKeys(source)) {
        const destinationKey = destinationKeyFor
            ? destinationKeyFor(key)
            : key
        if (destinationKey === undefined) continue
        const value = languageProperties.readLanguageProperty(source, key)
        if (!languageValues.isPromise(value)) {
            if (languageValues.isTracked(value)) metadata.markShared(value)
            continue
        }
        forkPromiseMirror(
            source,
            destination,
            key,
            value,
            {
                retained: true,
                destinationKey,
                sharedBacking: true,
            },
        )
    }
}

// TRANSFER moves one already-detached property version into a private Chain
// root. The source version's resolver is earlier on the same canonical Promise,
// so detachedValue is current before this callback runs.
function transferDetachedPromiseMirror(
    sourceMirror,
    destination,
    key,
    promise,
    attachmentRoot,
) {
    const mirror = new PromiseMirror()
    resolution.onLaterPromiseReady(promise, () => {
        const value = sourceMirror.detachedValue
        setMirrorValue(destination, key, mirror, value)
        if (attachmentRoot) metadata.markShared(value)
    })
    installPromiseMirror(destination, key, mirror)
}

function detachPromiseMirror(parent, key) {
    const mirror = getPromiseMirror(parent, key)
    if (mirror) mirror.detach(parent, key)
}

export {
    createAssignedPromiseMirror,
    detachPromiseMirror,
    forkPromiseMirror,
    prepareRetainedArrayProperties,
    getOrCreatePromiseMirror,
    getPromiseMirror,
    getRequiredPromiseMirror,
    initPromiseMirrors,
    installPromiseMirror,
    transferDetachedPromiseMirror,
}
