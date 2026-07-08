const {
    isError,
    isPromise,
    isTracked,
} = require("./helpers")

const hasOwn = Object.prototype.hasOwnProperty

function validateImportBoundary(value, target = undefined) {
    return validateImportValue(value, target, false, new Set(), new Set(), new Set())
}

function validateImportValue(value, target, insideFrozen, visiting, plainVisited, frozenVisited) {
    if (target !== undefined && value === target) {
        return new Error("Imported value cannot reach its write target")
    }
    if (isPromise(value) || isError(value)) {
        return insideFrozen ? new Error("Frozen objects cannot contain promises or errors") : null
    }
    if (!isTracked(value)) return null

    const valueInsideFrozen = insideFrozen || !Object.isExtensible(value)
    if (valueInsideFrozen) {
        if (frozenVisited.has(value)) return null
    } else if (plainVisited.has(value) || frozenVisited.has(value)) {
        return null
    }

    if (visiting.has(value)) {
        return new Error("Imported values cannot be cyclic")
    }
    if (hasOwn.call(value, "__proto__")) {
        return new Error("Imported objects cannot contain __proto__")
    }

    visiting.add(value)

    // Cascada data is language-visible enumerable string keys; symbols and
    // non-enumerable JS properties are outside the runtime value graph.
    for (const key of Object.keys(value)) {
        const failure = validateImportValue(
            value[key],
            target,
            valueInsideFrozen,
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
    validateImportBoundary,
}
