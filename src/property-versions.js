import { releaseOnClose } from "./operation-lifecycle.js"
import { certainPoison, followErrorEvidence, supplyErrorEvidence } from "./error-evidence.js"
import { createLeaseLedger, releaseDetached, retainWriter, releasePin } from "./ownership.js"
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
import { CONSTRUCTION_STATE, recordLogicalPlacement, destinationOf, activateRelationships, linkRetentionParent, unlinkRetentionParent } from "./parent-placements.js"

// Only a failed structural selection creates this role. The same Error used
// as an explicit value is an ordinary payload, even at another Array index.
const STRUCTURAL_ERROR = 1
// A skipped selection may resolve to a removable flag or to permanent Error
// data. A missing output is already known to be the latter.
const BLOCKED_SELECTION = 1, MARKER_SELECTION = 2
const CACHE_WRITE = 2
const ERROR_PAYLOAD = 3

// Capture without consuming an unused old value. A replacement must not wait
// for the value it replaces merely to preserve current data on failure.
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
        transition: version.transition,
        ownFailure: version.ownFailure,
        role: version.role,
        pendingPresence: version.pendingPresence,
        discoveryBlocked: version.discoveryBlocked,
        position: version.position ?? (version.present === false ? Infinity : -1),
    }
}

// A destination has its own publication authority and capture obligations.
// Only logical contents and unfinished source dependencies cross placements.
function createVersionFromPlacement(placement) {
    return {
        value: placement.value, present: placement.present !== false, ownFailure: placement.ownFailure,
        role: placement.role,
        pendingPresence: placement.pendingPresence,
        transition: placement.sourceVersion?.transition,
        discoveryBlocked: placement.discoveryBlocked,
        position: placement.position,
    }
}

// A proved failure can precede identification of its Error. Only its
// diagnostic producer is shared between captures, never the hidden data.
class PendingFailure {
    constructor(result, ctx) {
        const version = this.version = createVersionFromPlacement({ value: result, role: ERROR_PAYLOAD })
        const publication = internalSteps.continueGraphTransition(result, ctx, error => {
            version.value = error
            version.promiseBacked = false
            version.publication = undefined
            return error
        })
        trackVersionPublication(version, publication, ctx)
    }
    get value() { return this.version.value }
    outcome(work) {
        supplyErrorEvidence(work.resultEvidence, certainPoison)
        return work.mutation ? { failure: this, result: this.value } : this.value
    }
}

// Status belongs to this placement, independently of its retained data. Only
// consumers project it to an Error; copying and publication keep both facts.
function placementValue(placement) {
    const failure = placement.ownFailure
    return failure instanceof PendingFailure ? failure.value : failure ?? placement.value
}
function placementPresent(placement) { return Boolean(placement.ownFailure) || placement.present !== false }
function structuralFailure(placement) {
    if (placement.ownFailure || placement.role === STRUCTURAL_ERROR) return placementValue(placement)
}

function blockedPlacement(placement) {
    return placement.transition ? placement.transition.structuralError :
        placement.ownFailure || placement.role === STRUCTURAL_ERROR || placement.role === ERROR_PAYLOAD
}

function knownObstruction(placement, certainty = BLOCKED_SELECTION) {
    if (placement.transition) placement.transition.structuralError = certainty
    return placement
}

function visiblePlacement(placement) {
    const failure = placement.ownFailure
    if (failure instanceof PendingFailure) return capturePlacementFromVersion(failure.version)
    if (placement.transition?.structuralError === MARKER_SELECTION && placement.transition.placement)
        return placement.transition.placement
    return placement
}

function resolveVisiblePlacement(placement, operationContext, onReady) {
    placement = visiblePlacement(placement)
    if (!languageValues.isPending(placementValue(placement), operationContext)) return onReady(placement)
    let version = placement.sourceVersion
    return continueCapturedPromiseVersion(placement.value, version, operationContext, (value, releaseCapture) => {
        try {
            const captured = capturePlacementFromVersion(version)
            if (!languageValues.isPending(captured.value, operationContext)) captured.sourceVersion = undefined
            return onReady(captured, releaseCapture)
        } finally { version = onReady = undefined }
    }, undefined, placementValue)
}

// Sort and flat observe data presence before consuming the value or its flag.
function resolvePresentPlacement(placement, ctx, consume) {
    return resolvePlacementTransition(placement, ctx, selected =>
        selected.present === false ? consume(selected) : resolveVisiblePlacement(selected, ctx, consume))
}

