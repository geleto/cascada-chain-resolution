import * as errorUtils from "./error.js"
import * as invocation from "./invocation.js"
import * as languageValues from "./language-values.js"
import { STRING_METHODS } from "./string-methods.js"

const regexpSourceGetter = Object.getOwnPropertyDescriptor(
    RegExp.prototype,
    "source",
).get

function getStandardStringMethod(method, callable) {
    const definition = STRING_METHODS[method]
    return definition?.intrinsic === callable ? definition : undefined
}

function invokeStringObservationMethod(thisValue, definition, args) {
    return invocation.invokeObservationMethodWithExportedArgs(
        definition.intrinsic,
        thisValue,
        args,
        preparedArgs => validateStringDispatch(
            definition.protocol,
            preparedArgs[0],
        ),
    )
}

function validateStringDispatch(protocol, value) {
    if (!protocol || value === null || value === undefined) return undefined
    const type = typeof value
    if (type !== "object" && type !== "function") return undefined

    const entry = invocation.findPropertyDescriptor(value, protocol)
    if (languageValues.isError(entry)) return entry
    if (
        !entry ||
        (
            "value" in entry.descriptor &&
            entry.descriptor.value === undefined
        )
    ) return undefined
    if (isIntrinsicRegExpProtocol(value, entry)) return undefined
    return errorUtils.validationError(
        "Custom String dispatch protocols are unsupported",
    )
}

function isIntrinsicRegExpProtocol(value, entry) {
    try {
        Reflect.apply(regexpSourceGetter, value, [])
        const prototype = entry.owner
        const constructor = Object.getOwnPropertyDescriptor(
            prototype,
            "constructor",
        )?.value
        return "value" in entry.descriptor &&
            typeof entry.descriptor.value === "function" &&
            typeof constructor === "function" &&
            languageValues.isPlainObjectPrototype(
                Object.getPrototypeOf(prototype),
            ) &&
            Object.getOwnPropertyDescriptor(
                constructor,
                "prototype",
            )?.value === prototype
    } catch {
        return false
    }
}

export {
    getStandardStringMethod,
    invokeStringObservationMethod,
}
