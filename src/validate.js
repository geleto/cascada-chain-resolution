const {
    forbiddenKeyError,
    reportFatalError,
    validationError,
} = require("./error")

const hasOwn = Object.prototype.hasOwnProperty
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

function assertMutationPath(path) {
    for (const key of path) {
        if (key === "__proto__") reportFatalError(forbiddenKeyError())
    }
}

// Language data is own enumerable string keys only. Reads treat __proto__ and
// own non-enumerable properties as missing; mutations through them are fatal.
function assertCanMutateLanguageProperty(parent, key, importContext = undefined) {
    if (key === "__proto__") {
        reportFatalError(forbiddenKeyError(importContext))
    }
    if (hasOwn.call(parent, key) && !propertyIsEnumerable.call(parent, key)) {
        reportFatalError(validationError(
            "Cannot mutate non-enumerable property",
            importContext,
        ))
    }
}

// Attached-edge commit assumes the physical mutation cannot fail. Check the
// descriptor before candidate preparation can publish any imported state.
function assertCanSetLanguageProperty(parent, key, importContext = undefined) {
    assertCanMutateLanguageProperty(parent, key, importContext)

    let owner = parent
    let descriptor
    while (owner && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(owner, key)
        if (!descriptor) owner = Object.getPrototypeOf(owner)
    }

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
    assertCanMutateLanguageProperty(parent, key, importContext)
    const descriptor = Object.getOwnPropertyDescriptor(parent, key)
    if (descriptor && !descriptor.configurable) {
        reportFatalError(validationError(
            "Cannot delete non-configurable property",
            importContext,
        ))
    }
}

module.exports = {
    assertCanDeleteLanguageProperty,
    assertCanMutateLanguageProperty,
    assertCanSetLanguageProperty,
    assertMutationPath,
}
