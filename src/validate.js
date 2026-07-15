"use strict"

const {
    reportFatalError,
    validationError,
} = require("./error")

const hasOwn = Object.prototype.hasOwnProperty

// Language data is own enumerable string keys only.
function assertCanMutateLanguageProperty(parent, key, importContext = undefined) {
    const descriptor = Object.getOwnPropertyDescriptor(parent, key)
    if (descriptor && !descriptor.enumerable) {
        reportFatalError(validationError(
            "Cannot mutate non-enumerable property",
            importContext,
        ))
    }
    return descriptor
}

// Attached-edge commit assumes the physical mutation cannot fail. Check the
// descriptor before candidate preparation can publish any imported state.
function assertCanSetLanguageProperty(parent, key, importContext = undefined) {
    const descriptor = assertCanMutateLanguageProperty(
        parent,
        key,
        importContext,
    )

    if (descriptor && !("value" in descriptor)) {
        reportFatalError(validationError(
            "Cannot assign to accessor property",
            importContext,
        ))
    }
    if (descriptor && !descriptor.writable) {
        reportFatalError(validationError(
            "Cannot assign to non-writable property",
            importContext,
        ))
    }
}

function assertCanDeleteLanguageProperty(parent, key, importContext = undefined) {
    const descriptor = assertCanMutateLanguageProperty(
        parent,
        key,
        importContext,
    )
    if (descriptor && !descriptor.configurable) {
        reportFatalError(validationError(
            "Cannot delete non-configurable property",
            importContext,
        ))
    }
}

// Define missing language keys as own data properties so inherited setters,
// notably Object.prototype.__proto__, never participate in a physical write.
function writeLanguageProperty(parent, key, value) {
    if (hasOwn.call(parent, key)) {
        parent[key] = value
        return
    }
    Object.defineProperty(parent, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
    })
}

module.exports = {
    assertCanDeleteLanguageProperty,
    assertCanMutateLanguageProperty,
    assertCanSetLanguageProperty,
    writeLanguageProperty,
}
