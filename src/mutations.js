import * as internalSteps from "./internal-step.js"
import { markPromiseHandled } from "./thenable-subscription.js"
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

function setProperty(
    parent,
    key,
    value,
    operationContext,
    attachmentRoot = undefined,
) {
    const result = propertyVersions.assignProperty(parent, key, value, operationContext)
    if (attachmentRoot && containsPromise(
        languageProperties.readLanguageProperty(parent, key, operationContext), operationContext,
    )) metadata.markShared(attachmentRoot, operationContext)
    return result
}

function containsPromise(value, operationContext, visited = new Set()) {
    if (languageValues.isPending(value, operationContext)) return true
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
    if (type === languageValues.TYPE.Array) {
        destination = new Array(arrayViews.logicalArrayLength(source, operationContext))
    } else if (
        type === languageValues.TYPE.Record ||
        type === languageValues.TYPE.ManagedClass
    ) {
        destination = Object.create(sourceMeta.admittedPrototype)
    } else {
        throw new TypeError("Cannot copy a non-container value")
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
        if (languageValues.isPending(value, operationContext)) {
            const sourceVersion = propertyVersions.requirePromiseVersion(
                source,
                key,
                operationContext,
            )
            propertyVersions.forkPromiseVersion(
                sourceVersion,
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
    refcounts.indexValueIfSourceIndexed(source, destination, operationContext)
    return {
        value: destination,
        attachmentRoot,
    }
}

function transformProperty(
    target,
    operationContext,
    transform,
) {
    const { parent, key, attachmentRoot } = target
    const placement = propertyVersions.getPropertyPlacement(
        parent,
        key,
        operationContext,
    )
    placement?.captureVersion()
    const operation = new operationLifecycle.OperationOwner(operationContext)
    operation.present = placement !== undefined
    return transformValue(
        placement?.resolveValue(),
        attachmentRoot,
        transform,
        value => errorUtils.catchExternalThrow(
            () => {
                setProperty(parent, key, value, operationContext, attachmentRoot)
                return propertyVersions.getPromiseVersion(parent, key, operationContext)
            },
            operationContext,
            errorUtils.ERROR_KIND.PropertyMutationFailed,
            failure => {
                const failedValue = errorUtils.isPoisonError(value)
                    ? errorUtils.combineErrors([value, failure], "Mutation publication failed")
                    : failure
                target.replaceReceiver(failedValue)
                return failedValue
            },
        ),
        operation,
        true,
    )
}

function transformValue(
    value,
    attachmentRoot,
    transform,
    publishValue,
    operation,
    returnResultPromise,
) {
    let originalValue
    const readiness = internalSteps.continueOperation(
        value,
        operation.operationContext,
        resolvedTargetValue =>
            recoverMutationFailure(() => {
                originalValue = resolvedTargetValue
                operation.mustPreserveValue = mustPreserveValue(
                    resolvedTargetValue,
                    attachmentRoot,
                    operation.operationContext,
                )
                return internalSteps.continueOperation(
                    transform(resolvedTargetValue, operation),
                    operation.operationContext,
                    normalizeMutationOutcome,
                    undefined,
                    operation,
                )
            }),
        undefined,
        operation,
    )

    if (!languageValues.isPending(readiness, operation.operationContext)) {
        const outcome = prepareMutationPublication(readiness)
        let failure
        if (outcome.mutatedValue !== originalValue) {
            failure = publishValue(outcome.mutatedValue)
        }
        operationLifecycle.close(operation)
        return includePublicationFailure(outcome.result, failure, operation.operationContext)
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
    const promiseVersion = publishValue(mutatedValueGate)
    let operationResult
    if (!errorUtils.isPoisonError(promiseVersion)) {
        // Subscribe at issuance, after the shared publication resolver and before
        // later operations can advance this captured version. Registering only
        // when readiness settles would let their Errors enter this result.
        const completion = internalSteps.continueOperation(
            mutatedValueGate,
            operation.operationContext,
            () => {
                operationLifecycle.close(operation)
                if (returnResultPromise) resolveResult(
                    includePublicationFailure(
                        operationResult,
                        promiseVersion.value,
                        operation.operationContext,
                    ),
                )
            },
            undefined,
            operation,
        )
        markPromiseHandled(completion, operation.operationContext)
    }
    const publication = internalSteps.continueOperation(
        readiness,
        operation.operationContext,
        outcome => {
            outcome = prepareMutationPublication(outcome)
            if (errorUtils.isPoisonError(promiseVersion)) {
                // Failed gate installation already replaced the enclosing
                // receiver. Retain the in-flight result without publishing again.
                operationLifecycle.close(operation)
                resolveResult(includePublicationFailure(
                    outcome.result,
                    promiseVersion,
                    operation.operationContext,
                ))
                return
            }
            operationResult = outcome.result
            // This private publication gate has only a resolve capability.
            resolveMutatedValue(outcome.mutatedValue)
        },
        undefined,
        operation,
    )
    markPromiseHandled(publication, operation.operationContext)
    return result

    function normalizeMutationOutcome(outcome) {
        return errorUtils.isPoisonError(outcome)
            ? { mutatedValue: outcome, result: outcome }
            : outcome
    }

    function recoverMutationFailure(fn) {
        return errorUtils.catchExternalThrow(
            fn,
            operation.operationContext,
            errorUtils.ERROR_KIND.PropertyMutationFailed,
            mutationFailureOutcome,
        )
    }

    function mutationFailureOutcome(failure) {
        return { mutatedValue: failure, result: failure }
    }

    function prepareMutationPublication(outcome) {
        if (outcome.result === outcome.mutatedValue)
            metadata.markShared(outcome.mutatedValue, operation.operationContext)
        return outcome
    }
}

// Publication and an independent result can both fail. Waiting for the result
// does not extend the completed publication's owner or receiver protection.
function includePublicationFailure(result, publishedValue, operationContext) {
    if (!errorUtils.isPoisonError(publishedValue) || result === publishedValue) return result
    return internalSteps.continueOperation(
        result,
        operationContext,
        value => errorUtils.isPoisonError(value)
            ? errorUtils.combineErrors([value, publishedValue], "Mutation publication failed")
            : publishedValue,
    )
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignPath(
    chain,
    path,
    value,
    operationContext,
    mutationScopeDepth = path.length,
) {
    return internalSteps.runInternalStep(operationContext, () => {
        chain._assertOperationContext(operationContext)
        const preparedPath = [...path]
        if (errorUtils.isFatalError(value)) throw value
        return walkMutationPath(
            chain,
            preparedPath,
            operationContext,
            target => {
                if (
                    target.propertyKind ===
                    languageProperties.ORDINARY_PROPERTY
                ) {
                    return setProperty(
                        target.parent,
                        target.key,
                        value,
                        operationContext,
                        target.attachmentRoot,
                    )
                }
                if (
                    target.propertyKind ===
                    languageProperties.STRING_LENGTH
                ) {
                    const error = languageProperties.propertyValidationError(
                        "String length is read-only",
                        operationContext,
                    )
                    target.replaceReceiver(error)
                    return error
                }
                return transformValue(
                    target.receiver,
                    target.attachmentRoot,
                    transformArrayLength,
                    target.replaceReceiver,
                    new operationLifecycle.OperationOwner(operationContext),
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

    function transformArrayLength(array, operation) {
        return internalSteps.continueOperation(
            toArrayLength(value, operation),
            operation.operationContext,
            length => {
                if (errorUtils.isPoisonError(length)) return length
                return errorUtils.catchExternalThrow(
                    () => {
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
                    operationContext,
                    errorUtils.ERROR_KIND.PropertyMutationFailed,
                    failure => ({ mutatedValue: failure, result: failure }),
                )
            },
            undefined,
            operation,
        )
    }
}

function toArrayLength(value, operation) {
    return internalSteps.continueOperation(
        conversion.toNumberValue(value, operation),
        operation.operationContext,
        number => {
            if (errorUtils.isPoisonError(number)) return number

            const length = number >>> 0
            return length === number
                ? length
                : errorUtils.validationError(
                    "Invalid array length",
                    operation.operationContext,
                    errorUtils.ERROR_KIND.InvalidArrayLength,
                )
        },
        undefined,
        operation,
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
        throw new Error("Cannot mutate through a read-only Chain")
    }
    const rootState = chain._state
    const targetPath = ["value", ...path]
    let attachmentRoot
    let pathSelectionComplete = false
    let operationResult
    let publicationValue
    return walk(rootState, 0, () => {})

    // Completion follows synchronous reconstruction through every enclosing
    // write-back continuation. Keeping this outside walk avoids allocating it
    // for every recursive frame.
    function complete(writeBack, next, targetResult = undefined) {
        pathSelectionComplete = true
        if (!languageValues.isPending(next, operationContext)) languageValues.admitReadyValue(next, operationContext)
        const outcome =
            targetResult === undefined && errorUtils.isPoisonError(next)
                ? next
                : targetResult
        publicationValue = next
        operationResult = outcome
        writeBack(next)
        return onComplete ? onComplete(operationResult) : operationResult
    }

    function completeTarget(target, writeBack) {
        let nextReceiver = target.receiver
        const result = onTarget({
            ...target,
            replaceReceiver(next) { nextReceiver = next },
        })
        return complete(writeBack, nextReceiver, result)
    }

    function walk(value, index, writeBack, placement = undefined) {
        return errorUtils.catchExternalThrow(
            () => walkReady(value, index, writeBack, placement),
            operationContext,
            errorUtils.ERROR_KIND.PropertyMutationFailed,
            failure => {
                const failedValue = errorUtils.isPoisonError(publicationValue)
                    ? errorUtils.combineErrors([publicationValue, failure], "Mutation publication failed")
                    : failure
                return complete(
                    writeBack,
                    failedValue,
                    includePublicationFailure(operationResult, failedValue, operationContext),
                )
            },
        )
    }

    function walkReady(value, index, writeBack, placement = undefined) {
        if (errorUtils.isPoisonError(value)) {
            return complete(writeBack, value)
        }
        const key = languageProperties.normalizePathSegment(
            targetPath[index],
            operationContext,
        )
        if (errorUtils.isPoisonError(key)) {
            languageValues.admitReadyValue(key, operationContext)
            return complete(writeBack, key, key)
        }
        const atTarget = index === targetPath.length - 1
        if (atTarget) pathSelectionComplete = true
        const propertyKind = languageProperties.classifyLanguageProperty(
            value,
            key,
            operationContext,
        )
        if (propertyKind === languageProperties.INVALID_ARRAY_KEY) {
            const error = languageProperties.propertyValidationError(
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
                // Publish intrinsic replacement through the captured edge;
                // its original Promise version may since have detached.
                return completeTarget({
                    ...placement,
                    attachmentRoot,
                    propertyKind,
                    receiver: value,
                }, writeBack)
            }
            return walk(
                languageProperties.readLanguageProperty(value, key, operationContext),
                index + 1,
                () => writeBack(value),
                { parent: value, key },
            )
        }
        if (!languageValues.isTraversable(value, operationContext)) {
            return complete(
                writeBack,
                errorUtils.pathAccessError(value, operationContext),
            )
        }

        const mutatedValue = atTarget
            ? tryTargetMutation?.(
                value,
                key,
                attachmentRoot,
            )
            : undefined
        if (errorUtils.isPoisonError(mutatedValue)) {
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
            return completeTarget({
                parent,
                key,
                attachmentRoot,
                propertyKind,
                receiver: parent,
            }, writeBack)
        }

        const present = languageProperties.hasLanguageProperty(
            parent,
            key,
            operationContext,
        )
        const child = present
            ? languageProperties.readLanguageProperty(parent, key, operationContext)
            : undefined
        if (languageValues.isPending(child, operationContext)) {
            const pending = propertyVersions.continuePromiseVersion(
                parent,
                key,
                child,
                operationContext,
                (propertyValue, promiseVersion) => walk(
                    propertyValue,
                    index + 1,
                    next => {
                        if (next !== propertyValue) {
                            publicationValue = next
                            // An imported parent was copied before descent, so
                            // this property version is runtime-owned.
                            propertyVersions.publishPromiseVersion(
                                parent,
                                key,
                                promiseVersion,
                                next,
                                operationContext,
                            )
                            operationResult = includePublicationFailure(
                                operationResult,
                                promiseVersion.value,
                                operationContext,
                            )
                        }
                    },
                    { parent, key },
                ),
            )
            if (!pathSelectionComplete) writeBack(parent)
            if (onComplete === undefined && languageValues.isPending(pending, operationContext)) {
                markPromiseHandled(pending, operationContext)
                return undefined
            }
            return pending
        }

        return walk(
            child,
            index + 1,
            next => {
                if (next === child) {
                    writeBack(value)
                    return
                }
                publicationValue = next
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
    return internalSteps.runInternalStep(operationContext, () => {
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
