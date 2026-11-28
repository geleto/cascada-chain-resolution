import { captureIdentity, compareIdentities } from "./captured-identity.js"
import { continueGraphTransition, decideInputs } from "./internal-step.js"
import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import { LengthState } from "./array-length.js"
import { fixedWidth } from "./array-width.js"
import { addParent, removeParent, PlacementConstruction, activateRelationships, updateBackingOwners } from "./parent-placements.js"
import { copyArrayOverlays, getOwnPlacementVersion, ownPlacementVersionEntries } from "./property-versions.js"

const hole = Object.freeze({ present: false, value: undefined })

class ArrayBacking {
    constructor(array, operationContext) {
        this.array = array
        this.owners = new Set()
        // A retention index, not language data: exclude it from graph traversal
        // and ordinary COW while retaining its explicit dependency edges.
        const meta = metadata.getOrCreateMeta(this, operationContext, metadata.TYPE.Primitive)
        meta.placementsInitialized = true
        meta.backingOwners = this.owners
        meta.outgoingPlacements = new Map()
        const sourceMeta = metadata.requireMeta(array, operationContext)
        sourceMeta.backingRecord = this
        if (sourceMeta.relationshipsActive) {
            this.owners.add(array)
            activateRelationships(this, operationContext)
        }
    }

    // Includes the original Array alongside its derived views.
    visitViewPlacements(indexes, operationContext, visit) {
        return this.visitStoragePlacements(this.producers ? [...indexes].filter(
            index => typeof index === "object" || !getOwnPlacementVersion(this.producers, index, operationContext)) : indexes,
            operationContext, visit)
    }

    // Both physical slots and shared producers project through these bounds.
    // Owner-local versions replace either projection at their own placement.
    visitStoragePlacements(indexes, operationContext, visit) {
        for (const owner of this.owners) {
            const meta = metadata.requireMeta(owner, operationContext)
            const range = meta.arrayRange
            const borrowed = range?.borrowed?.record === this && range.borrowed
            const offset = range?.start ?? 0
            const start = offset + (borrowed?.start ?? 0)
            let length = range ? retainedLength(range, range.lengthState.minimum ?? range.lengthState) : undefined
            if (borrowed) length = Math.min(length, borrowed.length - offset)
            for (const index of indexes) {
                if (typeof index === "object") {
                    if (!range || owner === this.array) continue
                    const keyAt = i => {
                        const key = String(i - start)
                        if (!getOwnPlacementVersion(owner, key, operationContext) && !getOwnPlacementVersion(this.producers, i, operationContext))
                            return visit(owner, key)
                    }
                    if (this.region?.prefix?.visitChildKeys(index, start, start + length, keyAt) === false ||
                        this.region?.visitChildKeys(index, start, start + length, keyAt) === false) return false
                    continue
                }
                const logical = index - start
                if (logical < 0 || length !== undefined && logical >= length) continue
                const key = String(logical)
                if (!getOwnPlacementVersion(owner, key, operationContext) && visit(owner, key) === false) return false
            }
        }
    }

}

// Logical backing contents are separate from physical cache edges. In
// particular, failed optional storage writes must retain both facts.
// Like physical slots, these forward producers live with their backing, even
// when current views mask them or cover only another range. Retirement clears
// their reverse edges and publication destinations, not authoritative contents.
class ArrayBackingProducers {
    constructor(backing, operationContext) {
        this.backing = backing
        const meta = metadata.getOrCreateMeta(this, operationContext, metadata.TYPE.Primitive)
        meta.placementsInitialized = true
        meta.backingOwners = backing.owners
        meta.outgoingPlacements = new Map()
        meta.arrayRange = { backing: backing.array, start: 0 }
        activateRelationships(this, operationContext)
    }

    visitViewPlacements(indexes, operationContext, visit) {
        return this.backing.visitStoragePlacements(indexes, operationContext, visit)
    }
}

// Each logical owner keeps its bounds and pending length in metadata. Native
// Arrays need no range until their logical shape diverges from physical storage.
class ArrayView {
    constructor(source, operationContext, start = 0, end, prefix) {
        languageValues.admitReadyValue(source, operationContext)
        const range = metadata.requireMeta(source, operationContext).arrayRange
        end ??= ArrayView.minimumLength(source, operationContext)
        languageValues.admitReadyValue(this, operationContext, languageValues.TYPE.Array)
        const bounds = metadata.requireMeta(this, operationContext).arrayRange = {
            backing: range?.backing ?? source,
            start: (range?.start ?? 0) + start,
            lengthState: end - start,
        }
        if (range?.retainedEnd !== undefined) bounds.retainedEnd = range.retainedEnd
        if (prefix) bounds.borrowed = prefix
        else if (range?.borrowed && bounds.start < range.borrowed.length) bounds.borrowed = range.borrowed
    }

