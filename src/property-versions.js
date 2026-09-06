import { markPromiseHandled } from "./thenable-subscription.js"
import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
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

    captureVersion() {
        if (Object.hasOwn(this, "value")) return
        const { owner, key, operationContext } = this
        const value = languageProperties.readLanguageProperty(
            owner,
            key,
            operationContext,
        )
        this.value = value
        if (languageValues.isPending(value, operationContext)) {
            this.mirror = requirePromiseMirror(
                owner,
                key,
                operationContext,
            )
        }
    }

    resolveValue() {
        this.captureVersion()
        if (!languageValues.isPending(this.value, this.operationContext)) {
            return this.value
        }
        return continuePromiseVersion(
            this.value,
            this.mirror,
            this.operationContext,
            value => {
                this.value = value
                delete this.mirror
                return value
            },
        )
    }
}

function getPlacementVersion(owner, key, operationContext) {
    return metadata.metaOf(owner, operationContext)?.placementVersions?.[key]
}

function getPromiseMirror(owner, key, operationContext) {
    const version = getPlacementVersion(owner, key, operationContext)
    return version?.promise === true ? version : undefined
}

function hasPromiseMirrors(owner, operationContext) {
    const versions = metadata.metaOf(owner, operationContext)?.placementVersions
    if (!versions) return false
    for (const key in versions) {
        if (versions[key].promise === true) return true
    }
    return false
}

function installPlacementVersion(owner, key, version, operationContext) {
    const meta = metadata.requireMeta(owner, operationContext)
    meta.placementVersions ??= Object.create(null)
    meta.placementVersions[key] = version
}

function installFixedPlacementVersion(owner, key, value, operationContext) {
    installPlacementVersion(owner, key, { value }, operationContext)
}

function detachPlacementVersion(owner, key, operationContext) {
    const versions = metadata.metaOf(owner, operationContext)?.placementVersions
    if (versions) delete versions[key]
}

function isLivePromiseMirror(owner, key, mirror, operationContext) {
    return getPromiseMirror(owner, key, operationContext) === mirror
}

function continuePromiseVersion(promise, mirror, operationContext, onValue) {
    return resolution.continueWhenSettled(
        promise,
        operationContext,
        () => onValue(mirror.value),
    )
}

function continuePropertyValue(owner, key, promise, operationContext, onValue) {
    const mirror = requirePromiseMirror(owner, key, operationContext)
    return continuePromiseVersion(
        promise,
        mirror,
        operationContext,
        value => onValue(value, mirror),
    )
}

// Fix presence and key order when structure is observed; capture the value and
// its exact version only when the operation reaches this placement.
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

function resolvePropertyValueAtKey(owner, key, operationContext) {
    return getPropertyPlacement(owner, key, operationContext)?.resolveValue()
}

function requirePromiseMirror(owner, key, operationContext) {
    const mirror = getPromiseMirror(owner, key, operationContext)
    if (!mirror) throw new Error("Pending property has no mirror")
    return mirror
}

function assignProperty(owner, key, value, operationContext, retained = false) {
    languageProperties.assertCanSetLanguageProperty(owner, key, operationContext)
    const version = { value }
    const result = preparePropertyVersion(owner, key, version, operationContext, retained)
    replaceProperty(owner, key, version.promise ? version : undefined, version.value, operationContext)
    return languageValues.isPending(result, operationContext) ? undefined : result
}

// A staging version is callback-visible before subscription. Its logical value
// may change synchronously; only the returned pending chain requires a mirror.
function preparePropertyVersion(owner, key, version, operationContext, retained = false) {
    const publication = resolution.continueInitialValue(
        version.value,
        operationContext,
        resolved => publishPromiseValue(owner, key, version, resolved, operationContext, retained),
        () => true,
        errorUtils.ERROR_KIND.AssignmentValueRejected,
    )
    if (languageValues.isPending(publication, operationContext)) {
        version.promise = true
        markPromiseHandled(publication, operationContext)
    }
    return publication
}

