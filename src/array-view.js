import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

// An Array operand or backing may be a Proxy, so physical reflection and
// writes can invoke its traps.
class ArrayView {
    constructor(arrayOrArrayView, start = 0, end) {
        languageValues.admitValue(arrayOrArrayView)
        const source = projectionOf(arrayOrArrayView)
        const sourceView = isArrayView(source) ? source : undefined
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
        languageValues.admitReadyValue(this, languageValues.TYPE_ARRAY)
        metadata.requireMeta(this).arrayView = this
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
        metadata.requireMeta(projection).arrayView = view
        return view
    }

    static canGrowEnd(source, count) {
        if (count === 0) return true
        const projection = projectionOf(source)
        const backing = backingOf(projection)
        const backingLength = physicalArrayLength(backing)
        if (
            isArrayView(projection) &&
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

    static tryExtendEnd(source, count, beforeWrite) {
        if (!ArrayView.canGrowEnd(source, count)) return
        const view = ArrayView.tryAttachTo(source)
        if (!view) return
        const next = new ArrayView(view, 0, view.length + count)
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
        return enumerableArrayKeys(this)
    }

    setLength(length) {
        const growth = length - this.length
        if (growth > 0) {
            if (!ArrayView.canGrowEnd(this, growth)) return false
            extendPhysicalArray(this._backing, growth)
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

function isArrayView(value) {
    return metadata.metaOf(value)?.arrayView === value
}

function isLogicalArray(value) {
    return metadata.metaOf(value)?.type === languageValues.TYPE_ARRAY
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

function physicalArrayLength(array) {
    return errorUtils.runUserCode(() => array.length)
}

function extendPhysicalArray(array, count) {
    errorUtils.runUserCode(() => {
        array.length += count
    })
}

function logicalArrayLength(value) {
    const projection = projectionOf(value)
    return isArrayView(projection)
        ? projection.length
        : physicalArrayLength(projection)
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
    const backingLength = physicalArrayLength(backing)
    const origin = view ? view._start : 0
    const extent = view ? view.length : backingLength
    start = origin + Math.max(0, start)
    end = origin + Math.min(extent, end ?? extent)

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
                keys[index - origin] = true
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
