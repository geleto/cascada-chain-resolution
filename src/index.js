"use strict"

// --- Notation ---------------------------------------------------------------
//   a.k.y = 1   -> assignPath(a, ["k", "y"], 1)
//   = a.k.y     -> lookupPath(a, ["k", "y"])
//   delete a.k  -> deletePath(a, ["k"])
//   P(V)        -> a promise P that resolves to value V
//
// A promise mirror {promise, currentValue} lives in node's META mirror map:
//   promise      : the exact promise instance assigned to this key
//   currentValue : the newest resolved value, V -> V' -> V'',
//                  each op reading the latest currentValue and storing its COW back.
// The FIFO order of continuations on one promise = program order, for free.
//
// A promise mirror is born at three points: ASSIGN, DISCOVERY, FORK. Only the
// first two seed currentValue from the raw resolved value. A FORK (shallow copy
// of a node whose key holds a promise) seeds from the source mirror's
// currentValue at the copier's FIFO slot: the copied world branches off at
// exactly the copier's position in program order.

const {
    isArray,
    isError,
    isPromise,
    isTracked,
    onResolve,
} = require("./helpers")
const {
    copyCounters,
    refDeleteProperty,
    refSetProperty,
} = require("./refcounts")
const {
    assertCanMutateLanguageProperty,
    assertMutationKey,
} = require("./validate")
const {
    hasSharedMark,
    markImported,
    markShared,
    nodeImportContext,
} = require("./meta")
const {
    clearPromiseMirror,
    createAssignedPromiseMirror,
    forkPromiseMirror,
    getOrCreatePromiseMirror,
    initPromiseMirrors,
    isLivePromiseMirror,
} = require("./promise-mirrors")

// Load-bearing helper contract:
// Every continuation that depends on one promise's FIFO order must go through
// settlePromise/onResolve, and must do so against the raw promise instance held
// at the key. Mixing in bare .then or wrapping a derived proxy can reorder a
// suspended read behind a later write. settlePromise also maps rejection to the
// language Error node, so intermediate advances stop instead of autovivifying.
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

// Cascada data is own enumerable keys only. `__proto__` is never language data
// because plain assignment would otherwise hit JS prototype machinery.
function readLanguageProperty(node, key) {
    if (key === "__proto__") return undefined
    return propertyIsEnumerable.call(node, key) ? node[key] : undefined
}

function setProperty(parent, key, value) {
    assertCanMutateLanguageProperty(parent, key)
    const nextValue = refSetProperty(parent, key, value)
    parent[key] = nextValue
    return nextValue
}

function deleteProperty(parent, key) {
    assertCanMutateLanguageProperty(parent, key)
    refDeleteProperty(parent, key)
    delete parent[key]
}

initPromiseMirrors(setProperty)

// --- import : external value enters the runtime -----------------------------
function importValue(value, importContext) {
    if (importContext === undefined) {
        throw new Error("import requires an error context")
    }
    if (isPromise(value)) {
        return onResolve(value, settledValueOrError => {
            return importValue(settledValueOrError, importContext)
        })
    }

    return markImported(value, importContext)
}

