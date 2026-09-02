import * as errorUtils from "./error.js"
import * as arrayViews from "./array-view.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

const ORDINARY_PROPERTY = 0
const ARRAY_LENGTH = 1
const STRING_LENGTH = 2
const INVALID_ARRAY_KEY = 3

function classifyLanguageProperty(parent, key, operationContext) {
    return classifyProjectedProperty(
        arrayViews.projectionOf(parent, operationContext),
        String(key),
        operationContext,
    )
}

function classifyProjectedProperty(parent, key, operationContext) {
    if (typeof parent === "string" && key === "length") {
        return STRING_LENGTH
    }
    if (arrayViews.isLogicalArray(parent, operationContext)) {
        if (key === "length") return ARRAY_LENGTH
        return arrayViews.isArrayIndex(key)
            ? ORDINARY_PROPERTY
            : INVALID_ARRAY_KEY
    }
    return ORDINARY_PROPERTY
}

// Imported-storage validation retains the source of that representation.
// Phase 9C replaces this transitional attribution with causal Error context.
function importErrorContextOf(value, operationContext) {
    return metadata.importBoundaryOf(value, operationContext)?.errorContext
}

function propertyValidationError(parent, message, operationContext) {
    return errorUtils.validationError(
        message,
        importErrorContextOf(parent, operationContext),
    )
}

function normalizePathSegment(segment) {
    return typeof segment === "string"
        ? segment
        : typeof segment === "number"
            ? String(segment)
            : errorUtils.validationError(
                "Path segments must be Strings or Numbers",
            )
}

function isDataPlacement(descriptor) {
    return descriptor?.enumerable === true && "value" in descriptor
}

// A language container may be a Proxy, so the physical property operations
// below can invoke its traps even though accessors never run as graph values.
function getLanguagePropertyDescriptor(parent, key, operationContext) {
    parent = arrayViews.projectionOf(parent, operationContext)
    key = String(key)
    if (classifyProjectedProperty(parent, key, operationContext) === INVALID_ARRAY_KEY) {
        return undefined
    }
    return arrayViews.isArrayView(parent, operationContext)
        ? parent.descriptor(key)
        : errorUtils.runUserCode(
            () => Object.getOwnPropertyDescriptor(parent, key),
        )
}

function getLanguagePlacementDescriptor(parent, key, operationContext) {
    const descriptor = getLanguagePropertyDescriptor(parent, key, operationContext)
    return isDataPlacement(descriptor) ? descriptor : undefined
}

function propertyMutationRequiresCopy(
    parent,
    key,
    operationContext,
    deleting = false,
) {
    const projected = arrayViews.projectionOf(parent, operationContext)
    key = String(key)
    const descriptor = getLanguagePropertyDescriptor(projected, key, operationContext)

    if (deleting) {
        return isDataPlacement(descriptor) && !descriptor.configurable
    }
    if (descriptor) {
        return !isDataPlacement(descriptor) || !descriptor.writable
    }

    const extensible = errorUtils.runUserCode(
        () => Object.isExtensible(projected),
    )
    if (!extensible) return true
    if (!Array.isArray(projected) || !arrayViews.isArrayIndex(key)) {
        return false
    }
    const length = getLanguagePropertyDescriptor(projected, "length", operationContext)
    return Number(key) >= arrayViews.logicalArrayLength(projected, operationContext) &&
        length?.writable !== true
}

function arrayLengthMutationRequiresCopy(array, length, operationContext) {
    const projection = arrayViews.projectionOf(array, operationContext)
    const current = arrayViews.logicalArrayLength(projection, operationContext)
    if (length === current) return false
    if (
        arrayViews.isArrayView(projection, operationContext) &&
        length > current
    ) {
        const canGrow = arrayViews.ArrayView.canGrowEnd(
            projection,
            length - current,
            operationContext,
        )
        return !canGrow
    }
    if (!arrayViews.isArrayView(projection, operationContext)) {
        const descriptor = getLanguagePropertyDescriptor(array, "length", operationContext)
        if (descriptor?.writable !== true) return true
    }

    for (let index = current - 1; index >= length; index--) {
        const descriptor = getLanguagePropertyDescriptor(
            array,
            String(index),
            operationContext,
        )
        if (descriptor && (
            !isDataPlacement(descriptor) || !descriptor.configurable
        )) return true
    }
    return false
}

// These assertions guard internal commits after the owning transition has
// selected a writable representation.
function assertCanSetLanguageProperty(parent, key, operationContext) {
    const descriptor = getLanguagePropertyDescriptor(parent, key, operationContext)
    if (!descriptor) return
    assertDataPlacement(descriptor)
    assertWritable(descriptor)
}

