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
            _storage: {
                value: sourceView
                    ? sourceView._storage
                    : { array: source, baseIndex: 0 },
            },
            _start: { value: sourceStart + start },
            _end: {
                value: sourceStart + (
                    end === undefined ? source.length : end
                ),
                writable: true,
            },
        })
    }

    static attachTo(arrayOrArrayView) {
        const projection = projectionOf(arrayOrArrayView)
        if (isArrayView(projection)) return projection

        const view = new ArrayView(projection)
        metadata.ensureMeta(projection).arrayView = view
        return view
    }

    static canGrowEnd(source, count, writesProperties = false) {
        if (count === 0) return true
        const projection = projectionOf(source)
        const backing = backingOf(projection)
        if (
            isArrayView(projection) &&
            projection._end + projection._storage.baseIndex !== backing.length
        ) return false
        if (backing.length + count > 0xffffffff) return false
        if (!Object.getOwnPropertyDescriptor(backing, "length").writable) {
            return false
        }
        return !writesProperties || Object.isExtensible(backing)
    }

    static tryExtendEnd(source, count, beforeWrite) {
        if (!ArrayView.canGrowEnd(source, count, true)) return
        return ArrayView.attachTo(source).#extendEnd(count, beforeWrite)
    }

    static tryPrepend(source, values, beforeWrite) {
        if (!ArrayView.#canPrepend(source, values.length)) return
        return ArrayView.attachTo(source).#prepend(values, beforeWrite)
    }

    static #canPrepend(source, count) {
        if (count === 0) return true
        const projection = projectionOf(source)
        const backing = backingOf(projection)
        if (
            isArrayView(projection) &&
            projection._start + projection._storage.baseIndex !== 0
        ) return false
        if (
            backing.length + count > 0xffffffff ||
            !Object.isExtensible(backing) ||
            !Object.getOwnPropertyDescriptor(backing, "length").writable
        ) return false

        for (const key of Object.getOwnPropertyNames(backing)) {
            if (!isArrayIndex(key)) continue
            const descriptor = Object.getOwnPropertyDescriptor(backing, key)
            if (
                !("value" in descriptor) ||
                !descriptor.writable ||
                !descriptor.configurable
            ) return false
        }

        // Native unshift must not observe inherited indexed properties.
        for (let index = 0; index < backing.length + count; index++) {
            if (!Object.hasOwn(backing, index) && index in backing) return false
        }
        return true
    }

    get length() {
        return this._end - this._start
    }

    #physicalKey(key) {
        if (!isArrayIndex(key)) return undefined
        const index = Number(key)
        if (index >= this.length) return undefined
        return String(
            this._start + index + this._storage.baseIndex,
        )
    }

    has(key) {
        if (key === "length") return true
        const physical = this.#physicalKey(key)
        return physical !== undefined &&
            propertyIsEnumerable.call(this._storage.array, physical)
    }

    get(key) {
        if (key === "length") return this.length
        const physical = this.#physicalKey(key)
        return physical !== undefined &&
            propertyIsEnumerable.call(this._storage.array, physical)
            ? this._storage.array[physical]
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
                this._storage.array,
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
        const backing = this._storage.array
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
        return physical === undefined || delete this._storage.array[physical]
    }

    keys() {
        const backing = this._storage.array
        const physicalStart = this._start + this._storage.baseIndex
        const physicalEnd = this._end + this._storage.baseIndex
        const keys = []
        for (const key of Object.keys(backing)) {
            if (!isArrayIndex(key)) continue
            const physical = Number(key)
            if (physical >= physicalStart && physical < physicalEnd) {
                keys.push(String(physical - physicalStart))
            }
        }
        return keys
    }

    #prepend(values, beforeWrite) {
        const count = values.length
        const next = new ArrayView(this, -count, this.length)
        beforeWrite(next)
        if (count === 0) return next
        const storage = this._storage
        Array.prototype.unshift.apply(storage.array, values)
        storage.baseIndex += count
        return next
    }

    #extendEnd(count, beforeWrite) {
        const next = new ArrayView(this, 0, this.length + count)
        beforeWrite(next)
        if (count > 0) this._storage.array.length += count
        return next
    }

    setLength(length) {
        const growth = length - this.length
        if (growth > 0) {
            if (!ArrayView.canGrowEnd(this, growth)) return false
            this._storage.array.length += growth
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
        ? projection._storage.array
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

export {
    ArrayView,
    backingOf,
    isArrayIndex,
    isArrayView,
    isLogicalArray,
    logicalArrayLength,
    projectionOf,
    requiresArrayMaterialization,
}