function shallowCopy(
    obj,
    pathKey = undefined,
    markReusedChildrenShared = false,
    inheritedImportContext = undefined,
) {
    const copy = isArray(obj) ? new Array(obj.length) : {}
    const pathKeyString = pathKey === undefined ? undefined : String(pathKey)
    const importContext = nodeImportContext(obj, inheritedImportContext)
    const keys = Object.keys(obj)
    if (keys.includes("__proto__")) {
        // Object.keys only sees an own enumerable data key on the source, but
        // the fresh copy would otherwise inherit Object.prototype.__proto__.
        // Pre-create the copy's own data slot so the normal assignment loop
        // preserves the value instead of invoking the legacy prototype setter.
        Object.defineProperty(copy, "__proto__", {
            value: undefined,
            enumerable: true,
            writable: true,
            configurable: true,
        })
    }

    // Copy only language-visible string keys; META is non-enumerable Symbol
    // metadata, so mirrors, counters, and the shared mark never enter the copy.
    // The source object keeps its own shared mark. When a copy reuses child
    // objects from a shared branch, those non-path children are marked too
    // so their shared references stay protected.
    for (const key of keys) {
        const isPathKey = key === pathKeyString
        const markCopiedValueShared = markReusedChildrenShared && !isPathKey
        const value = obj[key]
        // Sanctioned write bypass: the copy is unobservable until it is installed
        // through setProperty, or copyCounters snapshots the already-indexed source.
        copy[key] = value
        if (key === "__proto__" && isPromise(value)) {
            // The key was pre-created as an own data property above, so the
            // assignment is safe. Do not mirror this promise: writeback would
            // later go through the normal mutation guard and throw. Boundary
            // marking is still owed for the eventual resolved value.
            if (importContext !== undefined) {
                markImported(value, importContext)
            } else if (markCopiedValueShared) {
                markShared(value)
            }
            continue
        }
        if (isPromise(value)) {
            // BIRTH 3 - FORK. For every copied key holding a promise, mint the
            // copy's mirror NOW, at the copier's program position.
            //
            // Why eager: a mirror minted lazily by a later walk would seed
            // currentValue from the RAW resolved value, stranding every advance
            // (V -> V' -> ...) made by ops issued BEFORE this copy; their writes
            // silently vanish from the copied world.
            //
            // Why seeding from the source mirror is correct: this initializer is
            // registered at the copier's FIFO slot, so it runs after every
            // continuation of earlier ops and before every continuation of later
            // ops. The two worlds diverge at exactly this point in program order.
            //
            // Why mark non-path captured values: they are reused by two worlds,
            // so the first advance on either side must COW. The path key itself
            // is protected by the walk's inherited shared state if we enter it,
            // and may simply be replaced/deleted at the target.
            forkPromiseMirror(obj, copy, key, value, markCopiedValueShared, importContext)
        } else if (importContext !== undefined && isTracked(value)) {
            markImported(value, importContext)
        } else if (markCopiedValueShared && isTracked(value)) {
            markShared(value)
        }
    }
    copyCounters(obj, copy)
    return copy
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignPath(root, path, value) {
    for (const key of path) {
        assertMutationKey(key)
    }
    if (path.length === 0) return value
    if (isPromise(root)) {
        return onResolve(root, resolvedRoot => {
            return assignPath(resolvedRoot, path, value)
        })
    }

    return walkMutationPath(root, path, true, (parent, key) => {
        if (isPromise(value)) {
            // BIRTH 1 - ASSIGN: assigning a promise to a key. Always creates a
            // fresh mirror. Two assignments of the same promise at the same key
            // are divergent worlds and must not share currentValue.
            createAssignedPromiseMirror(parent, key, value) // FIRST: the FIFO ordering invariant
            setProperty(parent, key, value)
        } else {
            clearPromiseMirror(parent, key)            // plain value ends any prior promise mirror
            setProperty(parent, key, value)
        }
    })
}

// Walk returns the value that should live at this path level after mutation.
// The root caller returns it; recursive callers install it into their key.
function walkMutationPath(root, path, createMissingIntermediates, onTarget) {
    return walk(root, 0, false)

    function walk(value, index, inheritedSharedBranch) {
        if (isError(value)) return value

        const valueIsTracked = isTracked(value)
        const valueImportContext = valueIsTracked
            ? nodeImportContext(value, undefined)
            : undefined
        let parent = value
        let parentInsideSharedBranch = valueIsTracked &&
            (inheritedSharedBranch || hasSharedMark(value))

        if (createMissingIntermediates) {
            if (value === null || value === undefined) {
                // Sanctioned write bypass: a blank intermediate is unobservable
                // during construction; installing it into the tree goes through setProperty.
                parent = {}
                parentInsideSharedBranch = false
            } else if (!valueIsTracked) {
                return new Error("Cannot assign into primitive value")
            }
        } else if (!valueIsTracked) {
            return value
        }

        const key = path[index]
        if (parentInsideSharedBranch) {
            parent = shallowCopy(parent, key, true, valueImportContext)
        }
        assertCanMutateLanguageProperty(parent, key, valueImportContext)

        if (index === path.length - 1) {
            onTarget(parent, key)
            return parent
        }

        const child = readLanguageProperty(parent, key)
        if (isPromise(child)) {
            const mirror = getOrCreatePromiseMirror(parent, key, child)
            onResolve(child, () => {
                const next = walk(
                    mirror.currentValue,
                    index + 1,
                    parentInsideSharedBranch,
                )
                mirror.currentValue = next
                if (isLivePromiseMirror(parent, key, mirror) &&
                    next !== readLanguageProperty(parent, key)) {
                    setProperty(parent, key, next)
                }
            })
            return parent
        }

        const next = walk(child, index + 1, parentInsideSharedBranch)
        if (next !== child) {
            clearPromiseMirror(parent, key)
            setProperty(parent, key, next)
        }
        return parent
    }
}

// --- lookupPath :  = a.k.y --------------------------------------------------
// sharedOwnership is false for a pure read or when ownership is ceded to
// the caller, e.g. the final `return x` from an otherwise unused variable.
function lookupPath(root, path, sharedOwnership = true) {
    if (isPromise(root)) {
        return onResolve(root, resolvedRoot => {
            return lookupPath(resolvedRoot, path, sharedOwnership)
        })
    }

    const rootImportContext = isTracked(root)
        ? nodeImportContext(root, undefined)
        : undefined
    if (path.length === 0) {
        if (rootImportContext !== undefined) {
            markImported(root, rootImportContext)
        } else if (sharedOwnership) {
            markShared(root)       // escaping object/array -> shared
        }
        return root
    }

    // Walk lookup paths through promise mirrors. Promise-valued keys resolve
    // before we decide whether the reached value is final or intermediate.
    return walk(root, 0, undefined)

    function walk(parent, index, inheritedImportContext) {
        if (isError(parent)) return parent
        if (!isTracked(parent)) return undefined

        const importContext = nodeImportContext(parent, inheritedImportContext)
        const key = path[index]
        const value = readLanguageProperty(parent, key)
        if (isPromise(value)) {
            if (!Object.isExtensible(parent)) {
                return onResolve(value, settledValueOrError => {
                    return lookupValue(settledValueOrError, index, importContext)
                })
            }

            const mirror = getOrCreatePromiseMirror(parent, key, value, importContext)
            return onResolve(value, () => {
                return lookupValue(
                    mirror.currentValue,
                    index,
                    undefined,
                )
            }) // never raw V
        }
        return lookupValue(value, index, importContext)
    }

    function lookupValue(value, index, importContext) {
        // `index` still names the segment that produced value; only deeper
        // lookups advance to the next segment.
        if (index === path.length - 1) {
            if (importContext !== undefined) {
                markImported(value, importContext)
            } else if (sharedOwnership) {
                markShared(value)  // escaping object/array -> shared
            }
            return value
        }
        if (isError(value)) return value
        if (!isTracked(value)) return undefined
        return walk(value, index + 1, importContext)
    }
}

// --- deletePath :  delete a.k ----------------------------------------------
function deletePath(root, path) {
    for (const key of path) {
        assertMutationKey(key)
    }
    if (path.length === 0) return null
    if (isPromise(root)) {
        return onResolve(root, resolvedRoot => {
            return deletePath(resolvedRoot, path)
        })
    }

    return walkMutationPath(root, path, false, (parent, key) => {
        if (isArray(parent)) return                    // array element deletion is outside this helper
        clearPromiseMirror(parent, key)                // no later writeback re-mirrors
        deleteProperty(parent, key)
    })
}

module.exports = { assignPath, deletePath, import: importValue, lookupPath }
