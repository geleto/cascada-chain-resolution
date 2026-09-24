import { markPromiseHandled } from "./thenable-subscription.js"
import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as internalSteps from "./internal-step.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as refcounts from "./refcounts.js"
import { beginPlacementStructure, preparePlacementStructure } from "./placement-structure.js"

class PropertyPlacement {
    constructor(owner, key, operationContext) {
        this.owner = owner
        this.key = key
        this.operationContext = operationContext
    }

    ensureCaptured() {
        if (Object.hasOwn(this, "value")) return this
        const { owner, key, operationContext } = this
        Object.assign(this, languageProperties.readLanguagePlacement(owner, key, operationContext))
        return this
    }

    resolveValue() {
        const captured = this.ensureCaptured()
        // The caller receives pending data through another Promise reaction.
        // Protect it at publication, before a later writer can resume.
        if (languageValues.isPending(captured.value, this.operationContext)) retainPlacement(captured, this.operationContext)
        return resolvePlacement(captured, this.operationContext, placement => {
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
    return { value: descriptor?.value, present: Boolean(descriptor),
        position: metadata.metaOf(owner, operationContext)?.recordOrder?.positions.get(key)?.position ?? (descriptor ? -1 : Infinity) }
}

function capturePlacementFromVersion(version) {
    return {
        value: version.value, present: version.present !== false,
        sourceVersion: version.promiseBacked ? version : undefined,
        recovery: version.recovery,
        position: version.position ?? (version.present === false ? Infinity : -1),
    }
}

// A destination has its own publication authority and capture obligations.
// Only logical contents and unfinished source dependencies cross placements.
function createVersionFromPlacement(placement) {
    return {
        value: placement.value, present: placement.present, recovery: placement.recovery,
        pendingPresence: placement.sourceVersion?.pendingPresence,
        transition: placement.sourceVersion?.transition,
        position: placement.position,
    }
}

// A pending capture follows its own version, never a later live placement.
// Delivery fixes presence and recovery together with the logical value.
function resolvePlacement(placement, operationContext, onReady, kind = errorUtils.ERROR_KIND.OperationInputFailed) {
    if (!languageValues.isPending(placement.value, operationContext)) return onReady(placement)
    const version = placement.sourceVersion
    if (!version) return internalSteps.consumeValue(placement.value, operationContext,
        kind, value => onReady({ ...placement, value }))
    return continueCapturedPromiseVersion(placement.value, version, operationContext, value =>
        onReady({ value, present: version.present !== false, recovery: version.recovery, position: version.position, sourceVersion: undefined }))
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
    kind = errorUtils.ERROR_KIND.AssignmentValueFailed, writeBack = true, structure) {
    if (retained || destinationVersion?.retained) retainPlacement(placement, operationContext)
    if (writeBack && !destinationVersion && !placement.present) {
        deleteProperty(owner, key, operationContext)
        return undefined
    }
    if (writeBack && !placement.sourceVersion?.pendingPresence &&
        (!destinationVersion || isLivePlacementVersion(owner, key, destinationVersion, operationContext)))
        languageProperties.assertCanSetLanguageProperty(owner, key, operationContext)
    let version = createVersionFromPlacement(placement)
    const deliver = resolved => publishPromiseVersion(owner, key, version, resolved, operationContext, retained)
    const publication = placement.sourceVersion
        ? resolvePlacement(placement, operationContext, deliver)
        : internalSteps.consumeValue(placement.value, operationContext, kind,
            value => deliver({ ...placement, value }))
    const pending = trackVersionPublication(version, publication, operationContext)
    if (destinationVersion) {
        commitPlacementVersion(owner, key, destinationVersion, version, operationContext, writeBack && !version.pendingPresence, structure)
        // Synchronous delivery stages above; later delivery advances the exact
        // captured version only after its complete placement has committed.
        version = destinationVersion
    } else if (!writeBack || version.pendingPresence) replaceLogicalPlacement(owner, key, version, operationContext)
    else if (version.present === false) deleteProperty(owner, key, operationContext)
    else replaceProperty(owner, key, version, operationContext)
    return pending ? undefined : publication
}

function installPlacementGate(owner, key, operationContext, captured, capturedVersion) {
    const previous = capturedVersion ?? getPlacementVersion(owner, key, operationContext)
    const { promise, resolve } = Promise.withResolvers()
    const publication = Promise.withResolvers()
    const transition = { promise: publication.promise }
    const gate = {
        promise, owner, key,
        resolve() {
            const version = gate.version
            gate.structure.complete()
            transition.placement = capturePlacementFromVersion(version)
            publication.resolve()
            // Replacement may proceed after publication. Value consumers still
            // wait for any pending data that was published through the gate.
            markPromiseHandled(continueCapturedPromiseVersion(version.value, version,
                operationContext, resolve), operationContext)
        },
    }
    const version = { value: gate.promise, promiseBacked: true, pendingPresence: true, transition, position: captured.position }
    const commit = capturedVersion ? undefined : refcounts.prepareLiveEdge(owner, key, version.value, operationContext, captured)
    gate.structure = beginPlacementStructure(owner, key, captured, operationContext)
    version.storageAbsent = previous ? previous.storageAbsent : !captured.present
    if (capturedVersion) {
        commitPlacementVersion(owner, key, capturedVersion, version, operationContext, false)
        gate.version = capturedVersion
    } else {
        gate.version = version
        commit(() => installPlacementVersion(owner, key, version, operationContext))
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
            () => transferPlacement(resolved, gate.owner, gate.key, operationContext, false, gate.version,
                errorUtils.ERROR_KIND.AssignmentValueFailed, false, gate.structure),
            operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)
        if (errorUtils.isPoisonError(failure)) {
            const poison = errorUtils.isPoisonError(resolved.value)
                ? errorUtils.combineErrors([resolved.value, failure], "Entry publication failed") : failure
            retainPlacement(resolved, operationContext)
            commitPlacementVersion(gate.owner, gate.key, gate.version,
                { value: poison, present: true, recovery: resolved.recovery ?? resolved, position: resolved.position }, operationContext, false, gate.structure)
        }
        gate.resolve()
    })
    markPromiseHandled(publication, operationContext)
    return publication
}

// An operation publishes all placement facts atomically. Unlike shared Promise
// settlement, a failed restoration leaves the previous placement available.
function commitPlacementVersion(owner, key, version, placement, operationContext, writeBack = true, structure) {
    if (writeBack && isLivePlacementVersion(owner, key, version, operationContext)) {
        if (placement.present === false && !errorUtils.isPoisonError(placement.value))
            languageProperties.assertCanDeleteLanguageProperty(owner, key, operationContext)
        else languageProperties.assertCanSetLanguageProperty(owner, key, operationContext)
    }
    preparePlacementCommit(owner, key, version, placement, operationContext, writeBack, structure)()
}

function preparePlacementCommit(owner, key, version, placement, operationContext, writeBack, structure) {
    placement.position ??= version.position
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
        version.position = placement.position
    }
    if (!isLivePlacementVersion(owner, key, version, operationContext)) {
        // Detachment removes storage authority, not this transition's captured
        // structural effects. Earlier length/order observers still need them.
        const commitStructure = structure?.prepare(placement)
        return () => { commit(); commitStructure?.() }
    }
    const absent = placement.present === false && !errorUtils.isPoisonError(placement.value)
    const commitEdge = preparePropertyCommit(owner, key, placement, operationContext, structure)
    return () => commitEdge(() => {
        if (writeBack) {
            if (absent) languageProperties.deleteLanguageProperty(owner, key, operationContext)
            else languageProperties.writeLanguageProperty(owner, key, placement.value, operationContext)
            version.storageAbsent = absent
        }
        commit()
        if (absent) detachAbsentVersion(owner, key, version, operationContext)
    })
}

