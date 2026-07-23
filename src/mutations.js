"use strict"

const {
    isError,
    isPromise,
    isTracked,
} = require("./helpers")
const {
    pathAccessError,
} = require("./error")
const {
    commitPropertyTransition,
    copyCounters,
    deleteEdge,
    preparePropertyTransition,
} = require("./refcounts")
const {
    assertCanDeleteLanguageProperty,
    assertCanMutateLanguageProperty,
    assertCanSetLanguageProperty,
    writeLanguageProperty,
} = require("./validate")
const {
    hasSharedMark,
    markShared,
    nodeImportBoundary,
} = require("./meta")
const {
    attachImportedDataToImportedData,
    import: importValue,
} = require("./import")
const {
    createAssignedPromiseMirror,
    forkPromiseMirror,
    getOrCreatePromiseMirror,
    getPromiseMirror,
    onPromiseMirrorResolve,
    readLogicalProperty,
    setPromiseMirrorValue,
} = require("./promise-mirrors")

function setProperty(
    parent,
    key,
    value,
    importBoundary = undefined,
    attachmentPath = undefined,
) {
    assertCanSetLanguageProperty(parent, key, importBoundary?.errorContext)
    // BIRTH 1 - ASSIGN: assigning a promise to a key always creates a fresh
    // mirror. Two assignments of the same promise are divergent worlds.
    const mirror = isPromise(value)
        ? createAssignedPromiseMirror(parent, key, value)
        : null
    preparePropertyTransition(parent, mirror, value)
    commitPropertyTransition(parent, key, mirror, value)
    if (attachmentPath) {
        attachImportedDataToImportedData(
            parent,
            key,
            attachmentPath,
            attachmentPath.root,
        )
    }
}

function deleteProperty(parent, key, importBoundary = undefined) {
    assertCanDeleteLanguageProperty(parent, key, importBoundary?.errorContext)
    deleteEdge(parent, key)
}

function shallowCopy(obj, pathKey, importBoundary, attachmentPath) {
    const copy = Array.isArray(obj) ? new Array(obj.length) : {}
    const pathKeyString = String(pathKey)
    const keys = Object.keys(obj)
    attachmentPath.root ??= copy
    attachmentPath.ancestors.add(copy)

    // Copy only language-visible own enumerable string keys; META lives outside
    // that surface (non-enumerable Symbol or WeakMap entry), so mirrors,
    // counters, and marks never enter the copy. The source keeps its own marks.
    // Reused children from a shared branch are marked shared so their shared
    // references stay protected — except the path key, which the walk's
    // inherited state protects until it is replaced or copied. Every tracked
    // child of an imported node receives its own import boundary. A path
    // child's next shallow copy omits that META, so every new path node remains
    // language-owned without a separate path exception here.
    for (const key of keys) {
        const isPathKey = key === pathKeyString
        const retainedOffPath = !isPathKey
        const sourceMirror = getPromiseMirror(obj, key)
        const value = readLogicalProperty(obj, key)
        const propertyImportBoundary = sourceMirror?.importBoundary ?? importBoundary
        // Sanctioned write bypass: the copy is unobservable until it is installed
        // through setProperty, or copyCounters reconstructs its indexed edges.
        writeLanguageProperty(copy, key, value)
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
            // is protected by the walk's inherited state if we enter it, and
            // may simply be replaced/deleted at the target.
            forkPromiseMirror(
                obj,
                copy,
                key,
                value,
                retainedOffPath,
                propertyImportBoundary,
            )
            if (retainedOffPath && propertyImportBoundary) {
                attachImportedDataToImportedData(
                    copy,
                    key,
                    attachmentPath,
                )
            }
        } else if (propertyImportBoundary && isTracked(value)) {
            // The source child remains external; a later shallow copy of a path
            // child drops this boundary together with its other META.
            importValue(value, propertyImportBoundary.errorContext)
        } else if (retainedOffPath && isTracked(value)) {
            markShared(value)
        }
    }
    copyCounters(obj, copy)
    return copy
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignPath(chain, path, value) {
    walkMutationPath(chain._state, path, (
        parent,
        key,
        importBoundary,
        attachmentPath,
    ) => {
        setProperty(parent, key, value, importBoundary, attachmentPath)
    })
}

// path identifies the complete mutation target. The walk starts at the private
// holder, where an empty path targets its value key, and recursive callers
// install copied branches back into their key.
function walkMutationPath(rootHolder, path, onTarget) {
    const targetPath = ["value", ...path]
    return walk(rootHolder, 0, false, undefined, undefined)

    function walk(
        value,
        index,
        inheritedSharedBranch,
        inheritedImportBoundary,
        attachmentPath,
    ) {
        if (isError(value)) return value
        if (!isTracked(value)) return pathAccessError()

        // Root-only import attribution is inherited until a nested boundary
        // overrides it; the shared-branch bit independently drives path COW.
        const valueImportBoundary = nodeImportBoundary(value, inheritedImportBoundary)
        let parent = value
        const parentInsideSharedBranch = inheritedSharedBranch || hasSharedMark(value)

        const key = targetPath[index]
        if (parentInsideSharedBranch) {
            attachmentPath ??= {
                root: undefined,
                ancestors: new Set(),
            }
            parent = shallowCopy(
                parent,
                key,
                valueImportBoundary,
                attachmentPath,
            )
        }
        if (index === targetPath.length - 1) {
            onTarget(parent, key, valueImportBoundary, attachmentPath)
            return parent
        }

        // Asserted after the COW: copies carry only own enumerable keys, so
        // this fires only on genuinely un-shadowable intermediate shapes.
        assertCanMutateLanguageProperty(
            parent,
            key,
            valueImportBoundary?.errorContext,
        )

        let mirror = getPromiseMirror(parent, key)
        const child = readLogicalProperty(parent, key)
        if (isPromise(child)) {
            mirror ??= getOrCreatePromiseMirror(
                parent,
                key,
                child,
                valueImportBoundary,
            )
            onPromiseMirrorResolve(mirror, () => {
                const childImportBoundary = mirror.importBoundary ?? valueImportBoundary
                const next = walk(
                    mirror.currentValue,
                    index + 1,
                    parentInsideSharedBranch,
                    childImportBoundary,
                    attachmentPath,
                )
                // The active path has now produced an owned value. Unlike an
                // off-path fork, this placement no longer carries provenance.
                mirror.importBoundary = undefined
                setPromiseMirrorValue(mirror, next)
            })
            return parent
        }

        const childImportBoundary = mirror?.importBoundary ?? valueImportBoundary
        const next = walk(
            child,
            index + 1,
            parentInsideSharedBranch,
            childImportBoundary,
            attachmentPath,
        )
        if (next !== child) {
            setProperty(parent, key, next, valueImportBoundary)
        }
        return parent
    }
}

// --- deletePath :  delete a.k ----------------------------------------------
function deletePath(chain, path) {
    const deletesRoot = path.length === 0
    walkMutationPath(chain._state, path, (parent, key, importBoundary) => {
        if (deletesRoot) {
            setProperty(parent, key, null, importBoundary)
        } else {
            deleteProperty(parent, key, importBoundary)
        }
    })
}

module.exports = {
    assignPath,
    deletePath,
}