// This is the first consumption of a raw placement. Subsequent reads use its
// logical value and never probe or subscribe to the physical host value again.
function normalizeRawPropertyValue(owner, key, value, operationContext, writable) {
    if (value === null || typeof value !== "object" || Error.isError(value) ||
        metadata.metaOf(value, operationContext)) {
        languageValues.admitReadyValue(value, operationContext)
        return value
    }
    const version = { value }
    preparePropertyVersion(owner, key, version, operationContext)
    if (version.promise) {
        const meta = metadata.metaOf(owner, operationContext)
        if (meta?.parents) throw new Error("Indexed promise property has no mirror")
        if (meta?.imported) throw new Error("Imported promise property has no mirror")
        installPlacementVersion(owner, key, version, operationContext)
    } else if (version.value !== value) {
        if (writable && !metadata.metaOf(owner, operationContext)?.imported) {
            languageProperties.writeLanguageProperty(owner, key, version.value, operationContext)
        } else {
            // Immutable physical storage uses the existing fixed overlay.
            installFixedPlacementVersion(owner, key, version.value, operationContext)
        }
    }
    return version.value
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
    const publication = continuePromiseVersion(
        promise,
        sourceMirror,
        operationContext,
        value => {
            publishPromiseValue(
                owner,
                key,
                mirror,
                value,
                operationContext,
                retained,
            )
        },
    )
    if (languageValues.isPending(publication, operationContext)) {
        mirror.promise = true
        markPromiseHandled(publication, operationContext)
    }
    replaceProperty(owner, key, mirror.promise ? mirror : undefined, mirror.value, operationContext)
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
    retained = false,
) {
    let validationFailure
    value = errorUtils.catchUserCodeFailure(
        () => {
            if (languageValues.isPending(value, operationContext)) {
                throw new Error("A Promise requires a fresh property version")
            }
            if (languageProperties.isCallableThenPlacement(key, value)) {
                value = validationFailure = languageProperties.propertyValidationError(
                    "Language data cannot contain a callable then property",
                    operationContext,
                )
                languageValues.admitReadyValue(value, operationContext)
            } else {
                if (Error.isError(value)) value = errorUtils.toPoison(
                    value,
                    operationContext,
                    errorUtils.ERROR_KIND.AssignmentValueError,
                )
                languageValues.admitReadyValue(value, operationContext)
            }
            if (retained) metadata.markShared(value, operationContext)
            return value
        },
        operationContext,
        errorUtils.ERROR_KIND.PropertyMutationThrew,
        failure => {
            languageValues.admitReadyValue(failure, operationContext)
            return failure
        },
    )
    commitPromiseValue(owner, key, mirror, value, operationContext, true)
    return validationFailure
}

function commitPromiseValue(owner, key, mirror, value, operationContext, writeBack) {
    function admitFailure(failure) {
        languageValues.admitReadyValue(failure, operationContext)
        return failure
    }
    const commit = errorUtils.catchUserCodeFailure(
        () => prepareCommit(value, writeBack),
        operationContext,
        errorUtils.ERROR_KIND.PropertyMutationThrew,
        failure => {
            value = admitFailure(failure)
            return prepareCommit(value, writeBack)
        },
    )
    errorUtils.catchUserCodeFailure(
        commit,
        operationContext,
        errorUtils.ERROR_KIND.PropertyMutationThrew,
        failure => prepareCommit(admitFailure(failure), false)(),
    )


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
                operationContext,
                errorUtils.ERROR_KIND.PropertyMutationThrew,
                admitFailure,
            )
            if (failure) {
                nextValue = failure
                canWriteBack = false
            }
        }
        const commitEdge = refcounts.prepareLiveEdge(
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
        detachPlacementVersion(owner, key, operationContext)
        languageProperties.writeLanguageProperty(owner, key, value, operationContext)
        if (mirror) installPlacementVersion(owner, key, mirror, operationContext)
    })
}

// Callers validate deletion semantics before this atomic edge removal.
function removeProperty(owner, key, operationContext, remove) {
    commitProperty(owner, key, undefined, operationContext, () => {
        detachPlacementVersion(owner, key, operationContext)
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
                throw new Error("ArrayView growth requires materialization")
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
            throw new Error("Array shrink requires materialization")
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

function commitProperty(owner, key, value, operationContext, updateProperty) {
    refcounts.prepareLiveEdge(owner, key, value, operationContext)(updateProperty)
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
        if (!languageValues.isPending(value, operationContext)) {
            metadata.markShared(value, operationContext)
            continue
        }
        placePromiseVersion(
            requirePromiseMirror(source, sourceKey, operationContext),
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
    commitArrayLength,
    continuePropertyValue,
    continuePromiseVersion,
    deleteProperty,
    requirePromiseMirror,
    getPropertyPlacement,
    getPromiseMirror,
    hasPromiseMirrors,
    isPropertyPlacement,
    placePromiseVersion,
    commitPromiseValue,
    installPlacementVersion,
    normalizeRawPropertyValue,
    prepareRetainedArrayProperties,
    resolvePropertyValueAtKey,
}
