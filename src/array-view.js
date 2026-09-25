import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import { LengthState } from "./array-length.js"

// Native Arrays keep their physical representation until bounds or pending
// growth require a projection. All Array-specific state stays behind this class.
class ArrayView {
    constructor(arrayOrArrayView, operationContext, start = 0, end) {
        languageValues.admitReadyValue(arrayOrArrayView, operationContext)
        const source = ArrayView.projectionOf(arrayOrArrayView, operationContext)
        const view = isArrayView(source, operationContext) ? source : undefined
        end ??= ArrayView.minimumLength(source, operationContext)
        Object.defineProperties(this, {
            _backing: { value: view?._backing ?? source },
            _start: { value: (view?._start ?? 0) + start },
            _lengthState: { value: end - start, writable: true },
        })
        languageValues.admitReadyValue(this, operationContext, languageValues.TYPE.Array)
        metadata.requireMeta(this, operationContext).arrayView = this
    }

    static projectionOf(value, operationContext) {
        return metadata.metaOf(value, operationContext)?.arrayView ?? value
    }

    // Incremental scans and storage allocation need only the committed prefix.
    // Ordinary consumers resolve or capture length instead.
    static minimumLength(array, operationContext) {
        const state = ArrayView.#stateOf(array, operationContext)
        return state.minimum ?? state
    }

