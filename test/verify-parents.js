import * as metadata from "../src/meta.js"
import { getParentPlacements } from "../src/parent-placements.js"
import * as errors from "../src/error.js"

// Read forward storage independently, without normalizing values, subscribing,
// or borrowing the preparer's key filter. Versions override projected storage.
function logicalVersionEntries(meta) {
    return [...(meta?.outgoingPlacements ?? [])].filter(([, placement]) => placement.present !== undefined)
}

function visitSharedPlacements(region, first, end, visit) {
    walk(region?.prefix?.layout, 0)
    walk(region?.layout, 0)
    function walk(node, offset) {
        if (!node?.shared || offset >= end || offset + node.length <= first) return
        if (node.left) {
            walk(node.left, offset)
            walk(node.right, offset + node.left.length)
        } else if (node.placement?.layoutChild)
            visit(node.placement, Math.max(first, offset), Math.min(end, offset + node.length))
    }
}

function logicalPlacements(owner, context) {
    const meta = metadata.metaOf(owner, context)
    const array = meta.type === metadata.TYPE.Array
    const view = meta.arrayRange
    const offset = view?.start ?? 0
    const length = view ? view.lengthState.minimum ?? view.lengthState : undefined
    const backing = array && metadata.metaOf(view?.backing ?? owner, context)?.arrayBacking
    const borrowed = view?.borrowed
    const storage = borrowed?.record.array ?? view?.backing ?? owner
    const physicalStart = offset + (borrowed?.start ?? 0)
    const placements = new Map()
    for (const key of Reflect.ownKeys(storage)) {
        if (typeof key !== "string") continue
        let logical = key
        if (array) {
            const index = Number(key)
            if (!Number.isInteger(index) || index < 0 || index >= 4294967295 || String(index) !== key) continue
            const projected = index - physicalStart
            if (borrowed && projected + offset >= borrowed.length) continue
            if (projected < 0 || length !== undefined && projected >= length) continue
            logical = String(projected)
        }
        const descriptor = Object.getOwnPropertyDescriptor(storage, key)
        if (descriptor?.enumerable && "value" in descriptor) placements.set(logical, descriptor.value)
    }
    if (array) {
        if (backing?.region) visitSharedPlacements(backing.region, offset, offset + (length ?? owner.length), (p, first, end) => {
            for (let i = first; i < end; i++) placements.set(String(i - offset), p.value)
        })
        function applyProducers(record, start, end) {
            for (const [physical, version] of logicalVersionEntries(metadata.metaOf(record?.producers, context))) {
                const index = Number(physical) - start
                if (index < 0 || index >= end) continue
                if (version.present === false) placements.delete(String(index))
                else placements.set(String(index), version.value)
            }
        }
        if (borrowed) applyProducers(borrowed.record, physicalStart, Math.min(length, borrowed.length - offset))
        applyProducers(backing, offset, length ?? Infinity)
    }
    for (const [key, version] of logicalVersionEntries(meta)) {
        if (version.present === false) placements.delete(key)
        else placements.set(key, version.value)
    }
    return placements
}

function logicalVersion(owner, key, context) {
    const meta = metadata.metaOf(owner, context)
    const own = meta.outgoingPlacements?.get(String(key))
    if (own?.present !== undefined) return own
    if (meta.type !== metadata.TYPE.Array) return
    const range = meta.arrayRange
    const index = Number(key)
    const backing = metadata.metaOf(range?.backing ?? owner, context)?.arrayBacking
    // A requested regional point can own a pending counter projection
    // before its eventual membership raises the guaranteed length.
    if (range) {
        const shape = range.lengthState
        if (index >= ((backing?.region ? shape.maximum : shape.minimum) ?? shape)) return
    }
    const physical = index + (range?.start ?? 0)
    const borrowed = range?.borrowed
    if (borrowed && physical < borrowed.length)
        return metadata.metaOf(borrowed.record.producers, context)?.outgoingPlacements?.get(String(borrowed.start + physical))
    let version = metadata.metaOf(backing?.producers, context)?.outgoingPlacements?.get(String(physical))
    if (!version) visitSharedPlacements(backing?.region, physical, physical + 1, p => { version = p })
    return version
}

