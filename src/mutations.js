import * as errorUtils from "./error.js"
import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as conversion from "./language-conversion.js"
import * as refcounts from "./refcounts.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as imports from "./import.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as propertyTransitions from "./property-transitions.js"
import * as propertyOrigins from "./property-capture.js"
import * as resolution from "./resolution.js"

const KEEP_TARGET = Symbol("KEEP_TARGET")

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
        return setArrayLength(parent, value)
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
    return commitArrayLength(array, length)
}

function deleteProperty(parent, key, importBoundary = undefined) {
    languageProperties.assertCanDeleteLanguageProperty(
        parent,
        key,
        importBoundary?.errorContext,
    )
    propertyTransitions.removeProperty(parent, key)
}

function copyForWrite(source, pathKey, importBoundary, attachmentPath) {
    const prototype = Object.getPrototypeOf(source)
    let destination
    if (arrayViews.isLogicalArray(source)) {
        destination = new Array(arrayViews.logicalArrayLength(source))
    } else if (prototype === null) {
        destination = Object.create(null)
    } else {
        destination = languageValues.isPlainObjectPrototype(prototype)
            ? {}
            : Object.create(prototype)
    }
    attachmentPath ??= {
        root: undefined,
        ancestors: new Set(),
    }
    const pathKeyString = String(pathKey)
    attachmentPath.root ??= destination
    attachmentPath.ancestors.add(destination)

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
        languageProperties.writeLanguageProperty(destination, key, value)
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
                source, destination, key, value,
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
    refcounts.indexValueIfSourceIndexed(source, destination)
    return {
        value: destination,
        attachmentPath,
    }
}

function transformProperty(
    parent,
    key,
    importBoundary,
    attachmentPath,
    prepareInput,
    transform,
    returnResultPromise = true,
) {
    const origin = propertyOrigins.getOrigin(parent, key)
    propertyOrigins.captureOrigin(origin, importBoundary)
    const context = {
        present: origin !== undefined,
        rawValue: origin?.value,
        importBoundary,
        attachmentPath,
    }
    let originalValue
    const operation = resolution.resolveOperationResultsOrFatal(
        [
            propertyOrigins.resolveOriginValue(origin),
            prepareInput(context),
        ],
        ([resolvedTargetValue, preparedArguments]) => {
            originalValue = resolvedTargetValue
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
        if (operation.mutatedValue !== originalValue) {
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
    return errorUtils.runFatal(() => {
        const result = walkMutationPath(chain, path, (
            parent,
            key,
            importBoundary,
            attachmentPath,
        ) => {
            setProperty(parent, key, value, importBoundary, attachmentPath)
        }, undefined, tryArrayViewAssignment)
        return result
    })

    function tryArrayViewAssignment(
        array,
        key,
        importBoundary,
        attachmentPath,
    ) {
        const projection = arrayViews.projectionOf(array)
        if (!arrayViews.isArrayView(projection)) return undefined
        const end = Number(key) + 1
        const growth = end - projection.length
        if (
            growth <= 0 ||
            metadata.nodeImportBoundary(array, importBoundary)
        ) return undefined

        const extended = arrayViews.ArrayView.tryExtendEnd(
            projection,
            growth,
            view => promiseMirrors.prepareRetainedArrayProperties(
                array,
                view,
            ),
        )
        if (!extended) return undefined
        setProperty(extended, key, value, importBoundary, attachmentPath)
        return extended
    }
}

function assignLengthPath(chain, receiverPath, value) {
    return errorUtils.runFatal(() => {
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
                    () => undefined,
                    transformLength,
                    false,
                )
            },
            pathError => pathError ?? result,
        )
    })

    function transformLength(
        targetValue,
        _input,
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
                const copied = copyForWrite(
                    targetValue,
                    "length",
                    importBoundary,
                    nextAttachment,
                )
                mutatedValue = copied.value
                nextAttachment = copied.attachmentPath
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
                const currentLength = projection.length
                const preserve =
                    attachmentPath !== undefined ||
                    metadata.requiresCopyOnWrite(targetValue)
                if (
                    preserve ||
                    (
                        arrayViews.isArrayView(projection) &&
                        length > currentLength &&
                        !arrayViews.ArrayView.canGrowEnd(
                            projection,
                            length - currentLength,
                        )
                    )
                ) {
                    mutatedValue = arrayRemaps.createArrayFromRemap(
                        arrayRemaps.createInitialRemap(targetValue),
                        targetValue,
                    )
                }
                const error = commitArrayLength(mutatedValue, length)
                return { mutatedValue, result: error }
            },
        )
    }
}

