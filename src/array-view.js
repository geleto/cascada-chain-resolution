import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

// An Array operand or backing may be a Proxy, so physical reflection and
// writes can invoke its traps.
class ArrayView {
    constructor(arrayOrArrayView, operationContext, start = 0, end) {
        languageValues.admitReadyValue(arrayOrArrayView, operationContext)
        const source = projectionOf(arrayOrArrayView, operationContext)
        const sourceView = isArrayView(source, operationContext) ? source : undefined
        const sourceStart = sourceView?._start ?? 0
        if (end === undefined) {
            end = sourceView
                ? sourceView.length
                : physicalArrayLength(source, operationContext)
        }
        Object.defineProperties(this, {
            _backing: { value: sourceView?._backing ?? source },
            _start: { value: sourceStart + start },
            _end: {
                value: sourceStart + end,
                writable: true,
            },
        })
        languageValues.admitReadyValue(
            this,
            operationContext,
            languageValues.TYPE.Array,
        )
        metadata.requireMeta(this, operationContext).arrayView = this
    }

    static tryAttachTo(arrayOrArrayView, operationContext) {
        const projection = projectionOf(arrayOrArrayView, operationContext)
        const backing = backingOf(projection, operationContext)
        if (
            metadata.isImported(arrayOrArrayView, operationContext) ||
            metadata.isImported(backing, operationContext) ||
            !hasPhysicalArrayLength(arrayOrArrayView, operationContext)
        ) return undefined
        if (isArrayView(projection, operationContext)) return projection

        const view = new ArrayView(projection, operationContext)
        metadata.requireMeta(projection, operationContext).arrayView = view
        return view
    }

    static canGrowEnd(source, count, operationContext) {
        if (!hasPhysicalArrayLength(source, operationContext)) return false
        return canGrowBacking(projectionOf(source, operationContext), count, operationContext)
    }

    static tryExtendEnd(source, count, beforeWrite, operationContext) {
        if (!ArrayView.canGrowEnd(source, count, operationContext)) return
        const view = ArrayView.tryAttachTo(source, operationContext)
        if (!view) return
        const next = new ArrayView(view, operationContext, 0, view.length + count)
        beforeWrite(next)
        if (count > 0)
            extendPhysicalArray(view._backing, count, operationContext)
        return next
    }

    get length() {
        return this._end - this._start
    }

    #physicalKey(key) {
        if (!isArrayIndex(key)) return undefined
        const index = Number(key)
        if (index >= this.length) return undefined
        return String(this._start + index)
    }

    descriptor(key, operationContext) {
        if (key === "length") {
            return {
                value: this.length,
                enumerable: false,
                writable: true,
                configurable: false,
            }
        }
        const physical = this.#physicalKey(key)
        return physical === undefined
            ? undefined
            : errorUtils.runExternalAction(operationContext, () => Object.getOwnPropertyDescriptor(
                this._backing,
                physical,
            ),
              )
    }

    set(key, value, operationContext) {
        if (key === "length") {
            if (!this.setLength(value, operationContext)) {
                throw new Error("ArrayView growth requires materialization")
            }
            return
        }
        const physical = this.#physicalKey(key)
        if (physical === undefined) {
            throw new Error("Cannot write outside an ArrayView range")
        }
        const backing = this._backing
        errorUtils.runExternalAction(operationContext, () => {
            if (Object.hasOwn(backing, physical)) {
                backing[physical] = value
            } else {
                Object.defineProperty(backing, physical, {
                    value,
                    enumerable: true,
                    writable: true,
                    configurable: true,
                })
            }
        })
    }

    delete(key, operationContext) {
        if (key === "length") return false
        const physical = this.#physicalKey(key)
        return (
            physical === undefined ||
            errorUtils.runExternalAction(
                operationContext,
                () => delete this._backing[physical],
            )
        )
    }

    setLength(length, operationContext) {
        const growth = length - this.length
        if (growth > 0) {
            // The view itself is already the resolved internal projection.
            if (!canGrowBacking(this, growth, operationContext)) return false
            extendPhysicalArray(this._backing, growth, operationContext)
        }
        this._end = this._start + length
        const meta = metadata.requireMeta(this, operationContext)
        meta.arrayLength = length
        if (meta.retainedPrefixLength > length) meta.retainedPrefixLength = length
        return true
    }
}

