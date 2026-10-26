import { releaseOnClose } from "./operation-lifecycle.js"
import { createLeaseLedger, releaseDetached, retainWriter, releasePin } from "./ownership.js"
import { captureIdentity } from "./captured-identity.js"
import { ArrayView, isArrayView } from "./array-view.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import * as errorUtils from "./error.js"
import * as internalSteps from "./internal-step.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as refcounts from "./refcounts.js"
import { beginPlacementStructure, preparePlacementStructure, defineCopyProperty } from "./placement-structure.js"
import { receiveValue } from "./input-preparations.js"
import { CONSTRUCTION_STATE, recordLogicalPlacement, destinationOf } from "./parent-placements.js"

class PropertyPlacement {
    constructor(owner, key, operationContext) {
        this.owner = owner
        this.key = key
        this.operationContext = operationContext
    }

    ensureCaptured() {
        if (Object.hasOwn(this, "value")) return this
        const { owner, key, operationContext } = this
        // A failed capture also consumes this lazy placement. Saved diagnostic
        // frames must not retain its source through the method receiver.
        try { Object.assign(this, languageProperties.readLanguagePlacement(owner, key, operationContext)) }
        finally { this.owner = undefined }
        return this
    }

    resolveValue(project) {
        const captured = this.ensureCaptured()
        // The caller receives pending data through another Promise reaction.
        // Protect it at publication, before a later writer can resume.
        return resolvePlacement(captured, this.operationContext, placement => {
            Object.assign(this, placement)
            // Search identity is captured at delivery, before later writers resume.
            return project ? project(this.value, this.operationContext) : this.value
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
function capturePlacement(owner, key, operationContext, capturedVersion, storage) {
    const version = capturedVersion ?? getPlacementVersion(owner, key, operationContext)
    if (version) return capturePlacementFromVersion(version)
    const descriptor = storage ? storage.descriptor : languageProperties.getLanguagePlacementDescriptor(owner, key, operationContext)
    const present = descriptor?.enumerable === true && "value" in descriptor
    return { value: present ? descriptor.value : undefined, present,
        position: metadata.metaOf(owner, operationContext)?.recordOrder?.positions.get(key)?.position ?? (present ? -1 : Infinity) }
}

function capturePlacementFromVersion(version) {
    refreshCopiedDelivery(version)
    return {
        value: version.value, present: version.present !== false,
        sourceVersion: version.promiseBacked ? version : undefined,
        recovery: version.recovery,
        discoveryBlocked: version.discoveryBlocked,
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
        discoveryBlocked: placement.discoveryBlocked,
        position: placement.position,
    }
}

// A pending capture follows its own version, never a later live placement.
// Reception has already installed the version and its causal validation policy.
// Delivery fixes presence and recovery together with the logical value.
function resolvePlacement(placement, operationContext, onReady) {
    if (!languageValues.isPending(placement.value, operationContext)) return onReady(placement)
    let version = placement.sourceVersion
    return continueCapturedPromiseVersion(placement.value, version, operationContext, (value, releaseCapture) => {
        try {
            return onReady({ value, present: version.present !== false, recovery: version.recovery, position: version.position,
                discoveryBlocked: version.discoveryBlocked, sourceVersion: undefined }, releaseCapture)
        } finally { version = onReady = undefined }
    })
}

// Call after subscription: synchronous delivery may already have advanced the
// version or handed publication to a new producer. Keep that newer dependency.
function trackVersionPublication(version, publication, operationContext) {
    if (!languageValues.isPending(publication, operationContext)) return false
    version.promiseBacked = true
    version.publication ??= publication
    // Storage and captures can keep following the original host Promise. Own
    // internal publication rejection even when nobody consumes this version.
    markPromiseHandled(internalSteps.continueOperation(
        publication, operationContext, () => undefined), operationContext)
    return true
}

// Replacement waits for preceding work to publish, not for the data that work
// publishes. Copies carry the same transition until their value becomes ready.
function resolvePlacementTransition(placement, operationContext, onReady) {
    const transition = placement.sourceVersion?.transition
    if (!transition) return onReady(placement)
    const resume = () => resolvePlacementTransition(transition.placement, operationContext, onReady)
    return transition.placement ? resume() :
        internalSteps.continueGraphTransition(transition.promise, operationContext, resume)
}

// Captures subscribe to the version's publication, not its source Promise.
// Each publication transfers its complete recovery obligation too. Recovery
// may introduce another pending version after this capture was registered.
function observePlacementCapture(placement, accept) {
    const subscribed = new Set()
    const visit = placement => {
        const version = placement.sourceVersion
        if (version) {
            if (subscribed.has(version)) return
            subscribed.add(version)
            ;(version.captures ??= new Set()).add(visit)
            retainCopiedDelivery(version)
            placement = version
        }
        accept(placement.value)
        if (placement.recovery) visit(placement.recovery)
    }
    visit(placement)
    return () => {
        for (const version of subscribed) {
            version.captures.delete(visit)
            if (!version.captures.size) delete version.captures
            releaseCopiedDelivery(version)
        }
        subscribed.clear()
    }
}

function retainPlacement(placement, operationContext) {
    const leases = createLeaseLedger(operationContext)
    const unsubscribe = observePlacementCapture(placement, leases.acquire)
    return () => { unsubscribe(); leases.release() }
}

// Initialize a fresh, unindexed destination. Ready copies have no old edge or
// structural effect to publish; the container copier transfers their shape.
// Shared backing copies only overlays. Pending copies keep ordinary publication.
function copyPlacement(placement, owner, key, operationContext, writeBack = true) {
    if (languageValues.isPending(placement.value, operationContext)) {
        if (writeBack) {
            const destination = ArrayView.placementDestination(owner, key, operationContext)
            if (destination) { owner = destination.owner; key = destination.key }
        }
        const source = placement.sourceVersion
        const delivery = source.copiedDelivery?.delivery ?? (source.copyDelivery ??=
            createCopyDelivery(placement, operationContext))
        if (delivery.placement) return copyPlacement(delivery.placement, owner, key, operationContext, writeBack)
        const version = createVersionFromPlacement(placement)
        version.promiseBacked = true
        version.publication = delivery.publication
        version.copiedDelivery = { delivery, version, key, operationContext, active: false,
            destination: destinationOf(owner, operationContext) }
        replacePlacement(owner, key, version, operationContext, writeBack && !version.pendingPresence)
        return
    }
    if (writeBack && placement.present) defineCopyProperty(owner, key, placement.value)
    if (!writeBack || placement.recovery || placement.discoveryBlocked)
        installPlacementVersion(owner, key, createVersionFromPlacement(placement), operationContext)
}

// Representation copies share one captured delivery, not mutable placement
// authority. Reads and writers still subscribe at their own program positions.
// Only live destinations and independently captured versions receive publication;
// retired forward state can adopt the same completed delivery on re-entry.
function createCopyDelivery(placement, operationContext) {
    const delivery = { uses: new Set() }
    delivery.publication = resolvePlacement(placement, operationContext, (ready, releaseCapture) => {
        try {
            delivery.placement = ready
            for (const use of delivery.uses) refreshCopiedDelivery(use.version)
            delivery.uses.clear()
        } finally { releaseCapture?.() }
    })
    if (languageValues.isPending(delivery.publication, operationContext))
        markPromiseHandled(delivery.publication, operationContext)
    return delivery
}

function refreshCopiedDelivery(version) {
    const use = version.copiedDelivery
    if (!use?.delivery.placement) return
    delete version.copiedDelivery
    use.delivery.uses.delete(use)
    publishPromiseVersion(use.active ? use.destination.owner : undefined, use.key, version,
        use.delivery.placement, use.operationContext)
}

function retainCopiedDelivery(version, active = false) {
    const use = version.copiedDelivery
    if (!use) return
    use.active ||= active
    if (use.delivery.placement) refreshCopiedDelivery(version)
    else use.delivery.uses.add(use)
}

function releaseCopiedDelivery(version, inactive = false) {
    const use = version.copiedDelivery
    if (!use) return
    if (inactive) use.active = false
    if (!use.active && !version.captures) use.delivery.uses.delete(use)
}

function transferPlacement(placement, owner, key, operationContext, destinationVersion,
    kind = errorUtils.ERROR_KIND.AssignmentValueFailed, writeBack = true, structure) {
    const ownerMeta = metadata.metaOf(owner, operationContext)
    if (writeBack && !destinationVersion && !structure && ownerMeta?.type === metadata.TYPE.Array &&
        ownerMeta.arrayRange && ownerMeta.arrayRange.backing !== owner &&
        (placement.sourceVersion || placement.recovery || placement.discoveryBlocked ||
            languageValues.isPending(placement.value, operationContext) ||
            ArrayView.backingVersion(owner, key, operationContext))) {
        const destination = ArrayView.placementDestination(owner, key, operationContext)
        if (destination) { owner = destination.owner; key = destination.key }
    }
    if (writeBack && !destinationVersion && !placement.present) {
        deleteProperty(owner, key, operationContext)
        return undefined
    }
    let version = createVersionFromPlacement(placement)
    const construction = metadata.metaOf(owner, operationContext)?.construction
    let destination
    const deliver = (resolved, releaseCapture) => {
        try {
            if (construction?.state !== CONSTRUCTION_STATE.Discarded)
                return publishPromiseVersion(construction ? construction.owner : destination ? destination.owner : owner,
                    key, version, resolved, operationContext)
        } finally { releaseCapture?.() }
    }
    try {
        const publication = placement.sourceVersion
            ? resolvePlacement(placement, operationContext, deliver)
            : receiveValue(placement.value, operationContext, { kind },
                value => deliver({ ...placement, value }), construction)
        const pending = trackVersionPublication(version, publication, operationContext)
        if (pending) {
            if (construction) construction.pending = true
            else destination = destinationOf(owner, operationContext)
        }
        if (destinationVersion) {
            commitPlacementVersion(owner, key, destinationVersion, version, operationContext, writeBack && !version.pendingPresence, structure)
            // Synchronous delivery stages above; later delivery advances the exact
            // captured version only after its complete placement has committed.
            version = destinationVersion
        } else if (!writeBack || version.pendingPresence) replacePlacement(owner, key, version, operationContext, false)
        else if (version.present === false) deleteProperty(owner, key, operationContext)
        else replacePlacement(owner, key, version, operationContext)
        return pending ? undefined : publication
    } finally {
        // A private destination is retained solely by its construction record,
        // even when this transfer fails after subscribing to a pending source.
        if (construction || destination) owner = undefined
    }
}

function installPlacementGate(owner, key, operationContext, captured, capturedVersion) {
    const structure = beginPlacementStructure(owner, key, captured, operationContext)
    const releaseWriter = retainWriter(owner, operationContext)
    const previous = capturedVersion ?? getPlacementVersion(owner, key, operationContext)
    const { promise, resolve } = Promise.withResolvers()
    const publication = Promise.withResolvers()
    const transition = { promise: publication.promise }
    const gate = {
        promise, owner, key, structure,
        resolve() {
            const version = gate.version
            gate.publication?.finish()
            gate.structure.complete?.()
            transition.placement = capturePlacementFromVersion(version)
            publication.resolve()
            releaseWriter()
            gate.owner = undefined
            // Replacement may proceed after publication. Value consumers still
            // wait for any pending data that was published through the gate.
            markPromiseHandled(continueCapturedPromiseVersion(version.value, version,
                operationContext, resolve), operationContext)
        },
    }
    const version = { value: gate.promise, promiseBacked: true, pendingPresence: true, transition,
        position: captured.position, discoveryBlocked: captured.discoveryBlocked }
    version.storageAbsent = previous ? previous.storageAbsent : !captured.present
    if (capturedVersion) {
        commitPlacementVersion(owner, key, capturedVersion, version, operationContext, false)
        gate.version = capturedVersion
    } else {
        gate.version = version
        prepareEdgeUpdate(owner, key, captured, version.value, operationContext,
            () => installPlacementVersion(owner, key, version, operationContext))()
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
            () => transferPlacement(resolved, gate.owner, gate.key, operationContext, gate.version,
                errorUtils.ERROR_KIND.AssignmentValueFailed, false, gate.structure),
            operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)
        if (errorUtils.isPoisonError(failure)) {
            gate.publication.published = true
            publishPlacementFailure(gate.owner, gate.key, gate.version,
                combinePublicationErrors(resolved.value, failure), resolved.recovery ?? resolved,
                operationContext, gate.structure, resolved.position)
        }
        gate.resolve()
    })
    markPromiseHandled(publication, operationContext)
    return publication
}

// The caller selects the recovery baseline: pre-mutation state for mutation,
// completed contained state for entry publication. Failure writes no storage.
// A retained baseline may have an older record position than the live placement.
function publishPlacementFailure(owner, key, version, failure, baseline, operationContext, structure, position = baseline.position) {
    const placement = { value: failure, present: true, recovery: baseline, position }
    if (version) commitPlacementVersion(owner, key, version, placement, operationContext, false, structure)
    else replacePlacement(owner, key, placement, operationContext, false)
}

function combinePublicationErrors(...values) {
    return errorUtils.combineErrors(values.filter(errorUtils.isPoisonError))
}

// An operation publishes all placement facts atomically. Unlike shared Promise
// settlement, a failed restoration leaves the previous placement available.
function commitPlacementVersion(owner, key, version, placement, operationContext, writeBack = true, structure) {
    preparePlacementCommit(owner, key, version, placement, operationContext, writeBack, structure)()
}

function preparePlacementCommit(owner, key, version, placement, operationContext, writeBack, structure, optionalStorage = false) {
    placement.position ??= version.position
    // Captured consumers may resume after publication makes this placement
    // ready. Preserve their value before a later synchronous writer can use it.
    const commit = () => {
        const copied = version.copiedDelivery
        if (copied) copied.delivery.uses.delete(copied)
        delete version.copiedDelivery
        delete version.copyDelivery
        version.value = placement.value
        version.present = placement.present
        version.recovery = placement.recovery
        version.pendingPresence = placement.pendingPresence
        version.transition = placement.transition
        version.publication = placement.publication
        version.position = placement.position
        version.discoveryBlocked = placement.discoveryBlocked
        for (const capture of version.captures ?? []) capture(version)
    }
    if (!isLivePlacementVersion(owner, key, version, operationContext)) {
        // Detachment removes storage authority, not this transition's captured
        // structural effects. Earlier length/order observers still need them.
        const commitStructure = structure?.prepare(placement)
        return () => { commit(); commitStructure?.() }
    }
    const absent = placement.present === false && !errorUtils.isPoisonError(placement.value)
    return preparePropertyCommit(owner, key, placement, operationContext, structure, writeBack, storageAbsent => {
        if (storageAbsent !== undefined) version.storageAbsent = storageAbsent
        commit()
        if (absent) detachAbsentVersion(owner, key, version, operationContext)
    }, optionalStorage)
}

function detachAbsentVersion(owner, key, version, operationContext) {
    // A completed writer alone does not prove that removing a logical absence
    // is safe: it may still mask physical storage or a canonical backing value.
    // Present versions can still authorize queued path publication after they
    // settle; matching physical storage alone does not make them disposable.
    if (version.present === false && version.storageAbsent && !errorUtils.isPoisonError(version.value) && !version.writing &&
        !ArrayView.backingVersion(owner, key, operationContext) &&
        isLivePlacementVersion(owner, key, version, operationContext))
        detachPlacementVersion(owner, key, operationContext)
}

function getPlacementVersion(owner, key, operationContext) {
    return metadata.metaOf(owner, operationContext)?.placementVersions?.[key] ??
        ArrayView.backingVersion(owner, key, operationContext)
}

function getPromiseVersion(owner, key, operationContext) {
    const version = getPlacementVersion(owner, key, operationContext)
    return version?.promiseBacked === true ? version : undefined
}

function installPlacementVersion(owner, key, version, operationContext) {
    const meta = metadata.requireMeta(owner, operationContext)
    meta.placementVersions ??= Object.create(null)
    if (meta.placementVersions[key]) releaseCopiedDelivery(meta.placementVersions[key], true)
    meta.placementVersions[key] = version
}

function detachPlacementVersion(owner, key, operationContext) {
    const versions = metadata.metaOf(owner, operationContext)?.placementVersions
    if (versions?.[key]) {
        releaseCopiedDelivery(versions[key], true)
        delete versions[key]
    }
}

function isLivePlacementVersion(owner, key, version, operationContext) {
    return getPlacementVersion(owner, key, operationContext) === version
}

function continueCapturedPromiseVersion(promise, promiseVersion, operationContext, onValue, operation) {
    const release = retainPlacement(capturePlacementFromVersion(promiseVersion), operationContext)
    let unregister
    const complete = () => {
        unregister?.()
        unregister = promise = promiseVersion = onValue = undefined
        release()
    }
    // A raw source only notifies us: its earlier publisher has classified its
    // rejection into the captured version. Publication readiness is already an
    // internal result, so an unexpected rejection must reach the fatal guard.
    const resume = signal => internalSteps.continueGraphTransition(signal, operationContext, deliver,
        signal === promiseVersion.publication ? undefined : deliver, operation)
    function deliver() {
        const value = promiseVersion.value
        if (languageValues.isPending(value, operationContext))
            return resume(value === promise ? promiseVersion.publication : value)
        // Direct consumers can release after transferring this capture.
        // Promise-forwarding consumers retain the ordinary delivery window.
        const consume = onValue
        promise = promiseVersion = onValue = undefined
        return consume(value, complete)
    }
    let result
    try { result = resume(promise) }
    catch (failure) { complete(); throw failure }
    if (!languageValues.isPending(result, operationContext)) { complete(); return result }
    if (operation) unregister = releaseOnClose(operation, complete)
    const queuedRelease = () => queueMicrotask(() => releaseDetached(operationContext, complete))
    markPromiseHandled(languageValues.thenValue(result, queuedRelease, queuedRelease, operationContext), operationContext)
    return result
}

function observePromiseVersion(
    promise,
    promiseVersion,
    operationContext,
    onValue,
    operation,
) {
    if (operation && !operation.open) return undefined
    operation?.beforeWait?.()
    // A transition can publish through another signal before this observer
    // resumes. Its captured value needs protection at publication, independently
    // of the lifetime owner used only to guard the observer's continuation.
    return continueCapturedPromiseVersion(
        promise,
        promiseVersion,
        operationContext,
        (value, releaseCapture) => {
            const version = promiseVersion, consume = onValue
            promise = promiseVersion = onValue = undefined
            // Observers capture every remaining dependency synchronously or
            // transfer protection to their consumer before returning readiness.
            try { return consume(value, version) }
            finally { releaseCapture() }
        },
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
    const releaseWriter = retainWriter(owner, operationContext)
    prepareEdgeUpdate(owner, key, captured, version.value, operationContext,
        () => installPlacementVersion(owner, key, version, operationContext))()
    let result
    transition.promise = resolvePlacement(captured, operationContext, (placement, releaseCapture) => {
        version.writing = true
        publishPromiseVersion(owner, key, version, placement, operationContext, structure)
        // Only a live destination accepts this capture. A displaced writer
        // keeps its lease through descent: the remaining parent may belong to
        // another owner. The capture releases when this callback returns.
        if (isLivePlacementVersion(owner, key, version, operationContext)) releaseCapture?.()
        result = onValue(version.value, version, structure)
        delete version.writing
        detachAbsentVersion(owner, key, version, operationContext)
        transition.placement = capturePlacementFromVersion(version)
        structure.complete?.()
    })
    trackVersionPublication(version, transition.promise, operationContext)
    return internalSteps.continueGraphTransition(transition.promise, operationContext, () => { releaseWriter(); return result })
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
    // Immediate capture supplies both presence and value in one read.
    return new PropertyPlacement(owner, String(key), operationContext).resolveValue()
}

function resolvePropertyIdentityAtKey(owner, key, operationContext) {
    return new PropertyPlacement(owner, String(key), operationContext).resolveValue(captureIdentity)
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
    kind = errorUtils.ERROR_KIND.AssignmentValueFailed,
) {
    return transferPlacement({ value, present: true }, owner, key, operationContext, undefined, kind)
}

// Prepare at issuance while retaining the original availability signal and its
// exact delivered version for a destination that may not be available yet.
function prepareInputPlacement(value, operationContext, kind, contextSetup) {
    const version = { value, present: true }
    const publish = ready => {
        commitPlacementVersion(undefined, undefined, version, { value: ready, present: true }, operationContext, false)
        return ready
    }
    const publication = receiveValue(value, operationContext, { kind, imported: Boolean(contextSetup) },
        publish, undefined, contextSetup?.mutationAccessTree === undefined ? undefined : contextSetup)
    const pending = trackVersionPublication(version, publication, operationContext)
    const placement = capturePlacementFromVersion(version)
    // An import already consumed its host input. Follow that publication while
    // retaining its producer version, rather than subscribing to the host again.
    // Ordinary assignment preserves the supplied Promise in physical storage.
    if (contextSetup && pending) placement.value = publication
    return placement
}

function publishPromiseVersion(
    owner,
    key,
    promiseVersion,
    placement,
    operationContext,
    structure,
) {
    let { value } = placement
    if (languageValues.isPending(value, operationContext)) {
        throw new Error("A Promise requires a fresh property version")
    }
    const validationFailure = languageProperties.validatePropertyValue(key, value, operationContext)
    value = validationFailure ?? value
    languageValues.admitReadyValue(value, operationContext)
    const ready = { value, present: placement.present, recovery: placement.recovery,
        discoveryBlocked: placement.discoveryBlocked,
        // Ordinary payload settlement does not insert the property again.
        // Only an unfinished transition still owns its structural decision.
        position: structure || promiseVersion.pendingPresence ? placement.position : promiseVersion.position ?? placement.position }
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
    // A view or shared backing producer advances its logical version. Native
    // owner settlement may refresh storage; derived native-owner placements
    // already have their own capture. Mutations still check sharing first.
    writeBack &&= !isArrayView(owner, operationContext)
    let { value } = placement
    function recordFailure(failure) {
        // Publishing an already failed value can fail independently. Each retry
        // retains the accumulated diagnostic instead of replacing an earlier cause.
        value = combinePublicationErrors(value, failure)
        languageValues.admitReadyValue(value, operationContext)
        return value
    }
    const commit = errorUtils.catchExternalThrow(
        () => prepareCommit(value),
        operationContext,
        errorUtils.ERROR_KIND.PropertyMutationFailed,
        failure => prepareCommit(recordFailure(failure)),
    )
    commit()

    function prepareCommit(nextValue) {
        return preparePlacementCommit(owner, key, promiseVersion,
            { ...placement, value: nextValue }, operationContext, writeBack, structure, true)
    }
}

function replacePlacement(owner, key, placement, operationContext, writeBack = true) {
    try {
        preparePropertyCommit(owner, key, placement, operationContext, undefined, writeBack, () => {
            // Failed storage work must leave the old logical version available.
            detachPlacementVersion(owner, key, operationContext)
            if (!writeBack || placement.promiseBacked || placement.recovery || placement.discoveryBlocked ||
                ArrayView.backingVersion(owner, key, operationContext))
                installPlacementVersion(owner, key, placement, operationContext)
        })()
    } finally { owner = placement = undefined }
}

function preparePlacementStorage(owner, key, placement, operationContext) {
    // Entry holders write through their captured source authority. Detached
    // references still advance privately. Nested entries can form a long
    // history around one value: prepare and write outermost-first without
    // recursive calls, preserving storage failure before private publication.
    const destinations = []
    for (;;) {
        const gate = metadata.metaOf(owner, operationContext)?.entryGate
        destinations.push({ owner, key, gate })
        if (!gate || !isLivePlacementVersion(gate.owner, gate.key, gate.version, operationContext)) break
        owner = gate.owner
        key = gate.key
    }
    const absent = placement.present === false && !errorUtils.isPoisonError(placement.value)
    for (let index = destinations.length - 1; index >= 0; index--) {
        const destination = destinations[index]
        destination.descriptor = absent
            ? languageProperties.assertCanDeleteLanguageProperty(destination.owner, destination.key, operationContext)
            : languageProperties.assertCanSetLanguageProperty(destination.owner, destination.key, operationContext)
    }
    return { descriptor: destinations[0].descriptor, commit() {
        try {
            for (let index = destinations.length - 1; index >= 0; index--) {
                const { owner, key, descriptor } = destinations[index]
                if (absent) languageProperties.deleteLanguageProperty(owner, key, operationContext, descriptor)
                else languageProperties.writeLanguageProperty(owner, key, placement.value, operationContext, descriptor)
                if (index > 0) destinations[index - 1].gate.version.storageAbsent = absent
            }
            return absent
        } finally { destinations.length = 0; placement = undefined }
    } }
}

function deleteProperty(owner, key, operationContext) {
    replacePlacement(owner, key, { value: undefined, present: false }, operationContext)
}

function releaseHolder(owner, operationContext) {
    deleteProperty(owner, "value", operationContext)
    releasePin(owner, operationContext)
}

function preparePropertyCommit(owner, key, placement, operationContext, structure, writeBack, updateProperty, optionalStorage = false) {
    try {
        let storage
        if (writeBack) {
            const prepare = () => preparePlacementStorage(owner, key, placement, operationContext)
            storage = optionalStorage ? errorUtils.catchExternalThrow(prepare, operationContext,
                errorUtils.ERROR_KIND.PropertyMutationFailed, () => undefined) : prepare()
        }
        const before = capturePlacement(owner, key, operationContext, undefined, storage)
        let commitStructure = preparePlacementStructure(owner, key, placement, structure, operationContext, before)
        return prepareEdgeUpdate(owner, key, before, placement.value, operationContext, () => {
            try {
                // A refused optional cache write leaves the prepared logical transition
                // intact. Required storage failure still precedes all logical publication.
                // Invoke without the preparation record as `this`: lazy Error
                // stacks must not retain its captured baseline descriptor.
                const commitStorage = storage?.commit
                const absent = optionalStorage && storage
                    ? errorUtils.catchExternalThrow(commitStorage, operationContext,
                        errorUtils.ERROR_KIND.PropertyMutationFailed, () => undefined)
                    : commitStorage?.()
                updateProperty(absent)
                commitStructure(absent !== undefined)
            } finally { storage = updateProperty = commitStructure = undefined }
        })
    } finally { owner = placement = undefined }
}

// Prepared placement inspection never consumes values. Storage, shape, and
// optional counters can therefore be prepared against one stable edge capture.
function prepareEdgeUpdate(owner, key, before, value, operationContext, commit) {
    const wasOverlay = Boolean(getPlacementVersion(owner, key, operationContext))
    let updateCounter = refcounts.prepareCounterUpdate(owner, key, before.value, value, operationContext)
    return () => {
        try {
            commit()
            recordLogicalPlacement(owner, key, before.present ? before.value : undefined, value, operationContext, wasOverlay)
            updateCounter?.()
        } finally { owner = before = value = commit = updateCounter = undefined }
    }
}

function copyArrayOverlays(
    source,
    destination,
    operationContext,
    sourceStart = 0,
    sourceEnd = ArrayView.minimumLength(source, operationContext),
    destinationOffset = 0,
) {
    const versions = metadata.requireMeta(source, operationContext).placementVersions
    for (const sourceKey of Object.keys(versions ?? {})) {
        const index = Number(sourceKey)
        if (index < sourceStart || index >= sourceEnd) continue
        const captured = capturePlacementFromVersion(versions[sourceKey])
        copyPlacement(captured, destination, String(index + destinationOffset), operationContext, false)
    }
}

export {
    refreshCopiedDelivery,
    retainCopiedDelivery,
    releaseCopiedDelivery,
    observePlacementCapture,
    resolvePropertyIdentityAtKey,
    installPlacementGate,
    completePlacementGate,
    publishPlacementFailure,
    combinePublicationErrors,
    capturePlacement,
    capturePlacementFromVersion,
    createVersionFromPlacement,
    resolvePlacement,
    resolvePlacementTransition,
    retainPlacement,
    copyPlacement,
    transferPlacement,
    commitPlacementVersion,
    publishPromiseVersion,
    assignProperty,
    prepareInputPlacement,
    observePromiseVersion,
    installMutationVersion,
    continueCapturedPromiseVersion,
    deleteProperty,
    releaseHolder,
    requirePromiseVersion,
    getPropertyPlacement,
    getPromiseVersion,
    getPlacementVersion,
    isPropertyPlacement,
    commitPromiseVersion,
    installPlacementVersion,
    copyArrayOverlays,
    trackVersionPublication,
    resolvePropertyValueAtKey,
    replacePlacement,
}
