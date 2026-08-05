import * as errorUtils from "./error.js"
import * as importPreparation from "./import-preparation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as refcounts from "./refcounts.js"
import * as resolution from "./resolution.js"

const PROPERTY_REFERENCE = Symbol("Property reference")

function getPromiseMirror(owner, key) {
    return metadata.metaOf(owner)?.mirrors?.[key]
}

function installPromiseMirror(owner, key, mirror) {
    const meta = metadata.ensureMeta(owner)
    meta.mirrors ??= Object.create(null)
    meta.mirrors[key] = mirror
}

function detachPromiseMirror(owner, key) {
    const mirrors = metadata.metaOf(owner)?.mirrors
    if (mirrors) delete mirrors[key]
}

function isLivePromiseMirror(owner, key, mirror) {
    return getPromiseMirror(owner, key) === mirror
}

function continuePromiseVersion(promise, mirror, onValue) {
    return resolution.onLaterPromiseReady(
        promise,
        () => onValue(mirror.value),
    )
}

function continuePropertyValue(owner, key, promise, onValue) {
    const mirror = getOrCreatePromiseMirror(owner, key, promise)
    return continuePromiseVersion(
        promise,
        mirror,
        value => onValue(value, mirror),
    )
}

// Fix presence and key order when structure is observed; capture the value and
// its exact version only when the operation reaches this reference.
function getPropertyReference(owner, key) {
    key = String(key)
    if (!languageProperties.hasLanguageProperty(owner, key)) return undefined
    return { [PROPERTY_REFERENCE]: true, owner, key }
}

function isPropertyReference(value) {
    return value?.[PROPERTY_REFERENCE] === true
}

function capturePropertyVersion(reference) {
    if (!reference || Object.hasOwn(reference, "value")) return
    const { owner, key } = reference
    const value = languageProperties.readLanguageProperty(owner, key)
    reference.value = value
    if (languageValues.isPromise(value)) {
        reference.mirror = getOrCreatePromiseMirror(owner, key, value)
    }
}

function resolvePropertyValue(reference) {
    capturePropertyVersion(reference)
    if (!reference || !languageValues.isPromise(reference.value)) {
        return reference?.value
    }
    return continuePromiseVersion(
        reference.value,
        reference.mirror,
        value => {
            reference.value = value
            delete reference.mirror
            return value
        },
    )
}

function resolvePropertyValueAtKey(owner, key) {
    return resolvePropertyValue(getPropertyReference(owner, key))
}

function getOrCreatePromiseMirror(owner, key, promise) {
    const meta = metadata.metaOf(owner)
    const existing = meta?.mirrors?.[key]
    if (existing) return existing
    if (meta?.parents) {
        errorUtils.reportFatalError(
            new Error("Indexed promise property has no mirror"),
        )
    }

    const importBoundary = meta?.importBoundary
    if (importBoundary) {
        languageProperties.assertPromisePropertyShape(
            owner,
            key,
            importBoundary.errorContext,
        )
    } else {
        languageProperties.assertCanSetLanguageProperty(owner, key)
    }

    const mirror = createInitialPromiseMirror(
        owner,
        key,
        promise,
        importBoundary,
    )
    installPromiseMirror(owner, key, mirror)
    return mirror
}

function assignProperty(owner, key, value, retained = false) {
    languageProperties.assertCanSetLanguageProperty(owner, key)
    const isPromise = languageValues.isPromise(value)
    if (retained && !isPromise) metadata.markShared(value)
    const mirror = isPromise
        ? createInitialPromiseMirror(
            owner,
            key,
            value,
            undefined,
            retained,
        )
        : undefined
    replaceProperty(owner, key, mirror, value)
}

// An initial version consumes the settlement payload. Derived versions instead
// sample their source mirror at their own FIFO position.
function createInitialPromiseMirror(
    owner,
    key,
    promise,
    importBoundary,
    retained = false,
) {
    const mirror = { value: promise }
    resolution.resolveInitialValueOrPoison(promise, value => {
        publishValue(owner, key, mirror, value, importBoundary, retained)
    })
    return mirror
}

function placePromiseVersion(
    sourceMirror,
    promise,
    owner,
    key,
    retained = false,
) {
    languageProperties.assertCanSetLanguageProperty(owner, key)
    // Ordinary placements are runtime-owned; imported properties instead use
    // same-parent promotion, which does not replace their physical edge.
    const mirror = { value: promise }
    continuePromiseVersion(promise, sourceMirror, value => {
        publishValue(owner, key, mirror, value, undefined, retained)
    })
    replaceProperty(owner, key, mirror, promise)
    return mirror
}

