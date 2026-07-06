// --- Notation ---------------------------------------------------------------
//   a.k.y = 1   -> assignPath(a, ["k", "y"], 1)
//   = a.k.y     -> lookupPath(a, ["k", "y"])
//   delete a.k  -> deletePath(a, ["k"])
//   P(V)        -> a promise P that resolves to value V
//
// A promise mirror {promise, currentValue} lives in PROMISE_MIRRORS.get(node)[key]:
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
    propagateClean,
    settlePromise,
    updateCleanCounts,
} = require("./helpers")

// Load-bearing helper contract:
// Every continuation that depends on one promise's FIFO order must go through
// settlePromise/onResolve, and must do so against the raw promise instance held
// at the key. Mixing in bare .then or wrapping a derived proxy can reorder a
// suspended read behind a later write. settlePromise also maps rejection to the
// language Error node, so intermediate advances stop instead of autovivifying.
const PROMISE_MIRRORS = new WeakMap()
const IMMUTABLE = Symbol("IMMUTABLE")

// The immutable mark is runtime metadata: language-invisible, copied nowhere,
// and used only to decide whether a write must copy before mutation. Frozen or
// sealed objects act immutable without receiving our Symbol metadata.
function hasImmutableMark(value) {
    return isTracked(value) &&
        (value[IMMUTABLE] === true || !Object.isExtensible(value))
}

// An unmarked object/array is owned by exactly one Cascada variable/path: object
// literals and async assignments enter one owner, and Cascada does not assign
// the same object into two roots directly. A value becomes immutable through
// import, shared-ownership lookupPath escape, or COW of an immutable branch
// when an existing child value is reused by both the old and new worlds.
// Promise-valued children follow that same COW rule through forked mirrors.
function markImmutable(value) {
    // Bare promises crossing an ownership boundary resolve to immutable values.
    // Promise keys with mirrors are different: they must mark mirror.currentValue,
    // because currentValue may have advanced away from the raw settled value.
    if (isPromise(value)) return settlePromise(value).then(markImmutable)

    if (!isTracked(value)) return value
    if (!Object.isExtensible(value)) return value

    Object.defineProperty(value, IMMUTABLE, {
        value: true,
        enumerable: false,
        writable: true,
        configurable: true,
    })
    return value
}

// --- Promise mirror map -----------------------------------------------------
function getPromiseMirrorMap(node) {
    let map = PROMISE_MIRRORS.get(node)
    if (map === undefined) {
        map = Object.create(null)                    // null proto: no inherited keys
        PROMISE_MIRRORS.set(node, map)
    }
    return map
}

function canUpdateMirrorToLive(node, key, mirror) {
    return PROMISE_MIRRORS.get(node)?.[key] === mirror
}

