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
        // A live boundary means this physical property belongs to imported data.
        if (importBoundary) this.importBoundary = importBoundary
        // resolvedValue: logical value while an imported promise property is not back-written.
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
        this.detachedValue = this.getValue(parent, key)
        delete this.resolvedValue
        const mirrors = metadata.metaOf(parent)?.mirrors
        if (mirrors) delete mirrors[key]
    }
}

// The first FIFO reaction prepares imported data before publishing it.
function createPromiseMirror(
    parent,
    key,
    promise,
    importBoundary,
    prepareImportedValue,
) {
    const mirror = new PromiseMirror(importBoundary)
    resolution.resolveInitialValueOrPoison(promise, value => {
        const cycleCut = prepareImportedValue?.(value, importBoundary)
        setMirrorValue(parent, key, mirror, value, cycleCut)
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
    sourceImportBoundary,
    prepareImportedValue,
    {
        sourceMirror = getOrCreatePromiseMirror(
            source,
            sourceKey,
            promise,
            sourceImportBoundary,
        ),
        destinationKey = sourceKey,
        install = true,
        sharedBacking = false,
    } = {},
) {
    const mirror = new PromiseMirror()
    resolution.onLaterPromiseReady(promise, () => {
        const value = sourceMirror.getValue(source, sourceKey)
        const sampledBoundary = retained
            ? metadata.nodeImportBoundary(
                value,
                sourceMirror.importBoundary ?? sourceImportBoundary,
            )
            : undefined
        const cycleCut = prepareImportedValue?.(value, sampledBoundary)
        setMirrorValue(
            destination,
            destinationKey,
            mirror,
            value,
            cycleCut,
            sharedBacking,
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
    const mirror = new PromiseMirror()
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
