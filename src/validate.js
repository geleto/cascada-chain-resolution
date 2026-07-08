const {
    isError,
    isPromise,
    isTracked,
} = require("./helpers")
const { nodeImportContext } = require("./meta")

const hasOwn = Object.prototype.hasOwnProperty
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

function validationError(message, importContext = undefined) {
    if (importContext === undefined) return new Error(message)
    return new Error(`${message} (imported at: ${String(importContext)})`)
}

function forbiddenKeyError(importContext = undefined) {
    return validationError("Cannot use __proto__ as a key", importContext)
}

function assertMutationKey(key, importContext = undefined) {
    if (key === "__proto__") {
        throw forbiddenKeyError(importContext)
    }
}

function assertCanMutateLanguageProperty(parent, key, importContext = undefined) {
    assertMutationKey(key, importContext)
    if (hasOwn.call(parent, key) && !propertyIsEnumerable.call(parent, key)) {
        throw validationError("Cannot mutate non-enumerable property", importContext)
    }
}

function validateCountable(value, writeTarget, isRefIndexed = () => false) {
    return validateValue(
        value,
        writeTarget,
        isRefIndexed,
        false,
        undefined,
        new Set(),
        new Set(),
        new Set(),
    )
}

function validateValue(
    value,
    writeTarget,
    isRefIndexed,
    insideFrozen,
    inheritedImportContext,
    visiting,
    plainVisited,
    frozenVisited,
) {
    const importContext = isTracked(value)
        ? nodeImportContext(value, inheritedImportContext)
        : inheritedImportContext

    if (writeTarget !== undefined && value === writeTarget) {
        return validationError("Value cannot reach its write target", importContext)
    }
    if (isPromise(value) || isError(value)) {
        return insideFrozen
            ? validationError("Frozen object cannot contain promises or errors", importContext)
            : null
    }
    if (!isTracked(value)) return null

    const valueInsideFrozen = insideFrozen || !Object.isExtensible(value)
    if (valueInsideFrozen) {
        if (frozenVisited.has(value)) return null
    } else if (plainVisited.has(value) || frozenVisited.has(value)) {
        return null
    }

    if (writeTarget === undefined && Object.isExtensible(value) && isRefIndexed(value)) {
        return null
    }
    if (visiting.has(value)) {
        return validationError("Value cannot be cyclic", importContext)
    }

    visiting.add(value)

    // Cascada data is language-visible enumerable string keys; symbols and
    // non-enumerable JS properties are outside the runtime value graph.
    for (const key of Object.keys(value)) {
        if (key === "__proto__") {
            visiting.delete(value)
            return forbiddenKeyError(importContext)
        }
        const failure = validateValue(
            value[key],
            writeTarget,
            isRefIndexed,
            valueInsideFrozen,
            importContext,
            visiting,
            plainVisited,
            frozenVisited,
        )
        if (failure) {
            visiting.delete(value)
            return failure
        }
    }

    visiting.delete(value)
    if (valueInsideFrozen) {
        frozenVisited.add(value)
    } else {
        plainVisited.add(value)
    }
    return null
}

module.exports = {
    assertCanMutateLanguageProperty,
    assertMutationKey,
    validateCountable,
}
