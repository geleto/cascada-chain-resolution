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
// A promise mirror is born at three points: ASSIGN, DISCOVERY, FORK. ASSIGN and
// DISCOVERY seed currentValue from the raw resolved value. A FORK (shallow copy
// of a node whose key holds a promise) seeds from the source mirror's
// currentValue at the copier's FIFO slot: the copied world branches off at
// exactly the copier's position in program order. One exception: a fork from a
// non-extensible source also seeds raw — no mirror can attach to a frozen
// holder and nothing can ever replace its key, so the raw settled value is the
// only version that will ever exist.

const {
    isArray,
    isError,
    isPromise,
    isTracked,
    onInternalResolve,
    onValueResolve,
} = require("./helpers")
const { reportFatalError } = require("./error")
const {
    buildRefIndex,
    copyCounters,
    getRefCounter,
    refDeleteProperty,
    refSetProperty,
    waitForSettlement,
} = require("./refcounts")
const {
    assertCanMutateLanguageProperty,
    assertMutationPath,
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
// onValueResolve, and must do so against the raw promise instance held at the key.
// Mixing in bare .then or wrapping a derived proxy can reorder a suspended read
// behind a later write. onValueResolve also maps rejection to the
// language Error node, so intermediate advances stop instead of autovivifying.

const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

class Chain {
    constructor(initialValue) {
        this._state = { value: initialValue }
        this._commands = []
    }
}

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

function defineOwnProtoSlot(copy) {
    // Object.keys only sees an own enumerable data key on the source, but a
    // fresh copy would otherwise inherit Object.prototype.__proto__. Pre-create
    // an own data slot so plain assignment preserves the value instead of
    // invoking the legacy prototype setter.
    Object.defineProperty(copy, "__proto__", {
        value: undefined,
        enumerable: true,
        writable: true,
        configurable: true,
    })
}

initPromiseMirrors(setProperty)

// --- import : external value enters the runtime -----------------------------
function importValue(value, importContext) {
    if (importContext === undefined) {
        reportFatalError(new Error("import requires an error context"))
    }
    if (isPromise(value)) {
        return onValueResolve(value, settledValueOrError => {
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
        defineOwnProtoSlot(copy)
    }

    // Copy only language-visible own enumerable string keys; META lives outside
    // that surface (non-enumerable Symbol or WeakMap entry), so mirrors,
    // counters, and marks never enter the copy. The source keeps its own marks.
    // Reused children from a shared branch are marked shared so their shared
    // references stay protected — except the path key, which the walk's
    // inherited shared state covers. Reused children of an imported node are
    // marked imported instead, path key included: provenance is about origin,
    // not aliasing, and imported data must COW regardless.
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
            // and may simply be replaced/deleted at the target. Imported
            // captures are marked imported (which implies shared) regardless of
            // path position — provenance must survive the copy.
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
function assignPath(chain, path, value) {
    walkMutationPath(chain._state, path, true, (parent, key) => {
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

// The walk starts at the Chain's private holder, so `_state.value` is prepended
// to the user path. Recursive callers install copied branches back into their key.
function walkMutationPath(rootHolder, path, createMissingIntermediates, onTarget) {
    assertMutationPath(path)
    const holderPath = ["value", ...path]
    return walk(rootHolder, 0, false)

    function walk(value, index, inheritedSharedBranch) {
        if (isError(value)) return value

        const valueIsTracked = isTracked(value)
        // Own marker only — mutation walks never need inherited context: an
        // import marker implies the shared mark, so every level inside an
        // imported region is COW'd, and shallowCopy stamps the copy's reused
        // children with their own markers before the walk descends into them.
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

        const key = holderPath[index]
        if (parentInsideSharedBranch) {
            parent = shallowCopy(parent, key, true, valueImportContext)
        }
        // Asserted after the COW: copies carry only own enumerable keys, so
        // this fires only on genuinely un-shadowable shapes — a non-enumerable
        // own property on a node that was never shared away.
        assertCanMutateLanguageProperty(parent, key, valueImportContext)

        if (index === holderPath.length - 1) {
            onTarget(parent, key)
            return parent
        }

        const child = readLanguageProperty(parent, key)
        if (isPromise(child)) {
            const mirror = getOrCreatePromiseMirror(parent, key, child)
            onValueResolve(child, () => {
                let next = walk(
                    mirror.currentValue,
                    index + 1,
                    parentInsideSharedBranch,
                )
                if (isLivePromiseMirror(parent, key, mirror) &&
                    next !== readLanguageProperty(parent, key)) {
                    // Validation may replace the candidate with a language Error.
                    next = setProperty(parent, key, next)
                }
                mirror.currentValue = next
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
// Imported values are marked on extraction even without shared ownership:
// provenance is about origin, not aliasing, and an ownership-transferred
// external branch is still external. (markImported implies the shared mark.)
function lookupPath(chain, path, sharedOwnership = true) {
    return resolvePath(chain, path, (value, importContext) => {
        return markResolvedValue(value, importContext, sharedOwnership)
    })
}

// --- normalize : settled snapshot of a branch -------------------------------
// Returns a direct value when the answer is available in the synchronous prefix;
// returns a promise only when path resolution or branch settlement must suspend.
// sharedOwnership matches lookupPath for settled returns; pending branches still
// mark to pin the snapshot while promises settle.
function normalize(chain, path, sharedOwnership = true, plainCopy = false) {
    return resolvePath(chain, path, (value, importContext) => {
        return normalizeResolved(value, importContext, sharedOwnership, plainCopy)
    })
}

function normalizeResolved(value, importContext, sharedOwnership, plainCopy) {
    if (isError(value) || !isTracked(value)) return value

    const indexed = buildRefIndex(value, importContext)
    if (isError(indexed)) return indexed

    if (!Object.isExtensible(value)) {
        if (!plainCopy) markResolvedValue(value, importContext, sharedOwnership)
        return plainCopy ? copyToPlainValue(value) : value
    }

    const counter = getRefCounter(value)
    if (counter.promiseCount === 0) {
        if (counter.errorCount > 0) return new Error("normalize: branch contains errors")
        if (plainCopy) return copyToPlainValue(value)
        markResolvedValue(value, importContext, sharedOwnership)
        return value
    }

    markResolvedValue(value, importContext, true)     // pin regardless of sharedOwnership
    return onInternalResolve(waitForSettlement(value), () => {
        if (counter.errorCount > 0) return new Error("normalize: branch contains errors")
        return plainCopy ? copyToPlainValue(value) : value
    })
}

function markResolvedValue(value, importContext, sharedOwnership) {
    if (importContext !== undefined) {
        markImported(value, importContext)
    } else if (sharedOwnership) {
        markShared(value)
    }
    return value
}

// --- hasError : query whether a path or branch contains an Error -------------
function hasError(chain, path) {
    const atRoot = path.length === 0
    const parentPath = atRoot ? path : path.slice(0, -1)
    const key = path[path.length - 1]
    return resolvePath(chain, parentPath, (parent, importContext) => {
        if (atRoot) return hasErrorAtPathValue(parent, importContext)
        if (isError(parent)) return true
        if (!isTracked(parent)) return true

        const value = readLanguageProperty(parent, key)
        if (isPromise(value)) {
            if (!Object.isExtensible(parent)) {
                return onValueResolve(value, settledValueOrError => {
                    return hasErrorAtPathValue(settledValueOrError, importContext)
                })
            }

            const mirror = getOrCreatePromiseMirror(parent, key, value, importContext)
            return onValueResolve(value, () => {
                return hasErrorAtPathValue(mirror.currentValue, undefined)
            })
        }
        if (value === undefined) return false
        return hasErrorAtPathValue(value, importContext)
    })
}

// Entry for the value reached by hasError's path resolution. This may be a
// direct branch, a root promise result, or a terminal promise key whose parent
// was not ref-indexed when writeback ran, so this boundary must build the index.
function hasErrorAtPathValue(value, importContext) {
    if (isError(value)) return true
    if (!isTracked(value)) return false

    const indexed = buildRefIndex(value, importContext)
    if (isError(indexed)) return true
    if (!Object.isExtensible(value)) return false

    return hasErrorInIndexedBranch(value)
}

// The branch is already ref-indexed here: either hasErrorAtPathValue just
// indexed the resolved path value, or a promise mirror writeback indexed the
// resolved value before the hasError wait continuation ran.
function hasErrorInIndexedBranch(value) {
    let foundError = false
    let resolveError
    // The executor runs synchronously, so resolveError is assigned before the
    // probe below can call it.
    const errorPromise = new Promise(resolve => {
        resolveError = () => {
            foundError = true
            resolve(true)
        }
    })
    const cleanPromise = probeIndexedBranchForErrors(value, resolveError)
    if (foundError) return true
    if (cleanPromise === undefined) return false
    // Promise.race aggregates hasError-internal waits, which are all
    // onValueResolve-derived; FIFO-sensitive registrations on key promises never
    // happen here.
    return Promise.race([
        errorPromise,
        onInternalResolve(cleanPromise, () => false),
    ])
}

function throwFatalHasErrorProbeError() {
    reportFatalError(new Error("hasError probe requires an indexed branch"))
}

function throwFatalHasErrorWaitCollectionError() {
    reportFatalError(new Error("hasError wait collection requires an indexed branch"))
}

// hasError's indexed-branch probe. Recursive promise waits rely on the mirror
// writeback registered while indexing the parent branch: it is earlier in the
// promise's FIFO list, so a live resolved branch has already been written
// through refSetProperty and indexed before this continuation probes it.
function probeIndexedBranchForErrors(value, resolveError) {
    if (!isTracked(value) || !Object.isExtensible(value)) {
        throwFatalHasErrorProbeError()
    }

    const counter = getRefCounter(value)
    if (counter === undefined) {
        throwFatalHasErrorProbeError()
    }
    if (counter.errorCount > 0) {
        resolveError()
        return undefined
    }
    if (counter.promiseCount === 0) return undefined

    const waitPromises = []
    collectPromiseWaits(value, waitPromises, resolveError, new Set())
    if (waitPromises.length === 0) return undefined

    return Promise.all(waitPromises)
}

function collectPromiseWaits(value, waitPromises, resolveError, visited) {
    if (!isTracked(value) || !Object.isExtensible(value)) {
        throwFatalHasErrorWaitCollectionError()
    }
    if (visited.has(value)) return
    visited.add(value)

    const counter = getRefCounter(value)
    if (counter?.parents === undefined) {
        throwFatalHasErrorWaitCollectionError()
    }
    if (counter.promiseCount === 0) return

    for (const key of Object.keys(value)) {
        const child = value[key]
        if (isPromise(child)) {
            const mirror = getOrCreatePromiseMirror(value, key, child)
            waitPromises.push(onValueResolve(child, () => {
                return probeResolvedPromiseForErrors(mirror.currentValue, resolveError)
            }))
        } else if (isTracked(child) && Object.isExtensible(child)) {
            const childCounter = getRefCounter(child)
            if (childCounter?.parents === undefined) {
                throwFatalHasErrorWaitCollectionError()
            }
            if (childCounter.promiseCount === 0) continue
            collectPromiseWaits(child, waitPromises, resolveError, visited)
        }
    }
}

function probeResolvedPromiseForErrors(value, resolveError) {
    const result = hasErrorAtPathValue(value, undefined)
    if (result === true) {
        resolveError()
        return undefined
    }
    if (result === false) return undefined

    return onInternalResolve(result, foundError => {
        if (foundError) resolveError()
    })
}

// Observational path resolution through the Chain's private root holder. Callers
// decide whether the reached value escapes and therefore whether to mark it.
function resolvePath(chain, path, onResolved) {
    const holderPath = ["value", ...path]
    return resolveFromParent(chain._state, 0, undefined)

    function resolveFromParent(parent, index, inheritedImportContext) {
        if (isError(parent)) return onResolved(parent, inheritedImportContext)
        if (!isTracked(parent)) return onResolved(undefined, inheritedImportContext)

        const importContext = nodeImportContext(parent, inheritedImportContext)
        const key = holderPath[index]
        const value = readLanguageProperty(parent, key)
        if (isPromise(value)) {
            if (!Object.isExtensible(parent)) {
                return onValueResolve(value, settledValueOrError => {
                    return resolvePathValue(settledValueOrError, index, importContext)
                })
            }

            const mirror = getOrCreatePromiseMirror(parent, key, value, importContext)
            return onValueResolve(value, () => {
                return resolvePathValue(mirror.currentValue, index, undefined)
            })
        }
        return resolvePathValue(value, index, importContext)
    }

    function resolvePathValue(value, index, importContext) {
        if (index === holderPath.length - 1) {
            return onResolved(value, importContext)
        }
        if (isError(value)) return onResolved(value, importContext)
        if (!isTracked(value)) return onResolved(undefined, importContext)
        return resolveFromParent(value, index + 1, importContext)
    }
}

function copyToPlainValue(value, copies = new Map()) {
    if (!isTracked(value)) return value

    const existing = copies.get(value)
    if (existing !== undefined) return existing

    const copy = isArray(value) ? new Array(value.length) : {}
    copies.set(value, copy)

    const keys = Object.keys(value)
    if (keys.includes("__proto__")) {
        defineOwnProtoSlot(copy)
    }
    for (const key of keys) {
        // Sanctioned write bypass: normalize(..., plainCopy) creates output data
        // outside the runtime graph, so there is no metadata to bookkeep.
        copy[key] = copyToPlainValue(value[key], copies)
    }
    return copy
}

// --- deletePath :  delete a.k ----------------------------------------------
function deletePath(chain, path) {
    const deletesRoot = path.length === 0
    walkMutationPath(chain._state, path, false, (parent, key) => {
        if (deletesRoot) {
            clearPromiseMirror(parent, key)            // no later writeback re-mirrors
            setProperty(parent, key, null)
        } else {
            clearPromiseMirror(parent, key)
            deleteProperty(parent, key)
        }
    })
}

module.exports = { Chain, assignPath, deletePath, hasError, import: importValue, lookupPath, normalize }
