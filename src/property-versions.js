import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as importPreparation from "./import-preparation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as refcounts from "./refcounts.js"
import * as resolution from "./resolution.js"

class PropertyPlacement {
    constructor(owner, key, operationContext) {
        this.owner = owner
        this.key = key
        this.operationContext = operationContext
    }
}

function getPromiseMirror(owner, key, operationContext) {
    return metadata.metaOf(owner, operationContext)?.mirrors?.[key]
}

function hasPromiseMirrors(owner, operationContext) {
    const mirrors = metadata.metaOf(owner, operationContext)?.mirrors
    if (!mirrors) return false
    for (const _key in mirrors) return true
    return false
}

function installPromiseMirror(owner, key, mirror, operationContext) {
    const meta = metadata.requireMeta(owner, operationContext)
    meta.mirrors ??= Object.create(null)
    meta.mirrors[key] = mirror
}

function detachPromiseMirror(owner, key, operationContext) {
    const mirrors = metadata.metaOf(owner, operationContext)?.mirrors
    if (mirrors) delete mirrors[key]
}

function isLivePromiseMirror(owner, key, mirror, operationContext) {
    return getPromiseMirror(owner, key, operationContext) === mirror
}

function continuePromiseVersion(promise, mirror, operationContext, onValue) {
    return resolution.onLaterPromiseReady(
        promise,
        operationContext,
        () => onValue(mirror.value),
    )
}

function continuePropertyValue(owner, key, promise, operationContext, onValue) {
    const mirror = getOrCreatePromiseMirror(owner, key, promise, operationContext)
    return continuePromiseVersion(
        promise,
        mirror,
        operationContext,
        value => onValue(value, mirror),
    )
}

// Fix presence and key order when structure is observed; capture the value and
// its exact version only when the operation reaches this origin.
function getPropertyPlacement(owner, key, operationContext) {
    key = String(key)
    if (!languageProperties.hasLanguageProperty(owner, key, operationContext)) {
        return undefined
    }
    return new PropertyPlacement(owner, key, operationContext)
}

function isPropertyPlacement(value) {
    return value instanceof PropertyPlacement
}

function capturePropertyVersion(origin) {
    if (
        !origin ||
        Object.hasOwn(origin, "value")
    ) return
    const { owner, key, operationContext } = origin
    const value = languageProperties.readLanguageProperty(owner, key, operationContext)
    origin.value = value
    if (languageValues.isPromise(value, operationContext)) {
        origin.mirror = getOrCreatePromiseMirror(owner, key, value, operationContext)
    }
}

function resolvePropertyValue(origin) {
    capturePropertyVersion(origin)
    if (!origin || !languageValues.isPromise(origin.value, origin.operationContext)) {
        return origin?.value
    }
    return continuePromiseVersion(
        origin.value,
        origin.mirror,
        origin.operationContext,
        value => {
            origin.value = value
            delete origin.mirror
            return value
        },
    )
}

function resolvePropertyValueAtKey(owner, key, operationContext) {
    return resolvePropertyValue(getPropertyPlacement(owner, key, operationContext))
}

function getOrCreatePromiseMirror(owner, key, promise, operationContext) {
    const meta = metadata.metaOf(owner, operationContext)
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
    languageProperties.assertCanSetLanguageProperty(owner, key, operationContext)

    const mirror = createInitialPromiseMirror(owner, key, promise, operationContext)
    installPromiseMirror(owner, key, mirror, operationContext)
    return mirror
}

function assignProperty(owner, key, value, operationContext, retained = false) {
    languageProperties.assertCanSetLanguageProperty(owner, key, operationContext)
    const isPromise = languageValues.isPromise(value, operationContext)
    if (!isPromise) languageValues.admitReadyValue(value, operationContext)
    if (retained && !isPromise) metadata.markShared(value, operationContext)
    const mirror = isPromise
        ? createInitialPromiseMirror(
            owner,
            key,
            value,
            operationContext,
            undefined,
            retained,
        )
        : undefined
    replaceProperty(owner, key, mirror, value, operationContext)
}

// An initial version consumes the settlement payload. Derived versions instead
// sample their source mirror at their own FIFO position.
function createInitialPromiseMirror(
    owner,
    key,
    promise,
    operationContext,
    importBoundary,
    retained = false,
) {
    const mirror = { value: promise }
    const publish = value => publishPromiseValue(
        owner,
        key,
        mirror,
        value,
        operationContext,
        importBoundary,
        retained,
    )
    if (importBoundary) {
        // Import must process fulfillment before admission; the general
        // initial-value resolver admits first.
        languageValues.continuePromise(
            promise,
            operationContext,
            value => errorUtils.runFatal(operationContext, publish, value),
            reason => errorUtils.runFatal(
                operationContext,
                publish,
                errorUtils.toPoison(reason),
            ),
        )
    } else {
        resolution.resolveInitialValueOrPoison(promise, operationContext, publish)
    }
    return mirror
}

function placePromiseVersion(
    sourceMirror,
    promise,
    owner,
    key,
    operationContext,
    retained = false,
) {
    languageProperties.assertCanSetLanguageProperty(owner, key, operationContext)
    // A derived placement is runtime-owned and may publish into its owner.
    const mirror = { value: promise }
    continuePromiseVersion(promise, sourceMirror, operationContext, value => {
        publishPromiseValue(
            owner,
            key,
            mirror,
            value,
            operationContext,
            undefined,
            retained,
        )
    })
    replaceProperty(owner, key, mirror, promise, operationContext)
    return mirror
}

