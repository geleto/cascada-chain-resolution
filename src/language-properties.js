"use strict"

import * as errorUtils from "./error.js"

const hasOwn = Object.prototype.hasOwnProperty

// This module owns the descriptor policy for language-visible properties and
// the corresponding safe physical write operation.

// Language data is own enumerable string keys only.
function assertCanMutateLanguageProperty(parent, key, errorContext = undefined) {
    const descriptor = Object.getOwnPropertyDescriptor(parent, key)
    if (descriptor && !descriptor.enumerable) {
        errorUtils.reportFatalError(errorUtils.validationError(
            "Cannot mutate non-enumerable property",
            errorContext,
        ))
    }
    return descriptor
}

// Attached-edge commit assumes the physical mutation cannot fail. Check the
// descriptor before new-value preparation can publish any imported state.
function assertCanSetLanguageProperty(parent, key, errorContext = undefined) {
    const descriptor = assertCanMutateLanguageProperty(
        parent,
        key,
        errorContext,
    )

    if (descriptor && !("value" in descriptor)) {
        errorUtils.reportFatalError(errorUtils.validationError(
            "Cannot assign to accessor property",
            errorContext,
        ))
    }
    if (descriptor && !descriptor.writable) {
        errorUtils.reportFatalError(errorUtils.validationError(
            "Cannot assign to non-writable property",
            errorContext,
        ))
    }
}

function assertCanDeleteLanguageProperty(parent, key, errorContext = undefined) {
    const descriptor = assertCanMutateLanguageProperty(
        parent,
        key,
        errorContext,
    )
    if (descriptor && !descriptor.configurable) {
        errorUtils.reportFatalError(errorUtils.validationError(
            "Cannot delete non-configurable property",
            errorContext,
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

export {
    assertCanDeleteLanguageProperty,
    assertCanMutateLanguageProperty,
    assertCanSetLanguageProperty,
    writeLanguageProperty,
}
