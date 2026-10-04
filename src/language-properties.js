import { ArrayView, isArrayView, isLogicalArray, isArrayIndex } from "./array-view.js"
import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"
import { capturePlacementFromVersion, normalizeRawPropertyValue } from "./property-versions.js"
import { orderRecordKeys } from "./placement-structure.js"

const ORDINARY_PROPERTY = 0
const ARRAY_LENGTH = 1
const STRING_LENGTH = 2
const INVALID_ARRAY_KEY = 3

const PROPERTY_MUTATION_MODE = Object.freeze({
    Assign: 0,
    Delete: 1,
    AssignOrDelete: 2,
})

function classifyLanguageProperty(parent, key, operationContext) {
    key = String(key)
    if (typeof parent === "string" && key === "length") {
        return STRING_LENGTH
    }
    if (isLogicalArray(parent, operationContext)) {
        if (key === "length") return ARRAY_LENGTH
        return isArrayIndex(key)
            ? ORDINARY_PROPERTY
            : INVALID_ARRAY_KEY
    }
    return ORDINARY_PROPERTY
}

function propertyValidationError(message, operationContext) {
    return errorUtils.validationError(
        message,
        operationContext,
        errorUtils.ERROR_KIND.PropertyValidation,
    )
}

function validatePropertyValue(key, value, operationContext, kind = errorUtils.ERROR_KIND.PropertyValidation) {
    if (key === "then" && typeof value === "function")
        return errorUtils.validationError("Language data cannot contain a callable then property", operationContext, kind)
}

function normalizePathSegment(segment, operationContext) {
    return typeof segment === "string"
        ? segment
        : typeof segment === "number"
            ? String(segment)
            : errorUtils.validationError(
                "Path segments must be Strings or Numbers",
                operationContext,
                errorUtils.ERROR_KIND.InvalidPathSegment,
            )
}

function isDataPlacement(descriptor) {
    return descriptor?.enumerable === true && "value" in descriptor
}

// A language container may be a Proxy, so the physical property operations
// below can invoke its traps even though accessors never run as graph values.
function getLanguagePropertyDescriptor(parent, key, operationContext) {
    try {
        key = String(key)
        if (classifyLanguageProperty(parent, key, operationContext) === INVALID_ARRAY_KEY) {
            return undefined
        }
        return metadata.metaOf(parent, operationContext)?.arrayRange
            ? ArrayView.descriptor(parent, key, operationContext)
            : errorUtils.runExternalAction(operationContext, () => Object.getOwnPropertyDescriptor(parent, key),
              )
    } finally { parent = undefined }
}

function getLanguagePlacementDescriptor(parent, key, operationContext) {
    const descriptor = getLanguagePropertyDescriptor(parent, key, operationContext)
    return isDataPlacement(descriptor) ? descriptor : undefined
}

function requiresRepresentationCopyForPropertyMutation(
    parent,
    key,
    operationContext,
    mode = PROPERTY_MUTATION_MODE.Assign,
) {
    if (ArrayView.requiresMaterialization(parent, operationContext, key) ||
        ArrayView.hasOtherStorageUse(parent, key, operationContext)) return true
    key = String(key)
    const descriptor = getLanguagePropertyDescriptor(parent, key, operationContext)

    if (mode === PROPERTY_MUTATION_MODE.Delete) {
        return isDataPlacement(descriptor) && !descriptor.configurable
    }
    if (descriptor) {
        return !isDataPlacement(descriptor) || !descriptor.writable ||
            mode === PROPERTY_MUTATION_MODE.AssignOrDelete && !descriptor.configurable
    }

    const storage = metadata.metaOf(parent, operationContext)?.arrayRange?.backing ?? parent
    const extensible = errorUtils.runExternalAction(operationContext, () => Object.isExtensible(storage))
    if (!extensible) return true
    if (!Array.isArray(parent) || !isArrayIndex(key)) {
        return false
    }
    const length = getStorageDescriptor(parent, "length", operationContext)
    return Number(key) >= ArrayView.minimumLength(parent, operationContext) &&
        length?.writable !== true
}

function getStorageDescriptor(parent, key, operationContext) {
    // A native Array may have an attached logical length projection. Storage
    // preflight needs its actual slot, without traversing pending length history.
    return isArrayView(parent, operationContext) ? ArrayView.descriptor(parent, String(key), operationContext) :
        errorUtils.runExternalAction(operationContext, () => Object.getOwnPropertyDescriptor(parent, key))
}

// These assertions guard internal commits after the owning transition has
// selected a writable representation.
function assertCanSetLanguageProperty(parent, key, operationContext) {
    const descriptor = getStorageDescriptor(parent, key, operationContext)
    if (!descriptor) return
    if (!descriptor.enumerable) {
        throw new Error("Cannot mutate non-enumerable property")
    }
    if (!("value" in descriptor)) {
        throw new Error("Cannot assign to accessor property")
    }
    if (!descriptor.writable) {
        throw new Error("Cannot assign to non-writable property")
    }
    return descriptor
}

function assertCanDeleteLanguageProperty(parent, key, operationContext) {
    const descriptor = getStorageDescriptor(parent, key, operationContext)
    if (isDataPlacement(descriptor) && !descriptor.configurable) {
        throw new Error("Cannot delete non-configurable property")
    }
    return descriptor
}

