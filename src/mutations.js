import * as errorUtils from "./error.js"
import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as conversion from "./language-conversion.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import * as resolution from "./resolution.js"

function setProperty(
    parent,
    key,
    value,
    attachmentRoot = undefined,
) {
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

function mustPreserveValue(value, attachmentRoot) {
    return attachmentRoot !== undefined ||
        metadata.requiresCopyOnWrite(value)
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
    }
    return transformValue(
        propertyVersions.resolvePropertyValue(origin),
        attachmentRoot,
        prepareInput(context),
        transform,
        value => setProperty(parent, key, value, attachmentRoot),
        context,
        returnResultPromise,
    )
}

function transformValue(
    value,
    attachmentRoot,
    preparedInput,
    transform,
    publishValue,
    context,
    returnResultPromise,
) {
    let originalValue
    const operation = resolution.resolveOperationResultsOrFatal(
        [value, preparedInput],
        ([resolvedTargetValue, preparedArguments]) => {
            originalValue = resolvedTargetValue
            context.mustPreserveValue = mustPreserveValue(
                resolvedTargetValue,
                attachmentRoot,
            )
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
        if (operation.result === operation.mutatedValue) {
            metadata.markShared(operation.mutatedValue)
        }
        if (operation.mutatedValue !== originalValue) {
            publishValue(operation.mutatedValue)
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
    publishValue(mutatedValueGate)
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
    return errorUtils.runFatal(() => {
        return walkMutationPath(
            chain,
            path,
            target => {
                if (
                    target.propertyKind ===
                    languageProperties.ORDINARY_PROPERTY
                ) {
                    setProperty(
                        target.parent,
                        target.key,
                        value,
                        target.attachmentRoot,
                    )
                    return undefined
                }
                if (
                    target.propertyKind ===
                    languageProperties.STRING_LENGTH
                ) {
                    return languageProperties.propertyValidationError(
                        target.receiver,
                        "String length is read-only",
                    )
                }
                return transformValue(
                    target.receiver,
                    target.attachmentRoot,
                    undefined,
                    transformArrayLength,
                    target.replaceReceiver,
                    {},
                    false,
                )
            },
            undefined,
            tryArrayViewAssignment,
        )
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
        if (growth <= 0) return undefined

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

    function transformArrayLength(
        array,
        _input,
        { mustPreserveValue },
    ) {
        return resolution.continueOperationUnlessPoison(
            toArrayLength(value),
            length => {
                let mutatedValue = array
                const projection = arrayViews.projectionOf(array)
                const growth = length - projection.length
                if (
                    mustPreserveValue ||
                    (
                        arrayViews.isArrayView(projection) &&
                        growth > 0 &&
                        !arrayViews.ArrayView.canGrowEnd(projection, growth)
                    )
                ) {
                    mutatedValue = arrayRemaps.createArrayFromRemap(
                        arrayRemaps.createInitialRemap(array),
                        array,
                    )
                }
                return {
                    mutatedValue,
                    result: propertyVersions.commitArrayLength(
                        mutatedValue,
                        length,
                    ),
                }
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
    function complete(writeBack, next, operationError = undefined) {
        writeBack(next)
        if (onComplete) {
            return onComplete(
                operationError ?? (
                    languageValues.isError(next) ? next : undefined
                ),
            )
        }
        return operationError
    }

    function walk(
        value,
        index,
        writeBack,
        placement = undefined,
    ) {
        if (languageValues.isError(value)) {
            return complete(writeBack, value)
        }
        const key = String(targetPath[index])
        const atTarget = index === targetPath.length - 1
        const propertyKind = languageProperties.classifyLanguageProperty(
            value,
            key,
        )
        if (propertyKind === languageProperties.INVALID_ARRAY_KEY) {
            return complete(
                writeBack,
                value,
                languageProperties.propertyValidationError(
                    value,
                    "Arrays support only indexes and length",
                ),
            )
        }
        if (propertyKind !== languageProperties.ORDINARY_PROPERTY) {
            if (atTarget) {
                let nextReceiver = value
                // Publish intrinsic replacement through the captured edge;
                // its original Promise mirror may since have detached.
                const targetResult = onTarget({
                    ...placement,
                    attachmentRoot,
                    propertyKind,
                    replaceReceiver(next) {
                        nextReceiver = next
                    },
                    receiver: value,
                })
                return complete(writeBack, nextReceiver, targetResult)
            }
            return walk(
                languageProperties.readLanguageProperty(value, key),
                index + 1,
                () => writeBack(value),
                { parent: value, key },
            )
        }
        if (!languageValues.isTracked(value)) {
            return complete(writeBack, errorUtils.pathAccessError())
        }

        const mutatedValue = atTarget
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
        const mustCopyParent = mustPreserveValue(
            value,
            attachmentRoot,
        ) ||
            arrayViews.requiresArrayMaterialization(value)

        if (mustCopyParent) {
            const copied = copyForWrite(
                parent,
                key,
                attachmentRoot,
            )
            parent = copied.value
            attachmentRoot = copied.attachmentRoot
        }
        if (atTarget) {
            const targetResult = onTarget({
                parent,
                key,
                attachmentRoot,
                propertyKind,
                receiver: parent,
            })
            return complete(writeBack, parent, targetResult)
        }

        // Asserted after the COW: copies carry only own enumerable keys, so
        // this fires only on genuinely un-shadowable intermediate shapes.
        languageProperties.assertCanMutateLanguageProperty(parent, key)

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
                    { parent, key },
                ),
            )
            writeBack(parent)
            return onComplete === undefined ? undefined : pending
        }

        return walk(
            child,
            index + 1,
            next => {
                if (next === child) {
                    writeBack(value)
                    return
                }
                setProperty(parent, key, next)
                writeBack(parent)
            },
            { parent, key },
        )
    }
}

// --- deletePath :  delete a.k ----------------------------------------------
function deletePath(chain, path) {
    return errorUtils.runFatal(() => {
        const deletesRoot = path.length === 0
        return walkMutationPath(chain, path, target => {
            if (deletesRoot) {
                setProperty(target.parent, target.key, null)
                return undefined
            }
            if (
                target.propertyKind !==
                languageProperties.ORDINARY_PROPERTY
            ) {
                return languageProperties.propertyValidationError(
                    target.receiver,
                    "Cannot delete length",
                )
            }

            propertyVersions.deleteProperty(target.parent, target.key)
            return undefined
        })
    })
}

export {
    assignPath,
    deletePath,
    setProperty,
    transformProperty,
    walkMutationPath,
}