function advancePromiseVersion(owner, key, mirror, value, operationContext) {
    publishPromiseValue(owner, key, mirror, value, operationContext)
}

function publishPromiseValue(
    owner,
    key,
    mirror,
    value,
    operationContext,
    importBoundary,
    retained = false,
) {
    value = errorUtils.catchUserCodeFailure(
        () => {
            if (languageValues.isPromise(value, operationContext)) {
                errorUtils.reportFatalError(
                    new Error("A Promise requires a fresh property version"),
                )
            }
            if (importBoundary) {
                value = prepareImportedValue(value, operationContext, importBoundary)
            } else {
                languageValues.admitReadyValue(value, operationContext)
            }
            if (retained) metadata.markShared(value, operationContext)
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
        languageValues.admitReadyValue(failure, operationContext)
        return failure
    }

    function prepareCommit(nextValue, canWriteBack) {
        // A runtime-owned version can be displaced when its owner is later
        // imported. A detached version survives only in its mirror.
        if (!isLivePromiseMirror(owner, key, mirror, operationContext)) {
            return () => {
                mirror.value = nextValue
            }
        }
        if (canWriteBack) {
            const failure = errorUtils.catchUserCodeFailure(
                () => languageProperties.assertCanPublishPromiseProperty(
                    owner,
                    key,
                    operationContext,
                ),
                admitFailure,
            )
            if (failure) {
                nextValue = failure
                canWriteBack = false
            }
        }
        const commitEdge = preparePropertyCommit(
            owner,
            key,
            nextValue,
            operationContext,
        )
        return () => commitEdge(() => {
            if (canWriteBack) languageProperties.writeLanguageProperty(
                owner,
                key,
                nextValue,
                operationContext,
            )
            mirror.value = nextValue
        })
    }
}

function replaceProperty(owner, key, mirror, value, operationContext) {
    commitProperty(owner, key, value, operationContext, () => {
        detachPromiseMirror(owner, key, operationContext)
        languageProperties.writeLanguageProperty(owner, key, value, operationContext)
        if (mirror) installPromiseMirror(owner, key, mirror, operationContext)
    })
}

// Callers validate deletion semantics before this atomic edge removal.
function removeProperty(owner, key, operationContext, remove) {
    commitProperty(owner, key, undefined, operationContext, () => {
        detachPromiseMirror(owner, key, operationContext)
        if (remove) remove()
        else languageProperties.deleteLanguageProperty(owner, key, operationContext)
    })
}

function deleteProperty(owner, key, operationContext) {
    languageProperties.assertCanDeleteLanguageProperty(owner, key, operationContext)
    removeProperty(owner, key, operationContext)
}

function commitArrayLength(array, length, operationContext) {
    const projection = arrayViews.projectionOf(array, operationContext)
    const current = arrayViews.logicalArrayLength(projection, operationContext)
    const view = arrayViews.isArrayView(projection, operationContext)
        ? projection
        : undefined
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
            operationContext,
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
                operationContext,
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

function preparePropertyCommit(owner, key, value, operationContext) {
    return refcounts.prepareLiveEdge(
        owner,
        key,
        value,
        operationContext,
        (parent, childKey, promise) => getOrCreatePromiseMirror(
            parent,
            childKey,
            promise,
            operationContext,
        ),
    )
}

function commitProperty(owner, key, value, operationContext, updateProperty) {
    preparePropertyCommit(owner, key, value, operationContext)(updateProperty)
}

function buildRefIndex(value, operationContext) {
    languageValues.admitValue(value, operationContext)
    return refcounts.buildRefIndex(
        value,
        operationContext,
        (parent, key, promise) => getOrCreatePromiseMirror(
            parent,
            key,
            promise,
            operationContext,
        ),
    )
}

function indexValueIfSourceIndexed(source, value, operationContext) {
    return refcounts.indexValueIfSourceIndexed(
        source,
        value,
        operationContext,
        (parent, key, promise) => getOrCreatePromiseMirror(
            parent,
            key,
            promise,
            operationContext,
        ),
    )
}

function prepareImportedValue(
    value,
    operationContext,
    importBoundary,
    externalTreeSetup,
) {
    return importPreparation.prepareImportedData(
        value,
        operationContext,
        importBoundary,
        (owner, key, promise, boundary) => installImportedPromise(
            owner,
            key,
            promise,
            operationContext,
            boundary,
        ),
        externalTreeSetup,
    )
}

function installImportedPromise(owner, key, promise, operationContext, importBoundary) {
    const mirror = createInitialPromiseMirror(
        owner,
        key,
        promise,
        operationContext,
        importBoundary,
    )
    installPromiseMirror(owner, key, mirror, operationContext)
}

function prepareRetainedArrayProperties(
    source,
    destination,
    operationContext,
    sourceStart = 0,
    sourceEnd = arrayViews.logicalArrayLength(source, operationContext),
    destinationOffset = 0,
) {
    for (const sourceKey of arrayViews.enumerableArrayKeys(
        source,
        operationContext,
        sourceStart,
        sourceEnd,
    )) {
        const destinationKey = String(Number(sourceKey) + destinationOffset)
        const value = languageProperties.readLanguageProperty(
            source,
            sourceKey,
            operationContext,
        )
        if (!languageValues.isPromise(value, operationContext)) {
            metadata.markShared(value, operationContext)
            continue
        }
        placePromiseVersion(
            getOrCreatePromiseMirror(source, sourceKey, value, operationContext),
            value,
            destination,
            destinationKey,
            operationContext,
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
