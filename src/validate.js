const {
    isError,
    isPromise,
    isTracked,
} = require("./helpers")

function validateRefIndexable(value, isRefIndexed = () => false) {
    return validatePlain(value, isRefIndexed, new Set(), new Set(), new Set())
}

function validatePlain(value, isRefIndexed, visiting, plainVisited, frozenVisited) {
    if (isPromise(value) || isError(value)) return null
    if (!isTracked(value) ||
        plainVisited.has(value) ||
        frozenVisited.has(value) ||
        isRefIndexed(value)) {
        return null
    }

    if (visiting.has(value)) {
        return new Error("Cannot ref-index cyclic value")
    }

    visiting.add(value)

    if (!Object.isExtensible(value)) {
        const failure = validateFrozenSubtree(value, visiting, frozenVisited)
        visiting.delete(value)
        frozenVisited.add(value)
        return failure
    }

    for (const key of Object.keys(value)) {
        const failure = validatePlain(
            value[key],
            isRefIndexed,
            visiting,
            plainVisited,
            frozenVisited,
        )
        if (failure) return failure
    }

    visiting.delete(value)
    plainVisited.add(value)
    return null
}

function validateFrozenSubtree(value, visiting, frozenVisited) {
    for (const key of Object.keys(value)) {
        const child = value[key]
        if (isPromise(child) || isError(child)) {
            return new Error("Frozen objects cannot contain promises or errors")
        }
        if (!isTracked(child) || frozenVisited.has(child)) continue

        if (visiting.has(child)) {
            return new Error("Cannot ref-index cyclic value")
        }

        visiting.add(child)
        const failure = validateFrozenSubtree(child, visiting, frozenVisited)
        visiting.delete(child)
        frozenVisited.add(child)
        if (failure) return failure
    }
    return null
}

function validateNoBackEdge(value, target, seen = new Set()) {
    if (value === target) return new Error("Cannot assign value into itself")
    if (!isTracked(value) || seen.has(value)) return null

    seen.add(value)
    for (const key of Object.keys(value)) {
        const failure = validateNoBackEdge(value[key], target, seen)
        if (failure) return failure
    }
    return null
}

module.exports = {
    validateRefIndexable,
    validateNoBackEdge,
}