// Register the mirror's resolved-value handler. getValue runs inside the
// onResolve continuation, so FORK reads sourceMirror.currentValue at the
// copier's FIFO slot, not earlier. The chosen value is stored as currentValue,
// then written to the live key only if this exact mirror still owns it.
function onResolvedValue(node, key, mirror, getValue, markResolvedValueImmutable = false) {
    onResolve(mirror.promise, settledValue => {
        const value = getValue(settledValue)
        if (markResolvedValueImmutable && isTracked(value)) markImmutable(value)
        mirror.currentValue = value

        if (canUpdateMirrorToLive(node, key, mirror)) {
            node[key] = value
            propagateClean(node, key)
        }
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
    const map = PROMISE_MIRRORS.get(node)
    if (!map) return
    delete map[key]
}

// --- import : external value enters the runtime -----------------------------
function importValue(value, rescan = true) {
    if (isPromise(value)) {
        return markImmutable(value).then(settledValue => {
            if (rescan) scanImportedValue(settledValue, new Set())
            return settledValue
        })
    }

    importResolvedValue(value, rescan)
    return value
}

function importResolvedValue(value, rescan) {
    if (!isTracked(value)) return value

    markImmutable(value)
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

function shallowCopy(obj, pathKey = undefined, markReusedChildrenImmutable = false) {
    const copy = isArray(obj) ? new Array(obj.length) : {}
    const pathKeyString = pathKey === undefined ? undefined : String(pathKey)

    // Copy only language-visible string keys; promise mirrors live in a WeakMap
    // and the IMMUTABLE symbol is non-enumerable, so metadata never enters the
    // copied world.
    // The source object keeps its own immutable mark. When a copy reuses child
    // objects from an immutable branch, those non-path children are marked too
    // so their shared references stay protected.
    for (const key of Object.keys(obj)) {
        const isPathKey = key === pathKeyString
        const markCopiedValueImmutable = markReusedChildrenImmutable && !isPathKey
        const value = obj[key]
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
            // is protected by the walk's inherited immutable state if we enter it,
            // and may simply be replaced/deleted at the target.
            const sourceMirror = getOrCreatePromiseMirror(obj, key, value) // DISCOVERY if source was an orphan.
            const mirror = { promise: value, currentValue: undefined }
            getPromiseMirrorMap(copy)[key] = mirror
            onResolvedValue(copy, key, mirror, () => sourceMirror.currentValue, markCopiedValueImmutable)
        } else if (markCopiedValueImmutable && isTracked(value)) {
            markImmutable(value)
        }
    }
    return copy
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignPath(root, path, value) {
    if (path.length === 0) return value
    if (isPromise(root)) {
        return settlePromise(root).then(resolvedRoot => {
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
            parent[key] = value
        } else {
            clearPromiseMirror(parent, key)            // plain value ends any prior promise mirror
            parent[key] = value
        }
        updateCleanCounts(parent, key)
    })
}

// Walk returns the value that should live at this path level after mutation.
// The root caller returns it; recursive callers install it into their key.
function walkMutationPath(root, path, createMissingIntermediates, onTarget) {
    return walk(root, 0, false)

    function walk(value, index, inheritedImmutableBranch) {
        if (isError(value)) return value

        const valueIsTracked = isTracked(value)
        let parent = value
        let parentInsideImmutableBranch = valueIsTracked && inheritedImmutableBranch
        if (!parentInsideImmutableBranch) {
            parentInsideImmutableBranch = hasImmutableMark(value)
        }

        if (createMissingIntermediates) {
            if (value === null || value === undefined) {
                parent = {}
                parentInsideImmutableBranch = false
            } else if (!valueIsTracked) {
                return new Error("Cannot assign into primitive value")
            }
        } else if (!valueIsTracked) {
            return value
        }

        const key = path[index]
        if (parentInsideImmutableBranch) {
            parent = shallowCopy(parent, key, true)
        }

        if (index === path.length - 1) {
            onTarget(parent, key)
            return parent
        }

        const child = parent[key]
        if (isPromise(child)) {
            const mirror = getOrCreatePromiseMirror(parent, key, child)
            onResolve(child, () => {
                const next = walk(mirror.currentValue, index + 1, parentInsideImmutableBranch)
                mirror.currentValue = next
                if (canUpdateMirrorToLive(parent, key, mirror)) {
                    parent[key] = next
                }
            })
            return parent
        }

        const next = walk(child, index + 1, parentInsideImmutableBranch)
        if (next !== child) {
            clearPromiseMirror(parent, key)
            parent[key] = next
        }
        return parent
    }
}

// --- lookupPath :  = a.k.y --------------------------------------------------
// sharedOwnership is false for a pure read or when ownership is ceded to
// the caller, e.g. the final `return x` from an otherwise unused variable.
function lookupPath(root, path, sharedOwnership = true) {
    if (isPromise(root)) {
        return settlePromise(root).then(resolvedRoot => {
            return lookupPath(resolvedRoot, path, sharedOwnership)
        })
    }

    if (path.length === 0) {
        if (sharedOwnership) markImmutable(root)       // escaping object/array -> immutable
        return root
    }

    // Walk lookup paths through promise mirrors. Promise-valued keys resolve
    // before we decide whether the reached value is final or intermediate.
    return walk(root, 0)

    function walk(parent, index) {
        if (isError(parent)) return parent
        if (!isTracked(parent)) return undefined

        const key = path[index]
        const value = parent[key]
        if (isPromise(value)) {
            const mirror = getOrCreatePromiseMirror(parent, key, value)
            return onResolve(value, () => lookupValue(mirror.currentValue, index)) // never raw V
        }
        return lookupValue(value, index)
    }

    function lookupValue(value, index) {
        if (index === path.length - 1) {
            if (sharedOwnership) markImmutable(value)  // escaping object/array -> immutable
            return value
        }
        if (isError(value)) return value
        if (!isTracked(value)) return undefined
        return walk(value, index + 1)
    }
}

// --- deletePath :  delete a.k ----------------------------------------------
function deletePath(root, path) {
    if (path.length === 0) return null
    if (isPromise(root)) {
        return settlePromise(root).then(resolvedRoot => {
            return deletePath(resolvedRoot, path)
        })
    }

    return walkMutationPath(root, path, false, (parent, key) => {
        if (isArray(parent)) return                    // array element deletion is outside this helper
        clearPromiseMirror(parent, key)                // no later writeback re-mirrors
        delete parent[key]
        updateCleanCounts(parent, key)
    })
}

module.exports = { assignPath, deletePath, import: importValue, lookupPath }