    static prefixLength(owner, ctx) {
        const range = metadata.metaOf(owner, ctx)?.arrayRange
        return range?.borrowed ? Math.max(0, Math.min(retainedLength(range, ArrayView.minimumLength(owner, ctx)),
            range.borrowed.length - range.start)) : 0
    }

    // The retained backing ends at the cut even if an owner later grows its
    // logical length. Own versions may publish into the newly added holes.
    static clipBacking(owner, ctx) {
        const range = metadata.requireMeta(owner, ctx).arrayRange
        range.retainedEnd = Math.min(range.retainedEnd ?? Infinity, range.start + range.lengthState)
    }

    static retainedLength(owner, ctx, length = ArrayView.maximumLength(owner, ctx)) {
        return retainedLength(metadata.metaOf(owner, ctx)?.arrayRange, length)
    }

    // A cursor past the borrowed prefix still needs the tail's versions,
    // shape and COW protection at their original coordinates.
    static captureAfterPrefix(owner, first, ctx) {
        const range = metadata.requireMeta(owner, ctx).arrayRange
        const view = new ArrayView(range.backing, ctx, range.start, range.start)
        ArrayView.prepareShapeCopy(owner, view, ctx)()
        return PlacementConstruction.initializeAndPublish(view, ctx, output =>
            copyArrayOverlays(owner, output, ctx, first, ArrayView.maximumLength(owner, ctx)))
    }

    static borrowPrefix(owner, length, ctx) {
        let range = metadata.requireMeta(owner, ctx).arrayRange
        if (range?.borrowed) {
            const start = range.borrowed.start + range.start
            length = ArrayView.prefixLength(owner, ctx)
            if (length && start <= length) return { record: range.borrowed.record, start, length }
        } else if (length > 0 && !ArrayView.region(owner, ctx) && ArrayView.tryShareStorage(owner, ctx, true)) {
            range = metadata.requireMeta(owner, ctx).arrayRange
            const storage = metadata.requireMeta(range.backing, ctx)
            return { record: storage.arrayBacking ??= new ArrayBacking(range.backing, ctx), start: range.start, length }
        }
    }

    // Incremental scans and storage allocation need only the committed prefix.
    // Ordinary consumers resolve or capture length instead.
    static minimumLength(array, operationContext) {
        const state = ArrayView.#stateOf(array, operationContext)
        return state.minimum ?? state
    }

    static readyLength(array, operationContext) {
        const state = ArrayView.#stateOf(array, operationContext)
        return typeof state === "number" ? state : state.answer()
    }

    static hasPendingLength(array, operationContext) {
        const state = metadata.metaOf(array, operationContext)?.arrayRange?.lengthState
        return state instanceof LengthState && state.answer() === undefined
    }

    static resolveLength(array, work, onLength) {
        const state = ArrayView.#stateOf(array, work.operationContext)
        return typeof state === "number" ? onLength(state) : state.resolve(work, onLength)
    }

    static resolveInRange(array, index, work, onInRange) {
        const state = ArrayView.#stateOf(array, work.operationContext)
        return typeof state === "number" ? onInRange(index < state) : state.resolve(work, onInRange, index)
    }

    static captureExtent(array, ctx, limit) {
        const state = ArrayView.#stateOf(array, ctx)
        return typeof state === "number" ? fixedWidth(Math.min(state, limit)) : state.captureExtent(limit, ctx)
    }

    static captureLength(array, operationContext, owner, limit) {
        const state = ArrayView.#stateOf(array, operationContext)
        return typeof state === "number" ? Math.min(state, limit ?? Infinity) : state.capture(owner, undefined, limit)
    }

