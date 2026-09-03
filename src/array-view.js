import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

// An Array operand or backing may be a Proxy, so physical reflection and
// writes can invoke its traps.
class ArrayView {
    constructor(arrayOrArrayView, operationContext, start = 0, end) {
        languageValues.admitValue(arrayOrArrayView, operationContext)
        const source = projectionOf(arrayOrArrayView, operationContext)
        const sourceView = isArrayView(source, operationContext) ? source : undefined
        const sourceStart = sourceView?._start ?? 0
        if (end === undefined) {
            end = sourceView ? sourceView.length : physicalArrayLength(source)
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
            languageValues.TYPE_ARRAY,
        )
        metadata.requireMeta(this, operationContext).arrayView = this
    }

    static tryAttachTo(arrayOrArrayView, operationContext) {
        const projection = projectionOf(arrayOrArrayView, operationContext)
        const backing = backingOf(projection, operationContext)
        if (
            metadata.isImported(arrayOrArrayView, operationContext) ||
            metadata.isImported(backing, operationContext)
        ) return undefined
        if (isArrayView(projection, operationContext)) return projection

        const view = new ArrayView(projection, operationContext)
        metadata.requireMeta(projection, operationContext).arrayView = view
        return view
    }

    static canGrowEnd(source, count, operationContext) {
        if (count === 0) return true
        const projection = projectionOf(source, operationContext)
        const backing = backingOf(projection, operationContext)
        const backingLength = physicalArrayLength(backing)
        if (
            isArrayView(projection, operationContext) &&
            projection._end !== backingLength
        ) return false
        if (backingLength + count > 0xffffffff) return false
        if (!errorUtils.runUserCode(
            () => Object.isExtensible(backing),
        )) return false
        const descriptor = errorUtils.runUserCode(
            () => Object.getOwnPropertyDescriptor(backing, "length"),
        )
        return descriptor?.writable === true
    }

    static tryExtendEnd(source, count, beforeWrite, operationContext) {
        if (!ArrayView.canGrowEnd(source, count, operationContext)) return
        const view = ArrayView.tryAttachTo(source, operationContext)
        if (!view) return
        const next = new ArrayView(view, operationContext, 0, view.length + count)
        beforeWrite(next)
        if (count > 0) extendPhysicalArray(view._backing, count)
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

    get(key) {
        if (key === "length") return this.length
        const descriptor = this.descriptor(key)
        return isDataPlacement(descriptor)
            ? descriptor.value
            : undefined
    }

    descriptor(key) {
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
            : errorUtils.runUserCode(
                () => Object.getOwnPropertyDescriptor(
                    this._backing,
                    physical,
                ),
            )
    }

    set(key, value) {
        if (key === "length") {
            if (!this.setLength(value)) {
                throw new Error("ArrayView growth requires materialization")
            }
            return
        }
        const physical = this.#physicalKey(key)
        if (physical === undefined) {
            throw new Error("Cannot write outside an ArrayView range")
        }
        const backing = this._backing
        errorUtils.runUserCode(() => {
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

    delete(key) {
        if (key === "length") return false
        const physical = this.#physicalKey(key)
        return physical === undefined || errorUtils.runUserCode(
            () => delete this._backing[physical],
        )
    }

    keys() {
        return enumerableProjectedArrayKeys(this)
    }

    setLength(length) {
        const growth = length - this.length
        if (growth > 0) {
            // The view itself is already the resolved internal projection.
            if (!this.#canGrowEnd(growth)) return false
            extendPhysicalArray(this._backing, growth)
        }
        this._end = this._start + length
        return true
    }

    #canGrowEnd(count) {
        if (count === 0) return true
        const backingLength = physicalArrayLength(this._backing)
        if (this._end !== backingLength) return false
        if (backingLength + count > 0xffffffff) return false
        if (!errorUtils.runUserCode(() => Object.isExtensible(this._backing))) {
            return false
        }
        const descriptor = errorUtils.runUserCode(
            () => Object.getOwnPropertyDescriptor(this._backing, "length"),
        )
        return descriptor?.writable === true
    }

    *[Symbol.iterator]() {
        for (let index = 0; index < this.length; index++) {
            yield this.get(String(index))
        }
    }
}

function isArrayView(value, operationContext) {
    return metadata.metaOf(value, operationContext)?.arrayView === value
}

function isLogicalArray(value, operationContext) {
    return metadata.metaOf(value, operationContext)?.type ===
        languageValues.TYPE_ARRAY
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

function physicalArrayLength(array) {
    return errorUtils.runUserCode(() => array.length)
}

function extendPhysicalArray(array, count) {
    errorUtils.runUserCode(() => {
        array.length += count
    })
}

function logicalArrayLength(value, operationContext) {
    const projection = projectionOf(value, operationContext)
    return isArrayView(projection, operationContext)
        ? projection.length
        : physicalArrayLength(projection)
}

function requiresArrayMaterialization(value, operationContext) {
    return isArrayView(projectionOf(value, operationContext), operationContext)
}

function isArrayIndex(key) {
    if (typeof key !== "string" || key === "") return false
    const index = Number(key)
    return Number.isInteger(index) &&
        index >= 0 &&
        index < 0xffffffff &&
        String(index) === key
}

// Logical keys of a logical Array range. A range spanning the complete
// backing pays only for present keys; a strict subrange inspects exactly its
// selected indexes, so its cost may include the selected holes.
function enumerableArrayKeys(
    arrayOrView,
    operationContext,
    start = 0,
    end = undefined,
) {
    return enumerableProjectedArrayKeys(
        projectionOf(arrayOrView, operationContext),
        start,
        end,
    )
}

function enumerableProjectedArrayKeys(projection, start = 0, end = undefined) {
    const view = projection instanceof ArrayView ? projection : undefined
    const backing = view ? view._backing : projection
    const backingLength = physicalArrayLength(backing)
    const offset = view ? view._start : 0
    const extent = view ? view.length : backingLength
    start = offset + Math.max(0, start)
    end = offset + Math.min(extent, end ?? extent)

    // Avoid inherited numeric setters while preserving numeric key order.
    const keys = Object.create(null)
    if (start === 0 && end === backingLength) {
        const ownKeys = errorUtils.runUserCode(
            () => Reflect.ownKeys(backing),
        )
        for (const key of ownKeys) {
            if (!isArrayIndex(key) || Number(key) >= end) continue
            const descriptor = errorUtils.runUserCode(
                () => Object.getOwnPropertyDescriptor(backing, key),
            )
            if (isDataPlacement(descriptor)) {
                keys[key] = true
            }
        }
    } else {
        for (let index = start; index < end; index++) {
            const descriptor = errorUtils.runUserCode(
                () => Object.getOwnPropertyDescriptor(backing, String(index)),
            )
            if (isDataPlacement(descriptor)) {
                keys[index - offset] = true
            }
        }
    }
    return Object.keys(keys)
}

function isDataPlacement(descriptor) {
    return descriptor?.enumerable === true && "value" in descriptor
}

export {
    ArrayView,
    backingOf,
    enumerableArrayKeys,
    hasArrayAncestor,
    isArrayIndex,
    isArrayView,
    isLogicalArray,
    logicalArrayLength,
    projectionOf,
    requiresArrayMaterialization,
}
