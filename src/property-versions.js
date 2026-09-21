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

    ensureCaptured() {
        if (Object.hasOwn(this, "value")) return this
        const { owner, key, operationContext } = this
        languageProperties.readLanguageProperty(owner, key, operationContext)
        Object.assign(this, capturePlacement(owner, key, operationContext))
        return this
    }

    resolveValue() {
        return resolvePlacement(this.ensureCaptured(), this.operationContext, placement => {
            Object.assign(this, placement)
            return this.value
        })
    }

    resolvePresence() {
        const version = Object.hasOwn(this, "value") ? this.sourceVersion :
            getPlacementVersion(this.owner, this.key, this.operationContext)
        if (!version?.pendingPresence && version?.present !== false) return this
        // Publication fixes presence even when the published value is pending.
        return resolvePlacementTransition(this.ensureCaptured(), this.operationContext,
            placement => Object.assign(this, placement))
    }
}

// Capture without consuming an unused old value. A replacement must not wait
// for the value it replaces merely to retain a recovery baseline.
// Deferred selection supplies its captured version, even if it is now detached.
function capturePlacement(owner, key, operationContext, capturedVersion) {
    const version = capturedVersion ?? getPlacementVersion(owner, key, operationContext)
    if (version) return capturePlacementFromVersion(version)
    const descriptor = languageProperties.getLanguagePlacementDescriptor(owner, key, operationContext)
    return { value: descriptor?.value, present: Boolean(descriptor) }
}

function capturePlacementFromVersion(version) {
    return {
        value: version.value, present: version.present !== false,
        sourceVersion: version.promiseBacked ? version : undefined,
        recovery: version.recovery,
    }
}

// A destination has its own publication authority and capture obligations.
// Only logical contents and unfinished source dependencies cross placements.
function createVersionFromPlacement(placement) {
    return {
        value: placement.value, present: placement.present, recovery: placement.recovery,
        pendingPresence: placement.sourceVersion?.pendingPresence,
        transition: placement.sourceVersion?.transition,
    }
}

// A pending capture follows its own version, never a later live placement.
// Delivery fixes presence and recovery together with the logical value.
function resolvePlacement(placement, operationContext, onReady) {
    if (!languageValues.isPending(placement.value, operationContext)) return onReady(placement)
    const version = placement.sourceVersion
    if (!version) return internalSteps.consumeValue(placement.value, operationContext,
        errorUtils.ERROR_KIND.OperationInputFailed, value => onReady({ ...placement, value }))
    return continueCapturedPromiseVersion(placement.value, version, operationContext, value =>
        onReady({ value, present: version.present !== false, recovery: version.recovery, sourceVersion: undefined }))
}

// Call after subscription: synchronous delivery may already have advanced the
// version or handed publication to a new producer. Keep that newer dependency.
function trackVersionPublication(version, publication, operationContext) {
    if (!languageValues.isPending(publication, operationContext)) return false
    version.promiseBacked = true
    version.publication ??= publication
    markPromiseHandled(publication, operationContext)
    return true
}

// Replacement waits for preceding work to publish, not for the data that work
// publishes. Copies carry the same transition until their value becomes ready.
function resolvePlacementTransition(placement, operationContext, onReady) {
    const transition = placement.sourceVersion?.transition
    if (!transition) return onReady(placement)
    const resume = () => resolvePlacementTransition(transition.placement, operationContext, onReady)
    return transition.placement ? resume() :
        internalSteps.continueOperation(transition.promise, operationContext, resume)
}

function retainPlacement(placement, operationContext) {
    if (languageValues.isPending(placement.value, operationContext)) {
        if (placement.sourceVersion) placement.sourceVersion.retained = true
    } else if (!Error.isError(placement.value)) {
        languageValues.admitReadyValue(placement.value, operationContext)
        metadata.markShared(placement.value, operationContext)
    }
    if (placement.recovery) retainPlacement(placement.recovery, operationContext)
}