    static #captureMembership(array, index, operationContext, owner) {
        const state = ArrayView.#stateOf(array, operationContext)
        return typeof state === "number" ? index < state : state.capture(owner, index)
    }

    static captureInRange(array, index, operationContext, owner) {
        const question = ArrayView.#captureMembership(array, index, operationContext, owner)
        return question?.read ? question.read() : question
    }

    // A point from either end can disappear while its source is still open.
    // Keep the captured width question only until either input decides the placement.
    static selectPoint(array, index, selected, ctx, owner) {
        if (!languageValues.isPending(selected, ctx)) return selected
        const member = ArrayView.#captureMembership(array, index, ctx, owner)
        if (member === true) return selected
        const membership = member === false ? false : member.read()
        return decideInputs([selected, membership], ctx, ([placement, present]) => {
            if (present === false) return hole
            if (languageValues.isPending(placement, ctx)) return
            member.release()
            return placement
        }, owner)
    }

    // An entry can create an index without committing growth at issuance.
    // The returned completion records creation or final absence for its copies too.
    static beginIndexTransition(array, key, operationContext) {
        const bound = Number(key) + 1
        let state = ArrayView.#stateOf(array, operationContext)
        if (bound <= (state.minimum ?? state)) return
        if (typeof state === "number") state = new LengthState(state)
        ArrayView.#setState(array, state, operationContext)
        const growth = state.add(bound)
        return created => growth.complete(created ? bound : 0)
    }

    // The same captured length facts cover a variable-width output region
    // and later indexed growth. Earlier questions keep their original bounds.
    static deferLength(array, widths, operationContext) {
        ArrayView.#setState(array, new LengthState(widths.minimum, widths), operationContext)
    }

    static maximumLength(array, operationContext) {
        const state = ArrayView.#stateOf(array, operationContext)
        return state.maximum ?? state
    }

    // Read fallible storage before publication. The returned commit runs after
    // the index write, with no host read between that write and logical growth.
    static prepareIndexCreation(array, key, operationContext) {
        if (!isArrayIndex(key)) return
        const length = Number(key) + 1
        if (length <= ArrayView.minimumLength(array, operationContext)) return
        return wroteStorage => {
            const range = metadata.metaOf(array, operationContext)?.arrayRange
            if (range) {
                const state = ArrayView.#stateOf(array, operationContext)
                if (typeof state === "number") range.lengthState = Math.max(state, length)
                else state.grow(length)
            } else if (!wroteStorage) ArrayView.#setState(array, length, operationContext)
        }
    }

    // Container copying transfers shape as well as placements. Earlier growth
    // outcomes are shared, but each copy owns its subsequent length history.
    static prepareShapeCopy(source, destination, operationContext) {
        const state = ArrayView.#stateOf(source, operationContext)
        const copy = typeof state === "number" ? state : state.fork()
        const changed = copy !== ArrayView.minimumLength(destination, operationContext)
        const from = metadata.metaOf(source, operationContext)?.arrayRange, to = metadata.metaOf(destination, operationContext)?.arrayRange
        if (from?.retainedEnd !== undefined && from.backing === to?.backing) to.retainedEnd = from.retainedEnd
        return () => {
            if (changed) ArrayView.#setState(destination, copy, operationContext)
        }
    }

    static registerOwner(owner, operationContext) {
        const range = metadata.metaOf(owner, operationContext)?.arrayRange
        const backing = range?.backing ?? owner
        const meta = metadata.requireMeta(backing, operationContext)
        if (range || meta.arrayBacking) {
            const record = meta.arrayBacking ??= new ArrayBacking(backing, operationContext)
            const ownerMeta = metadata.requireMeta(owner, operationContext)
            ownerMeta.backingRecord = record
            if (ownerMeta.relationshipsActive) updateBackingOwners(owner, ownerMeta, operationContext)
        }
    }

    static storedIndexes(owner, operationContext) {
        const range = metadata.metaOf(owner, operationContext)?.arrayRange
        const storage = range?.borrowed?.record.array ?? range?.backing ?? owner
        return metadata.requireMeta(storage, operationContext).storedIndexes ?? 0
    }

    static hasStoredVersions(owner, ctx) {
        const meta = metadata.requireMeta(owner, ctx)
        const backing = metadata.requireMeta(meta.arrayRange?.backing ?? owner, ctx)
        return Boolean(meta.outgoingPlacements?.size ||
            metadata.metaOf(backing.arrayBacking?.producers, ctx)?.outgoingPlacements?.size)
    }

    static hasSparsePrefix(owner, length, ctx) {
        return length > 0 && length > 2 * ArrayView.storedIndexes(owner, ctx)
    }

    // A subrange can be much sparser than the rest of its backing. Even if
    // every physical hole were inside it, a native copy must still pay for
    // at least half its slots. Open and compressed data keep their layout.
    static denseStorage(owner, length, ctx, skip, cut, requireMovedSlot) {
        const meta = metadata.requireMeta(owner, ctx), range = meta.arrayRange
        const borrowed = range?.borrowed, offset = range?.start ?? 0, region = ArrayView.region(owner, ctx)
        if (!length || length > 0xffffffff || region?.pending || length > retainedLength(range, length)) return
        const backing = borrowed?.record.array ?? range?.backing ?? owner, storage = metadata.requireMeta(backing, ctx)
        const prefix = borrowed ? ArrayView.prefixLength(owner, ctx) : region ? 0 : length
        const kept = prefix - Math.min(cut, Math.max(0, prefix - skip))
        const start = (borrowed?.start ?? 0) + offset, stored = storage.storedIndexes ?? 0
        // The occupied end bounds physical density without inspecting the host.
        const present = stored - start - Math.max(0, (storage.storedEnd ?? 0) - start - prefix)
        if (kept && prefix - present > kept / 2) return
        if (requireMovedSlot) {
            // Mutating reverse writes if either side of any pair is present.
            // Exclude every possible override and the unpaired center. The
            // ordinary layout decides conditional writes when this cannot.
            const overrides = (meta.outgoingPlacements?.size ?? 0) +
                (metadata.metaOf(storage.arrayBacking?.producers, ctx)?.outgoingPlacements?.size ?? 0)
            const center = length % 2 === 1 && prefix > Math.floor(length / 2)
            if (present <= overrides + Number(center)) return
        }
        let tail
        if (prefix < length) {
            if (!region) return
            // A settled region contributes its individual slots. Gaps still
            // consult its physical backing and published producers.
            const slots = Object.create(null)
            if (!collect(prefix, Math.min(skip, length), slots) || !collect(Math.max(prefix, skip + cut), length, slots)) return
            const backing = range?.backing ?? owner
            tail = { slots, backing, start: offset, producers: metadata.requireMeta(backing, ctx).arrayBacking.producers }
        }
        return { backing, start, prefix, producers: storage.arrayBacking?.producers, tail }

        function collect(first, end, slots) {
            if (first >= end) return true
            first += offset
            end += offset
            const middle = Math.max(first, Math.min(end, region.start))
            if (first < middle && (region.prefix ? !region.prefix.copyIndividualSlots(first, middle, slots, offset) : middle - first > 1)) return false
            if (middle >= end) return true
            if (end > region.end && end - middle > 1) return false
            return middle >= region.end || region.copyIndividualSlots(middle, Math.min(end, region.end), slots, offset)
        }
    }

    static recordBackingPlacement(owner, key, previous, value, operationContext, countChange = 0) {
        if (!isArrayIndex(key)) return
        const range = metadata.metaOf(owner, operationContext)?.arrayRange
        const backing = range?.backing ?? owner
        const meta = metadata.requireMeta(backing, operationContext)
        const index = (range?.start ?? 0) + Number(key)
        if (!meta.placementsInitialized) return
        if (countChange) {
            meta.storedIndexes += countChange
            if (countChange > 0) meta.storedEnd = Math.max(meta.storedEnd, index + 1)
            else if (!meta.storedIndexes) meta.storedEnd = 0
            else if (meta.storedEnd === index + 1) meta.storedEnd = index
        }
        let record = meta.arrayBacking
        if (!record && metadata.isTraversableType(metadata.metaOf(value, operationContext)?.type)) {
            record = meta.arrayBacking = new ArrayBacking(backing, operationContext)
        }
        if (!record) return
        removeParent(previous, record, index, operationContext)
        addParent(value, record, index, operationContext)
    }

    static requiresMaterialization(value, operationContext, key) {
        // Sharing and leases use ordinary COW; this checks representation only.
        const range = metadata.metaOf(value, operationContext)?.arrayRange
        if (!range) return false
        if (ArrayView.region(value, operationContext)) return false
        const length = ArrayView.minimumLength(value, operationContext)
        if (isArrayIndex(key) && Number(key) < length) {
            const backing = metadata.requireMeta(range.backing, operationContext)
            // tryShareStorage never registers views over imported backing.
            if (backing.arrayBacking?.owners.size === 1 && backing.arrayBacking.owners.has(value))
                return false
        }
        return range.backing !== value || length !== ArrayView.#physicalLength(range.backing, operationContext)
    }

    static hasOtherStorageUse(owner, key, operationContext) {
        if (ArrayView.region(owner, operationContext)) return false
        const meta = metadata.metaOf(owner, operationContext)
        const backing = meta?.backingRecord
        if (!backing || !isArrayIndex(key)) return false
        const index = (meta.arrayRange?.start ?? 0) + Number(key)
        let shared = false
        backing.visitStoragePlacements([index], operationContext, parent => {
            if (parent === owner) return
            shared = true
            return false
        })
        return shared
    }

    static backingVersion(owner, key, operationContext) {
        const meta = metadata.metaOf(owner, operationContext)
        if (meta?.type !== metadata.TYPE.Array || !isArrayIndex(key) && !ArrayView.mayHaveVirtualIndex(owner, key, operationContext)) return
        const range = meta.arrayRange
        const backing = range?.backing ?? owner
        const record = metadata.metaOf(backing, operationContext)?.arrayBacking
        if (range && Number(key) >= retainedLength(range, record?.region ? ArrayView.maximumLength(owner, operationContext) :
            ArrayView.minimumLength(owner, operationContext))) return
        const index = (range?.start ?? 0) + Number(key)
        const borrowed = range?.borrowed
        return borrowed && index < borrowed.length ? getOwnPlacementVersion(borrowed.record.producers, borrowed.start + index, operationContext) :
            getOwnPlacementVersion(record?.producers, index, operationContext) ?? record?.region?.versionAt(index)
    }

    static capturePoint(owner, key, operationContext) {
        const range = metadata.metaOf(owner, operationContext)?.arrayRange
        if (!range || !isArrayIndex(key) && !ArrayView.mayHaveVirtualIndex(owner, key, operationContext) ||
            Number(key) >= retainedLength(range, ArrayView.maximumLength(owner, operationContext)) || getOwnPlacementVersion(owner, key, operationContext)) return
        const index = range.start + Number(key)
        if (range.borrowed && index < range.borrowed.length) return
        return ArrayView.region(owner, operationContext)?.capturePoint?.(index)
    }

    // An unfinished region uses the existing shared backing producer for
    // established placements. A numeric selection creates only its own gate.
    static attachRegion(backing, region, operationContext) {
        const meta = metadata.requireMeta(backing, operationContext)
        const record = meta.arrayBacking ??= new ArrayBacking(backing, operationContext)
        record.region = region
        ArrayView.linkRegionChildren(record, region, operationContext)
        if (region.prefix) ArrayView.linkRegionChildren(record, region.prefix, operationContext)
        return record.producers ??= new ArrayBackingProducers(record, operationContext)
    }

    static linkRegionChildren(record, region, operationContext) {
        region.children(undefined, placement => addParent(placement.value, record, placement, operationContext))
    }

    static region(owner, operationContext) {
        const meta = metadata.metaOf(owner, operationContext)
        if (meta?.type !== metadata.TYPE.Array) return
        return metadata.metaOf(meta.arrayRange?.backing ?? owner, operationContext)?.arrayBacking?.region
    }

    static mayHaveVirtualIndex(owner, key, operationContext) {
        const index = Number(key)
        return Number.isSafeInteger(index) && index >= 0xffffffff && String(index) === String(key) &&
            metadata.metaOf(owner, operationContext)?.type === metadata.TYPE.Array &&
            index < ArrayView.maximumLength(owner, operationContext)
    }

    static *regionKeys(owner, region, operationContext, start, end) {
        const offset = metadata.requireMeta(owner, operationContext).arrayRange?.start ?? 0
        start = Math.max(start, region.start - offset)
        end = Math.min(end ?? Infinity, ArrayView.retainedLength(owner, operationContext), region.end - offset)
        if (start >= end || !region.implicit) return
        if (region.layout) {
            for (const index of region.keys(start + offset, end + offset)) yield String(index - offset)
        } else yield* indexKeys(start, end)
    }

    // Capture the restriction and local point overrides, without reading any
    // unknown numeric placement or retaining its former owner.
    static implicitRanges(owner, operationContext, from, to) {
        const region = ArrayView.region(owner, operationContext)
        if (!region) return []
        const suffix = ArrayView.implicitRange(owner, operationContext, region, from, to)
        const prefix = region.prefix && ArrayView.implicitRange(owner, operationContext, region.prefix, from, to)
        return prefix ? suffix ? [prefix, suffix] : [prefix] : suffix ? [suffix] : []
    }

    static regionKey(owner, index, operationContext) {
        const offset = metadata.requireMeta(owner, operationContext).arrayRange?.start ?? 0
        const key = index - offset
        if (key >= 0 && key < ArrayView.retainedLength(owner, operationContext) &&
            !getOwnPlacementVersion(owner, key, operationContext)) return String(key)
    }

    static implicitRange(owner, operationContext, region = ArrayView.region(owner, operationContext), from = 0, to = Infinity) {
        if (!region?.implicit) return
        const offset = metadata.requireMeta(owner, operationContext).arrayRange?.start ?? 0
        const first = Math.max(offset + from, region.start)
        const end = Math.min(offset + Math.min(to, ArrayView.retainedLength(owner, operationContext)), region.end)
        if (first >= end) return
        const counts = region.layout && region.counts(first, end)
        let masked, errors = counts?.poison ?? 0
        for (const [key] of ownPlacementVersionEntries(owner, operationContext)) {
            const index = offset + Number(key)
            if (index < first || index >= end) continue
            const member = region.layout && region.versionAt(index)
            if (region.layout && !member) continue
            ;(masked ??= new Set()).add(index)
            if (!region.pending && (member?.ownFailure || errorUtils.isPoisonError(member?.value))) errors--
        }
        if (region.pending) for (const index of region.pointKeys(first, end)) (masked ??= new Set()).add(index)
        const count = (counts?.covered ?? end - first) - (masked?.size ?? 0)
        if (count) return { region, first, end, offset, count, errors,
            contains: index => index >= first && index < end && !masked?.has(index),
            intervals(visit) {
                let next = first
                for (const index of masked ? [...masked].sort((a, b) => a - b) : []) {
                    if (next < index) visit(next, index)
                    next = index + 1
                }
                if (next < end) visit(next, end)
            } }
    }

    static captureSkippedRuns(owner, operationContext) {
        const offset = metadata.requireMeta(owner, operationContext).arrayRange?.start ?? 0
        let overrides
        return index => {
            let region = ArrayView.region(owner, operationContext)
            const at = offset + index
            if (region?.prefix && at < region.start) region = region.prefix
            if (!region?.layout || at < region.start || at >= region.end || getOwnPlacementVersion(owner, index, operationContext)) return
            const end = Math.min(region.end, offset + ArrayView.retainedLength(owner, operationContext,
                ArrayView.minimumLength(owner, operationContext)))
            if (at >= end) return
            const run = region.skippedRun(at, end)
            if (!run) return
            // Linear pulls only move forward on this protected logical version.
            // Retain coordinates, never the values of overwritten slots.
            overrides ??= ownPlacementVersionEntries(owner, operationContext).map(([key]) => Number(key)).reverse()
            while (overrides.length && overrides.at(-1) <= index) overrides.pop()
            const next = overrides.at(-1)
            return next < index + run.length ? region.skippedRun(at, offset + next) : run
        }
    }

    // Logical version consumers need only the selected range's maintained
    // producers. Use the existing outgoing table's size to avoid scanning a
    // large unrelated backing or expanding a large sparse range into holes.
    static *backingVersions(owner, start, operationContext) {
        const meta = metadata.metaOf(owner, operationContext)
        const range = meta?.arrayRange
        if (meta?.type !== metadata.TYPE.Array || !range) return
        const record = metadata.metaOf(range.backing, operationContext)?.arrayBacking
        const length = retainedLength(range, ArrayView.minimumLength(owner, operationContext))
        const borrowed = range?.borrowed
        if (borrowed) yield* versions(borrowed.record.producers, range.start + borrowed.start,
            Math.min(length, borrowed.length - range.start))
        yield* versions(record?.producers, range.start, length)

        function* versions(producers, offset, extent) {
            const table = metadata.metaOf(producers, operationContext)?.outgoingPlacements
            if (!table || start >= extent) return
            const first = offset + start, end = offset + extent
            const keys = end - first <= table.size ? indexKeys(first, end) : table.keys()
            for (const key of keys) {
                const index = Number(key)
                if (index < first || index >= end) continue
                const logical = String(index - offset), version = getOwnPlacementVersion(producers, key, operationContext)
                if (version && !getOwnPlacementVersion(owner, logical, operationContext)) yield [logical, version]
            }
        }
    }

    // Bounds are already established. An unshared physical position can own
    // one producer regardless of how many bounds-only successors are created.
    // Local gates/overrides keep their own authority, as do explicit copies.
    static placementDestination(owner, key, operationContext) {
        const meta = metadata.metaOf(owner, operationContext)
        const range = meta?.arrayRange
        if (meta?.type !== metadata.TYPE.Array || !range || range.backing === owner || meta.parents || ArrayView.region(owner, operationContext) ||
            !isArrayIndex(key) || getOwnPlacementVersion(owner, key, operationContext) ||
            Number(key) >= ArrayView.minimumLength(owner, operationContext) ||
            ArrayView.hasOtherStorageUse(owner, key, operationContext)) return
        const backingMeta = metadata.requireMeta(range.backing, operationContext)
        const record = backingMeta.arrayBacking ??= new ArrayBacking(range.backing, operationContext)
        const producers = record.producers ??= new ArrayBackingProducers(record, operationContext)
        return { owner: producers, key: String(range.start + Number(key)) }
    }

    // Freeze the source's logical bounds before creating an owner that can
    // extend shared storage. No additional identity is admitted for this range.
    static tryShareStorage(source, operationContext, growing = false) {
        const range = metadata.metaOf(source, operationContext)?.arrayRange
        const backing = range?.backing ?? source
        if (metadata.isImported(source, operationContext) ||
            metadata.isImported(backing, operationContext)) return false
        const length = ArrayView.readyLength(source, operationContext)
        if (length === undefined || growing && range?.start > length) return false
        if (!range) ArrayView.#setState(source, length, operationContext)
        return true
    }

    static tryExtendEnd(source, count, operationContext, populate, logicalLength) {
        let backing
        try {
            const range = metadata.metaOf(source, operationContext)?.arrayRange
            backing = range?.backing ?? source
            // Imported storage cannot be extended, regardless of its host descriptors.
            if (ArrayView.region(source, operationContext) || metadata.isImported(source, operationContext) ||
                metadata.isImported(backing, operationContext)) return
            logicalLength ??= ArrayView.readyLength(source, operationContext)
            if (logicalLength === undefined) return
            // Repeated end growth on a moving window must not retain its whole
            // discarded prefix. Materialize the live range through the ordinary
            // fallback; other owners keep their existing backing unchanged.
            if (count > 0 && range?.start > logicalLength) return
            // Check tail availability before attaching a new logical owner.
            // An empty extension needs no physical write.
            let nextPhysicalLength
            if (count > 0) {
                const length = errorUtils.catchExternalAction(() => ArrayView.#physicalLength(backing, operationContext),
                    () => undefined)
                if (length === undefined) return
                if (range && range.start + logicalLength !== length) return
                // Only the native backing owner can reserve growth beyond physical
                // storage: distinct views materialize or extend storage first.
                // Its pending creation reserves the intervening holes too.
                const backingRange = metadata.requireMeta(backing, operationContext).arrayRange
                if (backingRange && (backingRange.lengthState.maximum ?? backingRange.lengthState) > length) return
                if (length + count > 0xffffffff) return
                const writable = errorUtils.catchExternalAction(() => errorUtils.runExternalAction(operationContext, () =>
                    Object.isExtensible(backing) && Object.getOwnPropertyDescriptor(backing, "length")?.writable), () => false)
                if (!writable) return
                nextPhysicalLength = length + count
            }
            // The checks above establish sharing eligibility. Pure storage
            // inspection cannot change this captured logical shape.
            if (!range) ArrayView.#setState(source, logicalLength, operationContext)
            if (count > 0 && !errorUtils.catchExternalAction(() => {
                errorUtils.runExternalAction(operationContext, () => { backing.length = nextPhysicalLength })
                return true
            }, () => false)) return
            const next = new ArrayView(source, operationContext, 0, logicalLength + count)
            return PlacementConstruction.initializeAndPublish(next, operationContext, next => {
                copyArrayOverlays(source, next, operationContext)
                populate?.(next)
            })
        } finally { source = backing = populate = undefined }
    }

    // Capture sparse or broad key sets now, and stream narrow coordinates.
    static physicalKeyCandidates(array, operationContext, start = 0, end, sparse = false) {
        let backing
        try {
            const range = metadata.metaOf(array, operationContext)?.arrayRange
            backing = range?.backing ?? array
            const borrowed = range?.borrowed
            const offset = range?.start ?? 0
            const extent = range ? retainedLength(range, ArrayView.minimumLength(array, operationContext)) : undefined
            if (borrowed) {
                const cut = Math.max(0, borrowed.length - offset)
                const prefix = start < cut ? ArrayView.#storageKeys(borrowed.record.array, borrowed.start + offset, Math.min(extent, cut),
                    start, Math.min(end ?? extent, cut), sparse, operationContext) : []
                const suffix = ArrayView.#storageKeys(backing, offset, extent, Math.max(start, cut), end, sparse, operationContext)
                return (function* () { yield* prefix; yield* suffix })()
            }
            return ArrayView.#storageKeys(backing, offset, extent, start, end, sparse, operationContext)
        } finally { backing = undefined }
    }

    static #storageKeys(backing, offset, extent, start, end, sparse, operationContext) {
        try {
            const backingLength = ArrayView.#physicalLength(backing, operationContext)
            extent ??= backingLength
            const meta = metadata.metaOf(backing, operationContext), record = meta?.arrayBacking
            start = offset + Math.max(0, start)
            end = offset + Math.min(extent, end ?? extent)
            const width = end - start
            const stored = (meta?.storedIndexes ?? 0) + (metadata.metaOf(record?.producers, operationContext)?.outgoingPlacements?.size ?? 0)
            if (sparse || meta?.placementsInitialized && width > 64 && width > 4 * stored || (record?.region ? end - start >= backingLength / 2 :
                extent >= backingLength && offset === 0 && end - start >= extent / 2)) {
                const ownKeys = errorUtils.runExternalAction(operationContext, () => Reflect.ownKeys(backing))
                // Proxies may list indexes out of order; logical Arrays use index order.
                const keys = Object.create(null)
                for (const key of ownKeys) {
                    if (!isArrayIndex(key) || Number(key) < start || Number(key) >= end) continue
                    keys[String(Number(key) - offset)] = true
                }
                const producers = record?.producers
                for (const [key] of ownPlacementVersionEntries(producers, operationContext)) {
                    if (Number(key) >= start && Number(key) < end) keys[String(Number(key) - offset)] = true
                }
                return Object.keys(keys)
            }
            // Capture the bounds now without allocating one key per hole. Iteration
            // itself reads no storage, so descriptor failures cannot lose candidates.
            return indexKeys(start - offset, end - offset)
        } finally { backing = undefined }
    }

    static descriptor(array, key, operationContext) {
        let backing
        try {
            if (key === "length") return {
                value: ArrayView.minimumLength(array, operationContext), enumerable: false, writable: true, configurable: false,
            }
            let physical = ArrayView.#physicalKey(array, key, operationContext)
            if (physical === undefined) return
            const range = metadata.requireMeta(array, operationContext).arrayRange
            backing = range.backing
            const borrowed = range.borrowed
            if (borrowed && Number(physical) < borrowed.length) {
                physical = String(borrowed.start + Number(physical))
                backing = borrowed.record.array
            }
            return errorUtils.runExternalAction(operationContext, () => Object.getOwnPropertyDescriptor(backing, physical))
        } finally { backing = undefined }
    }

    static mutationTarget(array, key, operationContext, writing) {
        // A native owner's index write precedes its logical growth commit.
        // A backing producer already owns its physical slot; logical bounds
        // were checked before selecting it, even if storage has not grown yet.
        // A distinct view writes only within its already established bounds.
        const meta = metadata.requireMeta(array, operationContext), range = meta.arrayRange
        const physical = writing && (range.backing === array || meta.backingOwners) && isArrayIndex(key)
            ? key : ArrayView.#physicalKey(array, key, operationContext)
        if (physical === undefined) {
            if (writing) throw new Error("Cannot write outside an ArrayView range")
            return undefined
        }
        return { parent: range.backing, key: physical }
    }

    static #physicalKey(array, key, operationContext) {
        if (!isArrayIndex(key)) return undefined
        const range = metadata.requireMeta(array, operationContext).arrayRange
        const state = ArrayView.#stateOf(array, operationContext), index = Number(key)
        if (range.retainedEnd !== undefined && index >= range.retainedEnd - range.start) return
        const inRange = typeof state === "number" ? index < state : state.answer(index)
        return inRange !== false ? String(range.start + index) : undefined
    }

    static #stateOf(array, operationContext) {
        const meta = metadata.metaOf(array, operationContext)
        const range = meta?.arrayRange
        if (!range) return ArrayView.#physicalLength(array, operationContext)
        if (meta.backingOwners) return ArrayView.#physicalLength(range.backing, operationContext)
        // Earlier questions retain their sequence when current bounds become exact.
        const state = range.lengthState
        if (state instanceof LengthState) {
            const length = state.currentAnswer()
            if (length !== undefined) ArrayView.#setState(array, length, operationContext)
        }
        return range.lengthState
    }

    static #setState(array, state, operationContext) {
        const meta = metadata.requireMeta(array, operationContext)
        const range = meta.arrayRange ??= { backing: array, start: 0 }
        if (range.lengthState === state) return
        if (meta.relationshipsActive) {
            range.lengthState?.release?.()
            state.retain?.()
        }
        range.lengthState = state
    }

    static #physicalLength(array, operationContext) {
        try {
            return errorUtils.runExternalAction(operationContext, () => array.length)
        } finally { array = undefined }
    }
}

