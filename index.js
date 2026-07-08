"use strict"

// --- Notation ---------------------------------------------------------------
//   a.k.y = 1   -> assignPath(a, ["k", "y"], 1)
//   = a.k.y     -> lookupPath(a, ["k", "y"])
//   delete a.k  -> deletePath(a, ["k"])
//   P(V)        -> a promise P that resolves to value V
//
// A promise mirror {promise, currentValue} lives in node[PROMISE_MIRRORS][key]:
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
    initRef,
    refDeleteProperty,
    refSetProperty,
} = require("./refcounts")

// Load-bearing helper contract:
// Every continuation that depends on one promise's FIFO order must go through
// settlePromise/onResolve, and must do so against the raw promise instance held
// at the key. Mixing in bare .then or wrapping a derived proxy can reorder a
// suspended read behind a later write. settlePromise also maps rejection to the
// language Error node, so intermediate advances stop instead of autovivifying.
const PROMISE_MIRRORS = Symbol("PROMISE_MIRRORS")
const SHARED = Symbol("SHARED")
const hasOwn = Object.prototype.hasOwnProperty
const FORBIDDEN_PATH_KEY = "__proto__"

function readOwnProperty(node, key) {
    return hasOwn.call(node, key) ? node[key] : undefined
}

function forbiddenPathError(path) {
    for (const key of path) {
        if (key === FORBIDDEN_PATH_KEY) {
            return new Error("Cannot use __proto__ as a path segment")
        }
    }
    return null
}

// The shared mark is runtime metadata: language-invisible, copied nowhere,
// and used only to decide whether a write must copy before mutation. Frozen or
// sealed objects act shared for COW purposes without receiving our Symbol metadata.
function hasSharedMark(value) {
    return isTracked(value) &&
        (value[SHARED] === true || !Object.isExtensible(value))
}

// An unmarked object/array is owned by exactly one Cascada variable/path: object
// literals and async assignments enter one owner, and Cascada does not assign
// the same object into two roots directly. A value becomes shared through
// import, shared-ownership lookupPath escape, or COW of a shared branch
// when an existing child value is reused by both the old and new worlds.
// Promise-valued children follow that same COW rule through forked mirrors.
function markShared(value) {
    // Bare promises crossing an ownership boundary resolve to shared values.
    // Promise keys with mirrors are different: they must mark mirror.currentValue,
    // because currentValue may have advanced away from the raw settled value.
    if (isPromise(value)) return onResolve(value, markShared)

    if (!isTracked(value)) return value
    if (!Object.isExtensible(value)) return value

    Object.defineProperty(value, SHARED, {
        value: true,
        enumerable: false,
        writable: true,
        configurable: true,
    })
    return value
}

// --- Promise mirror map -----------------------------------------------------
function getPromiseMirrorMap(node) {
    let map = node[PROMISE_MIRRORS]
    if (map === undefined) {
        map = Object.create(null)                    // null proto: no inherited keys
        Object.defineProperty(node, PROMISE_MIRRORS, {
            value: map,
            enumerable: false,
            writable: true,
            configurable: true,
        })
    }
    return map
}

function canUpdateMirrorToLive(node, key, mirror) {
    return node[PROMISE_MIRRORS]?.[key] === mirror
}

// Register the mirror's resolved-value handler. Rejected data promises become
// Error values here through onResolve/settlePromise; runtime bugs thrown by
// this continuation are intentionally not caught.
// getValue runs inside the onResolve continuation, so FORK reads
// sourceMirror.currentValue at the copier's FIFO slot, not earlier. The chosen
// value is stored as currentValue, then written to the live key only if this
// exact mirror still owns it.
function onResolvedValue(node, key, mirror, getValue, markResolvedValueShared = false) {
    onResolve(mirror.promise, settledValueOrError => {
        let value = getValue(settledValueOrError)
        if (markResolvedValueShared && isTracked(value)) markShared(value)

        if (canUpdateMirrorToLive(node, key, mirror)) {
            value = setProperty(node, key, value)
        }
        mirror.currentValue = value
        // Else a later op reassigned/deleted the key: keep currentValue alive
        // privately for reads that captured this mirror; leave the property alone.
    })
}

// BIRTH 2 - DISCOVERY: find the mirror for a pending promise reached during a
// walk, or lazily create one for an orphan (imported data, raw literal).
// COW-copied keys must never arrive here mirrorless; they are forked eagerly
// in shallowCopy. Minting one lazily here would seed from the raw resolved
// value and lose every write made by ops issued before the copy.
function getOrCreatePromiseMirror(node, key, promise) {
    const map = getPromiseMirrorMap(node)
    if (map[key]?.promise === promise) {
        return map[key]
    }

    const mirror = { promise, currentValue: undefined }
    map[key] = mirror
    onResolvedValue(node, key, mirror, value => value)

    return mirror
}

function clearPromiseMirror(node, key) {
    const map = node[PROMISE_MIRRORS]
    if (!map) return
    delete map[key]
}

