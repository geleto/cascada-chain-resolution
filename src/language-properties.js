import * as errorUtils from "./error.js"
import * as arrayViews from "./array-view.js"
import * as metadata from "./meta.js"

const propertyIsEnumerable = Object.prototype.propertyIsEnumerable
const propertyShapeErrors = new WeakSet()
const ORDINARY_PROPERTY = 0
const ARRAY_LENGTH = 1
const STRING_LENGTH = 2
const INVALID_ARRAY_KEY = 3

// This module owns the descriptor policy and logical access for
// language-visible properties.

function classifyLanguageProperty(parent, key) {
    return classifyProjectedProperty(
        arrayViews.projectionOf(parent),
        String(key),
    )
}

function classifyProjectedProperty(parent, key) {
    if (typeof parent === "string" && key === "length") {
        return STRING_LENGTH
    }
    if (arrayViews.isLogicalArray(parent)) {
        if (key === "length") return ARRAY_LENGTH
        return arrayViews.isArrayIndex(key)
            ? ORDINARY_PROPERTY
            : INVALID_ARRAY_KEY
    }
    return ORDINARY_PROPERTY
}

function errorContextOf(value) {
    return metadata.importBoundaryOf(value)?.errorContext
}

function propertyValidationError(parent, message) {
    return errorUtils.validationError(message, errorContextOf(parent))
}

function propertyShapeError(message, errorContext) {
    const error = errorUtils.validationError(message, errorContext)
    propertyShapeErrors.add(error)
    return error
}

function isPropertyShapeError(error) {
    return propertyShapeErrors.has(error)
}

function assertCanMutateProperty(parent, key, errorContext) {
    const descriptor = getLanguagePropertyDescriptor(parent, key)
    if (descriptor && !descriptor.enumerable) {
        throw propertyShapeError(
            "Cannot mutate non-enumerable property",
            errorContext,
        )
    }
    return descriptor
}

function assertCanMutateLanguageProperty(parent, key) {
    return assertCanMutateProperty(parent, key, errorContextOf(parent))
}

function getLanguagePropertyDescriptor(parent, key) {
    parent = arrayViews.projectionOf(parent)
    key = String(key)
    if (classifyProjectedProperty(parent, key) === INVALID_ARRAY_KEY) {
        return undefined
    }
    if (arrayViews.isArrayView(parent)) return parent.descriptor(key)
    return Object.getOwnPropertyDescriptor(parent, key)
}

// Validate before edge accounting; ArrayView writes are preflighted.
function assertCanCreateLanguageProperty(parent, key, errorContext) {
    parent = arrayViews.projectionOf(parent)
    if (arrayViews.isArrayView(parent)) return
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
function assertCanSetLanguageProperty(parent, key) {
    const errorContext = errorContextOf(parent)
    const descriptor = assertCanMutateProperty(parent, key, errorContext)
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

function assertCanPublishPromiseProperty(parent, key, value) {
    const errorContext = errorContextOf(value)
    const descriptor = assertPromisePropertyShapeWithContext(
        parent,
        key,
        errorContext,
    )
    if (!descriptor.writable) {
        throw propertyShapeError(
            "Cannot assign to non-writable property",
            errorContext,
        )
    }
}

// Promise discovery requires a stable data property; imported properties need
// not be writable because their logical results are stored in the mirror.
function assertPromisePropertyShapeWithContext(parent, key, errorContext) {
    const descriptor = assertCanMutateProperty(
        parent,
        key,
        errorContext,
    )
    if (!descriptor) {
        throw errorUtils.validationError(
            "Cannot resolve missing Promise property",
            errorContext,
        )
    }
    if (!("value" in descriptor)) {
        throw propertyShapeError(
            "Cannot assign to accessor property",
            errorContext,
        )
    }
    return descriptor
}

function assertPromisePropertyShape(parent, key) {
    return assertPromisePropertyShapeWithContext(
        parent,
        key,
        errorContextOf(parent),
    )
}

function assertCanDeleteLanguageProperty(parent, key) {
    const errorContext = errorContextOf(parent)
    const descriptor = assertCanMutateProperty(
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
    key = String(key)
    const logicalParent = parent
    parent = arrayViews.projectionOf(parent)
    const propertyKind = classifyProjectedProperty(parent, key)
    if (propertyKind === INVALID_ARRAY_KEY) return undefined
    if (propertyKind !== ORDINARY_PROPERTY) return parent.length

    const mirror = metadata.metaOf(logicalParent)?.mirrors?.[key]
    if (mirror) return mirror.value

    if (arrayViews.isArrayView(parent)) return parent.get(key)
    return propertyIsEnumerable.call(parent, key) ? parent[key] : undefined
}

function hasLanguageProperty(parent, key) {
    parent = arrayViews.projectionOf(parent)
    key = String(key)
    const propertyKind = classifyProjectedProperty(parent, key)
    if (propertyKind === INVALID_ARRAY_KEY) return false
    if (propertyKind !== ORDINARY_PROPERTY) return true
    if (arrayViews.isArrayView(parent)) return parent.has(key)
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
    ARRAY_LENGTH,
    INVALID_ARRAY_KEY,
    ORDINARY_PROPERTY,
    STRING_LENGTH,
    assertCanDeleteLanguageProperty,
    assertCanMutateLanguageProperty,
    assertCanPublishPromiseProperty,
    assertPromisePropertyShape,
    assertCanSetLanguageProperty,
    classifyLanguageProperty,
    deleteLanguageProperty,
    enumerableLanguageKeys,
    getLanguagePropertyDescriptor,
    hasLanguageProperty,
    isPropertyShapeError,
    propertyValidationError,
    readLanguageProperty,
    writeLanguageProperty,
}