function retainedLength(range, length) {
    return range?.retainedEnd === undefined ? length : Math.max(0, Math.min(length, range.retainedEnd - range.start))
}

function* indexKeys(start, end) {
    for (let index = start; index < end; index++) yield String(index)
}

function isArrayView(value, operationContext) {
    const range = metadata.metaOf(value, operationContext)?.arrayRange
    return range !== undefined && range.backing !== value
}

function isLogicalArray(value, operationContext) {
    return metadata.metaOf(value, operationContext)?.type === languageValues.TYPE.Array
}

function isArrayIndex(key) {
    if (typeof key === "string") {
        const index = Number(key)
        if (String(index) !== key) return false
        key = index
    }
    return Number.isInteger(key) && key >= 0 && key < 0xffffffff
}

function hasArrayAncestor(ancestry, array, operation) {
    const identity = captureIdentity(array, operation.operationContext)
    return next(ancestry)

    function next(current) {
        for (; current; current = current.parent) {
            const equal = compareIdentities(current.identity, identity, operation)
            if (languageValues.isPending(equal, operation.operationContext)) {
                const parent = current.parent
                return continueGraphTransition(equal, operation.operationContext,
                    equal => equal || next(parent), undefined, operation)
            }
            if (equal) return true
        }
        return false
    }
}

export { ArrayView, ArrayBacking, ArrayBackingProducers, isArrayView, isLogicalArray, isArrayIndex, hasArrayAncestor, hole }