initRef({ mintPromiseMirror: getOrCreatePromiseMirror })

function setProperty(parent, key, value) {
    const nextValue = refSetProperty(parent, key, value)
    parent[key] = nextValue
    return nextValue
}

function deleteProperty(parent, key) {
    refDeleteProperty(parent, key)
    delete parent[key]
}

// --- import : external value enters the runtime -----------------------------
function importValue(value, rescan = true) {
    if (isPromise(value)) {
        return onResolve(value, settledValue => importResolvedValue(settledValue, rescan))
    }

    return importResolvedValue(value, rescan)
}

function importResolvedValue(value, rescan) {
    if (!isTracked(value)) return value

    markShared(value)
    if (rescan) scanImportedValue(value, new Set())
    return value
}

function scanImportedValue(value, seen) {
    if (!isTracked(value) || seen.has(value)) return
    seen.add(value)

    for (const key of Object.keys(value)) {
        const child = value[key]

        if (isPromise(child)) {
            const mirror = getOrCreatePromiseMirror(value, key, child)
            onResolve(child, () => {
                importResolvedValue(mirror.currentValue, true)
            })
        } else {
            scanImportedValue(child, seen)
        }
    }
}

function shallowCopy(obj, pathKey = undefined, markReusedChildrenShared = false) {
    const copy = isArray(obj) ? new Array(obj.length) : {}
    const pathKeyString = pathKey === undefined ? undefined : String(pathKey)

    // Copy only language-visible string keys; promise mirrors and SHARED are
    // non-enumerable Symbol metadata, so they never enter the copied world.
    // The source object keeps its own shared mark. When a copy reuses child
    // objects from a shared branch, those non-path children are marked too
    // so their shared references stay protected.
    for (const key of Object.keys(obj)) {
        const isPathKey = key === pathKeyString
        const markCopiedValueShared = markReusedChildrenShared && !isPathKey
        const value = obj[key]
        // Sanctioned write bypass: the copy is unobservable until it is installed
        // through setProperty, or copyCounters snapshots the already-indexed source.
        copy[key] = value
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
            const sourceMirror = getOrCreatePromiseMirror(obj, key, value) // DISCOVERY if source was an orphan.
            const mirror = { promise: value, currentValue: undefined }
            getPromiseMirrorMap(copy)[key] = mirror
            onResolvedValue(copy, key, mirror, () => sourceMirror.currentValue, markCopiedValueShared)
        } else if (markCopiedValueShared && isTracked(value)) {
            markShared(value)
        }
    }
    copyCounters(obj, copy)
    return copy
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignPath(root, path, value) {
    const pathError = forbiddenPathError(path)
    if (pathError) return pathError
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
            const map = getPromiseMirrorMap(parent)
            const mirror = { promise: value, currentValue: undefined }
            map[key] = mirror
            onResolvedValue(parent, key, mirror, settledValue => settledValue) // FIRST: the FIFO ordering invariant
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
            parent = shallowCopy(parent, key, true)
        }

        if (index === path.length - 1) {
            onTarget(parent, key)
            return parent
        }

        const child = readOwnProperty(parent, key)
        if (isPromise(child)) {
            const mirror = getOrCreatePromiseMirror(parent, key, child)
            onResolve(child, () => {
                const next = walk(mirror.currentValue, index + 1, parentInsideSharedBranch)
                mirror.currentValue = next
                if (canUpdateMirrorToLive(parent, key, mirror) &&
                    next !== readOwnProperty(parent, key)) {
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
    const pathError = forbiddenPathError(path)
    if (pathError) return pathError
    if (isPromise(root)) {
        return onResolve(root, resolvedRoot => {
            return lookupPath(resolvedRoot, path, sharedOwnership)
        })
    }

    if (path.length === 0) {
        if (sharedOwnership) markShared(root)       // escaping object/array -> shared
        return root
    }

    // Walk lookup paths through promise mirrors. Promise-valued keys resolve
    // before we decide whether the reached value is final or intermediate.
    return walk(root, 0)

    function walk(parent, index) {
        if (isError(parent)) return parent
        if (!isTracked(parent)) return undefined

        const key = path[index]
        const value = readOwnProperty(parent, key)
        if (isPromise(value)) {
            const mirror = getOrCreatePromiseMirror(parent, key, value)
            return onResolve(value, () => lookupValue(mirror.currentValue, index)) // never raw V
        }
        return lookupValue(value, index)
    }

    function lookupValue(value, index) {
        // `index` still names the segment that produced value; only deeper
        // lookups advance to the next segment.
        if (index === path.length - 1) {
            if (sharedOwnership) markShared(value)  // escaping object/array -> shared
            return value
        }
        if (isError(value)) return value
        if (!isTracked(value)) return undefined
        return walk(value, index + 1)
    }
}

// --- deletePath :  delete a.k ----------------------------------------------
function deletePath(root, path) {
    const pathError = forbiddenPathError(path)
    if (pathError) return pathError
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
