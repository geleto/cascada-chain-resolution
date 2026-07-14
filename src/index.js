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
const {
    pathAccessError,
    reportFatalError,
} = require("./error")
const {
    buildRefIndex,
    copyCounters,
    getRequiredRefCounter,
    refDeleteProperty,
    refIndexChildValue,
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

initPromiseMirrors(setProperty, refIndexChildValue)

// --- import : external value enters the runtime -----------------------------
function importValue(value, importContext) {
    if (!importContext) {
        reportFatalError(new Error("import requires an error context"))
    }

    const seen = new WeakSet()
    return importBranch(value)

    // Import registers every reachable promise now. Each settled branch runs
    // through this same walk before later mirror consumers can write it back.
    function importBranch(value) {
        if (isPromise(value)) {
            if (seen.has(value)) return value
            seen.add(value)
            return onValueResolve(value, importBranch)
        }
        if (!isTracked(value) || seen.has(value)) return value

        seen.add(value)
        markImported(value, importContext)
        for (const key of Object.keys(value)) {
            importBranch(value[key])
        }
        return value
    }
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
            if (importContext) {
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
        } else if (importContext && isTracked(value)) {
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
    walkMutationPath(chain._state, path, (parent, key) => {
        if (isPromise(value)) {
            // BIRTH 1 - ASSIGN: assigning a promise to a key. Always creates a
            // fresh mirror. Two assignments of the same promise at the same key
            // are divergent worlds and must not share currentValue.
            createAssignedPromiseMirror(parent, key, value) // FIRST: the FIFO ordering invariant
        } else {
            clearPromiseMirror(parent, key)            // plain value ends any prior promise mirror
        }
        setProperty(parent, key, value)
    })
}

// path identifies the complete mutation target. The walk starts at the private
// holder, where an empty path targets its value key, and recursive callers
// install copied branches back into their key.
function walkMutationPath(rootHolder, path, onTarget) {
    const targetPath = ["value", ...path]
    assertMutationPath(path)
    return walk(rootHolder, 0, false)

    function walk(value, index, inheritedSharedBranch) {
        if (isError(value)) return value
        if (!isTracked(value)) return pathAccessError()

        // Own marker only — mutation walks never need inherited context: an
        // import marker implies the shared mark, so every level inside an
        // imported region is COW'd, and shallowCopy stamps the copy's reused
        // children with their own markers before the walk descends into them.
        const valueImportContext = nodeImportContext(value, undefined)
        let parent = value
        const parentInsideSharedBranch = inheritedSharedBranch || hasSharedMark(value)

        const key = targetPath[index]
        if (parentInsideSharedBranch) {
            parent = shallowCopy(parent, key, true, valueImportContext)
        }
        // Asserted after the COW: copies carry only own enumerable keys, so
        // this fires only on genuinely un-shadowable shapes — a non-enumerable
        // own property on a node that was never shared away.
        assertCanMutateLanguageProperty(parent, key, valueImportContext)

        if (index === targetPath.length - 1) {
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
    return walkObservationPath(chain, path, (value, importContext) => {
        return markResolvedValue(value, importContext, sharedOwnership)
    })
}

// --- normalize : settled snapshot of a branch -------------------------------
// Returns a direct value when the answer is available in the synchronous prefix;
// returns a promise only when path resolution or branch settlement must suspend.
// sharedOwnership matches lookupPath for settled returns; pending branches still
// mark to pin the snapshot while promises settle.
function normalize(chain, path, sharedOwnership = true, plainCopy = false) {
    return walkObservationPath(chain, path, (value, importContext) => {
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

    const counter = getRequiredRefCounter(value)
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
    if (importContext) {
        markImported(value, importContext)
    } else if (sharedOwnership) {
        markShared(value)
    }
    return value
}

// --- hasError : query whether a path or branch contains an Error -------------
function hasError(chain, path) {
    return walkObservationPath(chain, path, (value, importContext) => {
        return hasErrorAtPathValue(value, importContext)
    })
}

// Entry for the value reached by hasError's path resolution. This boundary must
// build the index because its parent need not have been ref-indexed.
function hasErrorAtPathValue(value, importContext) {
    if (isError(value)) return true
    if (!isTracked(value)) return false

    const indexed = buildRefIndex(value, importContext)
    if (isError(indexed)) return true
    if (!Object.isExtensible(value)) return false

    return hasErrorInIndexedBranch(value, new WeakSet())
}

// The branch is already ref-indexed here: either hasErrorAtPathValue just
// indexed the resolved path value, or a promise mirror writeback indexed the
// resolved value before the hasError wait continuation ran.
function hasErrorInIndexedBranch(value, visited) {
    const counter = getRequiredRefCounter(value)
    if (counter.errorCount > 0) return true
    if (counter.promiseCount === 0) return false

    let resolveError
    const errorPromise = new Promise(resolve => {
        resolveError = () => resolve(true)
    })
    const cleanPromise = collectErrorSearchWaits(
        value,
        settledValueOrError => {
            return probeResolvedPromiseForErrors(
                settledValueOrError,
                resolveError,
                visited,
            )
        },
        visited,
    )
    // Promise.race aggregates hasError-internal waits, which are all
    // onValueResolve-derived; FIFO-sensitive registrations on key promises never
    // happen here.
    return Promise.race([
        errorPromise,
        onInternalResolve(cleanPromise, () => false),
    ])
}

// hasError's indexed-branch probe. Recursive promise waits rely on the mirror
// writeback registered while indexing the parent branch: it is earlier in the
// promise's FIFO list, so a live resolved branch has already been written
// through refSetProperty and indexed before this continuation probes it.
function probeIndexedBranchForErrors(
    value,
    resolveError,
    visited,
) {
    const counter = getRequiredRefCounter(value)
    if (counter.errorCount > 0) {
        resolveError()
        return undefined
    }
    if (counter.promiseCount === 0) return undefined

    return collectErrorSearchWaits(
        value,
        settledValueOrError => {
            return probeResolvedPromiseForErrors(
                settledValueOrError,
                resolveError,
                visited,
            )
        },
        visited,
    )
}

function probeResolvedPromiseForErrors(
    value,
    resolveError,
    visited,
) {
    if (isError(value)) {
        resolveError()
        return undefined
    }
    if (!isTracked(value) || !Object.isExtensible(value)) return undefined

    return probeIndexedBranchForErrors(
        value,
        resolveError,
        visited,
    )
}

// --- getErrors : collect every distinct Error in a path branch ---------------
function getErrors(chain, path) {
    const errors = new Set()
    return walkObservationPath(chain, path, (value, importContext) => {
        const readiness = collectErrorsAtPathValue(
            value,
            importContext,
            errors,
        )
        if (!readiness) return [...errors]
        return onInternalResolve(readiness, () => [...errors])
    })
}

function collectErrorsAtPathValue(value, importContext, errors) {
    if (isError(value)) {
        errors.add(value)
        return undefined
    }
    if (!isTracked(value)) return undefined

    const indexed = buildRefIndex(value, importContext)
    if (isError(indexed)) {
        errors.add(indexed)
        return undefined
    }
    if (!Object.isExtensible(value)) return undefined

    return collectErrorsInIndexedBranch(value, errors, new WeakSet())
}

function collectErrorsInIndexedBranch(
    value,
    errors,
    visited,
) {
    return collectErrorSearchWaits(
        value,
        settledValueOrError => {
            if (isError(settledValueOrError)) {
                errors.add(settledValueOrError)
                return undefined
            }
            if (!isTracked(settledValueOrError) ||
                !Object.isExtensible(settledValueOrError)) {
                return undefined
            }
            return collectErrorsInIndexedBranch(
                settledValueOrError,
                errors,
                visited,
            )
        },
        visited,
        errors,
    )
}

// Shared synchronous walk for error queries. hasError follows only promises;
// getErrors also visits counted Error branches by supplying its result Set.
function collectErrorSearchWaits(
    value,
    onPromiseValue,
    visited,
    errors = undefined,
) {
    const waitPromises = []
    walk(value)
    return waitPromises.length === 0 ? undefined : Promise.all(waitPromises)

    function walk(node) {
        // Shared marks are permanent, so only shared nodes can be reused safely
        // across synchronous and promise-resolved parts of this search.
        if (hasSharedMark(node)) {
            if (visited.has(node)) return
            visited.add(node)
        }

        const counter = getRequiredRefCounter(node)
        if (counter.promiseCount === 0 &&
            (!errors || counter.errorCount === 0)) return

        for (const key of Object.keys(node)) {
            const child = node[key]
            if (isError(child)) {
                if (errors) errors.add(child)
            } else if (isPromise(child)) {
                const mirror = getOrCreatePromiseMirror(node, key, child)
                waitPromises.push(onValueResolve(child, () => {
                    return onPromiseValue(mirror.currentValue)
                }))
            } else if (isTracked(child) && Object.isExtensible(child)) {
                const childCounter = getRequiredRefCounter(child)
                if (childCounter.promiseCount > 0 ||
                    (errors && childCounter.errorCount > 0)) {
                    walk(child)
                }
            }
        }
    }
}

// Observational path resolution through the Chain's private root holder. Callers
// decide whether the reached value escapes and therefore whether to mark it.
// Every preceding value must be trackable; only the final target may be
// missing, and an empty path targets the root.
function walkObservationPath(chain, path, onResolved) {
    const targetPath = ["value", ...path]
    return walkFromParent(chain._state, 0, undefined)

    function walkFromParent(
        parent,
        index,
        inheritedImportContext,
    ) {
        if (isError(parent)) {
            return onResolved(parent, inheritedImportContext)
        }
        if (!isTracked(parent)) {
            return onResolved(pathAccessError(), inheritedImportContext)
        }

        const importContext = nodeImportContext(parent, inheritedImportContext)
        const key = targetPath[index]
        const value = readLanguageProperty(parent, key)
        if (isPromise(value)) {
            if (!Object.isExtensible(parent)) {
                return onValueResolve(value, settledValueOrError => {
                    return walkValue(
                        settledValueOrError,
                        index,
                        importContext,
                    )
                })
            }

            const mirror = getOrCreatePromiseMirror(parent, key, value, importContext)
            return onValueResolve(value, () => {
                return walkValue(
                    mirror.currentValue,
                    index,
                    undefined,
                )
            })
        }
        return walkValue(value, index, importContext)
    }

    function walkValue(value, index, importContext) {
        if (index === targetPath.length - 1) {
            return onResolved(value, importContext)
        }
        if (isError(value)) {
            return onResolved(value, importContext)
        }
        if (!isTracked(value)) {
            return onResolved(pathAccessError(), importContext)
        }
        return walkFromParent(
            value,
            index + 1,
            importContext,
        )
    }
}

function copyToPlainValue(value, copies = new Map()) {
    if (!isTracked(value)) return value

    const existing = copies.get(value)
    if (existing) return existing

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
    walkMutationPath(chain._state, path, (parent, key) => {
        clearPromiseMirror(parent, key) // no later writeback restores the value
        if (deletesRoot) {
            setProperty(parent, key, null)
        } else {
            deleteProperty(parent, key)
        }
    })
}

module.exports = {
    Chain,
    assignPath,
    deletePath,
    getErrors,
    hasError,
    import: importValue,
    lookupPath,
    normalize,
}