function toArrayLength(value) {
    return resolution.continueOperationUnlessPoison(
        conversion.toNumberValue(value),
        number => {
            const length = number >>> 0
            return length === number
                ? length
                : errorUtils.validationError("Invalid array length")
        },
    )
}

function commitArrayLength(array, length) {
    const projection = arrayViews.projectionOf(array)
    const current = projection.length
    const view = arrayViews.isArrayView(projection) ? projection : undefined
    if (view) {
        if (length >= current) {
            if (!view.setLength(length)) {
                return errorUtils.validationError(
                    "Cannot grow this ArrayView in place",
                )
            }
            return undefined
        }
    } else if (
        Object.getOwnPropertyDescriptor(array, "length")?.writable !== true
    ) {
        return errorUtils.validationError("Array length is read-only")
    }
    if (length === current) return undefined

    for (let index = current - 1; index >= length; index--) {
        const key = String(index)
        const property = languageProperties.getLanguagePropertyDescriptor(
            array,
            key,
        )
        if (property && !property.configurable) {
            setLength(index + 1)
            return errorUtils.validationError(
                "Cannot delete an Array element while setting length",
            )
        }
        if (property?.enumerable) {
            propertyTransitions.removeProperty(
                array,
                key,
                view ? () => view.setLength(index) : undefined,
            )
        } else if (view) {
            view.setLength(index)
        }
    }
    setLength(length)
    return undefined

    function setLength(nextLength) {
        if (view) view.setLength(nextLength)
        else array.length = nextLength
    }
}

// path identifies the complete mutation target. The walk starts at the private
// holder, where an empty path targets its value key, and write-back
// continuations install copied branches into their enclosing keys.
function walkMutationPath(
    chain,
    path,
    onTarget,
    onComplete = undefined,
    tryTargetMutation = undefined,
) {
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
            index === targetPath.length - 1 &&
            key === "length" &&
            (
                typeof value === "string" ||
                arrayViews.isLogicalArray(value)
            )
        ) {
            onTarget(
                value,
                key,
                inheritedImportBoundary,
                attachmentPath,
                true,
            )
            return complete(writeBack, value)
        }
        if (!languageValues.isTracked(value)) {
            const error = errorUtils.pathAccessError()
            return complete(writeBack, error)
        }
        if (
            index === targetPath.length - 1 &&
            !languageProperties.isArrayLanguageKey(value, key)
        ) {
            writeBack(value)
            const error = errorUtils.validationError(
                "Arrays support only indexes and length",
            )
            return onComplete ? onComplete(error) : error
        }

        // Root-only import attribution is inherited until a nested boundary
        // overrides it. Once COW starts, attachmentPath keeps every remaining
        // path node in the shared branch.
        let valueImportBoundary = metadata.nodeImportBoundary(
            value,
            inheritedImportBoundary,
        )
        const mutatedValue = index === targetPath.length - 1
            ? tryTargetMutation?.(
                value,
                key,
                valueImportBoundary,
                attachmentPath,
            )
            : undefined
        if (mutatedValue !== undefined) {
            return complete(writeBack, mutatedValue)
        }
        let parent = value
        const parentInsideSharedBranch =
            attachmentPath !== undefined ||
            metadata.requiresCopyOnWrite(value) ||
            arrayViews.requiresArrayMaterialization(value)

        if (parentInsideSharedBranch) {
            const copied = copyForWrite(
                parent,
                key,
                valueImportBoundary,
                attachmentPath,
            )
            parent = copied.value
            attachmentPath = copied.attachmentPath
            valueImportBoundary = undefined
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
        if (!(key === "length" && arrayViews.isLogicalArray(parent))) {
            languageProperties.assertCanMutateLanguageProperty(
                parent,
                key,
                valueImportBoundary?.errorContext,
            )
        }

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
    return errorUtils.runFatal(() => {
        const deletesRoot = path.length === 0
        let operationError
        const result = walkMutationPath(chain, path, (
            parent,
            key,
            importBoundary,
            attachmentPath,
            virtualLength,
        ) => {
            if (deletesRoot) {
                setProperty(parent, key, null, importBoundary)
            } else if (virtualLength) {
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
