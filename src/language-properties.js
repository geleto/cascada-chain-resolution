import * as errorUtils from "./error.js"
import * as arrayViews from "./array-view.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

const ORDINARY_PROPERTY = 0
const ARRAY_LENGTH = 1
const STRING_LENGTH = 2
const INVALID_ARRAY_KEY = 3

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
function getLanguagePropertyDescriptor(parent, key) {
    parent = arrayViews.projectionOf(parent)
    key = String(key)
    if (classifyProjectedProperty(parent, key) === INVALID_ARRAY_KEY) {
        return undefined
    }
    return arrayViews.isArrayView(parent)
        ? parent.descriptor(key)
        : errorUtils.runUserCode(
            () => Object.getOwnPropertyDescriptor(parent, key),
        )
}

function getLanguagePlacementDescriptor(parent, key) {
    const descriptor = getLanguagePropertyDescriptor(parent, key)
    return isDataPlacement(descriptor) ? descriptor : undefined
}

function propertyMutationRequiresCopy(parent, key, deleting = false) {
    const projected = arrayViews.projectionOf(parent)
    key = String(key)
    const descriptor = getLanguagePropertyDescriptor(projected, key)

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
    const length = getLanguagePropertyDescriptor(projected, "length")
    return Number(key) >= arrayViews.logicalArrayLength(projected) &&
        length?.writable !== true
}

function arrayLengthMutationRequiresCopy(array, length) {
    const projection = arrayViews.projectionOf(array)
    const current = arrayViews.logicalArrayLength(projection)
    if (length === current) return false
    if (
        arrayViews.isArrayView(projection) &&
        length > current
    ) {
        const canGrow = arrayViews.ArrayView.canGrowEnd(
            projection,
            length - current,
        )
        return !canGrow
    }
    if (!arrayViews.isArrayView(projection)) {
        const descriptor = getLanguagePropertyDescriptor(array, "length")
        if (descriptor?.writable !== true) return true
    }

    for (let index = current - 1; index >= length; index--) {
        const descriptor = getLanguagePropertyDescriptor(array, String(index))
        if (descriptor && (
            !isDataPlacement(descriptor) || !descriptor.configurable
        )) return true
    }
    return false
}

// These assertions guard internal commits after the owning transition has
// selected a writable representation.
function assertCanSetLanguageProperty(parent, key) {
    const descriptor = getLanguagePropertyDescriptor(parent, key)
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

function assertPromisePropertyShape(parent, key) {
    return assertDataPlacement(
        getLanguagePropertyDescriptor(parent, key),
        "Cannot resolve missing Promise property",
    )
}

function assertCanPublishPromiseProperty(parent, key) {
    assertWritable(assertPromisePropertyShape(parent, key))
}

function assertCanDeleteLanguageProperty(parent, key) {
    const descriptor = getLanguagePropertyDescriptor(parent, key)
    if (isDataPlacement(descriptor) && !descriptor.configurable) {
        fatalPropertyError("Cannot delete non-configurable property")
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

function readLanguageProperty(parent, key) {
    key = String(key)
    const logicalParent = parent
    parent = arrayViews.projectionOf(parent)
    const propertyKind = classifyProjectedProperty(parent, key)
    if (propertyKind === INVALID_ARRAY_KEY) return undefined
    if (propertyKind === ARRAY_LENGTH) {
        return arrayViews.logicalArrayLength(parent)
    }
    if (propertyKind === STRING_LENGTH) return parent.length

    const mirror = metadata.metaOf(logicalParent)?.mirrors?.[key]
    const value = mirror
        ? mirror.value
        : getLanguagePlacementDescriptor(parent, key)?.value
    languageValues.admitValue(value)
    return value
}

function hasLanguageProperty(parent, key) {
    key = String(key)
    parent = arrayViews.projectionOf(parent)
    const propertyKind = classifyProjectedProperty(parent, key)
    if (propertyKind === INVALID_ARRAY_KEY) return false
    if (propertyKind !== ORDINARY_PROPERTY) return true
    const descriptor = getLanguagePlacementDescriptor(parent, key)
    return descriptor !== undefined
}

function deleteLanguageProperty(parent, key) {
    parent = arrayViews.projectionOf(parent)
    if (arrayViews.isArrayView(parent)) return parent.delete(String(key))
    return errorUtils.runUserCode(() => delete parent[key])
}

function enumerableLanguageKeys(value) {
    if (arrayViews.isLogicalArray(value)) {
        return arrayViews.enumerableArrayKeys(value)
    }
    const keys = errorUtils.runUserCode(() => Reflect.ownKeys(value))

    const placements = []
    for (const key of keys) {
        if (typeof key !== "string") continue
        const descriptor = getLanguagePlacementDescriptor(value, key)
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
