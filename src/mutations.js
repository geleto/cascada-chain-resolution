import * as helpers from "./helpers.js"
import * as errorUtils from "./error.js"
import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as coercion from "./language-coercion.js"
import * as refcounts from "./refcounts.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as imports from "./import.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as propertyTransitions from "./property-transitions.js"
import * as propertyCaptures from "./property-capture.js"
import * as resolution from "./resolution.js"

const KEEP_TARGET = Symbol("KEEP_TARGET")

function createCopyShell(source) {
    const prototype = Object.getPrototypeOf(source)
    if (arrayViews.isLogicalArray(source)) {
        return new Array(arrayViews.logicalArrayLength(source))
    }
    if (prototype === null) return Object.create(null)
    if (languageValues.isPlainObjectPrototype(prototype)) return {}
    return Object.create(prototype)
}

function setProperty(
    parent,
    key,
    value,
    importBoundary = undefined,
    attachmentPath = undefined,
) {
    if (
        arrayViews.isLogicalArray(parent) &&
        String(key) === "length"
    ) {
        setArrayLength(parent, value)
        return
    }
    languageProperties.assertCanSetLanguageProperty(
        parent,
        key,
        importBoundary?.errorContext,
    )
    // BIRTH 1 - ASSIGN: assigning a promise to a key always creates a fresh
    // mirror. Two assignments of the same promise are divergent worlds.
    let mirror
    if (languageValues.isPromise(value)) {
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

function setArrayLength(array, value) {
    const length = toArrayLength(value)
    if (languageValues.isPromise(length)) {
        errorUtils.reportFatalError(
            new Error("Deferred Array length requires an owning-path gate"),
        )
    }
    if (languageValues.isError(length)) return length
    return setArrayLengthReady(array, length)
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
    for (const key of languageProperties.enumerableLanguageKeys(source)) {
        const retainedOffPath = key !== pathKeyString
        const sourceMirror = promiseMirrors.getPromiseMirror(source, key)
        const value = languageProperties.readLanguageProperty(source, key)
        const propertyImportBoundary = sourceMirror?.importBoundary ?? importBoundary
        // Sanctioned write bypass: the copy is unobservable until it is installed
        // through setProperty, or indexValueIfSourceIndexed reconstructs its index.
        languageProperties.writeLanguageProperty(shell, key, value)
        if (languageValues.isPromise(value)) {
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
        } else if (propertyImportBoundary && languageValues.isTracked(value)) {
            // The source child remains external; a later shallow copy of a path
            // child drops this boundary together with its other META.
            imports.import(value, propertyImportBoundary.errorContext)
        } else if (retainedOffPath && languageValues.isTracked(value)) {
            metadata.markShared(value)
        }
    }
    refcounts.indexValueIfSourceIndexed(source, shell)
    return shell
}

function transformProperty(
    parent,
    key,
    importBoundary,
    attachmentPath,
    prepareArguments,
    transform,
    returnResultPromise = true,
) {
    const targetProperty = propertyCaptures.capture(
        parent,
        key,
        importBoundary,
    )
    const context = {
        present: targetProperty !== undefined,
        rawValue: targetProperty?.value,
        importBoundary,
        attachmentPath,
    }
    let targetValue
    const operation = resolution.resolveOperationResultsOrFatal(
        [
            propertyCaptures.resolve(targetProperty),
            prepareArguments(context),
        ],
        ([resolvedTargetValue, preparedArguments]) => {
            targetValue = resolvedTargetValue
            return resolution.resolveOperationResultOrFatal(
                transform(
                    resolvedTargetValue,
                    preparedArguments,
                    context,
                ),
                outcome => languageValues.isError(outcome)
                    ? {
                        mutatedValue: resolvedTargetValue,
                        result: outcome,
                    }
                    : outcome,
            )
        },
    )

    if (!languageValues.isPromise(operation)) {
        if (operation.mutatedValue !== targetValue) {
            setProperty(
                parent,
                key,
                operation.mutatedValue,
                importBoundary,
                attachmentPath,
            )
        }
        if (operation.result === operation.mutatedValue) {
            metadata.markShared(operation.mutatedValue)
        }
        return operation.result
    }

    let resolveMutatedValue
    const mutatedValueGate = new Promise(resolve => {
        resolveMutatedValue = resolve
    })
    let resolveResult
    const result = returnResultPromise
        ? new Promise(resolve => {
            resolveResult = resolve
        })
        : undefined
    setProperty(
        parent,
        key,
        mutatedValueGate,
        importBoundary,
        attachmentPath,
    )
    resolution.resolveOperationResultOrFatal(
        operation,
        outcome => {
            if (outcome.result === outcome.mutatedValue) {
                metadata.markShared(outcome.mutatedValue)
            }
            if (returnResultPromise) {
                resolution.onLaterPromiseReady(mutatedValueGate, () => {
                    resolveResult(outcome.result)
                })
            }
            resolveMutatedValue(outcome.mutatedValue)
        },
    )
    return result
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignPath(chain, path, value) {
    if (path.length > 0 && String(path[path.length - 1]) === "length") {
        return assignLengthPath(chain, path.slice(0, -1), value)
    }
    return helpers.runFatal(() => {
        let operationError
        const result = walkMutationPath(chain, path, (
            parent,
            key,
            importBoundary,
            attachmentPath,
            virtual,
        ) => {
            if (virtual === "stringLength") {
                operationError = errorUtils.validationError(
                    "String length is read-only",
                )
                return
            }
            setProperty(parent, key, value, importBoundary, attachmentPath)
        })
        return result ?? operationError
    })
}

function assignLengthPath(chain, receiverPath, value) {
    return helpers.runFatal(() => {
        let result
        return walkMutationPath(
            chain,
            receiverPath,
            (parent, key, importBoundary, attachmentPath) => {
                result = transformProperty(
                    parent,
                    key,
                    importBoundary,
                    attachmentPath,
                    () => value,
                    transformLength,
                    false,
                )
            },
            pathError => pathError ?? result,
        )
    })

    function transformLength(
        targetValue,
        value,
        { present, importBoundary, attachmentPath },
    ) {
        if (!present) {
            return {
                mutatedValue: errorUtils.pathAccessError(),
                result: undefined,
            }
        }
        if (languageValues.isError(targetValue)) {
            return { mutatedValue: targetValue, result: undefined }
        }
        if (typeof targetValue === "string") {
            return {
                mutatedValue: targetValue,
                result: errorUtils.validationError(
                    "String length is read-only",
                ),
            }
        }
        if (!languageValues.isTracked(targetValue)) {
            return {
                mutatedValue: errorUtils.pathAccessError(),
                result: undefined,
            }
        }
        if (!arrayViews.isLogicalArray(targetValue)) {
            const mustCopy =
                attachmentPath !== undefined ||
                metadata.requiresCopyOnWrite(targetValue)
            let mutatedValue = targetValue
            let nextAttachment = attachmentPath
            if (mustCopy) {
                const shell = createCopyShell(targetValue)
                nextAttachment ??= {
                    root: undefined,
                    ancestors: new Set(),
                }
                mutatedValue = shallowCopy(
                    targetValue,
                    shell,
                    "length",
                    importBoundary,
                    nextAttachment,
                )
            }
            setProperty(
                mutatedValue,
                "length",
                value,
                importBoundary,
                nextAttachment,
            )
            return { mutatedValue, result: undefined }
        }

        return resolution.continueOperationUnlessPoison(
            toArrayLength(value),
            length => {
                let mutatedValue = targetValue
                const projection = arrayViews.projectionOf(targetValue)
                const currentLength =
                    arrayViews.logicalArrayLength(targetValue)
                const preserve =
                    attachmentPath !== undefined ||
                    metadata.requiresCopyOnWrite(targetValue)
                if (
                    preserve ||
                    (
                        arrayViews.isArrayView(projection) &&
                        length > currentLength &&
                        !projection.canGrowEnd(length - currentLength)
                    )
                ) {
                    mutatedValue =
                        arrayRemaps.materializeSource(targetValue)
                }
                const error = setArrayLengthReady(mutatedValue, length)
                return { mutatedValue, result: error }
            },
        )
    }
}

function toArrayLength(value) {
    return resolution.continueOperationUnlessPoison(
        coercion.toNumberValue(value),
        number => {
            const length = number >>> 0
            return length === number
                ? length
                : errorUtils.validationError("Invalid array length")
        },
    )
}

function setArrayLengthReady(array, length) {
    const current = arrayViews.logicalArrayLength(array)

    const projection = arrayViews.projectionOf(array)
    if (arrayViews.isArrayView(projection)) {
        if (length >= current) {
            if (!projection.setLength(length)) {
                return errorUtils.validationError(
                    "Cannot grow this ArrayView in place",
                )
            }
            return undefined
        }
        for (let index = current - 1; index >= length; index--) {
            const key = String(index)
            propertyTransitions.contractArrayEnd(
                array,
                key,
                () => projection.setLength(index),
            )
        }
        return undefined
    }

    const descriptor = Object.getOwnPropertyDescriptor(array, "length")
    if (descriptor?.writable !== true) {
        return errorUtils.validationError("Array length is read-only")
    }
    if (length === current) return undefined
    if (length < current) {
        for (let index = current - 1; index >= length; index--) {
            const key = String(index)
            const property = Object.getOwnPropertyDescriptor(array, key)
            if (property && !property.configurable) {
                array.length = index + 1
                return errorUtils.validationError(
                    "Cannot delete an Array element while setting length",
                )
            }
            if (languageProperties.hasLanguageProperty(array, key)) {
                propertyTransitions.deleteProperty(array, key)
            }
        }
    }
    array.length = length
    return undefined
}

// path identifies the complete mutation target. The walk starts at the private
// holder, where an empty path targets its value key, and write-back
// continuations install copied branches into their enclosing keys.
function walkMutationPath(chain, path, onTarget, onComplete = undefined) {
    chain.assertState()
    const state = chain._state
    if (!state.mutates) {
        errorUtils.reportFatalError(
            new Error("Cannot mutate through a read-only Chain"),
        )
    }
    const targetPath = ["value", ...path]
    let attachmentPath
    return walk(state, 0, undefined, () => {})

    // Completion follows synchronous reconstruction through every enclosing
    // write-back continuation. Keeping this outside walk avoids allocating it
    // for every recursive frame.
    function complete(writeBack, next) {
        writeBack(next)
        return onComplete?.(
            languageValues.isError(next) ? next : undefined,
        )
    }

    function walk(
        value,
        index,
        inheritedImportBoundary,
        writeBack,
    ) {
        if (languageValues.isError(value)) {
            return complete(writeBack, value)
        }
        const key = targetPath[index]
        if (
            typeof value === "string" &&
            index === targetPath.length - 1 &&
            key === "length"
        ) {
            onTarget(
                value,
                key,
                inheritedImportBoundary,
                attachmentPath,
                "stringLength",
            )
            return complete(writeBack, value)
        }
        if (
            arrayViews.isLogicalArray(value) &&
            index === targetPath.length - 1 &&
            key === "length"
        ) {
            onTarget(
                value,
                key,
                inheritedImportBoundary,
                attachmentPath,
                "arrayLength",
            )
            return complete(writeBack, value)
        }
        if (!languageValues.isTracked(value)) {
            const error = errorUtils.pathAccessError()
            return complete(writeBack, error)
        }

        // Root-only import attribution is inherited until a nested boundary
        // overrides it. Once COW starts, attachmentPath keeps every remaining
        // path node in the shared branch.
        const valueImportBoundary = metadata.nodeImportBoundary(value, inheritedImportBoundary)
        let parent = value
        const parentInsideSharedBranch = attachmentPath !== undefined ||
            metadata.requiresCopyOnWrite(value) ||
            arrayViews.requiresArrayMaterialization(value)

        if (parentInsideSharedBranch) {
            const shell = createCopyShell(parent)
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
            const targetResult = onTarget(
                parent,
                key,
                valueImportBoundary,
                attachmentPath,
            )
            return complete(
                writeBack,
                targetResult === KEEP_TARGET ? value : parent,
            )
        }

        // Asserted after the COW: copies carry only own enumerable keys, so
        // this fires only on genuinely un-shadowable intermediate shapes.
        languageProperties.assertCanMutateLanguageProperty(
            parent,
            key,
            valueImportBoundary?.errorContext,
        )

        const child = languageProperties.readLanguageProperty(parent, key)
        if (languageValues.isPromise(child)) {
            const mirror = promiseMirrors.getOrCreatePromiseMirror(
                parent,
                key,
                child,
                valueImportBoundary,
            )
            const pending = resolution.onLaterPromiseReady(child, () => {
                const propertyValue = mirror.getValue(parent, key)
                return walk(
                    propertyValue,
                    index + 1,
                    mirror.importBoundary ?? valueImportBoundary,
                    next => {
                        if (next !== propertyValue) {
                            propertyTransitions.setMirrorValue(
                                parent,
                                key,
                                mirror,
                                next,
                            )
                        }
                    },
                )
            })
            writeBack(parent)
            return onComplete === undefined ? undefined : pending
        }

        return walk(
            child,
            index + 1,
            valueImportBoundary,
            next => {
                if (next !== child) {
                    setProperty(parent, key, next, valueImportBoundary)
                }
                writeBack(parent)
            },
        )
    }
}

// --- deletePath :  delete a.k ----------------------------------------------
function deletePath(chain, path) {
    return helpers.runFatal(() => {
        const deletesRoot = path.length === 0
        let operationError
        const result = walkMutationPath(chain, path, (
            parent,
            key,
            importBoundary,
            attachmentPath,
            virtual,
        ) => {
            if (deletesRoot) {
                setProperty(parent, key, null, importBoundary)
            } else if (
                virtual === "stringLength" ||
                (
                    arrayViews.isLogicalArray(parent) &&
                    String(key) === "length"
                )
            ) {
                operationError = errorUtils.validationError(
                    "Cannot delete length",
                )
                return KEEP_TARGET
            } else {
                deleteProperty(parent, key, importBoundary)
            }
        })
        return result ?? operationError
    })
}

export {
    assignPath,
    deleteProperty,
    deletePath,
    setProperty,
    transformProperty,
    walkMutationPath,
}