function promoteImportedPromiseVersion(owner, key, promise) {
    const sourceMirror = getPromiseMirror(owner, key)
    if (!sourceMirror) return getOrCreatePromiseMirror(owner, key, promise)

    const importBoundary = metadata.importBoundaryOf(owner)
    const mirror = { value: promise }
    continuePromiseVersion(promise, sourceMirror, value => {
        publishValue(owner, key, mirror, value, importBoundary)
    })
    // Promotion changes only the version's publication policy. The imported
    // property and its refcount edge remain physically and logically pending.
    installPromiseMirror(owner, key, mirror)
    return mirror
}

function advancePromiseVersion(owner, key, mirror, value) {
    publishValue(owner, key, mirror, value)
}

function publishValue(
    owner,
    key,
    mirror,
    value,
    importBoundary,
    retained = false,
) {
    if (languageValues.isPromise(value)) {
        errorUtils.reportFatalError(
            new Error("A Promise requires a fresh property version"),
        )
    }
    if (retained) metadata.markShared(value)
    if (importBoundary) {
        prepareImportedResult(value, importBoundary)
    }

    // A runtime-owned version can be displaced when its owner is later imported.
    // Check liveness before applying this version's captured writeback policy.
    if (!isLivePromiseMirror(owner, key, mirror)) {
        mirror.value = value
        indexValueIfSourceIndexed(owner, value)
        return
    }

    if (!importBoundary) {
        const valueBoundary = metadata.importBoundaryOf(value)
        languageProperties.assertCanUpdatePromiseProperty(
            owner,
            key,
            valueBoundary?.errorContext,
        )
    }

    commitProperty(owner, key, value, () => {
        if (!importBoundary) {
            languageProperties.writeLanguageProperty(owner, key, value)
        }
        mirror.value = value
    })
}

function replaceProperty(owner, key, mirror, value) {
    commitProperty(owner, key, value, () => {
        detachPromiseMirror(owner, key)
        languageProperties.writeLanguageProperty(owner, key, value)
        if (mirror) installPromiseMirror(owner, key, mirror)
    })
}

function removeProperty(owner, key, remove) {
    commitProperty(owner, key, undefined, () => {
        detachPromiseMirror(owner, key)
        if (remove) remove()
        else languageProperties.deleteLanguageProperty(owner, key)
    })
}

function commitProperty(owner, key, value, updateProperty) {
    refcounts.commitLiveEdge(
        owner,
        key,
        value,
        getOrCreatePromiseMirror,
        updateProperty,
    )
}

function buildRefIndex(value) {
    return refcounts.buildRefIndex(value, getOrCreatePromiseMirror)
}

function indexValueIfSourceIndexed(source, value) {
    return refcounts.indexValueIfSourceIndexed(
        source,
        value,
        getOrCreatePromiseMirror,
    )
}

function prepareImportedRoot(value, importBoundary) {
    prepareImportedData(value, importBoundary, true)
}

function prepareImportedResult(value, importBoundary) {
    prepareImportedData(value, importBoundary, false)
}

function prepareImportedData(value, importBoundary, promoteRoot) {
    importPreparation.prepareImportedData(
        value,
        importBoundary,
        promoteRoot,
        promoteImportedPromiseVersion,
        getOrCreatePromiseMirror,
    )
}

function prepareRetainedArrayProperties(
    source,
    destination,
    destinationKeyFor,
) {
    for (const sourceKey of languageProperties.enumerableLanguageKeys(source)) {
        const destinationKey = destinationKeyFor
            ? destinationKeyFor(sourceKey)
            : sourceKey
        if (destinationKey === undefined) continue

        const value = languageProperties.readLanguageProperty(source, sourceKey)
        if (!languageValues.isPromise(value)) {
            metadata.markShared(value)
            continue
        }
        placePromiseVersion(
            getOrCreatePromiseMirror(source, sourceKey, value),
            value,
            destination,
            destinationKey,
            true,
        )
    }
}

export {
    advancePromiseVersion,
    assignProperty,
    buildRefIndex,
    capturePropertyVersion,
    continuePropertyValue,
    continuePromiseVersion,
    getOrCreatePromiseMirror,
    getPropertyReference,
    getPromiseMirror,
    indexValueIfSourceIndexed,
    isPropertyReference,
    placePromiseVersion,
    prepareImportedRoot,
    prepareRetainedArrayProperties,
    removeProperty,
    resolvePropertyValue,
    resolvePropertyValueAtKey,
}
