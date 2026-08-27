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
    attachmentRoot = undefined,
) {
    if (attachmentRoot && containsPromise(value)) {
        metadata.markShared(attachmentRoot)
    }
    propertyVersions.assignProperty(parent, key, value)
}

function containsPromise(value, visited = new Set()) {
    if (languageValues.isPromise(value)) return true
    if (!languageValues.isTraversable(value) || visited.has(value)) return false
    visited.add(value)

    const counter = refcounts.getRefCounter(value)
    if (counter?.promiseCount > 0) return true
    if (counter && counter.cycleCutCount === 0) return false

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

function createEmptyContainerCopy(source) {
    const sourceMeta = metadata.requireMeta(source)
    const type = sourceMeta.type
    let destination
    if (type === languageValues.TYPE_ARRAY) {
        destination = new Array(arrayViews.logicalArrayLength(source))
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
        type,
        sourceMeta.admittedPrototype,
    )
    return destination
}

function shallowCopyPathContainer(source, pathKey, attachmentRoot) {
    const destination = createEmptyContainerCopy(source)
    attachmentRoot ??= destination
    const pathKeyString = String(pathKey)

    // Copy only language-visible own enumerable string keys. Metadata lives
    // outside that surface, so the source alone keeps its metadata.
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
    const context = operationLifecycle.createOwner({
        present: origin !== undefined,
    })
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
    const readiness = operationLifecycle.continueInternalAll(
        context,
        [value, preparedInput],
        values => recoverMutationFailure(
            () => {
                const [resolvedTargetValue, preparedArguments] = values
                originalValue = resolvedTargetValue
                context.mustPreserveValue = mustPreserveValue(
                    resolvedTargetValue,
                    attachmentRoot,
                )
                return operationLifecycle.continueInternal(
                    context,
                    transform(
                        resolvedTargetValue,
                        preparedArguments,
                        context,
                    ),
                    normalizeMutationOutcome,
                )
            },
        ),
    )

    if (!languageValues.isPromise(readiness)) {
        const outcome = prepareMutationPublication(readiness)
        if (outcome.mutatedValue !== originalValue) {
            publishValue(outcome.mutatedValue)
        }
        operationLifecycle.close(context)
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
        context,
        readiness,
        outcome => {
            outcome = prepareMutationPublication(outcome)
            // This private publication gate has only a resolve capability.
            operationLifecycle.continueInternal(context, mutatedValueGate, () => {
                if (returnResultPromise) resolveResult(outcome.result)
                operationLifecycle.close(context)
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
            ) metadata.markShared(outcome.mutatedValue)
            return outcome
        })
    }
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignPath(chain, path, value) {
    return errorUtils.runFatal(() => {
        languageValues.admitValue(value)
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
                    const error = languageProperties.propertyValidationError(
                        target.receiver,
                        "String length is read-only",
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
                    operationLifecycle.createOwner(),
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
        context,
    ) {
        return operationLifecycle.continuePrepared(
            context,
            toArrayLength(value, context),
            length => {
                let mutatedValue = array
                const representationCopy =
                    languageProperties.arrayLengthMutationRequiresCopy(
                        array,
                        length,
                    )
                if (context.mustPreserveValue || representationCopy) {
                    mutatedValue = arrayRemaps.createArrayFromRemap(
                        arrayRemaps.createRemap(array),
                        array,
                        context.mustPreserveValue,
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
    onTarget,
    onComplete = undefined,
    {
        tryTargetMutation = undefined,
        deletesTarget = false,
    } = {},
) {
    const mutates = chain.assertState()
    const state = chain._state
    if (!mutates) {
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
    function complete(writeBack, next, targetResult = undefined) {
        languageValues.admitValue(next)
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
        const key = String(targetPath[index])
        const atTarget = index === targetPath.length - 1
        const propertyKind = languageProperties.classifyLanguageProperty(
            value,
            key,
        )
        if (propertyKind === languageProperties.INVALID_ARRAY_KEY) {
            const error = languageProperties.propertyValidationError(
                value,
                "Arrays support only indexes and length",
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
                languageProperties.readLanguageProperty(value, key),
                index + 1,
                () => writeBack(value),
                { parent: value, key },
            )
        }
        if (!languageValues.isTraversable(value)) {
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
                atTarget && deletesTarget,
            )
        const mustCopyParent = mustPreserveValue(
            value,
            attachmentRoot,
        ) ||
            // View materialization is the representation fallback before the
            // ordinary property-specific preflight can permit an in-place write.
            arrayViews.requiresArrayMaterialization(value) ||
            representationCopy

        if (mustCopyParent) {
            const copied = shallowCopyPathContainer(
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

        const present = languageProperties.hasLanguageProperty(parent, key)
        const child = present
            ? languageProperties.readLanguageProperty(parent, key)
            : undefined
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
        return walkMutationPath(
            chain,
            path,
            target => {
                if (deletesRoot) {
                    setProperty(target.parent, target.key, null)
                    return undefined
                }
                if (
                    target.propertyKind !==
                    languageProperties.ORDINARY_PROPERTY
                ) {
                    const error = languageProperties.propertyValidationError(
                        target.receiver,
                        "Cannot delete length",
                    )
                    target.replaceReceiver(error)
                    return error
                }

                propertyVersions.deleteProperty(target.parent, target.key)
                return undefined
            },
            undefined,
            deletesRoot ? undefined : {
                deletesTarget: true,
                tryTargetMutation(parent, key) {
                    return languageProperties.hasLanguageProperty(parent, key)
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
