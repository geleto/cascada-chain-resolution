import * as errorUtils from "./error.js"
import * as arrayViews from "./array-view.js"

const propertyIsEnumerable = Object.prototype.propertyIsEnumerable
const propertyShapeErrors = new WeakSet()

// This module owns the descriptor policy and physical access for
// language-visible properties.

// Arrays expose canonical indexes only; other tracked values expose their own
// enumerable string keys.
function isArrayLanguageKey(parent, key) {
    if (!arrayViews.isLogicalArray(parent)) return true
    key = String(key)
    return key === "length" || arrayViews.isArrayIndex(key)
}

function propertyShapeError(message, errorContext) {
    const error = errorUtils.validationError(message, errorContext)
    propertyShapeErrors.add(error)
    return error
}

function isPropertyShapeError(error) {
    return propertyShapeErrors.has(error)
}

function assertCanMutateLanguageProperty(parent, key, errorContext = undefined) {
    const descriptor = getLanguagePropertyDescriptor(parent, key)
    if (descriptor && !descriptor.enumerable) {
        throw propertyShapeError(
            "Cannot mutate non-enumerable property",
            errorContext,
        )
    }
    return descriptor
}

function getLanguagePropertyDescriptor(parent, key) {
    parent = arrayViews.projectionOf(parent)
    key = String(key)
    if (!isArrayLanguageKey(parent, key)) return undefined
    if (arrayViews.isArrayView(parent)) return parent.descriptor(key)
    return Object.getOwnPropertyDescriptor(parent, key)
}

// Validate before edge accounting; ArrayView writes are preflighted.
function assertCanCreateLanguageProperty(parent, key, errorContext) {
    parent = arrayViews.projectionOf(parent)
    if (arrayViews.isArrayView(parent)) return
    if (!Object.isExtensible(parent)) {
        throw propertyShapeError(
            "Cannot add a property to a non-extensible object",
            errorContext,
        )
    }
    if (
        Array.isArray(parent) &&
        arrayViews.isArrayIndex(key) &&
        Number(key) >= parent.length &&
        !Object.getOwnPropertyDescriptor(parent, "length").writable
    ) {
        throw propertyShapeError(
            "Cannot grow an Array with a read-only length",
            errorContext,
        )
    }
}

// Attached-edge commit assumes the physical mutation cannot fail. Check the
// descriptor before new-value preparation can publish any imported state.
function assertCanSetLanguageProperty(parent, key, errorContext = undefined) {
    const descriptor = assertCanMutateLanguageProperty(
        parent,
        key,
        errorContext,
    )
    if (!descriptor) {
        assertCanCreateLanguageProperty(parent, String(key), errorContext)
        return descriptor
    }

    if (!("value" in descriptor)) {
        throw propertyShapeError(
            "Cannot assign to accessor property",
            errorContext,
        )
    }
    if (!descriptor.writable) {
        throw propertyShapeError(
            "Cannot assign to non-writable property",
            errorContext,
        )
    }
    return descriptor
}

function assertCanUpdatePromiseProperty(parent, key, errorContext = undefined) {
    const descriptor = assertCanSetLanguageProperty(parent, key, errorContext)
    if (!descriptor) {
        throw errorUtils.validationError(
            "Cannot resolve missing Promise property",
            errorContext,
        )
    }
}

function assertCanDeleteLanguageProperty(parent, key, errorContext = undefined) {
    const descriptor = assertCanMutateLanguageProperty(
        parent,
        key,
        errorContext,
    )
    if (descriptor && !descriptor.configurable) {
        throw propertyShapeError(
            "Cannot delete non-configurable property",
            errorContext,
        )
    }
}

// Define missing language keys as own data properties so inherited setters,
// notably Object.prototype.__proto__, never participate in a physical write.
function writeLanguageProperty(parent, key, value) {
    parent = arrayViews.projectionOf(parent)
    if (arrayViews.isArrayView(parent)) {
        parent.set(String(key), value)
        return
    }
    if (Object.hasOwn(parent, key)) {
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

function readLanguageProperty(parent, key) {
    parent = arrayViews.projectionOf(parent)
    key = String(key)
    if (!isArrayLanguageKey(parent, key)) return undefined
    if (arrayViews.isArrayView(parent)) return parent.get(key)
    if (
        (Array.isArray(parent) || typeof parent === "string") &&
        key === "length"
    ) {
        return parent.length
    }
    return propertyIsEnumerable.call(parent, key) ? parent[key] : undefined
}

function hasLanguageProperty(parent, key) {
    parent = arrayViews.projectionOf(parent)
    key = String(key)
    if (!isArrayLanguageKey(parent, key)) return false
    if (arrayViews.isArrayView(parent)) return parent.has(key)
    if (
        (Array.isArray(parent) || typeof parent === "string") &&
        key === "length"
    ) return true
    return propertyIsEnumerable.call(parent, key)
}

function deleteLanguageProperty(parent, key) {
    parent = arrayViews.projectionOf(parent)
    if (arrayViews.isArrayView(parent)) return parent.delete(String(key))
    return delete parent[key]
}

function enumerableLanguageKeys(value) {
    value = arrayViews.projectionOf(value)
    if (arrayViews.isArrayView(value)) return value.keys()
    const keys = Object.keys(value)
    return Array.isArray(value)
        ? keys.filter(arrayViews.isArrayIndex)
        : keys
}

export {
    assertCanDeleteLanguageProperty,
    assertCanMutateLanguageProperty,
    assertCanSetLanguageProperty,
    assertCanUpdatePromiseProperty,
    deleteLanguageProperty,
    enumerableLanguageKeys,
    getLanguagePropertyDescriptor,
    hasLanguageProperty,
    isArrayLanguageKey,
    isPropertyShapeError,
    readLanguageProperty,
    writeLanguageProperty,
}
