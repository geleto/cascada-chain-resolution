import * as errorUtils from "./error.js"
import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as conversion from "./language-conversion.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"
import * as refcounts from "./refcounts.js"
import * as resolution from "./resolution.js"

function setProperty(
    parent,
    key,
    value,
    operationContext,
    attachmentRoot = undefined,
) {
    if (attachmentRoot && containsPromise(value, operationContext)) {
        metadata.markShared(attachmentRoot, operationContext)
    }
    propertyVersions.assignProperty(parent, key, value, operationContext)
}

function containsPromise(value, operationContext, visited = new Set()) {
    if (languageValues.isPromise(value, operationContext)) return true
    if (
        !languageValues.isTraversable(value, operationContext) ||
        visited.has(value)
    ) return false
    visited.add(value)

    const counter = refcounts.getRefCounter(value, operationContext)
    if (counter?.promiseCount > 0) return true
    if (counter && counter.cycleCutCount === 0) return false

    for (const key of languageProperties.enumerableLanguageKeys(
        value,
        operationContext,
    )) {
        if (containsPromise(
            languageProperties.readLanguageProperty(value, key, operationContext),
            operationContext,
            visited,
        )) return true
    }
    return false
}

function mustPreserveValue(value, attachmentRoot, operationContext) {
    return attachmentRoot !== undefined ||
        metadata.requiresCopyOnWrite(value, operationContext)
}

function createEmptyContainerCopy(source, operationContext) {
    const sourceMeta = metadata.requireMeta(source, operationContext)
    const type = sourceMeta.type
    let destination
    if (type === languageValues.TYPE_ARRAY) {
        destination = new Array(arrayViews.logicalArrayLength(source, operationContext))
    } else if (
        type === languageValues.TYPE_RECORD ||
        type === languageValues.TYPE_MANAGED_CLASS
    ) {
        destination = Object.create(sourceMeta.admittedPrototype)
    } else {
        errorUtils.reportFatalError(
            new TypeError("Cannot copy a non-container value"),
        )
    }
    languageValues.admitReadyValue(
        destination,
        operationContext,
        type,
        sourceMeta.admittedPrototype,
    )
    return destination
}

function shallowCopyPathContainer(source, pathKey, attachmentRoot, operationContext) {
    const destination = createEmptyContainerCopy(source, operationContext)
    attachmentRoot ??= destination

    // Copy only language-visible own enumerable string keys. Metadata lives
    // outside that surface, so the source alone keeps its metadata.
    // Reused off-path children are marked shared because both copies retain
    // them. The path child is replaced or copied by the current walk.
    for (const key of languageProperties.enumerableLanguageKeys(
        source,
        operationContext,
    )) {
        const retainedOffPath = key !== pathKey
        const value = languageProperties.readLanguageProperty(
            source,
            key,
            operationContext,
        )
        if (languageValues.isPromise(value, operationContext)) {
            const sourceMirror = propertyVersions.getOrCreatePromiseMirror(
                source,
                key,
                value,
                operationContext,
            )
            propertyVersions.placePromiseVersion(
                sourceMirror,
                value,
                destination,
                key,
                operationContext,
                retainedOffPath,
            )
            continue
        }
        if (retainedOffPath) metadata.markShared(value, operationContext)
        // The copy remains unobservable until its owning path is installed.
        languageProperties.writeLanguageProperty(
            destination,
            key,
            value,
            operationContext,
        )
    }
    propertyVersions.indexValueIfSourceIndexed(source, destination, operationContext)
    return {
        value: destination,
        attachmentRoot,
    }
}

function transformProperty(
    parent,
    key,
    attachmentRoot,
    operationContext,
    prepareInput,
    transform,
    returnResultPromise = true,
) {
    const origin = propertyVersions.getPropertyPlacement(
        parent,
        key,
        operationContext,
    )
    propertyVersions.capturePropertyVersion(origin)
    const operation = operationLifecycle.createOwner(operationContext, {
        present: origin !== undefined,
    })
    return transformValue(
        propertyVersions.resolvePropertyValue(origin),
        attachmentRoot,
        prepareInput(operation),
        transform,
        value => setProperty(
            parent,
            key,
            value,
            operationContext,
            attachmentRoot,
        ),
        operation,
        returnResultPromise,
    )
}