function isCounterCut(owner, key, context) {
    const meta = metadata.metaOf(owner, context)
    return meta?.cycleCuts?.has(key) || meta?.sharedCuts?.has(logicalVersion(owner, key, context))
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
        if (meta.arrayRange?.borrowed && !meta.arrayRange.borrowed.record.owners.has(owner)) fail("Missing borrowed prefix owner")
        if (backings.has(array)) return
        backings.add(array)
        for (const registered of record?.owners ?? []) {
            const registeredMeta = metadata.metaOf(registered, context)
            if (!registeredMeta?.relationshipsActive ||
                (registeredMeta.arrayRange?.backing ?? registered) !== array && registeredMeta.arrayRange?.borrowed?.record !== record)
                fail("Invalid Array backing owner")
        }
        for (const version of logicalVersionEntries(metadata.metaOf(record?.producers, context)).map(([, version]) => version)) {
            for (const [owner, key] of version.counterProjections ?? []) {
                const state = metadata.metaOf(owner, context)
                if (!state?.relationshipsActive || !state.parents ||
                    !state.backingCounterVersions?.has(version) || logicalVersion(owner, key, context) !== version)
                    fail("Invalid backing producer counter projection")
            }
        }
        for (const key of Reflect.ownKeys(array)) {
            if (typeof key !== "string") continue
            const index = Number(key)
            if (!Number.isInteger(index) || index < 0 || index >= 4294967295 || String(index) !== key) continue
            const descriptor = Object.getOwnPropertyDescriptor(array, key)
            if (!descriptor?.enumerable || !("value" in descriptor)) continue
            const child = descriptor.value
            if (!metadata.isTraversableType(metadata.metaOf(child, context)?.type)) continue
            const captured = record && hasBackingOccurrence(child, record, index)
            // A failed initial descriptor is masked by a fixed poison version.
            // Its physical value was never available for indexing. Require a
            // backing occurrence whenever any logical owner can expose it.
            const exposed = [...record?.owners ?? [owner]].some(registered => {
                const state = metadata.metaOf(registered, context)
                const range = state.arrayRange
                const prefix = range?.borrowed?.record === record && range?.borrowed
                if (prefix && index - prefix.start >= prefix.length) return false
                const logical = index - (range?.start ?? 0) - (prefix?.start ?? 0)
                const length = range ? range.lengthState.minimum ?? range.lengthState : array.length
                return logical >= 0 && logical < length && !logicalVersion(registered, String(logical), context)
            })
            if (!captured && exposed) fail("Missing exposed backing occurrence")
            if (captured) walk(child)
        }
    }

    function walk(node) {
        const meta = metadata.metaOf(node, context)
        if (!metadata.isTraversableType(meta?.type) || seen.has(node)) return
        seen.add(node)
        if (!meta.placementsInitialized) fail("Published managed container has incomplete parent preparation")
        if (!meta.relationshipsActive) {
            if (meta.incomingParents || meta.parents || meta.counterChildren || meta.backingCounterVersions ||
                meta.frontierCount !== undefined || meta.errorCount !== undefined ||
                meta.cycleCuts || meta.destination?.owner || meta.backingRecord?.owners.has(node))
                fail("Retired container retains active ownership state")
            for (const child of forward(node).values()) walk(child)
            return
        }
        for (const [source, indexes] of occurrences(node)) {
            const sourceMeta = metadata.metaOf(source, context)
            if (!sourceMeta?.backingOwners) continue
            if (!sourceMeta.arrayRange) {
                if (!sourceMeta.relationshipsActive || !source.owners.size)
                    fail("Incoming backing occurrence has no active owner")
                if (metadata.metaOf(source.array, context)?.arrayBacking !== source) fail("Detached Array backing record")
                for (const index of indexes) {
                    if (typeof index === "object") {
                        if (!index.layoutChild || index.value !== node || sourceMeta.outgoingPlacements?.get(index)?.value !== node)
                            fail("Shared backing placement does not hold its child")
                        continue
                    }
                    const descriptor = Object.getOwnPropertyDescriptor(source.array, String(index))
                    if (!Number.isInteger(index) || index < 0 || index >= 4294967295 ||
                        !descriptor?.enumerable || descriptor.value !== node)
                        fail("Physical backing occurrence does not hold its child")
                }
            } else {
                if (!sourceMeta.relationshipsActive || !source.backing.owners.size ||
                    source.backing.producers !== source)
                    fail("Incoming backing producer has no active owner")
                for (const index of indexes) {
                    const version = sourceMeta.outgoingPlacements?.get(String(index))
                    if (!version || version.present === false || version.value !== node)
                        fail("Backing producer does not hold its child")
                }
            }
        }
        if (meta.type === metadata.TYPE.Array) checkBacking(node, meta)
        for (const version of meta.backingCounterVersions ?? []) {
            const key = version.counterProjections?.get(node)
            if (!meta.parents || key === undefined || logicalVersion(node, key, context) !== version)
                fail(`Missing backing producer counter projection at ${key}`)
        }
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
            if (parentMeta.parents && !logicalVersion(parent, key, context)?.ownFailure && !isCounterCut(parent, key, context))
                projection.set(parent, (projection.get(parent) ?? 0) + 1)
        }
        if (meta.parents) {
            if (projection.size !== meta.parents.size) fail("Counter parent projection omits a complete incoming placement")
            for (const [parent, count] of projection)
                if (meta.parents.get(parent) !== count) fail("Counter parent projection has incorrect multiplicity")
        }
        for (const [key, child] of forward(node)) {
            const childMeta = metadata.metaOf(child, context)
            const version = logicalVersion(node, key, context)
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

export { verifyParents, verifyLiveness, logicalPlacements, logicalVersionEntries, isCounterCut }
