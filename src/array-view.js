import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

class ArrayView {
    constructor(arrayOrArrayView, start = 0, end) {
        const source = projectionOf(arrayOrArrayView)
        const sourceView = isArrayView(source) ? source : undefined
        const sourceStart = sourceView?._start ?? 0
        Object.defineProperties(this, {
            _backing: { value: sourceView?._backing ?? source },
            _start: { value: sourceStart + start },
            _end: {
                value: sourceStart + (
                    end === undefined ? source.length : end
                ),
                writable: true,
            },
        })
    }

    static tryAttachTo(arrayOrArrayView) {
        const projection = projectionOf(arrayOrArrayView)
        const backing = backingOf(projection)
        if (
            metadata.importBoundaryOf(arrayOrArrayView) ||
            metadata.importBoundaryOf(backing)
        ) return undefined
        if (isArrayView(projection)) return projection

        const view = new ArrayView(projection)
        metadata.ensureMeta(projection).arrayView = view
        return view
    }

    static canGrowEnd(source, count) {
        if (count === 0) return true
        const projection = projectionOf(source)
        const backing = backingOf(projection)
        if (
            isArrayView(projection) &&
            projection._end !== backing.length
        ) return false
        if (backing.length + count > 0xffffffff) return false
        return Object.getOwnPropertyDescriptor(backing, "length").writable
    }

    static tryExtendEnd(source, count, beforeWrite) {
        if (!ArrayView.canGrowEnd(source, count)) return
        const view = ArrayView.tryAttachTo(source)
        if (!view) return
        const next = new ArrayView(view, 0, view.length + count)
        beforeWrite(next)
        if (count > 0) view._backing.length += count
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

    has(key) {
        if (key === "length") return true
        const physical = this.#physicalKey(key)
        return physical !== undefined &&
            propertyIsEnumerable.call(this._backing, physical)
    }

    get(key) {
        if (key === "length") return this.length
        const physical = this.#physicalKey(key)
        return physical !== undefined &&
            propertyIsEnumerable.call(this._backing, physical)
            ? this._backing[physical]
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
            : Object.getOwnPropertyDescriptor(
                this._backing,
                physical,
            )
    }

    set(key, value) {
        if (key === "length") {
            if (!this.setLength(value)) {
                errorUtils.reportFatalError(
                    new Error("ArrayView growth requires materialization"),
                )
            }
            return
        }
        const physical = this.#physicalKey(key)
        if (physical === undefined) {
            errorUtils.reportFatalError(
                new Error("Cannot write outside an ArrayView range"),
            )
        }
        const backing = this._backing
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
    }

    delete(key) {
        if (key === "length") return false
        const physical = this.#physicalKey(key)
        return physical === undefined || delete this._backing[physical]
    }

    keys() {
        return enumerableArrayKeys(this)
    }

    setLength(length) {
        const growth = length - this.length
        if (growth > 0) {
            if (!ArrayView.canGrowEnd(this, growth)) return false
            this._backing.length += growth
        }
        this._end = this._start + length
        return true
    }

    *[Symbol.iterator]() {
        for (let index = 0; index < this.length; index++) {
            yield this.get(String(index))
        }
    }
}

languageValues.registerDataClass(ArrayView)

function isArrayView(value) {
    return value instanceof ArrayView
}

function isLogicalArray(value) {
    return Array.isArray(value) || isArrayView(value)
}

function hasArrayAncestor(ancestry, array) {
    for (let current = ancestry; current; current = current.parent) {
        if (current.array === array) return true
    }
    return false
}

function attachedViewOf(value) {
    return Array.isArray(value)
        ? metadata.metaOf(value)?.arrayView
        : undefined
}

function projectionOf(value) {
    if (isArrayView(value)) return value
    return attachedViewOf(value) ?? value
}

function backingOf(value) {
    const projection = projectionOf(value)
    return isArrayView(projection)
        ? projection._backing
        : projection
}

function logicalArrayLength(value) {
    return projectionOf(value).length
}

function requiresArrayMaterialization(value) {
    return isArrayView(projectionOf(value))
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
function enumerableArrayKeys(arrayOrView, start = 0, end = undefined) {
    const projection = projectionOf(arrayOrView)
    const view = isArrayView(projection) ? projection : undefined
    const backing = view ? view._backing : projection
    const backingLength = backing.length
    const origin = view ? view._start : 0
    const extent = view ? view.length : backingLength
    start = origin + Math.max(0, start)
    end = origin + Math.min(extent, end ?? extent)

    // Avoid inherited numeric setters while preserving numeric key order.
    const keys = Object.create(null)
    if (start === 0 && end === backingLength) {
        for (const key of Object.keys(backing)) {
            if (isArrayIndex(key) && Number(key) < end) keys[key] = true
        }
    } else {
        for (let index = start; index < end; index++) {
            if (propertyIsEnumerable.call(backing, index)) {
                keys[index - origin] = true
            }
        }
    }
    return Object.keys(keys)
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
