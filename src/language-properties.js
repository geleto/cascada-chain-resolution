import * as errorUtils from "./error.js"
import * as arrayViews from "./array-view.js"

const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

// This module owns the descriptor policy and physical access for
// language-visible properties.

// Language data is own enumerable string keys only.
function assertCanMutateLanguageProperty(parent, key, errorContext = undefined) {
    const descriptor = getLanguagePropertyDescriptor(parent, key)
    if (descriptor && !descriptor.enumerable) {
        throw errorUtils.validationError(
            "Cannot mutate non-enumerable property",
            errorContext,
        )
    }
    return descriptor
}

function getLanguagePropertyDescriptor(parent, key) {
    if (arrayViews.isLogicalArray(parent)) {
        key = String(key)
        parent = arrayViews.projectionOf(parent)
        if (arrayViews.isArrayView(parent)) {
            return parent.descriptor(key)
        }
    }
    return Object.getOwnPropertyDescriptor(parent, key)
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
        throw errorUtils.validationError(
            "Cannot assign to accessor property",
            errorContext,
        )
    }
    if (descriptor && !descriptor.writable) {
        throw errorUtils.validationError(
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
        throw errorUtils.validationError(
            "Cannot delete non-configurable property",
            errorContext,
        )
    }
}

// Define missing language keys as own data properties so inherited setters,
// notably Object.prototype.__proto__, never participate in a physical write.
function writeLanguageProperty(parent, key, value) {
    if (arrayViews.isLogicalArray(parent)) {
        key = String(key)
        const projection = arrayViews.projectionOf(parent)
        if (arrayViews.isArrayView(projection)) {
            projection.set(key, value)
            return
        }
        parent = projection
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
    if (arrayViews.isLogicalArray(parent)) {
        key = String(key)
        const projection = arrayViews.projectionOf(parent)
        if (arrayViews.isArrayView(projection)) return projection.get(key)
        if (key === "length") return projection.length
        parent = projection
    }
    if (
        typeof parent === "string" &&
        String(key) === "length"
    ) {
        return parent.length
    }
    return propertyIsEnumerable.call(parent, key) ? parent[key] : undefined
}

function hasLanguageProperty(parent, key) {
    if (arrayViews.isLogicalArray(parent)) {
        key = String(key)
        const projection = arrayViews.projectionOf(parent)
        if (arrayViews.isArrayView(projection)) return projection.has(key)
        return key === "length" || propertyIsEnumerable.call(projection, key)
    }
    if (typeof parent === "string" && String(key) === "length") return true
    return propertyIsEnumerable.call(parent, key)
}

function deleteLanguageProperty(parent, key) {
    if (arrayViews.isLogicalArray(parent)) {
        const projection = arrayViews.projectionOf(parent)
        key = String(key)
        return arrayViews.isArrayView(projection)
            ? projection.delete(key)
            : delete projection[key]
    }
    return delete parent[key]
}

function enumerableLanguageKeys(value) {
    if (!arrayViews.isLogicalArray(value)) return Object.keys(value)
    const projection = arrayViews.projectionOf(value)
    return arrayViews.isArrayView(projection)
        ? projection.keys()
        : Object.keys(projection)
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
    readLanguageProperty,
    writeLanguageProperty,
}
