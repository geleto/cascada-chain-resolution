import * as metadata from "../src/meta.js"
import { getParentPlacements } from "../src/parent-placements.js"
import { ArrayBacking } from "../src/array-view.js"
import * as errors from "../src/error.js"

// Read forward storage independently, without normalizing values, subscribing,
// or borrowing the preparer's key filter. Versions override projected storage.
function logicalPlacements(owner, context) {
    const meta = metadata.metaOf(owner, context)
    const array = meta.type === metadata.TYPE.Array
    const view = meta.arrayRange
    const offset = view?.start ?? 0
    const length = view ? view.lengthState.minimum ?? view.lengthState : undefined
    const placements = new Map()
    for (const key of Reflect.ownKeys(view?.backing ?? owner)) {
        if (typeof key !== "string") continue
        let logical = key
        if (array) {
            const index = Number(key)
            if (!Number.isInteger(index) || index < 0 || index >= 4294967295 || String(index) !== key) continue
            const projected = index - offset
            if (projected < 0 || length !== undefined && projected >= length) continue
            logical = String(projected)
        }
        const descriptor = Object.getOwnPropertyDescriptor(view?.backing ?? owner, key)
        if (descriptor?.enumerable && "value" in descriptor) placements.set(logical, descriptor.value)
    }
    for (const [key, version] of Object.entries(meta.placementVersions ?? {})) {
        if (version.present === false) placements.delete(key)
        else placements.set(key, version.value)
    }
    return placements
}

function verifyParents(context, ...roots) {
    const seen = new Set()
    const backings = new Set()
    const snapshots = new Map()
    const forward = node => {
        if (!snapshots.has(node)) snapshots.set(node, logicalPlacements(node, context))
        return snapshots.get(node)
    }
    for (const root of roots) walk(root)

    function fail(message) { errors.failExecution(context, new Error(message)) }

    function occurrences(node) {
        const incoming = metadata.metaOf(node, context)?.incomingParents
        return incoming instanceof Map ? incoming : incoming ? [[incoming.source, [incoming.key]]] : []
    }

    function hasBackingOccurrence(child, backing, index) {
        for (const [source, keys] of occurrences(child))
            if (source === backing && Array.from(keys).includes(index)) return true
        return false
    }

    function checkBacking(owner, meta) {
        const array = meta.arrayRange?.backing ?? owner
        const record = metadata.metaOf(array, context)?.arrayBacking
        // A native Array's length-only projection needs no backing record until
        // it stores a managed child or another logical owner shares its storage.
        if ((array !== owner || record) && !record?.owners.has(owner)) fail("Missing Array backing owner")
        if (backings.has(array)) return
        backings.add(array)
        for (const registered of record?.owners ?? []) {
            const registeredMeta = metadata.metaOf(registered, context)
            if (!registeredMeta?.relationshipsActive ||
                (registeredMeta.arrayRange?.backing ?? registered) !== array)
                fail("Invalid Array backing owner")
        }
        for (const key of Reflect.ownKeys(array)) {
            if (typeof key !== "string") continue
            const index = Number(key)
            if (!Number.isInteger(index) || index < 0 || index >= 4294967295 || String(index) !== key) continue
            const descriptor = Object.getOwnPropertyDescriptor(array, key)
            if (!descriptor?.enumerable || !("value" in descriptor)) continue
            const child = descriptor.value
            if (!metadata.isTraversableType(metadata.metaOf(child, context)?.type)) continue
            if (!record || !hasBackingOccurrence(child, record, index)) fail("Missing physical backing occurrence")
            walk(child)
        }
    }

    function walk(node) {
        const meta = metadata.metaOf(node, context)
        if (!metadata.isTraversableType(meta?.type) || seen.has(node)) return
        seen.add(node)
        if (!meta.placementsInitialized) fail("Published managed container has incomplete parent preparation")
        if (!meta.relationshipsActive) {
            if (meta.incomingParents || meta.preservationParents || meta.parents || meta.counterChildren ||
                meta.frontierCount !== undefined || meta.errorCount !== undefined ||
                meta.cycleCuts || meta.destination?.owner || meta.backingRecord?.owners.has(node))
                fail("Retired container retains active ownership state")
            for (const child of forward(node).values()) walk(child)
            return
        }
        for (const [source, indexes] of occurrences(node)) if (source instanceof ArrayBacking) {
            if (!metadata.metaOf(source, context)?.relationshipsActive || !source.owners.size)
                fail("Incoming backing occurrence has no active owner")
            if (metadata.metaOf(source.array, context)?.arrayBacking !== source) fail("Detached Array backing record")
            for (const index of indexes) {
                const descriptor = Object.getOwnPropertyDescriptor(source.array, String(index))
                if (!Number.isInteger(index) || index < 0 || index >= 4294967295 ||
                    !descriptor?.enumerable || descriptor.value !== node)
                    fail("Physical backing occurrence does not hold its child")
            }
        }
        if (meta.type === metadata.TYPE.Array) checkBacking(node, meta)
        const incoming = getParentPlacements(node, context)
        const pairs = new Map()
        const projection = new Map()
        for (const { parent, key } of incoming) {
            let keys = pairs.get(parent)
            if (!keys) pairs.set(parent, keys = new Set())
            if (keys.has(key)) fail("Duplicate incoming parent placement")
            keys.add(key)
            if (forward(parent).get(key) !== node) fail("Incoming parent placement does not hold its child")
            const parentMeta = metadata.metaOf(parent, context)
            if (!parentMeta?.relationshipsActive) fail("Incoming parent placement belongs to a retired parent")
            if (parentMeta.parents && !parentMeta.cycleCuts?.has(key))
                projection.set(parent, (projection.get(parent) ?? 0) + 1)
        }
        if (meta.parents) {
            if (projection.size !== meta.parents.size) fail("Counter parent projection omits a complete incoming placement")
            for (const [parent, count] of projection)
                if (meta.parents.get(parent) !== count) fail("Counter parent projection has incorrect multiplicity")
        }
        for (const [key, child] of forward(node)) {
            const childMeta = metadata.metaOf(child, context)
            const version = meta.placementVersions?.[key]
            // Errors and Functions are leaves without container relationships;
            // an unadmitted object needs an installed delivery obligation.
            // Inspect that obligation, never the child's potentially accessor
            // then. The historical promiseBacked flag also survives settlement.
            if (!childMeta && child !== null && typeof child === "object" &&
                !Error.isError(child) && !version?.publication && !version?.transition)
                fail("Published child was not admitted")
            if (!metadata.isTraversableType(childMeta?.type)) continue
            const actual = getParentPlacements(child, context)
            if (!actual.some(p => p.parent === node && p.key === key)) fail("Missing incoming parent placement")
            walk(child)
        }
    }
}

// The scenario supplies its independently modeled live set. Do not infer it
// from the runtime's reverse edges, lease counts, or retirement predicate.
function verifyLiveness(context, nodes, expectedLive) {
    for (const node of nodes) {
        if (!!metadata.metaOf(node, context)?.relationshipsActive !== expectedLive.has(node))
            errors.failExecution(context, new Error("Relationship activity differs from modeled liveness"))
    }
    verifyParents(context, ...nodes)
}

export { verifyParents, verifyLiveness, logicalPlacements }