function assertDataPlacement(descriptor, missingMessage) {
    if (!descriptor) fatalPropertyError(missingMessage)
    if (!descriptor.enumerable) {
        fatalPropertyError("Cannot mutate non-enumerable property")
    }
    if (!("value" in descriptor)) {
        fatalPropertyError("Cannot assign to accessor property")
    }
    return descriptor
}

function assertWritable(descriptor) {
    if (!descriptor.writable) {
        fatalPropertyError("Cannot assign to non-writable property")
    }
}

function fatalPropertyError(message) {
    errorUtils.reportFatalError(new Error(message))
}

function assertPromisePropertyShape(parent, key, operationContext) {
    return assertDataPlacement(
        getLanguagePropertyDescriptor(parent, key, operationContext),
        "Cannot resolve missing Promise property",
    )
}

function assertCanPublishPromiseProperty(parent, key, operationContext) {
    assertWritable(assertPromisePropertyShape(parent, key, operationContext))
}

function assertCanDeleteLanguageProperty(parent, key, operationContext) {
    const descriptor = getLanguagePropertyDescriptor(parent, key, operationContext)
    if (isDataPlacement(descriptor) && !descriptor.configurable) {
        fatalPropertyError("Cannot delete non-configurable property")
    }
}

// Define missing language keys as own data properties so inherited setters,
// notably Object.prototype.__proto__, never participate in a physical write.
function writeLanguageProperty(parent, key, value, operationContext) {
    parent = arrayViews.projectionOf(parent, operationContext)
    if (arrayViews.isArrayView(parent, operationContext)) {
        parent.set(String(key), value)
        return
    }
    errorUtils.runUserCode(() => {
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
    })
}

function readLanguageProperty(parent, key, operationContext) {
    key = String(key)
    const logicalParent = parent
    parent = arrayViews.projectionOf(parent, operationContext)
    const propertyKind = classifyProjectedProperty(parent, key, operationContext)
    if (propertyKind === INVALID_ARRAY_KEY) return undefined
    if (propertyKind === ARRAY_LENGTH) {
        return arrayViews.logicalArrayLength(parent, operationContext)
    }
    if (propertyKind === STRING_LENGTH) return parent.length

    const mirror = metadata.metaOf(
        logicalParent,
        operationContext,
    )?.mirrors?.[key]
    const value = mirror
        ? mirror.value
        : getLanguagePlacementDescriptor(parent, key, operationContext)?.value
    languageValues.admitValue(value, operationContext)
    return value
}

function hasLanguageProperty(parent, key, operationContext) {
    key = String(key)
    parent = arrayViews.projectionOf(parent, operationContext)
    const propertyKind = classifyProjectedProperty(parent, key, operationContext)
    if (propertyKind === INVALID_ARRAY_KEY) return false
    if (propertyKind !== ORDINARY_PROPERTY) return true
    const descriptor = getLanguagePlacementDescriptor(parent, key, operationContext)
    return descriptor !== undefined
}

function deleteLanguageProperty(parent, key, operationContext) {
    parent = arrayViews.projectionOf(parent, operationContext)
    if (arrayViews.isArrayView(parent, operationContext)) return parent.delete(String(key))
    return errorUtils.runUserCode(() => delete parent[key])
}

function enumerableLanguageKeys(value, operationContext) {
    if (arrayViews.isLogicalArray(value, operationContext)) {
        return arrayViews.enumerableArrayKeys(value, operationContext)
    }
    const keys = errorUtils.runUserCode(() => Reflect.ownKeys(value))

    const placements = []
    for (const key of keys) {
        if (typeof key !== "string") continue
        const descriptor = getLanguagePlacementDescriptor(value, key, operationContext)
        if (descriptor) placements.push(key)
    }
    return placements
}

export {
    ARRAY_LENGTH,
    INVALID_ARRAY_KEY,
    ORDINARY_PROPERTY,
    STRING_LENGTH,
    arrayLengthMutationRequiresCopy,
    assertCanDeleteLanguageProperty,
    assertCanPublishPromiseProperty,
    assertPromisePropertyShape,
    assertCanSetLanguageProperty,
    classifyLanguageProperty,
    deleteLanguageProperty,
    enumerableLanguageKeys,
    getLanguagePropertyDescriptor,
    getLanguagePlacementDescriptor,
    hasLanguageProperty,
    normalizePathSegment,
    propertyMutationRequiresCopy,
    propertyValidationError,
    readLanguageProperty,
    writeLanguageProperty,
}
