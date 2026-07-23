"use strict"

import * as helpers from "./helpers.js"
import * as errorUtils from "./error.js"
import * as refcounts from "./refcounts.js"
import * as languageProperties from "./language-properties.js"
import * as metadata from "./meta.js"
import * as imports from "./import.js"
import * as promiseMirrors from "./promise-mirrors.js"

function setProperty(
    parent,
    key,
    value,
    importBoundary = undefined,
    attachmentPath = undefined,
) {
    languageProperties.assertCanSetLanguageProperty(
        parent,
        key,
        importBoundary?.errorContext,
    )
    // BIRTH 1 - ASSIGN: assigning a promise to a key always creates a fresh
    // mirror. Two assignments of the same promise are divergent worlds.
    const mirror = helpers.isPromise(value)
        ? promiseMirrors.createAssignedPromiseMirror(parent, key, value)
        : null
    refcounts.preparePropertyTransition(parent, mirror, value)
    refcounts.commitPropertyTransition(parent, key, mirror, value)
    if (attachmentPath) {
        imports.attachImportedDataToImportedData(
            parent,
            key,
            attachmentPath,
            attachmentPath.root,
        )
    }
}

function deleteProperty(parent, key, importBoundary = undefined) {
    languageProperties.assertCanDeleteLanguageProperty(
        parent,
        key,
        importBoundary?.errorContext,
    )
    refcounts.deleteEdge(parent, key)
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
        const sourceMirror = promiseMirrors.getPromiseMirror(obj, key)
        const value = promiseMirrors.readLogicalProperty(obj, key)
        const propertyImportBoundary = sourceMirror?.importBoundary ?? importBoundary
        // Sanctioned write bypass: the copy is unobservable until it is installed
        // through setProperty, or refcounts.copyCounters reconstructs its indexed edges.
        languageProperties.writeLanguageProperty(copy, key, value)
        if (helpers.isPromise(value)) {
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
            promiseMirrors.forkPromiseMirror(
                obj,
                copy,
                key,
                value,
                retainedOffPath,
                propertyImportBoundary,
            )
            if (retainedOffPath && propertyImportBoundary) {
                imports.attachImportedDataToImportedData(
                    copy,
                    key,
                    attachmentPath,
                )
            }
        } else if (propertyImportBoundary && helpers.isTracked(value)) {
            // The source child remains external; a later shallow copy of a path
            // child drops this boundary together with its other META.
            imports.import(value, propertyImportBoundary.errorContext)
        } else if (retainedOffPath && helpers.isTracked(value)) {
            metadata.markShared(value)
        }
    }
    refcounts.copyCounters(obj, copy)
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
        if (helpers.isError(value)) return value
        if (!helpers.isTracked(value)) return errorUtils.pathAccessError()

        // Root-only import attribution is inherited until a nested boundary
        // overrides it; the shared-branch bit independently drives path COW.
        const valueImportBoundary = metadata.nodeImportBoundary(value, inheritedImportBoundary)
        let parent = value
        const parentInsideSharedBranch = inheritedSharedBranch || metadata.hasSharedMark(value)

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
        languageProperties.assertCanMutateLanguageProperty(
            parent,
            key,
            valueImportBoundary?.errorContext,
        )

        let mirror = promiseMirrors.getPromiseMirror(parent, key)
        const child = promiseMirrors.readLogicalProperty(parent, key)
        if (helpers.isPromise(child)) {
            mirror ??= promiseMirrors.getOrCreatePromiseMirror(
                parent,
                key,
                child,
                valueImportBoundary,
            )
            promiseMirrors.onPromiseMirrorResolve(mirror, () => {
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
                promiseMirrors.setPromiseMirrorValue(mirror, next)
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

export {
    assignPath,
    deletePath,
}
