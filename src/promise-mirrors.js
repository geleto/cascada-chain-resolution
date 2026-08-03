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

class PromiseMirror {
    constructor(importBoundary) {
        // importBoundary: imported root and error context used for preparation.
        if (importBoundary) this.importBoundary = importBoundary
        // detachedValue: current value after this property version detaches.
    }

    isLive(parent, key) {
        return getPromiseMirror(parent, key) === this
    }

    getValue(parent, key) {
        return this.isLive(parent, key)
            ? languageProperties.readLanguageProperty(parent, key)
            : this.detachedValue
    }

    detach(parent, key) {
        this.detachedValue = languageProperties.readLanguageProperty(
            parent,
            key,
        )
        const mirrors = metadata.metaOf(parent)?.mirrors
        if (mirrors) delete mirrors[key]
    }
}

// The first FIFO reaction passes optional import preparation into the property
// transition, which prepares the value before indexing and publishing it.
function createPromiseMirror(
    parent,
    key,
    promise,
    importBoundary,
    prepareImportedValue,
) {
    const mirror = new PromiseMirror(importBoundary)
    resolution.resolveInitialValueOrPoison(promise, value => {
        setMirrorValue(parent, key, mirror, value, prepareImportedValue)
    })
    return mirror
}

// ASSIGN always creates a fresh property version, even for the same Promise.
function createAssignedPromiseMirror(
    parent,
    key,
    promise,
    prepareImportedValue,
) {
    return createPromiseMirror(
        parent,
        key,
        promise,
        undefined,
        prepareImportedValue,
    )
}

// DISCOVERY is lazy for trusted literals and derived import Promises. A
// completed ref index must already contain every required mirror.
function getOrCreatePromiseMirror(
    parent,
    key,
    promise,
    importBoundary,
    prepareImportedValue,
) {
    const existing = getPromiseMirror(parent, key)
    if (existing) return existing

    // A completed index already contains every Promise mirror. Unindexed
    // trusted or prepared data may still discover one lazily.
    if (metadata.metaOf(parent)?.parents) {
        return getRequiredPromiseMirror(parent, key)
    }

    languageProperties.assertCanSetLanguageProperty(
        parent,
        key,
        importBoundary?.errorContext,
    )
    const mirror = createPromiseMirror(
        parent,
        key,
        promise,
        importBoundary,
        prepareImportedValue,
    )
    installPromiseMirror(parent, key, mirror)
    return mirror
}

// FORK samples the source property's prepared state at the copier's FIFO slot.
function forkPromiseMirror(
    source,
    destination,
    sourceKey,
    promise,
    retained,
    importBoundary,
    prepareImportedValue,
    {
        sourceMirror = getOrCreatePromiseMirror(
            source,
            sourceKey,
            promise,
            importBoundary,
        ),
        destinationKey = sourceKey,
        install = true,
        fallbackImportBoundary,
        sharedBacking = false,
    } = {},
) {
    const mirror = new PromiseMirror(
        retained ? importBoundary : undefined,
    )
    resolution.onLaterPromiseReady(promise, () => {
        const value = sourceMirror.getValue(source, sourceKey)
        const sampledBoundary = retained
            ? metadata.nodeImportBoundary(
                value,
                sourceMirror.importBoundary ?? fallbackImportBoundary,
            )
            : undefined
        if (sampledBoundary) {
            mirror.importBoundary = sampledBoundary
        } else {
            delete mirror.importBoundary
        }
        setMirrorValue(
            destination,
            destinationKey,
            mirror,
            value,
            prepareImportedValue,
            sharedBacking,
        )
        // The resolver is synchronous, so sharing is established before the
        // next FIFO resolver can observe this retained value.
        if (retained) metadata.markShared(value)
    })
    if (install) installPromiseMirror(destination, destinationKey, mirror)
    return mirror
}

function prepareRetainedArrayProperties(
    source,
    destination,
    destinationKeyFor,
) {
    const mirrors = metadata.metaOf(source)?.mirrors
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
        const sourceMirror = mirrors?.[key] ?? getOrCreatePromiseMirror(
            source,
            key,
            value,
        )
        forkPromiseMirror(
            source,
            destination,
            key,
            value,
            true,
            sourceMirror.importBoundary,
            undefined,
            { sourceMirror, destinationKey, sharedBacking: true },
        )
    }
}

// TRANSFER moves one already-detached property version into a private Chain
// root. The source version's resolver is earlier on the same canonical Promise,
// so detachedValue is prepared before this callback runs.
function transferDetachedPromiseMirror(
    sourceMirror,
    destination,
    key,
    promise,
    attachmentPath,
) {
    const mirror = new PromiseMirror(sourceMirror.importBoundary)
    resolution.onLaterPromiseReady(promise, () => {
        const value = sourceMirror.detachedValue
        setMirrorValue(destination, key, mirror, value)
        if (attachmentPath) metadata.markShared(value)
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
