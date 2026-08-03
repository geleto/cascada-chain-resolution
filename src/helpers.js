import * as errorUtils from "./error.js"

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

export {
    findPropertyDescriptor,
    invokeDataFunctionOrPoison,
    runFatal,
}