// Check physical capacity on an already resolved projection. Logical shape
// and imported-data protection remain the responsibility of its caller.
function canGrowBacking(projection, count, operationContext) {
    if (count === 0) return true
    const view = isArrayView(projection, operationContext) ? projection : undefined
    const backing = view ? view._backing : projection
    const length = physicalArrayLength(backing, operationContext)
    if (view && view._end !== length) return false
    if (length + count > 0xffffffff) return false
    if (!errorUtils.runExternalAction(operationContext, () => Object.isExtensible(backing))) return false
    const descriptor = errorUtils.runExternalAction(operationContext, () =>
        Object.getOwnPropertyDescriptor(backing, "length"))
    return descriptor?.writable === true
}

function isArrayView(value, operationContext) {
    return metadata.metaOf(value, operationContext)?.arrayView === value
}

function isLogicalArray(value, operationContext) {
    return metadata.metaOf(value, operationContext)?.type ===
        languageValues.TYPE.Array
}

function hasArrayAncestor(ancestry, array) {
    for (let current = ancestry; current; current = current.parent) {
        if (current.array === array) return true
    }
    return false
}

function attachedViewOf(value, operationContext) {
    return Array.isArray(value)
        ? metadata.metaOf(value, operationContext)?.arrayView
        : undefined
}

function projectionOf(value, operationContext) {
    if (isArrayView(value, operationContext)) return value
    return attachedViewOf(value, operationContext) ?? value
}

function backingOf(value, operationContext) {
    const projection = projectionOf(value, operationContext)
    return isArrayView(projection, operationContext)
        ? projection._backing
        : projection
}

function physicalArrayLength(array, operationContext) {
    return errorUtils.runExternalAction(operationContext, () => array.length)
}

function extendPhysicalArray(array, count, operationContext) {
    errorUtils.runExternalAction(operationContext, () => {
        array.length += count
    })
}

function publishedArrayLength(value, operationContext) {
    const length = metadata.metaOf(value, operationContext)?.arrayLength
    return length?.minimum ?? length ?? storedArrayLength(value, operationContext)
}

function storedArrayLength(value, operationContext) {
    const projection = projectionOf(value, operationContext)
    return isArrayView(projection, operationContext)
        ? projection.length
        : physicalArrayLength(projection, operationContext)
}

function hasPhysicalArrayLength(value, operationContext) {
    const length = metadata.metaOf(value, operationContext)?.arrayLength
    return length === undefined || (length?.minimum ?? length) === storedArrayLength(value, operationContext) &&
        (length?.maximum === undefined || length.maximum === length.minimum)
}

function requiresArrayMaterialization(value, operationContext) {
    if (isArrayView(projectionOf(value, operationContext), operationContext)) return true
    const length = metadata.metaOf(value, operationContext)?.arrayLength
    if (length === undefined) return false
    const minimum = length.minimum ?? length
    // Pending growth lives in logical placements; it needs no storage copy.
    // Resolved shape must match storage before native representation is reused.
    return (length.maximum ?? minimum) === minimum && minimum !== storedArrayLength(value, operationContext)
}

function isArrayIndex(key) {
    if (typeof key !== "string" || key === "") return false
    const index = Number(key)
    return Number.isInteger(index) &&
        index >= 0 &&
        index < 0xffffffff &&
        String(index) === key
}

// Broad ranges enumerate stored indexes; bounded views inspect only their
// selected indexes, yielding holes lazily without a dense key allocation.
function* physicalArrayKeyCandidates(arrayOrView, operationContext, start = 0, end) {
    const projection = projectionOf(arrayOrView, operationContext)
    const view = isArrayView(projection, operationContext) ? projection : undefined
    const backing = view ? view._backing : projection
    const backingLength = physicalArrayLength(backing, operationContext)
    const offset = view ? view._start : 0
    const extent = view ? view.length : backingLength
    start = offset + Math.max(0, start)
    end = offset + Math.min(extent, end ?? extent)

    if (extent === backingLength && offset === 0 && end - start >= backingLength / 2) {
        const ownKeys = errorUtils.runExternalAction(operationContext, () =>
            Reflect.ownKeys(backing),
        )
        // Proxies may list indexes out of order; logical Arrays use index order.
        const keys = Object.create(null)
        for (const key of ownKeys) {
            if (!isArrayIndex(key) || Number(key) < start || Number(key) >= end) continue
            keys[String(Number(key) - offset)] = true
        }
        yield* Object.keys(keys)
    } else {
        for (let index = start; index < end; index++) {
            yield String(index - offset)
        }
    }
}

export {
    ArrayView,
    physicalArrayKeyCandidates,
    backingOf,
    hasArrayAncestor,
    isArrayIndex,
    isArrayView,
    isLogicalArray,
    publishedArrayLength,
    projectionOf,
    requiresArrayMaterialization,
}
