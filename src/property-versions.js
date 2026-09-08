import { markPromiseHandled } from "./thenable-subscription.js"
import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as internalSteps from "./internal-step.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as refcounts from "./refcounts.js"

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
            this.promiseVersion = requirePromiseVersion(
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
        return continueCapturedPromiseVersion(
            this.value,
            this.promiseVersion,
            this.operationContext,
            value => {
                this.value = value
                delete this.promiseVersion
                return value
            },
        )
    }
}

function getPlacementVersion(owner, key, operationContext) {
    return metadata.metaOf(owner, operationContext)?.placementVersions?.[key]
}

function getPromiseVersion(owner, key, operationContext) {
    const version = getPlacementVersion(owner, key, operationContext)
    return version?.promiseBacked === true ? version : undefined
}

function hasPlacementVersions(owner, operationContext) {
    const versions = metadata.metaOf(owner, operationContext)?.placementVersions
    if (!versions) return false
    for (const key in versions) {
        return true
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

function isLivePromiseVersion(owner, key, promiseVersion, operationContext) {
    return getPromiseVersion(owner, key, operationContext) === promiseVersion
}

function continueCapturedPromiseVersion(
    promise,
    promiseVersion,
    operationContext,
    onValue,
    operation,
) {
    return internalSteps.continueOperation(
        promise,
        operationContext,
        () => onValue(promiseVersion.value),
        () => onValue(promiseVersion.value),
        operation,
    )
}

function continuePromiseVersion(
    owner,
    key,
    promise,
    operationContext,
    onValue,
    operation,
) {
    const promiseVersion = requirePromiseVersion(owner, key, operationContext)
    return continueCapturedPromiseVersion(
        promise,
        promiseVersion,
        operationContext,
        value => onValue(value, promiseVersion),
        operation,
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

function requirePromiseVersion(owner, key, operationContext) {
    const promiseVersion = getPromiseVersion(owner, key, operationContext)
    if (!promiseVersion) throw new Error("Pending property has no Promise version")
    return promiseVersion
}

function assignProperty(
    owner,
    key,
    value,
    operationContext,
    retained = false,
    kind = errorUtils.ERROR_KIND.AssignmentValueFailed,
) {
    languageProperties.assertCanSetLanguageProperty(owner, key, operationContext)
    const version = { value }
    const result = preparePropertyVersion(
        owner,
        key,
        version,
        operationContext,
        retained,
        kind,
    )
    replaceProperty(owner, key, version.promiseBacked ? version : undefined, version.value, operationContext)
    return languageValues.isPending(result, operationContext) ? undefined : result
}

// A staging version is callback-visible before subscription. Its logical value
// may change synchronously; only the returned pending chain requires a Promise version.
function preparePropertyVersion(
    owner,
    key,
    version,
    operationContext,
    retained = false,
    kind = errorUtils.ERROR_KIND.OperationInputFailed,
) {
    const publication = internalSteps.consumeValue(
        version.value,
        operationContext,
        kind,
        resolved => publishPromiseVersion(owner, key, version, resolved, operationContext, retained),
    )
    if (languageValues.isPending(publication, operationContext)) {
        version.promiseBacked = true
        markPromiseHandled(publication, operationContext)
    }
    return publication
}

// This is the first consumption of a raw placement. Subsequent reads use its
// logical value and never probe or subscribe to the physical host value again.
function normalizeRawPropertyValue(
    owner,
    key,
    value,
    operationContext,
    writable,
) {
    if (Error.isError(value) && !errorUtils.isPoisonError(value)) {
        const poison = errorUtils.createPoisonError(
            value,
            operationContext,
            errorUtils.ERROR_KIND.OperationInputFailed,
        )
        installFixedPlacementVersion(owner, key, poison, operationContext)
        languageValues.admitReadyValue(poison, operationContext)
        return poison
    }
    if (
        value === null || typeof value !== "object" ||
        errorUtils.isPoisonError(value) ||
        metadata.metaOf(value, operationContext)
    ) {
        languageValues.admitReadyValue(value, operationContext)
        return value
    }
    const version = { value }
    preparePropertyVersion(owner, key, version, operationContext)
    if (version.promiseBacked) {
        const meta = metadata.metaOf(owner, operationContext)
        if (meta?.parents) throw new Error("Indexed promise property has no Promise version")
        if (meta?.imported) throw new Error("Imported promise property has no Promise version")
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

function forkPromiseVersion(
    sourceVersion,
    promise,
    owner,
    key,
    operationContext,
    retained = false,
) {
    languageProperties.assertCanSetLanguageProperty(owner, key, operationContext)
    // A derived placement is runtime-owned and may publish into its owner.
    const promiseVersion = { value: promise }
    const publication = continueCapturedPromiseVersion(
        promise,
        sourceVersion,
        operationContext,
        value => {
            publishPromiseVersion(
                owner,
                key,
                promiseVersion,
                value,
                operationContext,
                retained,
            )
        },
    )
    if (languageValues.isPending(publication, operationContext)) {
        promiseVersion.promiseBacked = true
        markPromiseHandled(publication, operationContext)
    }
    replaceProperty(owner, key, promiseVersion.promiseBacked ? promiseVersion : undefined, promiseVersion.value, operationContext)
    return promiseVersion
}

function publishPromiseVersion(
    owner,
    key,
    promiseVersion,
    value,
    operationContext,
    retained = false,
) {
    let validationFailure
    if (languageValues.isPending(value, operationContext)) {
        throw new Error("A Promise requires a fresh property version")
    }
    if (languageProperties.isCallableThenPlacement(key, value)) {
        value = validationFailure = languageProperties.propertyValidationError(
            "Language data cannot contain a callable then property",
            operationContext,
        )
    }
    languageValues.admitReadyValue(value, operationContext)
    if (retained) metadata.markShared(value, operationContext)
    commitPromiseVersion(owner, key, promiseVersion, value, operationContext, true)
    return validationFailure
}

function commitPromiseVersion(
    owner,
    key,
    promiseVersion,
    value,
    operationContext,
    writeBack,
) {
    function recordFailure(failure) {
        // Publishing an already failed value can fail independently. Each retry
        // retains the accumulated diagnostic instead of replacing an earlier cause.
        value = errorUtils.isPoisonError(value)
            ? errorUtils.combineErrors([value, failure], "Property publication failed")
            : failure
        languageValues.admitReadyValue(value, operationContext)
        return value
    }
    const commit = errorUtils.catchExternalThrow(
        () => prepareCommit(value, writeBack),
        operationContext,
        errorUtils.ERROR_KIND.PropertyMutationFailed,
        failure => prepareCommit(recordFailure(failure), writeBack),
    )
    errorUtils.catchExternalThrow(
        commit,
        operationContext,
        errorUtils.ERROR_KIND.PropertyMutationFailed,
        failure => prepareCommit(recordFailure(failure), false)(),
    )

    function prepareCommit(nextValue, canWriteBack) {
        // A runtime-owned version can be displaced when its owner is later
        // imported. Detachment leaves only the captured version to update.
        if (!isLivePromiseVersion(owner, key, promiseVersion, operationContext)) {
            return () => {
                promiseVersion.value = nextValue
            }
        }
        if (canWriteBack) {
            const failure = errorUtils.catchExternalThrow(
                () => languageProperties.assertCanPublishPromiseProperty(
                    owner,
                    key,
                    operationContext,
                ),
                operationContext,
                errorUtils.ERROR_KIND.PropertyMutationFailed,
                recordFailure,
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
            promiseVersion.value = nextValue
        })
    }
}

function replaceProperty(owner, key, promiseVersion, value, operationContext) {
    commitProperty(owner, key, value, operationContext, () => {
        languageProperties.writeLanguageProperty(owner, key, value, operationContext)
        // Failed storage work must leave the old logical version available.
        detachPlacementVersion(owner, key, operationContext)
        if (promiseVersion) installPlacementVersion(owner, key, promiseVersion, operationContext)
    })
}

// Callers validate deletion semantics before this atomic edge removal.
function removeProperty(owner, key, operationContext, remove) {
    commitProperty(owner, key, undefined, operationContext, () => {
        if (remove) remove()
        else languageProperties.deleteLanguageProperty(owner, key, operationContext)
        detachPlacementVersion(owner, key, operationContext)
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
            const resized = view.setLength(length, operationContext)
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
                view
                    ? () => view.setLength(index, operationContext)
                    : undefined,
            )
        } else if (view) {
            view.setLength(index, operationContext)
        }
    }
    setLength(length)
    return undefined

    function setLength(nextLength) {
        if (view) view.setLength(nextLength, operationContext)
        else {
            // A logical Array may be a Proxy whose set trap runs here.
            errorUtils.runExternalAction(operationContext, () => {
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
            // Views share physical backing, but every retained placement keeps
            // its logical value, including a fixed Error or custom-thenable outcome.
            if (getPlacementVersion(source, sourceKey, operationContext))
                installFixedPlacementVersion(destination, destinationKey, value, operationContext)
            continue
        }
        forkPromiseVersion(
            requirePromiseVersion(source, sourceKey, operationContext),
            value,
            destination,
            destinationKey,
            operationContext,
            true,
        )
    }
}

export {
    publishPromiseVersion,
    assignProperty,
    commitArrayLength,
    continuePromiseVersion,
    deleteProperty,
    requirePromiseVersion,
    getPropertyPlacement,
    getPromiseVersion,
    getPlacementVersion,
    hasPlacementVersions,
    isPropertyPlacement,
    forkPromiseVersion,
    commitPromiseVersion,
    installPlacementVersion,
    normalizeRawPropertyValue,
    prepareRetainedArrayProperties,
    resolvePropertyValueAtKey,
}
