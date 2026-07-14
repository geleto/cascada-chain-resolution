const {
    isError,
    isPromise,
    isTracked,
} = require("./helpers")
const {
    forbiddenKeyError,
    reportFatalError,
    validationError,
} = require("./error")
const { nodeImportContext } = require("./meta")

const hasOwn = Object.prototype.hasOwnProperty
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

function assertMutationPath(path) {
    for (const key of path) {
        if (key === "__proto__") {
            reportFatalError(forbiddenKeyError())
        }
    }
}

// Language data is own enumerable string keys only. Reads treat __proto__ and
// own non-enumerable properties as missing; mutations through them throw,
// because plain assignment could not shadow them safely.
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

// Everything counting requires, nothing more:
// - back-edge: value must not reach writeTarget — a write-created cycle must
//   pass through the written parent. With a target the descent takes no early
//   exits, because the target may hide behind already-indexed DAG shares.
// - cycles: two-color marking — reaching a visiting node is a cycle, reaching
//   a visited node is a DAG share.
// - frozen rule: a non-extensible node must not contain promises or Errors
//   anywhere beneath it; its subtree is decreed [0,0], so the counts would lie.
// - __proto__: own enumerable __proto__ keys are not valid language data.
// importContext is re-derived per node from the import markers so failures
// name the import that brought the data in. isRefIndexed is passed in by
// refcounts.js to keep this module below it in the layering.
function validateCountable(
    value,
    writeTarget,
    isRefIndexed = () => false,
    inheritedImportContext = undefined,
) {
    return validateValue(
        value,
        writeTarget,
        isRefIndexed,
        false,
        inheritedImportContext,
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

    if (writeTarget && value === writeTarget) {
        return validationError("Value cannot reach its write target", importContext)
    }
    if (isPromise(value) || isError(value)) {
        return insideFrozen
            ? validationError("Frozen object cannot contain promises or errors", importContext)
            : null
    }
    if (!isTracked(value)) return null

    // Two visited sets, one per strictness: a node validated leniently (plain
    // context, promises allowed) must still be re-validated when reached under
    // a frozen ancestor, while a frozen-validated node satisfies both. One
    // shared set would let a frozen violation hide behind an earlier lenient
    // visit, with the outcome depending on key order.
    const valueInsideFrozen = insideFrozen || !Object.isExtensible(value)
    if (valueInsideFrozen) {
        if (frozenVisited.has(value)) return null
    } else if (plainVisited.has(value) || frozenVisited.has(value)) {
        return null
    }

    // Already-ref-indexed subtrees are valid only for ordinary mutable context.
    // A frozen ancestor imposes the stricter no-promise/no-Error rule, so that
    // subtree must be checked again even though its counters are already live.
    if (!writeTarget && !valueInsideFrozen && isRefIndexed(value)) {
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
    assertMutationPath,
    validateCountable,
}