function transferPlacement(placement, owner, key, operationContext, retained = false, destinationVersion,
    kind = errorUtils.ERROR_KIND.AssignmentValueFailed) {
    if (retained || destinationVersion?.retained) retainPlacement(placement, operationContext)
    if (!destinationVersion && !placement.present) {
        deleteProperty(owner, key, operationContext)
        return undefined
    }
    if (!destinationVersion || isLivePromiseVersion(owner, key, destinationVersion, operationContext))
        languageProperties.assertCanSetLanguageProperty(owner, key, operationContext)
    let version = createVersionFromPlacement(placement)
    const deliver = resolved => publishPromiseVersion(owner, key, version, resolved, operationContext, retained)
    const publication = placement.sourceVersion
        ? resolvePlacement(placement, operationContext, deliver)
        : internalSteps.consumeValue(placement.value, operationContext, kind,
            value => deliver({ ...placement, value }))
    const pending = trackVersionPublication(version, publication, operationContext)
    if (destinationVersion) {
        commitPlacementVersion(owner, key, destinationVersion, version, operationContext)
        // Synchronous delivery stages above; later delivery advances the exact
        // captured version only after its complete placement has committed.
        version = destinationVersion
    } else if (version.present === false) deleteProperty(owner, key, operationContext)
    else replaceProperty(owner, key, version.promiseBacked || version.recovery ? version : undefined,
        version.value, operationContext)
    return pending ? undefined : publication
}

function installPlacementGate(owner, key, operationContext, capturedVersion) {
    const { promise, resolve } = Promise.withResolvers()
    const publication = Promise.withResolvers()
    const transition = { promise: publication.promise }
    const gate = {
        promise, owner, key,
        resolve() {
            const version = gate.version
            transition.placement = capturePlacementFromVersion(version)
            publication.resolve()
            // Replacement may proceed after publication. Value consumers still
            // wait for any pending data that was published through the gate.
            markPromiseHandled(continueCapturedPromiseVersion(version.value, version,
                operationContext, resolve), operationContext)
        },
    }
    const version = { value: gate.promise, promiseBacked: true, pendingPresence: true, transition }
    if (capturedVersion) {
        commitPlacementVersion(owner, key, capturedVersion, version, operationContext)
        gate.version = capturedVersion
    } else {
        languageProperties.assertCanSetLanguageProperty(owner, key, operationContext)
        replaceProperty(owner, key, version, gate.promise, operationContext)
        gate.version = version
    }
    return gate
}

function completePlacementGate(gate, placement, operationContext) {
    // Completion is exposed through the gate; this helper owns pending publication.
    // A nested command may still change presence or recovery. Finish that
    // transition here so failed publication follows the same recovery path as
    // ready completion. Pending data itself does not delay gate publication.
    const publication = resolvePlacementTransition(placement, operationContext, resolved => {
        const failure = errorUtils.catchExternalThrow(
            () => transferPlacement(resolved, gate.owner, gate.key, operationContext, false, gate.version),
            operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)
        if (errorUtils.isPoisonError(failure)) {
            const poison = errorUtils.isPoisonError(resolved.value)
                ? errorUtils.combineErrors([resolved.value, failure], "Entry publication failed") : failure
            retainPlacement(resolved, operationContext)
            commitPlacementVersion(gate.owner, gate.key, gate.version,
                { value: poison, present: true, recovery: resolved.recovery ?? resolved }, operationContext, false)
        }
        gate.resolve()
    })
    markPromiseHandled(publication, operationContext)
}

// An operation publishes all placement facts atomically. Unlike shared Promise
// settlement, a failed restoration leaves the previous placement available.
function commitPlacementVersion(owner, key, version, placement, operationContext, writeBack = true) {
    if (writeBack && isLivePromiseVersion(owner, key, version, operationContext)) {
        if (placement.present === false && !errorUtils.isPoisonError(placement.value))
            languageProperties.assertCanDeleteLanguageProperty(owner, key, operationContext)
        else languageProperties.assertCanSetLanguageProperty(owner, key, operationContext)
    }
    preparePlacementCommit(owner, key, version, placement, operationContext, writeBack)()
}