// Define missing language keys as own data properties so inherited setters,
// notably Object.prototype.__proto__, never participate in a physical write.
function writeLanguageProperty(parent, key, value, operationContext, descriptor) {
    if (metadata.metaOf(parent, operationContext)?.arrayRange) {
        const target = ArrayView.mutationTarget(parent, String(key), operationContext, true)
        parent = target.parent
        key = target.key
    }
    const previous = isDataPlacement(descriptor) ? descriptor.value : undefined
    errorUtils.runExternalAction(operationContext, () => {
        if (descriptor) {
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
    if (isLogicalArray(parent, operationContext)) ArrayView.recordBackingPlacement(parent, key, previous, value, operationContext)
}

function readLanguageProperty(parent, key, operationContext) {
    return readLanguagePlacement(parent, key, operationContext).value
}

// Consume once at the current program position, then capture any version
// installed by normalization. Baseline capture deliberately does not consume.
function readLanguagePlacement(parent, key, operationContext) {
    key = String(key)
    const propertyKind = classifyLanguageProperty(parent, key, operationContext)
    if (propertyKind === INVALID_ARRAY_KEY) return { value: undefined, present: false }
    if (propertyKind === ARRAY_LENGTH) {
        return { value: ArrayView.readyLength(parent, operationContext), present: true }
    }
    if (propertyKind === STRING_LENGTH) return { value: parent.length, present: true }

    const meta = metadata.metaOf(parent, operationContext)
    let version = meta?.placementVersions?.[key]
    if (version) return capturePlacementFromVersion(version)
    const descriptor = getLanguagePlacementDescriptor(parent, key, operationContext)
    const value = normalizeRawPropertyValue(parent, key, descriptor?.value, operationContext, descriptor?.writable)
    version = meta?.placementVersions?.[key]
    return version ? capturePlacementFromVersion(version) : {
        value, present: descriptor !== undefined,
        position: meta?.recordOrder?.positions.get(key)?.position ?? (descriptor ? -1 : Infinity),
    }
}

function hasLanguageProperty(parent, key, operationContext) {
    key = String(key)
    const propertyKind = classifyLanguageProperty(parent, key, operationContext)
    if (propertyKind === INVALID_ARRAY_KEY) return false
    if (propertyKind !== ORDINARY_PROPERTY) return true
    const version = metadata.metaOf(parent, operationContext)?.placementVersions?.[key]
    // An undecided placement is a candidate, even without physical storage.
    // Its consumer resolves presence through the captured transition.
    if (version) return version.present !== false
    const descriptor = getLanguagePlacementDescriptor(parent, key, operationContext)
    return descriptor !== undefined
}

function deleteLanguageProperty(parent, key, operationContext, descriptor) {
    if (metadata.metaOf(parent, operationContext)?.arrayRange) {
        const target = ArrayView.mutationTarget(parent, String(key), operationContext, false)
        if (!target) return key !== "length"
        parent = target.parent
        key = target.key
    }
    const previous = isDataPlacement(descriptor) ? descriptor.value : undefined
    const removed = errorUtils.runExternalAction(operationContext, () => delete parent[key])
    if (removed && isLogicalArray(parent, operationContext)) ArrayView.recordBackingPlacement(parent, key, previous, undefined, operationContext)
    return removed
}

// Capture candidates at the call, before descriptor checks, so one failing
// Proxy descriptor cannot hide later siblings from complete Error collection.
function enumerableLanguageKeyCandidates(value, operationContext, start = 0, end,
    type = metadata.metaOf(value, operationContext)?.type) {
    try {
        const array = type === metadata.TYPE.Array
        const keys = array
            ? ArrayView.physicalKeyCandidates(value, operationContext, start, end)
            : errorUtils.runExternalAction(operationContext, () => Reflect.ownKeys(value))
        const meta = metadata.metaOf(value, operationContext)
        const versions = meta?.placementVersions
        if (!versions) return array ? keys : keys.filter(key => typeof key === "string")
        if (array) return mergeArrayKeys(keys, Object.keys(versions).filter(
            key => Number(key) >= start && (end === undefined || Number(key) < end)))
        const candidates = Object.create(null)
        for (const key of keys) if (typeof key === "string") candidates[key] = true
        for (const key of Object.keys(versions)) {
            candidates[key] = true
        }
        return orderRecordKeys(Object.keys(candidates), meta.recordOrder?.positions)
    } finally { value = undefined }
}

// Both lists are captured in numeric order. Merge overlays without expanding
// a bounded sparse range into an intermediate set of every possible index.
function* mergeArrayKeys(physical, overlays) {
    let next = 0
    for (const key of physical) {
        while (next < overlays.length && Number(overlays[next]) < Number(key)) yield overlays[next++]
        if (overlays[next] === key) next++
        yield key
    }
    while (next < overlays.length) yield overlays[next++]
}

// Complete collectors guard both listing and each presence check. Keep the
// keys captured before a listing failure and continue past failed descriptors.
function enumerableLanguageKeys(value, operationContext, start = 0, end, inspect = action => action()) {
    const placements = []
    try {
        inspect(() => {
            for (const key of enumerableLanguageKeyCandidates(value, operationContext, start, end)) {
                if (inspect(() => hasLanguageProperty(value, key, operationContext)) === true) placements.push(key)
            }
        })
        return placements
    } finally { value = undefined }
}

export {
    ARRAY_LENGTH,
    INVALID_ARRAY_KEY,
    PROPERTY_MUTATION_MODE,
    ORDINARY_PROPERTY,
    STRING_LENGTH,
    assertCanDeleteLanguageProperty,
    assertCanSetLanguageProperty,
    classifyLanguageProperty,
    deleteLanguageProperty,
    enumerableLanguageKeys,
    getLanguagePlacementDescriptor,
    hasLanguageProperty,
    validatePropertyValue,
    enumerableLanguageKeyCandidates,
    normalizePathSegment,
    propertyValidationError,
    readLanguageProperty,
    readLanguagePlacement,
    requiresRepresentationCopyForPropertyMutation,
    writeLanguageProperty,
}
