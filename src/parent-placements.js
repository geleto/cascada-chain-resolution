import { refreshCopiedDelivery, retainCopiedDelivery, releaseCopiedDelivery, getOwnPlacementVersion } from "./property-versions.js"
import { reconsider } from "./ownership.js"
import { retireRefIndex } from "./refcounts.js"
import * as metadata from "./meta.js"
import { ArrayView, isArrayView, isArrayIndex } from "./array-view.js"

const CONSTRUCTION_STATE = Object.freeze({
    Staged: 0,
    Published: 1,
    Discarded: 2,
})

// Incoming occurrences are independent of the counter index. A backing source
// expands into logical Array owners only when a consumer asks for placements.
function addParent(value, source, key, operationContext) {
    const sourceMeta = metadata.requireMeta(source, operationContext)
    const targetMeta = metadata.metaOf(value, operationContext)
    if (metadata.isTraversableType(targetMeta?.type)) {
        (sourceMeta.outgoingPlacements ??= new Map()).set(key, { value })
        if (sourceMeta.relationshipsActive) {
            activateRelationships(value, operationContext)
            linkParent(value, source, key, operationContext)
        }
    }
}

function linkParent(value, source, key, operationContext) {
    const meta = metadata.metaOf(value, operationContext)
    if (!metadata.isTraversableType(meta?.type)) return
    const incoming = meta.incomingParents
    if (!incoming) meta.incomingParents = { source, key }
    else if (incoming instanceof Map) {
        let keys = incoming.get(source)
        if (!keys) incoming.set(source, keys = new Set())
        keys.add(key)
    } else if (incoming.source !== source || incoming.key !== key) {
        meta.incomingParents = new Map([[incoming.source, new Set([incoming.key])]])
        linkParent(value, source, key, operationContext)
    }
}

function removeParent(value, source, key, operationContext) {
    metadata.requireMeta(source, operationContext).outgoingPlacements?.delete(key)
    unlinkParent(value, source, key, operationContext)
}

function unlinkParent(value, source, key, operationContext) {
    const meta = metadata.metaOf(value, operationContext)
    const incoming = meta?.incomingParents
    if (!incoming) return
    reconsider(value, operationContext)
    if (incoming instanceof Map) {
        const keys = incoming.get(source)
        if (!keys) return
        keys.delete(key)
        if (!keys.size) incoming.delete(source)
        if (!incoming.size) delete meta.incomingParents
    } else if (incoming.source === source && incoming.key === key) delete meta.incomingParents
}

function visitParentPlacements(value, operationContext, visit) {
    const incoming = metadata.metaOf(value, operationContext)?.incomingParents
    if (!incoming) return
    const entries = incoming instanceof Map ? incoming : [[incoming.source, [incoming.key]]]
    for (const [source, keys] of entries) {
        if (metadata.metaOf(source, operationContext)?.backingOwners) {
            if (source.visitViewPlacements(keys, operationContext, visit) === false) return false
        } else {
            for (const key of keys) if (visit(source, key) === false) return false
        }
    }
}

function getParentPlacements(value, operationContext) {
    const result = []
    visitParentPlacements(value, operationContext,
        (parent, key) => { result.push({ parent, key }) })
    return result
}

// Publish outgoing relationships from private storage or captured entries:
// physical slots for Arrays, logical slots for records. Views register only
// their overlays; backing occurrences already exist.
function initializePlacements(owner, operationContext, entries) {
    const meta = metadata.requireMeta(owner, operationContext)
    if (meta.placementsInitialized) return
    const array = meta.type === metadata.TYPE.Array
    meta.placementsInitialized = true
    meta.outgoingPlacements ??= new Map()
    if (array) ArrayView.registerOwner(owner, operationContext)
    if (!isArrayView(owner, operationContext)) {
        for (const [key, value] of entries ?? Object.entries(owner)) {
            if (array) {
                if (isArrayIndex(key)) ArrayView.recordBackingPlacement(owner, key, undefined, value, operationContext)
            } else if (!getOwnPlacementVersion(owner, key, operationContext)) addParent(value, owner, key, operationContext)
        }
    }
    activateRelationships(owner, operationContext)
}

// Pending deliveries retain only this destination authority. Input preparation
// keeps it local; private outputs link it from metadata while initializing.
class PlacementConstruction {
    get open() { return this.state !== CONSTRUCTION_STATE.Discarded }
    get owner() { return this.destination ? this.destination.owner : this.initialOwner }
    constructor(owner, operationContext) {
        this.initialOwner = owner
        this.operationContext = operationContext
        this.state = CONSTRUCTION_STATE.Staged
    }