function transformValue(
    value,
    attachmentRoot,
    preparedInput,
    transform,
    publishValue,
    operation,
    returnResultPromise,
) {
    let originalValue
    const readiness = operationLifecycle.continueInternalAll(
        operation,
        [value, preparedInput],
        values => recoverMutationFailure(
            () => {
                const [resolvedTargetValue, preparedArguments] = values
                originalValue = resolvedTargetValue
                operation.mustPreserveValue = mustPreserveValue(
                    resolvedTargetValue,
                    attachmentRoot,
                    operation.operationContext,
                )
                return operationLifecycle.continueInternal(
                    operation,
                    transform(
                        resolvedTargetValue,
                        preparedArguments,
                        operation,
                    ),
                    normalizeMutationOutcome,
                )
            },
        ),
    )

    if (!languageValues.isPromise(readiness, operation.operationContext)) {
        const outcome = prepareMutationPublication(readiness)
        if (outcome.mutatedValue !== originalValue) {
            publishValue(outcome.mutatedValue)
        }
        operationLifecycle.close(operation)
        return outcome.result
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
    operationLifecycle.continueInternal(
        operation,
        readiness,
        outcome => {
            outcome = prepareMutationPublication(outcome)
            // This private publication gate has only a resolve capability.
            operationLifecycle.continueInternal(operation, mutatedValueGate, () => {
                if (returnResultPromise) resolveResult(outcome.result)
                operationLifecycle.close(operation)
            })
            resolveMutatedValue(outcome.mutatedValue)
        },
    )
    return result

    function normalizeMutationOutcome(outcome) {
        return recoverMutationFailure(
            () => languageValues.isError(outcome)
                ? { mutatedValue: outcome, result: outcome }
                : outcome,
        )
    }

    function recoverMutationFailure(fn) {
        return errorUtils.catchUserCodeFailure(fn, mutationFailureOutcome)
    }

    function mutationFailureOutcome(failure) {
        return { mutatedValue: failure, result: failure }
    }

    function prepareMutationPublication(outcome) {
        return recoverMutationFailure(() => {
            if (
                !languageValues.isError(outcome.result) &&
                outcome.result === outcome.mutatedValue
            ) metadata.markShared(
                outcome.mutatedValue,
                operation.operationContext,
            )
            return outcome
        })
    }
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignPath(
    chain,
    path,
    value,
    operationContext,
    mutationScopeDepth = path.length,
) {
    return errorUtils.runFatal(operationContext, () => {
        chain._assertOperationContext(operationContext)
        const preparedPath = [...path]
        languageValues.admitValue(value, operationContext)
        return walkMutationPath(
            chain,
            preparedPath,
            operationContext,
            target => {
                if (
                    target.propertyKind ===
                    languageProperties.ORDINARY_PROPERTY
                ) {
                    setProperty(
                        target.parent,
                        target.key,
                        value,
                        operationContext,
                        target.attachmentRoot,
                    )
                    return undefined
                }
                if (
                    target.propertyKind ===
                    languageProperties.STRING_LENGTH
                ) {
                    const error = languageProperties.propertyValidationError(
                        target.receiver,
                        "String length is read-only",
                        operationContext,
                    )
                    target.replaceReceiver(error)
                    return error
                }
                return transformValue(
                    target.receiver,
                    target.attachmentRoot,
                    undefined,
                    transformArrayLength,
                    target.replaceReceiver,
                    operationLifecycle.createOwner(operationContext),
                    false,
                )
            },
            undefined,
            { tryTargetMutation: tryArrayViewAssignment },
        )
    })

    function tryArrayViewAssignment(
        array,
        key,
        attachmentRoot,
    ) {
        const projection = arrayViews.projectionOf(array, operationContext)
        if (!arrayViews.isArrayView(projection, operationContext)) return undefined
        const end = Number(key) + 1
        const growth = end - projection.length
        if (growth <= 0) return undefined

        const extended = arrayViews.ArrayView.tryExtendEnd(
            projection,
            growth,
            view => propertyVersions.prepareRetainedArrayProperties(
                array,
                view,
                operationContext,
            ),
            operationContext,
        )
        if (!extended) return undefined
        setProperty(extended, key, value, operationContext, attachmentRoot)
        return extended
    }

    function transformArrayLength(
        array,
        _input,
        operation,
    ) {
        return operationLifecycle.continuePrepared(
            operation,
            toArrayLength(value, operation),
            length => {
                let mutatedValue = array
                const representationCopy =
                    languageProperties.arrayLengthMutationRequiresCopy(
                        array,
                        length,
                        operation.operationContext,
                    )
                if (operation.mustPreserveValue || representationCopy) {
                    mutatedValue = arrayRemaps.createArrayFromRemap(
                        arrayRemaps.createRemap(array, operation.operationContext),
                        operation.operationContext,
                        array,
                        operation.mustPreserveValue,
                    )
                }
                return {
                    mutatedValue,
                    result: propertyVersions.commitArrayLength(
                        mutatedValue,
                        length,
                        operation.operationContext,
                    ),
                }
            },
        )
    }
}

function toArrayLength(value, operation) {
    return operationLifecycle.continuePrepared(
        operation,
        conversion.toNumberValue(value, operation),
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
    operationContext,
    onTarget,
    onComplete = undefined,
    {
        tryTargetMutation = undefined,
        deletesTarget = false,
    } = {},
) {
    if (chain._entryMutable === false) {
        errorUtils.reportFatalError(
            new Error("Cannot mutate through a read-only Chain"),
        )
    }
    const state = chain._state
    const targetPath = ["value", ...path]
    let attachmentRoot
    return walk(state, 0, () => {})

    // Completion follows synchronous reconstruction through every enclosing
    // write-back continuation. Keeping this outside walk avoids allocating it
    // for every recursive frame.
    function complete(writeBack, next, targetResult = undefined) {
        languageValues.admitValue(next, operationContext)
        writeBack(next)
        const outcome = targetResult === undefined &&
            languageValues.isError(next)
            ? next
            : targetResult
        return onComplete ? onComplete(outcome) : outcome
    }

    function walk(value, index, writeBack, placement = undefined) {
        return errorUtils.catchUserCodeFailure(
            () => walkReady(value, index, writeBack, placement),
            failure => complete(writeBack, failure, failure),
        )
    }

    function walkReady(
        value,
        index,
        writeBack,
        placement = undefined,
    ) {
        if (languageValues.isError(value)) {
            return complete(writeBack, value)
        }
        const key = languageProperties.normalizePathSegment(
            targetPath[index],
        )
        if (languageValues.isError(key)) {
            languageValues.admitReadyValue(key, operationContext)
            return complete(writeBack, key, key)
        }
        const atTarget = index === targetPath.length - 1
        const propertyKind = languageProperties.classifyLanguageProperty(
            value,
            key,
            operationContext,
        )
        if (propertyKind === languageProperties.INVALID_ARRAY_KEY) {
            const error = languageProperties.propertyValidationError(
                value,
                "Arrays support only indexes and length",
                operationContext,
            )
            return complete(
                writeBack,
                error,
                error,
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
                languageProperties.readLanguageProperty(value, key, operationContext),
                index + 1,
                () => writeBack(value),
                { parent: value, key },
            )
        }
        if (!languageValues.isTraversable(value, operationContext)) {
            return complete(writeBack, errorUtils.pathAccessError())
        }

        const mutatedValue = atTarget
            ? tryTargetMutation?.(
                value,
                key,
                attachmentRoot,
            )
            : undefined
        if (languageValues.isError(mutatedValue)) {
            return complete(writeBack, mutatedValue, mutatedValue)
        }
        if (mutatedValue !== undefined) {
            return complete(writeBack, mutatedValue)
        }
        let parent = value
        const representationCopy =
            languageProperties.propertyMutationRequiresCopy(
                value,
                key,
                operationContext,
                atTarget && deletesTarget,
            )
        const mustCopyParent = mustPreserveValue(
            value,
            attachmentRoot,
            operationContext,
        ) ||
            // View materialization is the representation fallback before the
            // ordinary property-specific preflight can permit an in-place write.
            arrayViews.requiresArrayMaterialization(value, operationContext) ||
            representationCopy

        if (mustCopyParent) {
            const copied = shallowCopyPathContainer(
                parent,
                key,
                attachmentRoot,
                operationContext,
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

        const present = languageProperties.hasLanguageProperty(
            parent,
            key,
            operationContext,
        )
        const child = present
            ? languageProperties.readLanguageProperty(parent, key, operationContext)
            : undefined
        if (languageValues.isPromise(child, operationContext)) {
            const pending = propertyVersions.continuePropertyValue(
                parent,
                key,
                child,
                operationContext,
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
                                operationContext,
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
                setProperty(parent, key, next, operationContext)
                writeBack(parent)
            },
            { parent, key },
        )
    }
}

// --- deletePath :  delete a.k ----------------------------------------------
function deletePath(
    chain,
    path,
    operationContext,
    mutationScopeDepth = path.length,
) {
    return errorUtils.runFatal(operationContext, () => {
        chain._assertOperationContext(operationContext)
        const preparedPath = [...path]
        const deletesRoot = preparedPath.length === 0
        return walkMutationPath(
            chain,
            preparedPath,
            operationContext,
            target => {
                if (deletesRoot) {
                    setProperty(target.parent, target.key, null, operationContext)
                    return undefined
                }
                if (
                    target.propertyKind !==
                    languageProperties.ORDINARY_PROPERTY
                ) {
                    const error = languageProperties.propertyValidationError(
                        target.receiver,
                        "Cannot delete length",
                        operationContext,
                    )
                    target.replaceReceiver(error)
                    return error
                }

                propertyVersions.deleteProperty(
                    target.parent,
                    target.key,
                    operationContext,
                )
                return undefined
            },
            undefined,
            deletesRoot ? undefined : {
                deletesTarget: true,
                tryTargetMutation(parent, key) {
                    return languageProperties.hasLanguageProperty(
                        parent,
                        key,
                        operationContext,
                    )
                        ? undefined
                        : parent
                },
            },
        )
    })
}

export {
    assignPath,
    createEmptyContainerCopy,
    deletePath,
    setProperty,
    transformProperty,
    walkMutationPath,
}