function preparePlacementCommit(owner, key, version, placement, operationContext, writeBack) {
    // Captured consumers may resume after publication makes this placement
    // ready. Preserve their value before a later synchronous writer can use it.
    if (version.retained) retainPlacement(placement, operationContext)
    const commit = () => {
        version.value = placement.value
        version.present = placement.present
        version.recovery = placement.recovery
        version.pendingPresence = placement.pendingPresence
        version.transition = placement.transition
        version.publication = placement.publication
    }
    if (!isLivePromiseVersion(owner, key, version, operationContext)) return commit
    const absent = placement.present === false && !errorUtils.isPoisonError(placement.value)
    const commitEdge = refcounts.prepareLiveEdge(owner, key, placement.value, operationContext)
    return () => commitEdge(() => {
        if (writeBack) {
            if (absent) languageProperties.deleteLanguageProperty(owner, key, operationContext)
            else languageProperties.writeLanguageProperty(owner, key, placement.value, operationContext)
        }
        commit()
        if (writeBack && absent) detachAbsentVersion(owner, key, version, operationContext)
    })
}

function detachAbsentVersion(owner, key, version, operationContext) {
    if (version.present === false && !errorUtils.isPoisonError(version.value) && !version.writing &&
        isLivePromiseVersion(owner, key, version, operationContext))
        detachPlacementVersion(owner, key, operationContext)
}

function getPlacementVersion(owner, key, operationContext) {
    return metadata.metaOf(owner, operationContext)?.placementVersions?.[key]
}

function getPromiseVersion(owner, key, operationContext) {
    const version = getPlacementVersion(owner, key, operationContext)
    return version?.promiseBacked === true ? version : undefined
}

function installPlacementVersion(owner, key, version, operationContext) {
    const meta = metadata.requireMeta(owner, operationContext)
    meta.placementVersions ??= Object.create(null)
    meta.placementVersions[key] = version
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
        deliver,
        deliver,
        operation,
    )
    function deliver() {
        const value = promiseVersion.value
        return languageValues.isPending(value, operationContext)
            // A copied transition can still be publishing after its old source
            // signal settles. Wait for its producer instead of polling that signal.
            ? continueCapturedPromiseVersion(value === promise ? promiseVersion.publication : value,
                promiseVersion, operationContext, onValue, operation)
            : onValue(value)
    }
}

function observePromiseVersion(
    promise,
    promiseVersion,
    operationContext,
    onValue,
    operation,
) {
    if (operation && !operation.open) return undefined
    // A transition can publish through another signal before this observer
    // resumes. Its captured value needs protection at publication, independently
    // of the lifetime owner used only to guard the observer's continuation.
    if (promiseVersion.transition) retainPlacement(capturePlacementFromVersion(promiseVersion), operationContext)
    return continueCapturedPromiseVersion(
        promise,
        promiseVersion,
        operationContext,
        value => onValue(value, promiseVersion),
        operation,
    )
}

