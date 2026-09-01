import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as importPreparation from "./import-preparation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as refcounts from "./refcounts.js"
import * as resolution from "./resolution.js"

class PropertyPlacement {
    constructor(owner, key) {
        this.owner = owner
        this.key = key
    }
}

function getPromiseMirror(owner, key) {
    return metadata.metaOf(owner)?.mirrors?.[key]
}

function hasPromiseMirrors(owner) {
    const mirrors = metadata.metaOf(owner)?.mirrors
    if (!mirrors) return false
    for (const _key in mirrors) return true
    return false
}

function installPromiseMirror(owner, key, mirror) {
    const meta = metadata.requireMeta(owner)
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
function getPropertyPlacement(owner, key) {
    key = String(key)
    if (!languageProperties.hasLanguageProperty(owner, key)) return undefined
    return new PropertyPlacement(owner, key)
}

function isPropertyPlacement(value) {
    return value instanceof PropertyPlacement
}

function capturePropertyVersion(origin) {
    if (
        !origin ||
        Object.hasOwn(origin, "value")
    ) return
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
    return resolvePropertyValue(getPropertyPlacement(owner, key))
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

    if (meta?.importBoundary) {
        errorUtils.reportFatalError(
            new Error("Imported promise property has no mirror"),
        )
    }
    languageProperties.assertCanSetLanguageProperty(owner, key)

    const mirror = createInitialPromiseMirror(owner, key, promise)
    installPromiseMirror(owner, key, mirror)
    return mirror
}

function assignProperty(owner, key, value, retained = false) {
    languageProperties.assertCanSetLanguageProperty(owner, key)
    const isPromise = languageValues.isPromise(value)
    if (!isPromise) languageValues.admitReadyValue(value)
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
    const publish = value => publishPromiseValue(
        owner,
        key,
        mirror,
        value,
        importBoundary,
        retained,
    )
    if (importBoundary) {
        // Import must process fulfillment before admission; the general
        // initial-value resolver admits first.
        languageValues.continuePromise(
            promise,
            value => errorUtils.runFatal(publish, value),
            reason => errorUtils.runFatal(
                publish,
                errorUtils.toPoison(reason),
            ),
        )
    } else {
        resolution.resolveInitialValueOrPoison(promise, publish)
    }
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
    // A derived placement is runtime-owned and may publish into its owner.
    const mirror = { value: promise }
    continuePromiseVersion(promise, sourceMirror, value => {
        publishPromiseValue(owner, key, mirror, value, undefined, retained)
    })
    replaceProperty(owner, key, mirror, promise)
    return mirror
}

function advancePromiseVersion(owner, key, mirror, value) {
    publishPromiseValue(owner, key, mirror, value)
}

function publishPromiseValue(
    owner,
    key,
    mirror,
    value,
    importBoundary,
    retained = false,
) {
    value = errorUtils.catchUserCodeFailure(
        () => {
            if (languageValues.isPromise(value)) {
                errorUtils.reportFatalError(
                    new Error("A Promise requires a fresh property version"),
                )
            }
            if (importBoundary) {
                value = prepareImportedValue(value, importBoundary)
            } else {
                languageValues.admitReadyValue(value)
            }
            if (retained) metadata.markShared(value)
            return value
        },
        admitFailure,
    )
    const writeBack = importBoundary === undefined
    const commit = errorUtils.catchUserCodeFailure(
        () => prepareCommit(value, writeBack),
        failure => {
            value = admitFailure(failure)
            return prepareCommit(value, writeBack)
        },
    )
    errorUtils.catchUserCodeFailure(
        commit,
        failure => prepareCommit(admitFailure(failure), false)(),
    )

    function admitFailure(failure) {
        languageValues.admitReadyValue(failure)
        return failure
    }

    function prepareCommit(nextValue, canWriteBack) {
        // A runtime-owned version can be displaced when its owner is later
        // imported. A detached version survives only in its mirror.
        if (!isLivePromiseMirror(owner, key, mirror)) {
            return () => {
                mirror.value = nextValue
            }
        }
        if (canWriteBack) {
            const failure = errorUtils.catchUserCodeFailure(
                () => languageProperties.assertCanPublishPromiseProperty(
                    owner,
                    key,
                ),
                admitFailure,
            )
            if (failure) {
                nextValue = failure
                canWriteBack = false
            }
        }
        const commitEdge = preparePropertyCommit(owner, key, nextValue)
        return () => commitEdge(() => {
            if (canWriteBack) languageProperties.writeLanguageProperty(
                owner,
                key,
                nextValue,
            )
            mirror.value = nextValue
        })
    }
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
    const current = arrayViews.logicalArrayLength(projection)
    const view = arrayViews.isArrayView(projection) ? projection : undefined
    if (view) {
        if (length >= current) {
            const resized = view.setLength(length)
            if (!resized) {
                errorUtils.reportFatalError(
                    new Error("ArrayView growth requires materialization"),
                )
            }
            return undefined
        }
    }
    if (length === current) return undefined

    for (let index = current - 1; index >= length; index--) {
        const key = String(index)
        const property = languageProperties.getLanguagePropertyDescriptor(
            array,
            key,
        )
        if (property && !property.configurable) {
            errorUtils.reportFatalError(
                new Error("Array shrink requires materialization"),
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
        else {
            // A logical Array may be a Proxy whose set trap runs here.
            errorUtils.runUserCode(() => {
                array.length = nextLength
            })
        }
    }
}

function preparePropertyCommit(owner, key, value) {
    return refcounts.prepareLiveEdge(
        owner,
        key,
        value,
        getOrCreatePromiseMirror,
    )
}

function commitProperty(owner, key, value, updateProperty) {
    preparePropertyCommit(owner, key, value)(updateProperty)
}

function buildRefIndex(value) {
    languageValues.admitValue(value)
    return refcounts.buildRefIndex(value, getOrCreatePromiseMirror)
}

function indexValueIfSourceIndexed(source, value) {
    return refcounts.indexValueIfSourceIndexed(
        source,
        value,
        getOrCreatePromiseMirror,
    )
}

function prepareImportedValue(value, importBoundary, externalTreeSetup) {
    return importPreparation.prepareImportedData(
        value,
        importBoundary,
        installImportedPromise,
        externalTreeSetup,
    )
}

function installImportedPromise(owner, key, promise, importBoundary) {
    const mirror = createInitialPromiseMirror(
        owner,
        key,
        promise,
        importBoundary,
    )
    installPromiseMirror(owner, key, mirror)
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
    getPropertyPlacement,
    getPromiseMirror,
    hasPromiseMirrors,
    indexValueIfSourceIndexed,
    isPropertyPlacement,
    placePromiseVersion,
    prepareImportedValue,
    prepareRetainedArrayProperties,
    resolvePropertyValue,
    resolvePropertyValueAtKey,
}
