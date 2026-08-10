import * as errorUtils from "./error.js"

const DATA_CLASS_PROTOTYPES = new WeakSet()

function registerDataClass(DataClass) {
    DATA_CLASS_PROTOTYPES.add(DataClass.prototype)
}

function isPromise(value) {
    return (
        value !== null &&
        (typeof value === "object" || typeof value === "function") &&
        typeof errorUtils.runUserCode(() => value.then) === "function"
    )
}

function isError(value) {
    return Error.isError(value)
}

function isTracked(value) {
    if (
        value === null ||
        typeof value !== "object" ||
        isPromise(value) ||
        isError(value)
    ) return false
    if (Array.isArray(value)) return true

    const prototype = errorUtils.runUserCode(
        () => Object.getPrototypeOf(value),
    )
    return prototype === null ||
        prototype === Object.prototype ||
        isPlainObjectPrototype(prototype) ||
        DATA_CLASS_PROTOTYPES.has(prototype)
}

function isPlainObjectPrototype(prototype) {
    if (prototype === null) return false
    if (errorUtils.runUserCode(
        () => Object.getPrototypeOf(prototype),
    ) !== null) return false
    const constructor = errorUtils.runUserCode(
        () => Object.getOwnPropertyDescriptor(prototype, "constructor"),
    )?.value
    return typeof constructor === "function" &&
        errorUtils.runUserCode(
            () => Object.getOwnPropertyDescriptor(constructor, "prototype"),
        )?.value === prototype
}

export {
    isError,
    isPlainObjectPrototype,
    isPromise,
    isTracked,
    registerDataClass,
}
