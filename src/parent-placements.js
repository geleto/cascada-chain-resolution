import * as metadata from "./meta.js"
import { ArrayView, ArrayBacking, isArrayView, isArrayIndex } from "./array-view.js"

// Incoming occurrences are independent of the counter index. A backing source
// expands into logical Array owners only when a consumer asks for placements.
function addParent(value, source, key, operationContext) {
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
        addParent(value, source, key, operationContext)
    }
}

function removeParent(value, source, key, operationContext) {
    const meta = metadata.metaOf(value, operationContext)
    const incoming = meta?.incomingParents
    if (!incoming) return
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
        if (source instanceof ArrayBacking) {
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
    const versions = meta.placementVersions
    meta.placementsInitialized = true
    if (array) ArrayView.registerOwner(owner, operationContext)
    if (!isArrayView(owner, operationContext)) {
        for (const [key, value] of entries ?? Object.entries(owner)) {
            if (array) {
                if (isArrayIndex(key)) ArrayView.recordBackingPlacement(owner, key, undefined, value, operationContext)
            } else if (!versions?.[key]) addParent(value, owner, key, operationContext)
        }
    }
    for (const key of Object.keys(versions ?? {})) {
        const version = versions[key]
        if (version.present !== false) addParent(version.value, owner, key, operationContext)
    }
}

// Pending deliveries retain only this destination authority. Overlapping input
// attempts keep it local; private outputs link it from metadata while initializing.
class PlacementConstruction {
    get open() { return this.state !== "discarded" }
    constructor(owner, operationContext) {
        this.owner = owner
        this.operationContext = operationContext
        this.state = "staged"
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
        if (this.state !== "staged") return
        const { owner, operationContext } = this
        initializePlacements(owner, operationContext, entries)
        this.finish("published")
    }

    discard() {
        if (this.state === "staged") this.finish("discarded")
    }

    finish(state) {
        this.state = state
        const meta = metadata.metaOf(this.owner, this.operationContext)
        if (meta?.construction === this) delete meta.construction
        if (state === "discarded") this.owner = undefined
    }
}

function recordLogicalPlacement(owner, key, before, after, operationContext, wasOverlay) {
    const meta = metadata.requireMeta(owner, operationContext)
    if (!meta.placementsInitialized) return
    if (meta.type !== metadata.TYPE.Array || wasOverlay) removeParent(before, owner, key, operationContext)
    if (meta.type !== metadata.TYPE.Array || meta.placementVersions?.[key]) addParent(after, owner, key, operationContext)
}

function initializeHolder(owner, operationContext) {
    metadata.getOrCreateMeta(owner, operationContext, metadata.TYPE.Record, Object.prototype).placementsInitialized = true
    return owner
}

export { addParent, removeParent, visitParentPlacements, getParentPlacements,
    PlacementConstruction, initializePlacements, recordLogicalPlacement, initializeHolder }
