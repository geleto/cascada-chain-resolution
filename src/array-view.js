import { captureIdentity } from "./captured-identity.js"
import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import { LengthState } from "./array-length.js"
import { addParent, removeParent, PlacementConstruction, activateRelationships } from "./parent-placements.js"
import { copyArrayOverlays } from "./property-versions.js"

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
        for (const owner of this.owners) {
            const meta = metadata.requireMeta(owner, operationContext)
            const range = meta.arrayRange
            const start = range?.start ?? 0
            const length = range ? range.lengthState.minimum ?? range.lengthState : undefined
            for (const index of indexes) {
                const logical = index - start
                if (logical < 0 || length !== undefined && logical >= length) continue
                const key = String(logical)
                if (!meta.placementVersions?.[key] && visit(owner, key) === false) return false
            }
        }
    }

}

// Each logical owner keeps its bounds and pending length in metadata. Native
// Arrays need no range until their logical shape diverges from physical storage.
class ArrayView {
    constructor(source, operationContext, start = 0, end) {
        languageValues.admitReadyValue(source, operationContext)
        const range = metadata.requireMeta(source, operationContext).arrayRange
        end ??= ArrayView.minimumLength(source, operationContext)
        languageValues.admitReadyValue(this, operationContext, languageValues.TYPE.Array)
        metadata.requireMeta(this, operationContext).arrayRange = {
            backing: range?.backing ?? source,
            start: (range?.start ?? 0) + start,
            lengthState: end - start,
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

    static resolveLength(array, work, onLength) {
        const state = ArrayView.#stateOf(array, work.operationContext)
        return typeof state === "number" ? onLength(state) : state.resolve(work, onLength)
    }

    static resolveInRange(array, index, work, onInRange) {
        const state = ArrayView.#stateOf(array, work.operationContext)
        return typeof state === "number" ? onInRange(index < state) : state.resolve(work, onInRange, index)
    }

    static captureLength(array, operationContext, owner) {
        const state = ArrayView.#stateOf(array, operationContext)
        return typeof state === "number" ? state : state.capture(owner)
    }

    // An entry can create an index without committing growth at issuance.
    // The returned completion records creation or final absence for its copies too.
    static beginIndexTransition(array, key, operationContext) {
        const bound = Number(key) + 1
        let state = ArrayView.#stateOf(array, operationContext)
        if (bound <= (state.minimum ?? state)) return
        if (typeof state === "number") state = new LengthState(state)
        ArrayView.#setState(array, state, operationContext)
        return state.add(bound).complete
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
            metadata.requireMeta(owner, operationContext).backingRecord = record
            if (metadata.requireMeta(owner, operationContext).relationshipsActive) {
                record.owners.add(owner)
                activateRelationships(record, operationContext)
            }
        }
    }

    static recordBackingPlacement(owner, key, previous, value, operationContext) {
        if (!isArrayIndex(String(key))) return
        const range = metadata.metaOf(owner, operationContext)?.arrayRange
        const backing = range?.backing ?? owner
        const meta = metadata.requireMeta(backing, operationContext)
        const index = (range?.start ?? 0) + Number(key)
        if (!meta.placementsInitialized) return
        let record = meta.arrayBacking
        if (!record && metadata.isTraversableType(metadata.metaOf(value, operationContext)?.type)) {
            record = meta.arrayBacking = new ArrayBacking(backing, operationContext)
            if (meta.relationshipsActive) record.owners.add(backing)
        }
        if (!record) return
        removeParent(previous, record, index, operationContext)
        addParent(value, record, index, operationContext)
    }

    static requiresMaterialization(value, operationContext, key) {
        // Sharing and leases use ordinary COW; this checks representation only.
        const range = metadata.metaOf(value, operationContext)?.arrayRange
        if (!range) return false
        const length = ArrayView.minimumLength(value, operationContext)
        if (isArrayIndex(String(key)) && Number(key) < length) {
            const backing = metadata.requireMeta(range.backing, operationContext)
            // tryShareStorage never registers views over imported backing.
            if (backing.arrayBacking?.owners.size === 1 && backing.arrayBacking.owners.has(value))
                return false
        }
        return range.backing !== value || length !== ArrayView.#physicalLength(range.backing, operationContext)
    }

    static hasOtherStorageUse(owner, key, operationContext) {
        const meta = metadata.metaOf(owner, operationContext)
        const backing = meta?.backingRecord
        if (!backing || !isArrayIndex(String(key))) return false
        const index = (meta.arrayRange?.start ?? 0) + Number(key)
        let shared = false
        backing.visitViewPlacements([index], operationContext, parent => {
            if (parent === owner) return
            shared = true
            return false
        })
        return shared
    }

    // Freeze the source's logical bounds before creating an owner that can
    // extend shared storage. No additional identity is admitted for this range.
    static tryShareStorage(source, operationContext) {
        const range = metadata.metaOf(source, operationContext)?.arrayRange
        const backing = range?.backing ?? source
        if (metadata.isImported(source, operationContext) ||
            metadata.isImported(backing, operationContext)) return false
        const length = ArrayView.readyLength(source, operationContext)
        if (length === undefined) return false
        if (!range) ArrayView.#setState(source, length, operationContext)
        return true
    }

    static tryExtendEnd(source, count, operationContext, populate) {
        const range = metadata.metaOf(source, operationContext)?.arrayRange
        const backing = range?.backing ?? source
        // Imported storage cannot be extended, regardless of its host descriptors.
        if (metadata.isImported(source, operationContext) ||
            metadata.isImported(backing, operationContext)) return
        if (ArrayView.readyLength(source, operationContext) === undefined) return
        // Check tail availability before attaching a new logical owner.
        // An empty extension needs no physical write.
        let nextPhysicalLength
        if (count > 0) {
            const length = ArrayView.#physicalLength(backing, operationContext)
            if (range && range.start + ArrayView.minimumLength(source, operationContext) !== length) return
            // Only the native backing owner can reserve growth beyond physical
            // storage: distinct views materialize or extend storage first.
            // Its pending creation reserves the intervening holes too.
            const backingRange = metadata.requireMeta(backing, operationContext).arrayRange
            if (backingRange && (backingRange.lengthState.maximum ?? backingRange.lengthState) > length) return
            if (length + count > 0xffffffff) return
            if (!errorUtils.runExternalAction(operationContext, () => Object.isExtensible(backing))) return
            const descriptor = errorUtils.runExternalAction(operationContext, () =>
                Object.getOwnPropertyDescriptor(backing, "length"))
            if (descriptor?.writable !== true) return
            nextPhysicalLength = length + count
        }
        if (!ArrayView.tryShareStorage(source, operationContext)) return
        const next = new ArrayView(source, operationContext, 0, ArrayView.minimumLength(source, operationContext) + count)
        return PlacementConstruction.initializeAndPublish(next, operationContext, next => {
            copyArrayOverlays(source, next, operationContext)
            if (count > 0) errorUtils.runExternalAction(operationContext, () => { backing.length = nextPhysicalLength })
            populate?.(next)
        })
    }

    // Capture storage candidates now: broad ranges enumerate stored keys;
    // bounded views inspect only their range.
    static physicalKeyCandidates(array, operationContext, start = 0, end) {
        const range = metadata.metaOf(array, operationContext)?.arrayRange
        const backing = range?.backing ?? array
        const backingLength = ArrayView.#physicalLength(backing, operationContext)
        const offset = range?.start ?? 0
        const extent = range ? ArrayView.minimumLength(array, operationContext) : backingLength
        start = offset + Math.max(0, start)
        end = offset + Math.min(extent, end ?? extent)
        if (extent >= backingLength && offset === 0 && end - start >= extent / 2) {
            const ownKeys = errorUtils.runExternalAction(operationContext, () => Reflect.ownKeys(backing))
            // Proxies may list indexes out of order; logical Arrays use index order.
            const keys = Object.create(null)
            for (const key of ownKeys) {
                if (!isArrayIndex(key) || Number(key) < start || Number(key) >= end) continue
                keys[String(Number(key) - offset)] = true
            }
            return Object.keys(keys)
        }
        const keys = []
        for (let index = start; index < end; index++) keys.push(String(index - offset))
        return keys
    }

    static descriptor(array, key, operationContext) {
        const range = metadata.requireMeta(array, operationContext).arrayRange
        if (key === "length") return {
            value: ArrayView.minimumLength(array, operationContext), enumerable: false, writable: true, configurable: false,
        }
        const physical = ArrayView.#physicalKey(array, key, operationContext)
        return physical === undefined ? undefined : errorUtils.runExternalAction(
            operationContext, () => Object.getOwnPropertyDescriptor(range.backing, physical))
    }

    static mutationTarget(array, key, operationContext, writing) {
        // A native owner's index write precedes its logical growth commit.
        // A distinct view writes only within its already established bounds.
        const range = metadata.requireMeta(array, operationContext).arrayRange
        const physical = writing && range.backing === array && isArrayIndex(key)
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
        const inRange = typeof state === "number" ? index < state : state.answer(index)
        return inRange !== false ? String(range.start + index) : undefined
    }

    static #stateOf(array, operationContext) {
        const range = metadata.metaOf(array, operationContext)?.arrayRange
        if (!range) return ArrayView.#physicalLength(array, operationContext)
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
        return errorUtils.runExternalAction(operationContext, () => array.length)
    }
}

function isArrayView(value, operationContext) {
    const range = metadata.metaOf(value, operationContext)?.arrayRange
    return range !== undefined && range.backing !== value
}

function isLogicalArray(value, operationContext) {
    return metadata.metaOf(value, operationContext)?.type === languageValues.TYPE.Array
}

function isArrayIndex(key) {
    if (typeof key !== "string" || key === "") return false
    const index = Number(key)
    return Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === key
}

function hasArrayAncestor(ancestry, array, operationContext) {
    const identity = captureIdentity(array, operationContext)
    for (let current = ancestry; current; current = current.parent) {
        if (current.identity === identity) return true
    }
    return false
}

export { ArrayView, ArrayBacking, isArrayView, isLogicalArray, isArrayIndex, hasArrayAncestor }