// Mutation needs a healthy receiver's data. An established blocker ends
// dispatch as soon as the preceding publication selects that placement.
function resolveMutationInput(placement, ctx, consume) {
    return consumePlacementTransition(placement, ctx, selected =>
        blockedPlacement(selected) ? consume(selected) : resolveVisiblePlacement(selected, ctx, consume), undefined, blockedPlacement)
}

function resolvePlacementPresence(placement, ctx, consume) {
    const version = placement.sourceVersion
    return placement.pendingPresence || version?.pendingPresence || version?.present === false
        ? resolvePlacementTransition(placement, ctx, consume) : consume(placement)
}

// A pending capture follows its own version, never a later live placement.
// Reception has already installed the version and its causal validation policy.
// Delivery fixes presence and own status together with the logical value.
function resolvePlacement(placement, operationContext, onReady) {
    if (!languageValues.isPending(placement.value, operationContext)) return onReady(placement)
    let version = placement.sourceVersion
    return continueCapturedPromiseVersion(placement.value, version, operationContext, (value, releaseCapture) => {
        try {
            return onReady({ value, present: version.present !== false, ownFailure: version.ownFailure, role: version.role, position: version.position,
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
function resolvePlacementTransition(placement, operationContext, onReady, stopAt) {
    // Publication can clear the version's live gate before a saved placement
    // is consumed. Its captured gate still identifies the exact successor.
    while (placement.transition && !stopAt?.(placement)) {
        const transition = placement.transition
        if (!transition.placement) return internalSteps.continueGraphTransition(transition.promise, operationContext,
            () => resolvePlacementTransition(transition.placement, operationContext, onReady, stopAt))
        placement = transition.placement
    }
    return onReady(placement)
}

// A reader may resume after another writer in the source publication turn.
// Keep the exact selected value until the reader takes ownership or finishes.
function consumePlacementTransition(placement, ctx, consume, owner, stopAt) {
    if (!placement.transition) return consume(placement)
    const release = retainPlacement(placement, ctx)
    const unregister = owner && releaseOnClose(owner, () => { consume = undefined; release() })
    return resolvePlacementTransition(placement, ctx, ready => {
        try { return consume?.(ready) }
        finally { unregister?.(); release() }
    }, stopAt)
}

// A mapping changes the selected placement, including its status. Later
// payload settlement supplies data without undoing that mapped structure.
function projectPlacement(placement, ctx, project) {
    return placementFromSelection(resolvePlacementTransition(placement, ctx, project), ctx, placement)
}

function placementFromSelection(selected, ctx, input, releaseSelection) {
    if (!languageValues.isPending(selected, ctx)) {
        releaseSelection?.()
        return selected
    }
    const release = input && retainPlacement(input, ctx)
    const transition = { selection: true, promise: selected }
    const version = { present: true, transition }
    version.value = internalSteps.continueGraphTransition(selected, ctx, next => {
        // The chosen point can itself be awaiting its flag, presence or role.
        // Expose that transition to structural readers and publish the final
        // selection's status alongside its captured data.
        transition.placement = next
        return resolvePlacementTransition(next, ctx, publish)
    })
    trackVersionPublication(version, version.value, ctx)
    return capturePlacementFromVersion(version)

    function publish(p) {
        const { present, ownFailure, role } = p
        try {
            commitPlacementVersion(undefined, undefined, version, createVersionFromPlacement(p), ctx, false)
            transition.placement = capturePlacementFromVersion(version)
            const publication = resolvePlacement(p, ctx, (ready, done) => {
                try {
                    commitPlacementVersion(undefined, undefined, version,
                        { ...ready, present, ownFailure, role }, ctx, false)
                    return ready.value
                } finally { done?.() }
            })
            trackVersionPublication(version, publication, ctx)
            return ownFailure ? placementValue(p) : publication
        } finally { release?.(); releaseSelection?.() }
    }
}

function captureObservedPoint(point, ctx) {
    return placementFromSelection(point.placement, ctx, undefined, point.release)
}

function densePlacement(placement, ctx) {
    return projectPlacement(placement, ctx, p => p.present === false ? { ...p, present: true } : p)
}

// Replacing an inherited layout selection masks its contents. A command or
// open entry still owns real preceding effects and must publish first.
function replacePlacementTransition(placement, operationContext, onReady) {
    return resolvePlacementTransition(placement, operationContext, onReady, p => p.transition.selection)
}

// Captures subscribe to the version's publication, not its source Promise.
// Publication transfers the current payload. Path status adds no second
// predecessor or separately retained graph.
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

function retainPlacement(placement, operationContext, retentionParent) {
    if (retentionParent) {
        let values
        const unsubscribe = observePlacementCapture(placement, value => {
            if (!metadata.isTraversableType(metadata.metaOf(value, operationContext)?.type) || values?.has(value)) return
            ;(values ??= new Set()).add(value)
            linkRetentionParent(value, retentionParent, operationContext)
            activateRelationships(value, operationContext)
        })
        return () => {
            unsubscribe()
            for (const value of values ?? []) unlinkRetentionParent(value, retentionParent, operationContext)
            values = undefined
        }
    }
    const leases = createLeaseLedger(operationContext)
    const unsubscribe = observePlacementCapture(placement, leases.acquire)
    return () => { unsubscribe(); leases.release() }
}

// Initialize a fresh, unindexed destination. Ready copies have no old edge or
// structural effect to publish; the container copier transfers their shape.
// Shared backing copies only overlays. Pending copies keep ordinary publication.
function copyPlacement(placement, owner, key, operationContext, writeBack = true) {
    if (writeBack && ArrayView.region(owner, operationContext)) writeBack = false
    if (placement.transition)
        return transferPlacement(placement, owner, key, operationContext, undefined, undefined, writeBack)
    if (languageValues.isPending(placement.value, operationContext)) {
        if (writeBack) {
            const destination = ArrayView.placementDestination(owner, key, operationContext)
            if (destination) { owner = destination.owner; key = destination.key }
        }
        const version = createCopiedVersion(placement, owner, key, operationContext)
        if (!languageValues.isPending(version.value, operationContext))
            return copyPlacement(version, owner, key, operationContext, writeBack)
        // The bounds and topology of a private view are published together.
        // Installing an overlay there consumes no predecessor descriptor.
        if (!writeBack && metadata.metaOf(owner, operationContext)?.construction && isArrayView(owner, operationContext))
            installPlacementVersion(owner, key, version, operationContext)
        else replacePlacement(owner, key, version, operationContext, !version.pendingPresence && writeBack)
        return
    }
    if (writeBack && placement.present) defineCopyProperty(owner, key, placement.value)
    if (!writeBack || placement.ownFailure || placement.role || placement.discoveryBlocked)
        installPlacementVersion(owner, key, createVersionFromPlacement(placement), operationContext)
}

// Copies and status successors share a payload producer. Each destination still
// commits its own status, parent edges, counters and publication authority.
function createCopiedVersion(placement, owner, key, operationContext) {
    const source = placement.sourceVersion
    const delivery = source.copiedDelivery?.delivery ?? (source.copyDelivery ??=
            createCopyDelivery(placement, operationContext))
    if (delivery.placement) return createVersionFromPlacement({ ...delivery.placement,
        ownFailure: placement.pendingPresence || placement.transition ? delivery.placement.ownFailure : placement.ownFailure,
        position: placement.pendingPresence || placement.transition ? delivery.placement.position : placement.position ?? delivery.placement.position })
    const version = createVersionFromPlacement(placement)
    version.promiseBacked = true
    version.publication = delivery.publication
    version.copiedDelivery = { delivery, key, operationContext, active: false,
        destination: destinationOf(owner, operationContext) }
    return version
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
            for (const version of delivery.uses) refreshCopiedDelivery(version)
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
    use.delivery.uses.delete(version)
    publishPromiseVersion(use.active ? use.destination.owner : undefined, use.key, version,
        use.delivery.placement, use.operationContext)
}

function retainCopiedDelivery(version, active = false) {
    const use = version.copiedDelivery
    if (!use) return
    use.active ||= active
    if (use.delivery.placement) refreshCopiedDelivery(version)
    else use.delivery.uses.add(version)
}

function releaseCopiedDelivery(version, inactive = false) {
    const use = version.copiedDelivery
    if (!use) return
    if (inactive) use.active = false
    if (!use.active && !version.captures) use.delivery.uses.delete(version)
}

function transferPlacement(placement, owner, key, operationContext, destinationVersion,
    kind = errorUtils.ERROR_KIND.AssignmentValueFailed, writeBack = true, structure) {
    if (writeBack && ArrayView.region(owner, operationContext)) writeBack = false
    const ownerMeta = metadata.metaOf(owner, operationContext)
    if (writeBack && !destinationVersion && !structure && ownerMeta?.type === metadata.TYPE.Array &&
        ownerMeta.arrayRange && ownerMeta.arrayRange.backing !== owner &&
        (placement.sourceVersion || placement.ownFailure || placement.role || placement.discoveryBlocked ||
            languageValues.isPending(placement.value, operationContext) ||
            ArrayView.backingVersion(owner, key, operationContext))) {
        const destination = ArrayView.placementDestination(owner, key, operationContext)
        if (destination) { owner = destination.owner; key = destination.key }
    }
    if (writeBack && !destinationVersion && !placementPresent(placement)) {
        replacePlacement(owner, key, placement, operationContext, writeBack)
        return undefined
    }
    const construction = metadata.metaOf(owner, operationContext)?.construction
    if (placement.sourceVersion && !placement.pendingPresence && !placement.transition &&
        !destinationVersion && !structure && !construction && languageValues.isPending(placement.value, operationContext)) {
        const version = createCopiedVersion(placement, owner, key, operationContext)
        replacePlacement(owner, key, version, operationContext, writeBack)
        return undefined
    }
    let version = createVersionFromPlacement(placement)
    let destination
    const destinationOwner = () => construction ? construction.owner : destination ? destination.owner : owner
    const deliver = (resolved, releaseCapture) => {
        try {
            if (construction?.state !== CONSTRUCTION_STATE.Discarded)
                return publishPromiseVersion(destinationOwner(), key, version, resolved, operationContext)
        } finally { releaseCapture?.() }
    }
    // A copy can learn its presence and failure before its data arrives. Publish
    // that selection so point reads and repair can proceed with the cursor.
    const receiveSelected = selected => {
        if (construction?.state === CONSTRUCTION_STATE.Discarded) return
        if (!languageValues.isPending(selected.value, operationContext)) return deliver(selected)
        commitPlacementVersion(destinationOwner(), key, version, createVersionFromPlacement(selected), operationContext, false)
        const receipt = resolvePlacement(selected, operationContext, deliver)
        trackVersionPublication(version, receipt, operationContext)
        return receipt
    }
    try {
        const publication = placement.transition
            ? consumePlacementTransition(placement, operationContext, receiveSelected)
            : placement.sourceVersion
            ? resolvePlacement(placement, operationContext, deliver)
            : receiveValue(placement.value, operationContext, { kind },
                value => deliver({ ...placement, value }), construction)
        const pending = trackVersionPublication(version, publication, operationContext)
        if (pending) {
            if (construction) construction.pending = true
            else destination = destinationOf(owner, operationContext)
        }
        if (destinationVersion) {
            commitPlacementVersion(owner, key, destinationVersion, version, operationContext, !version.pendingPresence && writeBack, structure)
            // Synchronous delivery stages above; later delivery advances the exact
            // captured version only after its complete placement has committed.
            version = destinationVersion
        } else if (!writeBack || version.pendingPresence) replacePlacement(owner, key, version, operationContext, false)
        else if (!placementPresent(version)) deleteProperty(owner, key, operationContext)
        else replacePlacement(owner, key, version, operationContext, writeBack)
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
    let publication = Promise.withResolvers()
    let transition = { promise: publication.promise }
    const gate = {
        promise, owner, key, structure,
        proveObstruction(certainty) {
            // Publish the intermediate fact through the same captured gate.
            // Exact readers still follow this destination's final commit.
            const previous = transition, selected = publication
            publication = Promise.withResolvers()
            transition = { selection: true, structuralError: certainty, promise: publication.promise }
            gate.version.transition = transition
            previous.placement = capturePlacementFromVersion(gate.version)
            previous.structuralError = certainty
            selected.resolve()
        },
        resolve() {
            const version = gate.version
            gate.publication?.finish()
            gate.structure.complete?.()
            transition.placement = capturePlacementFromVersion(version)
            publication.resolve()
            releaseWriter?.()
            gate.owner = undefined
            // Replacement may proceed after publication. Value consumers still
            // wait for any pending data that was published through the gate.
            if (version.ownFailure) resolve(placementValue(version))
            else markPromiseHandled(continueCapturedPromiseVersion(version.value, version,
                operationContext, resolve), operationContext)
        },
    }
    const version = { value: gate.promise, present: true, promiseBacked: true, pendingPresence: true, transition,
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
    // A nested command may still change presence or status. Finish that
    // transition here so failed publication follows the same failure path as
    // ready completion. Pending data itself does not delay gate publication.
    const publication = resolvePlacementTransition(placement, operationContext, resolved => {
        const failure = errorUtils.catchExternalThrow(
            () => transferPlacement(resolved, gate.owner, gate.key, operationContext, gate.version,
                errorUtils.ERROR_KIND.AssignmentValueFailed, false, gate.structure),
            operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)
        if (errorUtils.isPoisonError(failure)) {
            gate.publication.published = true
            publishPlacementFailure(gate.owner, gate.key, gate.version,
                combinePublicationErrors(placementValue(resolved), failure), resolved,
                operationContext, gate.structure, resolved.position)
        }
        gate.resolve()
    })
    markPromiseHandled(publication, operationContext)
    return publication
}

// Failed private work is never adopted. Keep the selected current data and
// publish only this path's failure status; no Error owns a recovery payload.
function publishPlacementFailure(owner, key, version, failure, baseline, operationContext, structure, position = baseline.position) {
    return transferPlacement({ ...baseline, ownFailure: failure, position }, owner, key,
        operationContext, version, errorUtils.ERROR_KIND.AssignmentValueFailed, false, structure)
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
        version.copiedDelivery?.delivery.uses.delete(version)
        delete version.copiedDelivery
        delete version.copyDelivery
        version.value = placement.value
        version.present = placement.present !== false
        version.ownFailure = placement.ownFailure
        version.role = placement.role
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
    const absent = !placementPresent(placement)
    return preparePropertyCommit(owner, key, placement, operationContext, structure, writeBack, storageAbsent => {
        if (storageAbsent !== undefined) version.storageAbsent = storageAbsent
        commit()
        if (absent) detachAbsentVersion(owner, key, version, operationContext)
    }, optionalStorage || writeBack === CACHE_WRITE)
}

function detachAbsentVersion(owner, key, version, operationContext) {
    // A completed writer alone does not prove that removing a logical absence
    // is safe: it may still mask physical storage or a canonical backing value.
    // Present versions can still authorize queued path publication after they
    // settle; matching physical storage alone does not make them disposable.
    if (!placementPresent(version) && version.storageAbsent && !version.writing &&
        !ArrayView.backingVersion(owner, key, operationContext) &&
        isLivePlacementVersion(owner, key, version, operationContext))
        detachPlacementVersion(owner, key, operationContext)
}

// Forward edges and logical overrides share one maintained placement table.
// Physical edges contain only value; an override owns an explicit presence fact.
function getOwnPlacementVersion(owner, key, operationContext) {
    const placement = metadata.metaOf(owner, operationContext)?.outgoingPlacements?.get(String(key))
    return placement?.present === undefined ? undefined : placement
}

function ownPlacementVersionEntries(owner, operationContext) {
    const meta = metadata.metaOf(owner, operationContext)
    const entries = [...(meta?.outgoingPlacements ?? [])].filter(([, placement]) => placement.present !== undefined)
    if (meta?.type === metadata.TYPE.Array || meta?.backingOwners) entries.sort(([a], [b]) => Number(a) - Number(b))
    return entries
}

function getPlacementVersion(owner, key, operationContext) {
    return getOwnPlacementVersion(owner, key, operationContext) ??
        ArrayView.backingVersion(owner, key, operationContext)
}

function installPlacementVersion(owner, key, version, operationContext) {
    const meta = metadata.requireMeta(owner, operationContext)
    const placements = meta.outgoingPlacements ??= new Map()
    const previous = placements.get(key)
    if (previous) releaseCopiedDelivery(previous, true)
    version.present ??= true
    placements.set(key, version)
}

function detachPlacementVersion(owner, key, operationContext) {
    const version = getOwnPlacementVersion(owner, key, operationContext)
    if (version) {
        releaseCopiedDelivery(version, true)
        metadata.requireMeta(owner, operationContext).outgoingPlacements.delete(key)
    }
}

function isLivePlacementVersion(owner, key, version, operationContext) {
    return getPlacementVersion(owner, key, operationContext) === version
}

function continueCapturedPromiseVersion(promise, promiseVersion, operationContext, onValue, operation, project) {
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
        // Data publication follows its payload even behind a failed path.
        // Observations can finish as soon as that path's status is known.
        const value = project ? project(promiseVersion) : promiseVersion.value
        if (languageValues.isPending(value, operationContext))
            return resume(value === promise ? promiseVersion.publication : value)
        // Direct consumers can release after transferring this capture.
        // Promise-forwarding consumers retain the ordinary delivery window.
        const consume = onValue
        promise = promiseVersion = onValue = undefined
        return consume(value, complete)
    }
    let result
    try {
        // A saved capture can be consumed after its exact version has already
        // published. Re-entry must restore ready data and parent edges now.
        const current = project ? project(promiseVersion) : promiseVersion.value
        if (current !== promise && !languageValues.isPending(current, operationContext)) promise = current
        result = resume(promise)
    }
    catch (failure) { complete(); throw failure }
    if (!languageValues.isPending(result, operationContext)) { complete(); return result }
    if (operation) unregister = releaseOnClose(operation, complete)
    const queuedRelease = () => queueMicrotask(() => releaseDetached(operationContext, complete))
    markPromiseHandled(languageValues.thenValue(result, queuedRelease, queuedRelease, operationContext), operationContext)
    return result
}

function observePlacementEvidence(placement, operation, terminal, blocked = blockedPlacement(placement)) {
    if (blocked) return operation.receiveEvidence(certainPoison, terminal)
    const evidence = placement.transition ? placement.transition.errorEvidence :
        operation.operationContext.execution._pendingErrorEvidence?.get(placement.value)
    if (evidence) followErrorEvidence(evidence, operation, (inspect, queue) => {
        if (operation.open) operation.receiveEvidence(inspect, terminal, queue)
    })
}

function observePlacement(placement, operationContext, onValue, operation, onBlocked, terminal = true) {
    if (operation && !operation.open) return undefined
    const blocked = blockedPlacement(placement)
    if (blocked && operation?.found?.()) return true
    if (operation?.receiveEvidence) {
        observePlacementEvidence(placement, operation, terminal, blocked)
        if (!operation.open) return operation.result
    }
    if (blocked && onBlocked) {
        if (placement.transition) {
            const cause = resolvePlacementTransition(placement, operationContext, structuralFailure)
            placement = { ownFailure: new PendingFailure(cause, operationContext) }
        }
        const visible = visiblePlacement(placement)
        const value = placementValue(visible)
        return onBlocked({ value, sourceVersion: languageValues.isPending(value, operationContext) ? visible.sourceVersion : undefined,
            present: true, role: ERROR_PAYLOAD })
    }
    if (placement.transition) {
        operation?.beforeWait?.()
        return consumePlacementTransition(placement, operationContext, selected =>
            observePlacement(selected, operationContext, onValue, operation, onBlocked, terminal), operation,
            !blocked && (onBlocked || operation?.found || operation?.receiveEvidence) ? blockedPlacement : undefined)
    }
    placement = visiblePlacement(placement)
    let promise = placementValue(placement), promiseVersion = placement.sourceVersion
    if (!languageValues.isPending(promise, operationContext)) return onValue(promise, placement)
    placement = undefined
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
            try { return consume(placementValue(version), version) }
            finally { releaseCapture() }
        },
        operation,
        placementValue,
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
    transition.promise = resolveMutationInput(captured, operationContext, (placement, releaseCapture) => {
        version.writing = true
        const blocked = blockedPlacement(placement)
        if (blocked) transferPlacement(placement, owner, key, operationContext,
            version, errorUtils.ERROR_KIND.AssignmentValueFailed, false, structure)
        else publishPromiseVersion(owner, key, version, placement, operationContext, structure)
        // Only a live destination accepts this capture. A displaced writer
        // keeps its lease through descent: the remaining parent may belong to
        // another owner. The capture releases when this callback returns.
        if (isLivePlacementVersion(owner, key, version, operationContext)) releaseCapture?.()
        result = blocked ? { result: resolvePlacementTransition(placement, operationContext, placementValue) } :
            onValue(placementValue(version), version, structure)
        delete version.writing
        detachAbsentVersion(owner, key, version, operationContext)
        transition.placement = capturePlacementFromVersion(version)
        structure.complete?.()
    })
    trackVersionPublication(version, transition.promise, operationContext)
    return internalSteps.continueGraphTransition(transition.promise, operationContext, () => { releaseWriter?.(); return result })
}

function resolvePropertyValueAtKey(owner, key, operationContext) {
    return resolveVisiblePlacement(languageProperties.readLanguagePlacement(owner, key, operationContext),
        operationContext, placementValue)
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
    const ready = { value, present: placement.present,
        // Ordinary payload delivery cannot reinstate status cleared by a later
        // placement version. A structural transition still selects its status.
        ownFailure: structure || promiseVersion.transition || promiseVersion.pendingPresence ? placement.ownFailure : promiseVersion.ownFailure,
        role: placement.role,
        discoveryBlocked: placement.discoveryBlocked,
        // Ordinary payload settlement does not insert the property again.
        // Only an unfinished transition still owns its structural decision.
        position: structure || promiseVersion.transition || promiseVersion.pendingPresence ? placement.position : promiseVersion.position ?? placement.position }
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
        preparePropertyCommit(owner, key, placement, operationContext, undefined, writeBack, absent => {
            // Failed storage work must leave the old logical version available.
            detachPlacementVersion(owner, key, operationContext)
            if (absent === undefined ||
                placement.promiseBacked || placement.ownFailure || placement.role || placement.discoveryBlocked ||
                ArrayView.backingVersion(owner, key, operationContext))
                installPlacementVersion(owner, key, placement, operationContext)
        }, writeBack === CACHE_WRITE)()
    } finally { owner = placement = undefined }
}

function preparePlacementStorage(owner, key, placement, operationContext) {
    // Entry holders write through their captured source authority. Detached
    // references still advance privately. Nested entries can form a long
    // history around one value: prepare and write outermost-first without
    // recursive calls, preserving storage failure before private publication.
    const destinations = []
    // A regional owner publishes through its version. Its shared backing
    // must stay untouched even when reached through a nested entry holder.
    while (!ArrayView.region(owner, operationContext)) {
        const gate = metadata.metaOf(owner, operationContext)?.entryGate
        destinations.push({ owner, key, gate })
        if (!gate || !isLivePlacementVersion(gate.owner, gate.key, gate.version, operationContext)) break
        owner = gate.owner
        key = gate.key
    }
    if (!destinations.length) return
    const absent = placement.present === false
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
        }, refcounts.counterValue(placement))
    } finally { owner = placement = undefined }
}

// Prepared placement inspection never consumes values. Storage, shape, and
// optional counters can therefore be prepared against one stable edge capture.
function prepareEdgeUpdate(owner, key, before, value, operationContext, commit, visible = value) {
    const wasOverlay = Boolean(getPlacementVersion(owner, key, operationContext))
    let updateCounter = refcounts.prepareCounterUpdate(owner, key, refcounts.counterValue(before), visible, operationContext)
    visible = undefined
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
    for (const [sourceKey, version] of ownPlacementVersionEntries(source, operationContext)) {
        const index = Number(sourceKey)
        if (index < sourceStart || index >= sourceEnd) continue
        const captured = capturePlacementFromVersion(version)
        copyPlacement(captured, destination, String(index + destinationOffset), operationContext, false)
    }
}

export {
    CACHE_WRITE,
    densePlacement,
    placementFromSelection,
    projectPlacement,
    replacePlacementTransition,
    STRUCTURAL_ERROR,
    MARKER_SELECTION,
    structuralFailure,
    resolvePlacementPresence,
    resolvePresentPlacement,
    placementValue,
    visiblePlacement,
    PendingFailure,
    knownObstruction,
    blockedPlacement,
    placementPresent,
    resolveVisiblePlacement,
    resolveMutationInput,
    refreshCopiedDelivery,
    retainCopiedDelivery,
    releaseCopiedDelivery,
    observePlacementCapture,
    observePlacementEvidence,
    installPlacementGate,
    completePlacementGate,
    publishPlacementFailure,
    combinePublicationErrors,
    capturePlacement,
    capturePlacementFromVersion,
    createVersionFromPlacement,
    resolvePlacement,
    consumePlacementTransition,
    captureObservedPoint,
    resolvePlacementTransition,
    retainPlacement,
    copyPlacement,
    transferPlacement,
    commitPlacementVersion,
    publishPromiseVersion,
    assignProperty,
    prepareInputPlacement,
    observePlacement,
    installMutationVersion,
    continueCapturedPromiseVersion,
    deleteProperty,
    releaseHolder,
    getPlacementVersion,
    getOwnPlacementVersion,
    ownPlacementVersionEntries,
    commitPromiseVersion,
    installPlacementVersion,
    copyArrayOverlays,
    trackVersionPublication,
    resolvePropertyValueAtKey,
    replacePlacement,
}