// Each queued mutation owns its publication version. Keep the original source
// as its availability signal so supported thenables can still deliver directly.
// Later access cannot see ready state until this mutation has taken its turn.
function installMutationVersion(owner, key, source, operationContext, onValue) {
    const captured = capturePlacementFromVersion(source)
    const transition = {}
    const version = createVersionFromPlacement(captured)
    version.promiseBacked = true
    version.transition = transition
    installPlacementVersion(owner, key, version, operationContext)
    let result
    transition.promise = resolvePlacement(captured, operationContext, placement => {
        version.writing = true
        publishPromiseVersion(owner, key, version, placement, operationContext)
        result = onValue(version.value, version)
        delete version.writing
        detachAbsentVersion(owner, key, version, operationContext)
        transition.placement = capturePlacementFromVersion(version)
    })
    trackVersionPublication(version, transition.promise, operationContext)
    return internalSteps.continueOperation(transition.promise, operationContext, () => result)
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
    return transferPlacement({ value, present: true }, owner, key, operationContext, retained, undefined, kind)
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
        installPlacementVersion(owner, key, { value: poison }, operationContext)
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
    const publication = internalSteps.consumeValue(value, operationContext,
        errorUtils.ERROR_KIND.OperationInputFailed,
        resolved => publishPromiseVersion(owner, key, version, { value: resolved, present: true }, operationContext))
    if (trackVersionPublication(version, publication, operationContext)) {
        const meta = metadata.metaOf(owner, operationContext)
        if (meta?.parents) throw new Error("Indexed promise property has no Promise version")
        if (meta?.imported) throw new Error("Imported promise property has no Promise version")
        installPlacementVersion(owner, key, version, operationContext)
    } else if (version.value !== value) {
        if (writable && !metadata.metaOf(owner, operationContext)?.imported) {
            languageProperties.writeLanguageProperty(owner, key, version.value, operationContext)
        } else {
            // Immutable physical storage uses the existing fixed overlay.
            installPlacementVersion(owner, key, { value: version.value }, operationContext)
        }
    }
    return version.value
}

function publishPromiseVersion(
    owner,
    key,
    promiseVersion,
    placement,
    operationContext,
    retained = false,
) {
    let { value } = placement
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
    const ready = { value, present: placement.present, recovery: placement.recovery }
    if (retained) retainPlacement(ready, operationContext)
    commitPromiseVersion(owner, key, promiseVersion, ready, operationContext, true)
    return validationFailure
}

function commitPromiseVersion(
    owner,
    key,
    promiseVersion,
    placement,
    operationContext,
    writeBack,
) {
    let { value } = placement
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
        if (canWriteBack && isLivePromiseVersion(owner, key, promiseVersion, operationContext)) {
            const failure = errorUtils.catchExternalThrow(
                () => languageProperties.assertCanSetLanguageProperty(
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
        return preparePlacementCommit(owner, key, promiseVersion,
            { ...placement, value: nextValue }, operationContext, canWriteBack)
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

    const affected = [...arrayViews.arrayKeyCandidates(array, operationContext, length, current)].sort((a, b) => Number(b) - Number(a))
    for (const key of affected) {
        const index = Number(key)
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
            const captured = capturePlacement(source, sourceKey, operationContext)
            retainPlacement(captured, operationContext)
            // Views share physical backing, but every retained placement keeps
            // its logical value, including a fixed Error or custom-thenable outcome.
            if (getPlacementVersion(source, sourceKey, operationContext))
                installPlacementVersion(destination, destinationKey, {
                    value, present: captured.present, recovery: captured.recovery,
                }, operationContext)
            continue
        }
        transferPlacement(capturePlacement(source, sourceKey, operationContext),
            destination, destinationKey, operationContext, true)
    }
}

export {
    installPlacementGate,
    completePlacementGate,
    capturePlacement,
    capturePlacementFromVersion,
    createVersionFromPlacement,
    resolvePlacement,
    resolvePlacementTransition,
    retainPlacement,
    transferPlacement,
    commitPlacementVersion,
    publishPromiseVersion,
    assignProperty,
    commitArrayLength,
    observePromiseVersion,
    installMutationVersion,
    continueCapturedPromiseVersion,
    deleteProperty,
    requirePromiseVersion,
    getPropertyPlacement,
    getPromiseVersion,
    getPlacementVersion,
    isPropertyPlacement,
    commitPromiseVersion,
    installPlacementVersion,
    normalizeRawPropertyValue,
    prepareRetainedArrayProperties,
    trackVersionPublication,
    resolvePropertyValueAtKey,
}
