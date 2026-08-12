import * as errorUtils from "./error.js"

const TYPE_ERROR = 1
const TYPE_ARRAY = 2
const TYPE_FUNCTION = 3
const TYPE_STRING = 4
const TYPE_PRIMITIVE = 5
const TYPE_RECORD = 6
const TYPE_REGISTERED = 7
const TYPE_OPAQUE = 8

const META_MAP = new WeakMap()
const REGISTERED_PROTOTYPES = new Set()

function metaOf(value) {
    return META_MAP.get(value)
}

function getOrCreateMeta(value, type = undefined) {
    let meta = META_MAP.get(value)
    if (!meta) {
        meta = type === undefined
            ? classifyMeta(value)
            : { type }
        META_MAP.set(value, meta)
    } else if (type !== undefined && meta.type !== type) {
        errorUtils.reportFatalError(
            new TypeError("Admitted type cannot change"),
        )
    }
    return meta
}

// Classification is a capability probe whose reflection can invoke Proxy
// traps. If it cannot identify a supported structure, preserving the exact
// value as opaque is always safe.
function classifyMeta(value) {
    return errorUtils.catchUserCodeFailure(
        () => errorUtils.runUserCode(() => classifyTypeFacts(value)),
        () => ({ type: TYPE_OPAQUE }),
    )
}

function classifyTypeFacts(value) {
    if (Error.isError(value)) return { type: TYPE_ERROR }
    if (Array.isArray(value)) return { type: TYPE_ARRAY }
    if (typeof value === "function") return { type: TYPE_FUNCTION }

    const prototype = Object.getPrototypeOf(value)
    if (
        prototype === null ||
        isPlainObjectPrototypeUnchecked(prototype)
    ) return { type: TYPE_RECORD, prototype }

    return REGISTERED_PROTOTYPES.has(prototype)
        ? { type: TYPE_REGISTERED, prototype }
        : { type: TYPE_OPAQUE }
}

function isPlainObjectPrototype(prototype) {
    // Prototype and descriptor reflection can invoke Proxy traps.
    return errorUtils.runUserCode(
        () => isPlainObjectPrototypeUnchecked(prototype),
    )
}

function isPlainObjectPrototypeUnchecked(prototype) {
    if (prototype === Object.prototype) return true
    if (prototype === null) return false
    if (Object.getPrototypeOf(prototype) !== null) return false
    const constructor = Object.getOwnPropertyDescriptor(
        prototype,
        "constructor",
    )?.value
    return typeof constructor === "function" &&
        Object.getOwnPropertyDescriptor(
            constructor,
            "prototype",
        )?.value === prototype
}

function registerDataClass(DataClass) {
    return errorUtils.runFatal(() => {
        if (typeof DataClass !== "function") {
            throw new TypeError(
                "registerDataClass requires a constructor",
            )
        }
        const prototype = DataClass.prototype
        if (!isObjectLike(prototype)) {
            throw new TypeError(
                "registerDataClass requires an object prototype",
            )
        }
        REGISTERED_PROTOTYPES.add(prototype)
    })
}

function isObjectLike(value) {
    return value !== null && (
        typeof value === "object" ||
        typeof value === "function"
    )
}

function requireMeta(value) {
    const meta = META_MAP.get(value)
    if (!meta) {
        errorUtils.reportFatalError(
            new TypeError("Value metadata requires prior admission"),
        )
    }
    return meta
}

// Temporary runtime-island inference retained until import reconciliation is
// unified. Type admission alone establishes no ownership.
function hasOperationalMetadata(value) {
    const meta = META_MAP.get(value)
    return meta !== undefined && Object.keys(meta).some(key => {
        return key !== "type" &&
            key !== "prototype"
    })
}

function requiresCopyOnWrite(value) {
    const meta = metaOf(value)
    return meta?.shared === true ||
        (meta?.readEnterCount ?? 0) > 0
}

function updateReadLease(value, change) {
    const meta = requireMeta(value)
    const count = meta.readEnterCount ?? 0
    const next = count + change
    if (next < 0) {
        errorUtils.reportFatalError(new Error("Read lease underflow"))
    }
    if (next === 0) delete meta.readEnterCount
    else meta.readEnterCount = next
}

function acquireReadLease(value) {
    if (!isObjectLike(value)) return () => {}
    updateReadLease(value, 1)
    return () => updateReadLease(value, -1)
}

function markShared(value) {
    if (!isObjectLike(value)) return value
    requireMeta(value).shared = true
    return value
}

// Every object reached by one import shares its import boundary.
function markImported(value, importBoundary) {
    const meta = requireMeta(value)
    meta.importBoundary ??= importBoundary
    meta.shared = true
}

function importBoundaryOf(value) {
    return metaOf(value)?.importBoundary
}

export {
    TYPE_ARRAY,
    TYPE_ERROR,
    TYPE_FUNCTION,
    TYPE_OPAQUE,
    TYPE_PRIMITIVE,
    TYPE_RECORD,
    TYPE_REGISTERED,
    TYPE_STRING,
    acquireReadLease,
    getOrCreateMeta,
    hasOperationalMetadata,
    importBoundaryOf,
    isObjectLike,
    isPlainObjectPrototype,
    markImported,
    markShared,
    metaOf,
    registerDataClass,
    requireMeta,
    requiresCopyOnWrite,
}