    static readyLength(array, operationContext) {
        const state = ArrayView.#stateOf(array, operationContext)
        return typeof state === "number" ? state : undefined
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
    static prepareIndexCreation(array, key, operationContext, writeBack) {
        if (!isArrayIndex(key)) return
        const length = Number(key) + 1
        if (length <= ArrayView.minimumLength(array, operationContext)) return
        return () => {
            const view = metadata.metaOf(array, operationContext)?.arrayView
            if (view) {
                const state = view.#lengthState
                if (typeof state === "number") view._lengthState = Math.max(state, length)
                else state.grow(length)
            } else if (!writeBack) ArrayView.#setState(array, length, operationContext)
        }
    }

    // Container copying transfers shape as well as placements. Earlier growth
    // outcomes are shared, but each copy owns its subsequent length history.
    static copyShape(source, destination, operationContext) {
        const state = ArrayView.#stateOf(source, operationContext)
        const copy = typeof state === "number" ? state : state.fork()
        if (copy !== ArrayView.minimumLength(destination, operationContext))
            ArrayView.#setState(destination, copy, operationContext)
    }

    static requiresMaterialization(value, operationContext) {
        // Sharing and leases use ordinary COW; this checks representation only.
        const view = ArrayView.projectionOf(value, operationContext)
        return isArrayView(view, operationContext) && (view === value ||
            view.#minimumLength !== ArrayView.#physicalLength(view._backing, operationContext))
    }

    static tryAttachTo(arrayOrArrayView, operationContext) {
        const projection = ArrayView.projectionOf(arrayOrArrayView, operationContext)
        const backing = isArrayView(projection, operationContext) ? projection._backing : projection
        if (metadata.isImported(arrayOrArrayView, operationContext) ||
            metadata.isImported(backing, operationContext) ||
            ArrayView.readyLength(arrayOrArrayView, operationContext) === undefined) return
        let view = projection
        if (!isArrayView(view, operationContext)) {
            view = new ArrayView(projection, operationContext)
            metadata.requireMeta(projection, operationContext).arrayView = view
        }
        metadata.markShared(backing, operationContext)
        return view
    }

    static tryExtendEnd(source, count, beforeWrite, operationContext) {
        if (ArrayView.readyLength(source, operationContext) === undefined) return
        const projection = ArrayView.projectionOf(source, operationContext)
        const sourceView = isArrayView(projection, operationContext) ? projection : undefined
        const backing = sourceView?._backing ?? projection
        // Check tail availability before attachment marks the backing shared.
        // An empty extension needs no physical write.
        if (count > 0) {
            const length = ArrayView.#physicalLength(backing, operationContext)
            if (sourceView && sourceView._start + sourceView.#minimumLength !== length) return
            if (length + count > 0xffffffff) return
            if (!errorUtils.runExternalAction(operationContext, () => Object.isExtensible(backing))) return
            const descriptor = errorUtils.runExternalAction(operationContext, () =>
                Object.getOwnPropertyDescriptor(backing, "length"))
            if (descriptor?.writable !== true) return
        }
        const view = ArrayView.tryAttachTo(source, operationContext)
        if (!view) return
        const next = new ArrayView(view, operationContext, 0, view.#minimumLength + count)
        beforeWrite(next)
        if (count > 0) errorUtils.runExternalAction(operationContext, () => { backing.length += count })
        return next
    }

    // Capture storage candidates now: broad ranges enumerate stored keys;
    // bounded views inspect only their range.
    static physicalKeyCandidates(array, operationContext, start = 0, end) {
        const projection = ArrayView.projectionOf(array, operationContext)
        const view = isArrayView(projection, operationContext) ? projection : undefined
        const backing = view ? view._backing : projection
        const backingLength = ArrayView.#physicalLength(backing, operationContext)
        const offset = view ? view._start : 0
        const extent = view ? view.#minimumLength : backingLength
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

    descriptor(key, operationContext) {
        if (key === "length") return {
            value: this.#minimumLength, enumerable: false, writable: true, configurable: false,
        }
        const physical = this.#physicalKey(key)
        return physical === undefined ? undefined : errorUtils.runExternalAction(
            operationContext, () => Object.getOwnPropertyDescriptor(this._backing, physical))
    }

    set(key, value, operationContext) {
        // A native owner's index write precedes its logical growth commit.
        // A distinct view writes only within its already established bounds.
        const backing = this._backing
        const physical = metadata.metaOf(backing, operationContext)?.arrayView === this && isArrayIndex(key)
            ? String(this._start + Number(key)) : this.#physicalKey(key)
        if (physical === undefined) throw new Error("Cannot write outside an ArrayView range")
        errorUtils.runExternalAction(operationContext, () => {
            if (Object.hasOwn(backing, physical)) backing[physical] = value
            else Object.defineProperty(backing, physical, {
                value, enumerable: true, writable: true, configurable: true,
            })
        })
    }

    delete(key, operationContext) {
        if (key === "length") return false
        const physical = this.#physicalKey(key)
        return physical === undefined || errorUtils.runExternalAction(
            operationContext, () => delete this._backing[physical])
    }

    get #minimumLength() {
        const state = this.#lengthState
        return state.minimum ?? state
    }

    get #lengthState() {
        // Earlier questions retain their sequence when current bounds become exact.
        const state = this._lengthState
        if (state instanceof LengthState && state.minimum === state.maximum)
            this._lengthState = state.minimum
        return this._lengthState
    }

    #physicalKey(key) {
        if (!isArrayIndex(key)) return undefined
        const state = this.#lengthState, index = Number(key)
        return index < (state.maximum ?? state) ? String(this._start + index) : undefined
    }

    static #stateOf(array, operationContext) {
        const view = metadata.metaOf(array, operationContext)?.arrayView
        return view ? view.#lengthState :
            ArrayView.#physicalLength(array, operationContext)
    }

    static #setState(array, state, operationContext) {
        let view = metadata.metaOf(array, operationContext)?.arrayView
        if (!view) {
            view = new ArrayView(array, operationContext, 0, state.minimum ?? state)
            metadata.requireMeta(array, operationContext).arrayView = view
        }
        view._lengthState = state
    }

    static #physicalLength(array, operationContext) {
        return errorUtils.runExternalAction(operationContext, () => array.length)
    }
}

function isArrayView(value, operationContext) {
    return metadata.metaOf(value, operationContext)?.arrayView === value
}

function isLogicalArray(value, operationContext) {
    return metadata.metaOf(value, operationContext)?.type === languageValues.TYPE.Array
}

function isArrayIndex(key) {
    if (typeof key !== "string" || key === "") return false
    const index = Number(key)
    return Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === key
}

function hasArrayAncestor(ancestry, array) {
    for (let current = ancestry; current; current = current.parent) {
        if (current.array === array) return true
    }
    return false
}

export { ArrayView, isArrayView, isLogicalArray, isArrayIndex, hasArrayAncestor }
