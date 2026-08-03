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

    static attachTo(array) {
        const attached = attachedViewOf(array)
        if (attached) return attached

        const view = new ArrayView(array)
        metadata.ensureMeta(array).arrayView = view
        return view
    }

    static canExtendBacking(source, atStart, count) {
        const backing = backingOf(source)
        if (backing.length + count > 0xffffffff) return false
        if (count === 0) return true
        if (
            !Object.isExtensible(backing) ||
            !Object.getOwnPropertyDescriptor(backing, "length").writable
        ) return false

        if (atStart) {
            for (const key of Object.getOwnPropertyNames(backing)) {
                if (!isArrayIndex(key)) continue
                const descriptor = Object.getOwnPropertyDescriptor(backing, key)
                if (
                    !("value" in descriptor) ||
                    !descriptor.writable ||
                    !descriptor.configurable
                ) return false
            }
        }

        const first = atStart ? 0 : backing.length
        const last = backing.length + count
        // Native Array mutation must not observe inherited indexed properties.
        for (
            let prototype = Object.getPrototypeOf(backing);
            prototype !== null;
            prototype = Object.getPrototypeOf(prototype)
        ) {
            for (const key of Object.getOwnPropertyNames(prototype)) {
                if (!isArrayIndex(key)) continue
                const index = Number(key)
                if (index >= first && index < last) return false
            }
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

    canExtend(atStart) {
        const { array, baseIndex } = this._storage
        return atStart
            ? this._start + baseIndex === 0
            : this._end + baseIndex === array.length
    }

    extend(atStart, values, beforeWrite) {
        const count = values.length
        const next = new ArrayView(
            this,
            atStart ? -count : 0,
            atStart ? this.length : this.length + count,
        )
        if (count === 0) return next

        beforeWrite(next)
        const storage = this._storage
        if (atStart) {
            Array.prototype.unshift.apply(storage.array, values)
            storage.baseIndex += count
        } else {
            Array.prototype.push.apply(storage.array, values)
        }
        return next
    }

    contract(atStart) {
        return new ArrayView(
            this,
            atStart ? Math.min(1, this.length) : 0,
            atStart ? this.length : Math.max(0, this.length - 1),
        )
    }

    canGrowEnd(count) {
        const backing = this._storage.array
        return this.canExtend(false) &&
            backing.length + count <= 0xffffffff &&
            Object.getOwnPropertyDescriptor(backing, "length").writable
    }

    canAssignEnd(count) {
        return this.canGrowEnd(count) &&
            Object.isExtensible(this._storage.array)
    }

    setLength(length) {
        const growth = length - this.length
        if (growth > 0) {
            if (!this.canGrowEnd(growth)) return false
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