    // Private initialization may leave pending deliveries, but never an unfinished
    // construction for its caller to publish or discard. Pass the destination
    // into initialize so a retained failure stack need not capture it in a closure.
    static initializeAndPublish(owner, operationContext, initialize) {
        const construction = new PlacementConstruction(owner, operationContext)
        metadata.requireMeta(owner, operationContext).construction = construction
        try {
            initialize(owner)
            construction.commit()
            return owner
        } finally { construction.discard() }
    }

    commit(entries) {
        if (this.state !== CONSTRUCTION_STATE.Staged) return
        const { owner, operationContext } = this
        initializePlacements(owner, operationContext, entries)
        this.finish(CONSTRUCTION_STATE.Published)
    }

    discard() {
        if (this.state === CONSTRUCTION_STATE.Staged) this.finish(CONSTRUCTION_STATE.Discarded)
    }

    finish(state) {
        this.state = state
        const meta = metadata.metaOf(this.owner, this.operationContext)
        if (meta?.construction === this) delete meta.construction
        if (state === CONSTRUCTION_STATE.Published && this.pending) this.destination = destinationOf(this.owner, this.operationContext)
        this.initialOwner = undefined
    }
}

function recordLogicalPlacement(owner, key, before, after, operationContext, wasOverlay) {
    const meta = metadata.requireMeta(owner, operationContext)
    if (!meta.placementsInitialized) return
    if (meta.type !== metadata.TYPE.Array || wasOverlay) unlinkParent(before, owner, key, operationContext)
    const version = getOwnPlacementVersion(owner, key, operationContext)
    if (version && meta.relationshipsActive) activatePlacement(owner, key, version, operationContext)
    if (!version) {
        meta.outgoingPlacements?.delete(key)
        if (meta.type !== metadata.TYPE.Array && !meta.backingOwners)
            addParent(after, owner, key, operationContext)
    }
}

function initializeHolder(owner, operationContext) {
    const meta = metadata.getOrCreateMeta(owner, operationContext, metadata.TYPE.Record, Object.prototype)
    meta.placementsInitialized = true
    meta.pinCount = 1
    meta.outgoingPlacements = new Map()
    activateRelationships(owner, operationContext)
    return owner
}

// A destination retains publication authority only while its topology is active.
// Captured versions settle independently and may outlive this cell's owner.
function destinationOf(owner, operationContext) {
    const meta = metadata.requireMeta(owner, operationContext)
    return meta.destination ??= { owner: meta.relationshipsActive ? owner : undefined }
}

function activatePlacement(owner, key, placement, operationContext) {
    retainCopiedDelivery(placement, true)
    if (placement.present === false) return
    activateRelationships(placement.value, operationContext)
    linkParent(placement.value, owner, key, operationContext)
}

function activateRelationships(owner, operationContext) {
    const meta = metadata.metaOf(owner, operationContext)
    if (!meta?.placementsInitialized || meta.relationshipsActive) return
    for (const placement of meta.outgoingPlacements?.values() ?? []) refreshCopiedDelivery(placement)
    meta.relationshipsActive = true
    meta.arrayRange?.lengthState?.retain?.()
    reconsider(owner, operationContext)
    if (meta.destination) meta.destination.owner = owner
    if (meta.backingRecord) {
        const record = meta.backingRecord
        record.owners.add(owner)
        activateRelationships(record, operationContext)
        activateRelationships(record.producers, operationContext)
    }
    for (const [key, placement] of meta.outgoingPlacements ?? [])
        activatePlacement(owner, key, placement, operationContext)
}

function retireRelationships(owner, operationContext) {
    const meta = metadata.requireMeta(owner, operationContext)
    meta.relationshipsActive = false
    meta.arrayRange?.lengthState?.release?.()
    if (meta.destination) meta.destination.owner = undefined
    if (meta.backingRecord) {
        meta.backingRecord.owners.delete(owner)
        reconsider(meta.backingRecord, operationContext)
        if (meta.backingRecord.producers) reconsider(meta.backingRecord.producers, operationContext)
    }
    for (const [key, placement] of meta.outgoingPlacements ?? []) {
        releaseCopiedDelivery(placement, true)
        if (placement.present !== false) unlinkParent(placement.value, owner, key, operationContext)
    }
    retireRefIndex(owner, operationContext)
}

function visitRetentionParents(value, operationContext, visit) {
    const meta = metadata.metaOf(value, operationContext)
    if (meta?.backingOwners) for (const owner of meta.backingOwners)
        if (visit(owner) === false) return false
    const incoming = meta?.incomingParents
    if (incoming instanceof Map) {
        for (const owner of incoming.keys()) if (visit(owner) === false) return false
    } else if (incoming) return visit(incoming.source)
}

export { addParent, removeParent, visitParentPlacements, getParentPlacements,
    CONSTRUCTION_STATE, PlacementConstruction, initializePlacements, recordLogicalPlacement, initializeHolder,
    activateRelationships, retireRelationships, visitRetentionParents, destinationOf }
