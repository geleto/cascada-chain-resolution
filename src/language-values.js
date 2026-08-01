const DATA_CLASS_PROTOTYPES = new WeakSet()

function registerDataClass(DataClass) {
    DATA_CLASS_PROTOTYPES.add(DataClass.prototype)
}

function isPromise(value) {
    return (
        value !== null &&
        (typeof value === "object" || typeof value === "function") &&
        typeof value.then === "function"
    )
}

function isError(value) {
    return value instanceof Error
}

function isTracked(value) {
    if (
        value === null ||
        typeof value !== "object" ||
        isPromise(value) ||
        isError(value)
    ) return false
    if (Array.isArray(value)) return true

    const prototype = Object.getPrototypeOf(value)
    return prototype === null ||
        prototype === Object.prototype ||
        isPlainObjectPrototype(prototype) ||
        DATA_CLASS_PROTOTYPES.has(prototype)
}

function isPlainObjectPrototype(prototype) {
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

export {
    isError,
    isPlainObjectPrototype,
    isPromise,
    isTracked,
    registerDataClass,
}
