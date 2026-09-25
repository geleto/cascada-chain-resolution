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

function isCallableThenPlacement(key, value) {
    return key === "then" && typeof value === "function"
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
    key = String(key)
    if (classifyLanguageProperty(parent, key, operationContext) === INVALID_ARRAY_KEY) {
        return undefined
    }
    parent = ArrayView.projectionOf(parent, operationContext)
    return isArrayView(parent, operationContext)
        ? parent.descriptor(key, operationContext)
        : errorUtils.runExternalAction(operationContext, () => Object.getOwnPropertyDescriptor(parent, key),
          )
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
    if (ArrayView.requiresMaterialization(parent, operationContext)) return true
    const projected = ArrayView.projectionOf(parent, operationContext)
    key = String(key)
    const descriptor = getLanguagePropertyDescriptor(projected, key, operationContext)

    if (mode === PROPERTY_MUTATION_MODE.Delete) {
        return isDataPlacement(descriptor) && !descriptor.configurable
    }
    if (descriptor) {
        return !isDataPlacement(descriptor) || !descriptor.writable ||
            mode === PROPERTY_MUTATION_MODE.AssignOrDelete && !descriptor.configurable
    }

    const extensible = errorUtils.runExternalAction(operationContext, () => Object.isExtensible(projected),
    )
    if (!extensible) return true
    if (!Array.isArray(projected) || !isArrayIndex(key)) {
        return false
    }
    const length = getLanguagePropertyDescriptor(projected, "length", operationContext)
    return Number(key) >= ArrayView.minimumLength(projected, operationContext) &&
        length?.writable !== true
}

// These assertions guard internal commits after the owning transition has
// selected a writable representation.
function assertCanSetLanguageProperty(parent, key, operationContext) {
    const descriptor = getLanguagePropertyDescriptor(parent, key, operationContext)
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
}

function assertCanDeleteLanguageProperty(parent, key, operationContext) {
    const descriptor = getLanguagePropertyDescriptor(parent, key, operationContext)
    if (isDataPlacement(descriptor) && !descriptor.configurable) {
        throw new Error("Cannot delete non-configurable property")
    }
}

// Define missing language keys as own data properties so inherited setters,
// notably Object.prototype.__proto__, never participate in a physical write.
function writeLanguageProperty(parent, key, value, operationContext) {
    parent = ArrayView.projectionOf(parent, operationContext)
    if (isArrayView(parent, operationContext)) {
        parent.set(String(key), value, operationContext)
        return
    }
    errorUtils.runExternalAction(operationContext, () => {
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

function deleteLanguageProperty(parent, key, operationContext) {
    parent = ArrayView.projectionOf(parent, operationContext)
    if (isArrayView(parent, operationContext))
        return parent.delete(String(key), operationContext)
    return errorUtils.runExternalAction(operationContext, () => delete parent[key])
}

// Capture candidates at the call, before descriptor checks, so one failing
// Proxy descriptor cannot hide later siblings from complete Error collection.
function enumerableLanguageKeyCandidates(value, operationContext, start = 0, end) {
    const array = isLogicalArray(value, operationContext)
    const keys = array
        ? ArrayView.physicalKeyCandidates(value, operationContext, start, end)
        : errorUtils.runExternalAction(operationContext, () => Reflect.ownKeys(value))
    const meta = metadata.metaOf(value, operationContext)
    const versions = meta?.placementVersions
    if (!versions) return array ? keys : keys.filter(key => typeof key === "string")
    const candidates = Object.create(null)
    for (const key of keys) if (typeof key === "string") candidates[key] = true
    for (const key of Object.keys(versions)) {
        if (!array || Number(key) >= start && (end === undefined || Number(key) < end)) {
            candidates[key] = true
        }
    }
    return orderRecordKeys(Object.keys(candidates), meta.recordOrder?.positions)
}

// Complete collectors guard both listing and each presence check. Keep the
// keys captured before a listing failure and continue past failed descriptors.
function enumerableLanguageKeys(value, operationContext, start = 0, end, inspect = action => action()) {
    const placements = []
    inspect(() => {
        for (const key of enumerableLanguageKeyCandidates(value, operationContext, start, end)) {
            if (inspect(() => hasLanguageProperty(value, key, operationContext)) === true) placements.push(key)
        }
    })
    return placements
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
    isCallableThenPlacement,
    enumerableLanguageKeyCandidates,
    normalizePathSegment,
    propertyValidationError,
    readLanguageProperty,
    readLanguagePlacement,
    requiresRepresentationCopyForPropertyMutation,
    writeLanguageProperty,
}
