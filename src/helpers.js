import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"

function runFatal(fn, value = undefined) {
    try {
        return fn(value)
    } catch (error) {
        return errorUtils.reportFatalError(error)
    }
}

function invokeDataFunctionOrPoison(callable, thisValue, args) {
    try {
        return Reflect.apply(callable, thisValue, args)
    } catch (error) {
        return errorUtils.toPoison(error)
    }
}

function findPropertyDescriptor(object, key) {
    try {
        let owner = object
        while (owner !== null) {
            const descriptor = Object.getOwnPropertyDescriptor(owner, key)
            if (descriptor) return { descriptor, owner }
            owner = Object.getPrototypeOf(owner)
        }
        return undefined
    } catch (error) {
        return errorUtils.toPoison(error)
    }
}

function hasDefinedProtocol(value, protocol) {
    if (
        value === null ||
        (
            typeof value !== "object" &&
            typeof value !== "function"
        )
    ) {
        return false
    }
    const entry = findPropertyDescriptor(value, protocol)
    if (languageValues.isError(entry)) return entry
    const descriptor = entry?.descriptor
    return descriptor !== undefined &&
        (!("value" in descriptor) || descriptor.value !== undefined)
}

export {
    findPropertyDescriptor,
    hasDefinedProtocol,
    invokeDataFunctionOrPoison,
    runFatal,
}
