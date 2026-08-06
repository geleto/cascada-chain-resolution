import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as importPreparation from "./import-preparation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as refcounts from "./refcounts.js"
import * as resolution from "./resolution.js"

const PROPERTY_ORIGIN = Symbol("Property origin")

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
// its exact version only when the operation reaches this origin.
function getPropertyOrigin(owner, key) {
    key = String(key)
    if (!languageProperties.hasLanguageProperty(owner, key)) return undefined
    return { [PROPERTY_ORIGIN]: true, owner, key }
}

function isPropertyOrigin(value) {
    return value?.[PROPERTY_ORIGIN] === true
}

function capturePropertyVersion(origin) {
    if (!origin || Object.hasOwn(origin, "value")) return
    const { owner, key } = origin
    const value = languageProperties.readLanguageProperty(owner, key)
    origin.value = value
    if (languageValues.isPromise(value)) {
        origin.mirror = getOrCreatePromiseMirror(owner, key, value)
    }
}

function resolvePropertyValue(origin) {
    capturePropertyVersion(origin)
    if (!origin || !languageValues.isPromise(origin.value)) {
        return origin?.value
    }
    return continuePromiseVersion(
        origin.value,
        origin.mirror,
        value => {
            origin.value = value
            delete origin.mirror
            return value
        },
    )
}

function resolvePropertyValueAtKey(owner, key) {
    return resolvePropertyValue(getPropertyOrigin(owner, key))
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
        languageProperties.assertPromisePropertyShape(owner, key)
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
        languageProperties.assertCanPublishPromiseProperty(
            owner,
            key,
            value,
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

// Callers validate deletion semantics before this atomic edge removal.
function removeProperty(owner, key, remove) {
    commitProperty(owner, key, undefined, () => {
        detachPromiseMirror(owner, key)
        if (remove) remove()
        else languageProperties.deleteLanguageProperty(owner, key)
    })
}

function deleteProperty(owner, key) {
    languageProperties.assertCanDeleteLanguageProperty(owner, key)
    removeProperty(owner, key)
}

function commitArrayLength(array, length) {
    const projection = arrayViews.projectionOf(array)
    const current = projection.length
    const view = arrayViews.isArrayView(projection) ? projection : undefined
    if (view) {
        if (length >= current) {
            if (!view.setLength(length)) {
                return errorUtils.validationError(
                    "Cannot grow this ArrayView in place",
                )
            }
            return undefined
        }
    } else if (
        Object.getOwnPropertyDescriptor(array, "length")?.writable !== true
    ) {
        return errorUtils.validationError("Array length is read-only")
    }
    if (length === current) return undefined

    for (let index = current - 1; index >= length; index--) {
        const key = String(index)
        const property = languageProperties.getLanguagePropertyDescriptor(
            array,
            key,
        )
        if (property && !property.configurable) {
            setLength(index + 1)
            return errorUtils.validationError(
                "Cannot delete an Array element while setting length",
            )
        }
        if (property?.enumerable) {
            removeProperty(
                array,
                key,
                view ? () => view.setLength(index) : undefined,
            )
        } else if (view) {
            view.setLength(index)
        }
    }
    setLength(length)
    return undefined

    function setLength(nextLength) {
        if (view) view.setLength(nextLength)
        else array.length = nextLength
    }
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
    sourceStart = 0,
    sourceEnd = arrayViews.logicalArrayLength(source),
    destinationOffset = 0,
) {
    for (const sourceKey of arrayViews.enumerableArrayKeys(
        source,
        sourceStart,
        sourceEnd,
    )) {
        const destinationKey = String(Number(sourceKey) + destinationOffset)
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
    commitArrayLength,
    continuePropertyValue,
    continuePromiseVersion,
    deleteProperty,
    getOrCreatePromiseMirror,
    getPropertyOrigin,
    getPromiseMirror,
    indexValueIfSourceIndexed,
    isPropertyOrigin,
    placePromiseVersion,
    prepareImportedRoot,
    prepareRetainedArrayProperties,
    resolvePropertyValue,
    resolvePropertyValueAtKey,
}