function detachAbsentVersion(owner, key, version, operationContext) {
    // A completed writer alone does not prove that removing a logical absence
    // is safe: publication without writeback may still mask physical storage.
    // Present versions can still authorize queued path publication after they
    // settle; matching physical storage alone does not make them disposable.
    if (version.present === false && version.storageAbsent && !errorUtils.isPoisonError(version.value) && !version.writing &&
        isLivePlacementVersion(owner, key, version, operationContext))
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

function isLivePlacementVersion(owner, key, version, operationContext) {
    return getPlacementVersion(owner, key, operationContext) === version
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
    const structure = beginPlacementStructure(owner, key, captured, operationContext)
    installPlacementVersion(owner, key, version, operationContext)
    let result
    transition.promise = resolvePlacement(captured, operationContext, placement => {
        version.writing = true
        publishPromiseVersion(owner, key, version, placement, operationContext, false, structure)
        result = onValue(version.value, version, structure)
        delete version.writing
        detachAbsentVersion(owner, key, version, operationContext)
        transition.placement = capturePlacementFromVersion(version)
        structure.complete()
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
        if (writable && !metadata.metaOf(owner, operationContext)?.imported &&
            !arrayViews.isArrayView(owner, operationContext)) {
            const failure = errorUtils.catchExternalThrow(
                () => languageProperties.writeLanguageProperty(owner, key, version.value, operationContext),
                operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)
            if (!failure) return version.value
        }
        installPlacementVersion(owner, key, { value: version.value }, operationContext)
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
    structure,
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
    const ready = { value, present: placement.present, recovery: placement.recovery,
        // Ordinary payload settlement does not insert the property again.
        // Only an unfinished transition still owns its structural decision.
        position: structure || promiseVersion.pendingPresence ? placement.position : promiseVersion.position ?? placement.position }
    if (retained) retainPlacement(ready, operationContext)
    commitPromiseVersion(owner, key, promiseVersion, ready, operationContext, true, structure)
    return validationFailure
}

function commitPromiseVersion(
    owner,
    key,
    promiseVersion,
    placement,
    operationContext,
    writeBack,
    structure,
) {
    // A view owns its logical placements, not the slots it shares with other
    // owners. Settlement updates the overlay without rewriting their storage.
    writeBack &&= !arrayViews.isArrayView(owner, operationContext)
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
        // Only the physical cache write can fail after preparation. The logical
        // value is already determined; failed synchronization cannot poison it.
        // Required mutation writes use commitPlacementVersion instead.
        () => prepareCommit(value, false)(),
    )

    function prepareCommit(nextValue, canWriteBack) {
        if (canWriteBack && isLivePlacementVersion(owner, key, promiseVersion, operationContext)) {
            const failure = errorUtils.catchExternalThrow(
                () => languageProperties.assertCanSetLanguageProperty(
                    owner,
                    key,
                    operationContext,
                ),
                operationContext,
                errorUtils.ERROR_KIND.PropertyMutationFailed,
            )
            if (failure) {
                canWriteBack = false
            }
        }
        return preparePlacementCommit(owner, key, promiseVersion,
            { ...placement, value: nextValue }, operationContext, canWriteBack, structure)
    }
}

function replaceProperty(owner, key, placement, operationContext) {
    preparePropertyCommit(owner, key, placement, operationContext)(() => {
        languageProperties.writeLanguageProperty(owner, key, placement.value, operationContext)
        // Failed storage work must leave the old logical version available.
        detachPlacementVersion(owner, key, operationContext)
        if (placement.promiseBacked || placement.recovery) installPlacementVersion(owner, key, placement, operationContext)
    })
}

function replaceLogicalPlacement(owner, key, placement, operationContext) {
    preparePropertyCommit(owner, key, placement, operationContext)(() =>
        installPlacementVersion(owner, key, placement, operationContext))
}

// Callers validate deletion semantics before this atomic edge removal.
function removeProperty(owner, key, operationContext, remove) {
    preparePropertyCommit(owner, key, { value: undefined, present: false }, operationContext)(() => {
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
    const current = arrayViews.publishedArrayLength(array, operationContext)
    const view = arrayViews.isArrayView(projection, operationContext)
        ? projection
        : undefined
    if (view) {
        if (length >= current) {
            const resized = view.setLength(length, operationContext)
            if (!resized) {
                throw new Error("ArrayView growth requires materialization")
            }
            metadata.requireMeta(array, operationContext).arrayLength = length
            return undefined
        }
    }
    if (length === current) return undefined

    const affected = [...languageProperties.enumerableLanguageKeyCandidates(array, operationContext, length, current)].sort((a, b) => Number(b) - Number(a))
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
        // Truncation revokes publication authority even for placements whose
        // pending values have never occupied physical storage.
        if (property?.enumerable || getPlacementVersion(array, key, operationContext)) {
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
    metadata.requireMeta(array, operationContext).arrayLength = length
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

function preparePropertyCommit(owner, key, placement, operationContext, structure) {
    // Index creation commits length even when only a logical version can hold
    // its outcome. Capture fallible length/index reads before changing storage.
    const commitStructure = preparePlacementStructure(owner, key, placement, structure, operationContext)
    const commitEdge = refcounts.prepareLiveEdge(owner, key, placement.value, operationContext)
    return updateProperty => commitEdge(() => {
        updateProperty()
        commitStructure()
    })
}

function prepareRetainedArrayProperties(
    source,
    destination,
    operationContext,
    sourceStart = 0,
    sourceEnd = arrayViews.publishedArrayLength(source, operationContext),
    destinationOffset = 0,
) {
    const sourceMeta = metadata.requireMeta(source, operationContext)
    // The captured prefix already contains normalized, protected values.
    // Revisit its overlays and capture only the newly added physical suffix.
    const retainedEnd = Math.max(sourceStart, Math.min(sourceEnd, sourceMeta.retainedPrefixLength ?? 0))
    for (const sourceKey of retainedKeys()) {
        // An absent overlay can hide a physical slot in the shared backing.
        // Retain it too; only a hole with no overlay needs no destination state.
        const captured = languageProperties.readLanguagePlacement(source, sourceKey, operationContext)
        if (!captured.present && !getPlacementVersion(source, sourceKey, operationContext)) continue
        const destinationKey = String(Number(sourceKey) + destinationOffset)
        const { value } = captured
        if (!languageValues.isPending(value, operationContext)) {
            retainPlacement(captured, operationContext)
            // Views share physical backing, but every retained placement keeps
            // its logical value, including a fixed Error or custom-thenable outcome.
            if (getPlacementVersion(source, sourceKey, operationContext))
                installPlacementVersion(destination, destinationKey, {
                    value, present: captured.present, recovery: captured.recovery,
                }, operationContext)
            continue
        }
        transferPlacement(captured,
            destination, destinationKey, operationContext, true, undefined,
            errorUtils.ERROR_KIND.AssignmentValueFailed, false)
    }
    metadata.requireMeta(destination, operationContext).retainedPrefixLength = sourceEnd + destinationOffset

    function* retainedKeys() {
        if (retainedEnd > sourceStart) {
            for (const key of Object.keys(sourceMeta.placementVersions ?? {})) {
                if (Number(key) >= sourceStart && Number(key) < retainedEnd) yield key
            }
        }
        if (retainedEnd < sourceEnd)
            yield* languageProperties.enumerableLanguageKeyCandidates(source, operationContext, retainedEnd, sourceEnd)
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
    replaceLogicalPlacement,
}
