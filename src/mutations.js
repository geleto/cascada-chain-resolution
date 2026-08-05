import * as errorUtils from "./error.js"
import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as conversion from "./language-conversion.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import * as resolution from "./resolution.js"

const KEEP_TARGET = Symbol("KEEP_TARGET")

function setProperty(
    parent,
    key,
    value,
    attachmentRoot = undefined,
) {
    if (
        arrayViews.isLogicalArray(parent) &&
        String(key) === "length"
    ) {
        return setArrayLength(parent, value)
    }
    if (attachmentRoot && containsPromise(value)) {
        metadata.markShared(attachmentRoot)
    }
    propertyVersions.assignProperty(parent, key, value)
}

function containsPromise(value, visited = new WeakSet()) {
    if (languageValues.isPromise(value)) return true
    if (!languageValues.isTracked(value) || visited.has(value)) return false
    visited.add(value)
    for (const key of languageProperties.enumerableLanguageKeys(value)) {
        if (containsPromise(
            languageProperties.readLanguageProperty(value, key),
            visited,
        )) return true
    }
    return false
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

function deleteProperty(parent, key) {
    const importBoundary = metadata.importBoundaryOf(parent)
    languageProperties.assertCanDeleteLanguageProperty(
        parent,
        key,
        importBoundary?.errorContext,
    )
    propertyVersions.removeProperty(parent, key)
}

function copyForWrite(source, pathKey, attachmentRoot) {
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
    attachmentRoot ??= destination
    const pathKeyString = String(pathKey)

    // Copy only language-visible own enumerable string keys; META lives outside
    // that surface (non-enumerable Symbol or WeakMap entry), so mirrors,
    // counters, and marks never enter the copy. The source keeps its own marks.
    // Reused off-path children are marked shared because both copies retain
    // them. The path child is replaced or copied by the current walk.
    for (const key of languageProperties.enumerableLanguageKeys(source)) {
        const retainedOffPath = key !== pathKeyString
        const value = languageProperties.readLanguageProperty(source, key)
        if (languageValues.isPromise(value)) {
            const sourceMirror = propertyVersions.getOrCreatePromiseMirror(
                source,
                key,
                value,
            )
            propertyVersions.placePromiseVersion(
                sourceMirror,
                value,
                destination,
                key,
                retainedOffPath,
            )
            continue
        }
        if (retainedOffPath) metadata.markShared(value)
        // The copy remains unobservable until its owning path is installed.
        languageProperties.writeLanguageProperty(destination, key, value)
    }
    propertyVersions.indexValueIfSourceIndexed(source, destination)
    return {
        value: destination,
        attachmentRoot,
    }
}

function transformProperty(
    parent,
    key,
    attachmentRoot,
    prepareInput,
    transform,
    returnResultPromise = true,
) {
    const origin = propertyVersions.getPropertyOrigin(parent, key)
    propertyVersions.capturePropertyVersion(origin)
    const context = {
        present: origin !== undefined,
        rawValue: origin?.value,
        attachmentRoot,
    }
    let originalValue
    const operation = resolution.resolveOperationResultsOrFatal(
        [
            propertyVersions.resolvePropertyValue(origin),
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
                attachmentRoot,
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
        attachmentRoot,
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
            attachmentRoot,
        ) => {
            setProperty(parent, key, value, attachmentRoot)
        }, undefined, tryArrayViewAssignment)
        return result
    })

    function tryArrayViewAssignment(
        array,
        key,
        attachmentRoot,
    ) {
        const projection = arrayViews.projectionOf(array)
        if (!arrayViews.isArrayView(projection)) return undefined
        const end = Number(key) + 1
        const growth = end - projection.length
        if (growth <= 0 || metadata.importBoundaryOf(array)) return undefined

        const extended = arrayViews.ArrayView.tryExtendEnd(
            projection,
            growth,
            view => propertyVersions.prepareRetainedArrayProperties(
                array,
                view,
            ),
        )
        if (!extended) return undefined
        setProperty(extended, key, value, attachmentRoot)
        return extended
    }
}

function assignLengthPath(chain, receiverPath, value) {
    return errorUtils.runFatal(() => {
        let result
        return walkMutationPath(
            chain,
            receiverPath,
            (parent, key, attachmentRoot) => {
                result = transformProperty(
                    parent,
                    key,
                    attachmentRoot,
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
        { present, attachmentRoot },
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
                attachmentRoot !== undefined ||
                metadata.requiresCopyOnWrite(targetValue)
            let mutatedValue = targetValue
            let nextAttachment = attachmentRoot
            if (mustCopy) {
                const copied = copyForWrite(
                    targetValue,
                    "length",
                    nextAttachment,
                )
                mutatedValue = copied.value
                nextAttachment = copied.attachmentRoot
            }
            setProperty(
                mutatedValue,
                "length",
                value,
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
                    attachmentRoot !== undefined ||
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
            propertyVersions.removeProperty(
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
    let attachmentRoot
    return walk(state, 0, () => {})

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
                attachmentRoot,
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

        const mutatedValue = index === targetPath.length - 1
            ? tryTargetMutation?.(
                value,
                key,
                attachmentRoot,
            )
            : undefined
        if (mutatedValue !== undefined) {
            return complete(writeBack, mutatedValue)
        }
        let parent = value
        const parentInsideSharedBranch =
            attachmentRoot !== undefined ||
            metadata.requiresCopyOnWrite(value) ||
            arrayViews.requiresArrayMaterialization(value)

        if (parentInsideSharedBranch) {
            const copied = copyForWrite(
                parent,
                key,
                attachmentRoot,
            )
            parent = copied.value
            attachmentRoot = copied.attachmentRoot
        }
        if (index === targetPath.length - 1) {
            const targetResult = onTarget(
                parent,
                key,
                attachmentRoot,
            )
            return complete(
                writeBack,
                targetResult === KEEP_TARGET ? value : parent,
            )
        }

        // Asserted after the COW: copies carry only own enumerable keys, so
        // this fires only on genuinely un-shadowable intermediate shapes.
        if (!(key === "length" && arrayViews.isLogicalArray(parent))) {
            languageProperties.assertCanMutateLanguageProperty(parent, key)
        }

        const child = languageProperties.readLanguageProperty(parent, key)
        if (languageValues.isPromise(child)) {
            const pending = propertyVersions.continuePropertyValue(
                parent,
                key,
                child,
                (propertyValue, mirror) => walk(
                    propertyValue,
                    index + 1,
                    next => {
                        if (next !== propertyValue) {
                            // An imported parent was copied before descent, so
                            // this property version is runtime-owned.
                            propertyVersions.advancePromiseVersion(
                                parent,
                                key,
                                mirror,
                                next,
                            )
                        }
                    },
                ),
            )
            writeBack(parent)
            return onComplete === undefined ? undefined : pending
        }

        return walk(
            child,
            index + 1,
            next => {
                if (next !== child) {
                    setProperty(parent, key, next)
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
            attachmentRoot,
            virtualLength,
        ) => {
            if (deletesRoot) {
                setProperty(parent, key, null)
            } else if (virtualLength) {
                operationError = errorUtils.validationError(
                    "Cannot delete length",
                )
                return KEEP_TARGET
            } else {
                deleteProperty(parent, key)
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
