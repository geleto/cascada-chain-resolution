import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

const ARRAY_VIEW_BRAND = new WeakSet()
const BASE_INDEX = Symbol("ArrayView._baseIndex")
const hasOwn = Object.prototype.hasOwnProperty
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

class ArrayView {
    constructor(array, start, end) {
        Object.defineProperties(this, {
            _array: { value: array, writable: true },
            _start: { value: start, writable: true },
            _end: { value: end, writable: true },
        })
        ARRAY_VIEW_BRAND.add(this)
    }

    static attachTo(array) {
        const attached = attachedViewOf(array)
        if (attached) return attached
        if (
            !Object.isExtensible(array) ||
            Object.getOwnPropertyDescriptor(
                array,
                "length",
            )?.writable !== true
        ) {
            return undefined
        }
        if (!hasOwn.call(array, BASE_INDEX)) {
            Object.defineProperty(array, BASE_INDEX, {
                value: 0,
                enumerable: false,
                writable: true,
                configurable: false,
            })
        }
        const view = new ArrayView(array, 0, array.length)
        metadata.ensureMeta(array).arrayView = view
        return view
    }

    static canExtendBacking(source, atStart, count) {
        const projection = projectionOf(source)
        const backing = isArrayView(projection)
            ? projection._array
            : projection
        if (backing.length + count > 0xffffffff) {
            return false
        }
        if (count === 0) return true
        if (
            !Object.isExtensible(backing) ||
            Object.getOwnPropertyDescriptor(
                backing,
                "length",
            )?.writable !== true
        ) {
            return false
        }
        if (atStart) {
            for (const key of Object.getOwnPropertyNames(backing)) {
                if (!isArrayIndex(key)) continue
                const descriptor = Object.getOwnPropertyDescriptor(backing, key)
                if (
                    !descriptor ||
                    !("value" in descriptor) ||
                    !descriptor.writable ||
                    !descriptor.configurable
                ) {
                    return false
                }
            }
        }

        const first = atStart ? 0 : backing.length
        const last = backing.length + count
        let prototype = Object.getPrototypeOf(backing)
        while (prototype !== null) {
            for (const key of Object.getOwnPropertyNames(prototype)) {
                if (!isArrayIndex(key)) continue
                const index = Number(key)
                if (index >= first && index < last) return false
            }
            prototype = Object.getPrototypeOf(prototype)
        }
        return true
    }

    get length() {
        return this._end - this._start
    }

    #physicalKey(key) {
        if (!isArrayIndex(key)) return key
        const index = Number(key)
        if (index >= this.length) return undefined
        return String(this._start + index + this._array[BASE_INDEX])
    }

    has(key) {
        if (key === "length") return true
        const physical = this.#physicalKey(key)
        return physical !== undefined &&
            propertyIsEnumerable.call(this._array, physical)
    }

    get(key) {
        if (key === "length") return this.length
        const physical = this.#physicalKey(key)
        return physical !== undefined &&
            propertyIsEnumerable.call(this._array, physical)
            ? this._array[physical]
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
        if (physical === undefined) return undefined
        const descriptor = Object.getOwnPropertyDescriptor(
            this._array,
            physical,
        )
        return descriptor
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
        if (hasOwn.call(this._array, physical)) {
            this._array[physical] = value
            return
        }
        Object.defineProperty(this._array, physical, {
            value,
            enumerable: true,
            writable: true,
            configurable: true,
        })
    }

    delete(key) {
        if (key === "length") return false
        const physical = this.#physicalKey(key)
        return physical === undefined || delete this._array[physical]
    }

    keys() {
        const base = this._array[BASE_INDEX]
        const physicalStart = this._start + base
        const physicalEnd = this._end + base
        const indexKeys = []
        const otherKeys = []
        for (const key of Object.keys(this._array)) {
            if (!isArrayIndex(key)) {
                otherKeys.push(key)
                continue
            }
            const physical = Number(key)
            if (physical >= physicalStart && physical < physicalEnd) {
                indexKeys.push(String(physical - physicalStart))
            }
        }
        return [...indexKeys, ...otherKeys]
    }

    canExtend(atStart) {
        return atStart
            ? this._start + this._array[BASE_INDEX] === 0
            : this._end + this._array[BASE_INDEX] === this._array.length
    }

    extend(atStart, values, beforeWrite) {
        const next = new ArrayView(this._array, this._start, this._end)
        beforeWrite(next)
        if (atStart) {
            Array.prototype.unshift.apply(this._array, values)
            this._array[BASE_INDEX] += values.length
            next._start -= values.length
        } else {
            Array.prototype.push.apply(this._array, values)
            next._end += values.length
        }
        return next
    }

    contract(atStart) {
        return new ArrayView(
            this._array,
            atStart ? Math.min(this._start + 1, this._end) : this._start,
            atStart ? this._end : Math.max(this._start, this._end - 1),
        )
    }

    canGrowEnd(count) {
        return this.canExtend(false) &&
            this._array.length + count <= 0xffffffff &&
            Object.getOwnPropertyDescriptor(
                this._array,
                "length",
            )?.writable === true
    }

    setLength(length) {
        const growth = length - this.length
        if (growth > 0) {
            if (!this.canGrowEnd(growth)) return false
            this._array.length += growth
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
    return ARRAY_VIEW_BRAND.has(value)
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
    const attached = attachedViewOf(value)
    return attached ?? value
}

function backingOf(value) {
    const projection = projectionOf(value)
    return isArrayView(projection) ? projection._array : projection
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
