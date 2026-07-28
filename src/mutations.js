import * as helpers from "./helpers.js"
import * as errorUtils from "./error.js"
import * as refcounts from "./refcounts.js"
import * as languageProperties from "./language-properties.js"
import * as metadata from "./meta.js"
import * as imports from "./import.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as propertyTransitions from "./property-transitions.js"

const PROPERTY_STATE_CLASS = Symbol("PROPERTY_STATE_CLASS")

function isObjectPrototype(prototype) {
    if (prototype === null) return false
    if (Object.getPrototypeOf(prototype) !== null) return false
    const constructor = Object.getOwnPropertyDescriptor(
        prototype,
        "constructor",
    )?.value
    return typeof constructor === "function" &&
        Object.getOwnPropertyDescriptor(
            constructor, "prototype",
        )?.value === prototype
}

function createCopyShell(source) {
    const prototype = Object.getPrototypeOf(source)
    if (Array.isArray(source)) {
        return new Array(source.length)
    }
    if (prototype === null) return Object.create(null)
    if (isObjectPrototype(prototype)) return {}
    return Object.getOwnPropertyDescriptor(
        prototype, PROPERTY_STATE_CLASS,
    )?.value === true
        ? Object.create(prototype)
        : undefined
}

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
    let mirror
    if (helpers.isPromise(value)) {
        let prepareImportedValue
        if (attachmentPath) {
            metadata.markShared(attachmentPath.root)
            prepareImportedValue = imports.createImportedValuePreparer(
                attachmentPath.ancestors,
            )
        }
        mirror = promiseMirrors.createAssignedPromiseMirror(
            parent,
            key,
            value,
            prepareImportedValue,
        )
    }
    propertyTransitions.replaceProperty(parent, key, mirror, value)
    if (attachmentPath) {
        imports.attachImportedDataToImportedData(parent, key, attachmentPath)
    }
}

function deleteProperty(parent, key, importBoundary = undefined) {
    languageProperties.assertCanDeleteLanguageProperty(
        parent,
        key,
        importBoundary?.errorContext,
    )
    propertyTransitions.deleteProperty(parent, key)
}

function shallowCopy(source, shell, pathKey, importBoundary, attachmentPath) {
    const pathKeyString = String(pathKey)
    attachmentPath.root ??= shell
    attachmentPath.ancestors.add(shell)

    // Copy only language-visible own enumerable string keys; META lives outside
    // that surface (non-enumerable Symbol or WeakMap entry), so mirrors,
    // counters, and marks never enter the copy. The source keeps its own marks.
    // Reused children from a shared branch are marked shared so their shared
    // references stay protected -- except the path key, which the walk's
    // inherited state protects until it is replaced or copied. Every tracked
    // child of an imported node receives its own import boundary. A path
    // child's next shallow copy omits that META, so every new path node remains
    // language-owned without a separate path exception here.
    for (const key of Object.keys(source)) {
        const retainedOffPath = key !== pathKeyString
        const sourceMirror = promiseMirrors.getPromiseMirror(source, key)
        const value = languageProperties.readLanguageProperty(source, key)
        const propertyImportBoundary = sourceMirror?.importBoundary ?? importBoundary
        // Sanctioned write bypass: the copy is unobservable until it is installed
        // through setProperty, or indexValueIfSourceIndexed reconstructs its index.
        languageProperties.writeLanguageProperty(shell, key, value)
        if (helpers.isPromise(value)) {
            // BIRTH 3 - FORK. For every copied key holding a promise, mint the
            // copy's mirror NOW, at the copier's program position.
            //
            // Its FIFO reaction samples the source after earlier operations and
            // before later ones, so the two property versions diverge here.
            //
            // Why mark non-path captured values: they are reused by two worlds,
            // so the first advance on either side must COW. The path key itself
            // is protected by the walk's inherited state if we enter it, and
            // may simply be replaced/deleted at the target.
            const prepareImportedValue = retainedOffPath
                ? imports.createImportedValuePreparer(
                    attachmentPath.ancestors,
                )
                : undefined
            promiseMirrors.forkPromiseMirror(
                source, shell, key, value,
                retainedOffPath,
                propertyImportBoundary,
                prepareImportedValue,
            )
        } else if (propertyImportBoundary && helpers.isTracked(value)) {
            // The source child remains external; a later shallow copy of a path
            // child drops this boundary together with its other META.
            imports.import(value, propertyImportBoundary.errorContext)
        } else if (retainedOffPath && helpers.isTracked(value)) {
            metadata.markShared(value)
        }
    }
    refcounts.indexValueIfSourceIndexed(source, shell)
    return shell
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignPath(chain, path, value) {
    helpers.runFatal(() => {
        walkMutationPath(chain._state, path, (
            parent,
            key,
            importBoundary,
            attachmentPath,
        ) => {
            setProperty(parent, key, value, importBoundary, attachmentPath)
        })
    })
}

// path identifies the complete mutation target. The walk starts at the private
// holder, where an empty path targets its value key, and recursive callers
// install copied branches back into their key.
function walkMutationPath(rootHolder, path, onTarget) {
    const targetPath = ["value", ...path]
    let attachmentPath
    return walk(rootHolder, 0, undefined)

    function walk(
        value,
        index,
        inheritedImportBoundary,
    ) {
        if (helpers.isError(value)) return value
        if (!helpers.isTracked(value)) return errorUtils.pathAccessError()

        // Root-only import attribution is inherited until a nested boundary
        // overrides it. Once COW starts, attachmentPath keeps every remaining
        // path node in the shared branch.
        const valueImportBoundary = metadata.nodeImportBoundary(value, inheritedImportBoundary)
        let parent = value
        const parentInsideSharedBranch = attachmentPath !== undefined ||
            metadata.hasSharedMark(value)

        const key = targetPath[index]
        if (parentInsideSharedBranch) {
            const shell = createCopyShell(parent)
            if (!shell) {
                const error = errorUtils.validationError(
                    "Cannot copy unsupported object during copy-on-write",
                    valueImportBoundary?.errorContext,
                )
                return error
            }
            attachmentPath ??= {
                root: undefined,
                ancestors: new Set(),
            }
            parent = shallowCopy(
                parent,
                shell,
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

        const child = languageProperties.readLanguageProperty(parent, key)
        if (helpers.isPromise(child)) {
            const mirror = promiseMirrors.getOrCreatePromiseMirror(
                parent,
                key,
                child,
                valueImportBoundary,
            )
            helpers.onLaterPromiseReady(child, () => {
                const propertyValue = mirror.getValue(parent, key)
                const next = walk(
                    propertyValue,
                    index + 1,
                    mirror.importBoundary ?? valueImportBoundary,
                )
                if (next !== propertyValue) {
                    propertyTransitions.setMirrorValue(
                        parent,
                        key,
                        mirror,
                        next,
                    )
                }
            })
            return parent
        }

        const next = walk(
            child,
            index + 1,
            valueImportBoundary,
        )
        if (next !== child) {
            setProperty(parent, key, next, valueImportBoundary)
        }
        return parent
    }
}

// --- deletePath :  delete a.k ----------------------------------------------
function deletePath(chain, path) {
    helpers.runFatal(() => {
        const deletesRoot = path.length === 0
        walkMutationPath(chain._state, path, (parent, key, importBoundary) => {
            if (deletesRoot) {
                setProperty(parent, key, null, importBoundary)
            } else {
                deleteProperty(parent, key, importBoundary)
            }
        })
    })
}

export {
    PROPERTY_STATE_CLASS,
    assignPath,
    deletePath,
}
