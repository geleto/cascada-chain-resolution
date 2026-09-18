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
import { PathOperation } from "./path-operation.js"
import { findBranch, truncatesLocations } from "./external-mutation-tree.js"
import { externalLocationError } from "./external-operation.js"

function setProperty(
    parent,
    key,
    value,
    operationContext,
    attachmentRoot = undefined,
) {
    return setPlacement(parent, key, { value, present: true }, operationContext, attachmentRoot)
}

function setPlacement(parent, key, placement, operationContext, attachmentRoot) {
    const result = propertyVersions.transferPlacement(placement, parent, key, operationContext)
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

function shallowCopyPathContainer(source, attachmentRoot, operationContext) {
    const destination = createEmptyContainerCopy(source, operationContext)
    attachmentRoot ??= destination

    // Copy only language-visible own enumerable string keys. Metadata lives
    // outside that surface, so the source alone keeps its metadata.
    // Both containers retain every copied child until replacement, including
    // when a path operation does nothing or its child is still pending.
    for (const key of languageProperties.enumerableLanguageKeys(
        source,
        operationContext,
    )) {
        languageProperties.readLanguageProperty(source, key, operationContext)
        const placement = propertyVersions.capturePlacement(source, key, operationContext)
        propertyVersions.transferPlacement(placement, destination, key, operationContext, true)
    }
    refcounts.indexValueIfSourceIndexed(source, destination, operationContext)
    return {
        value: destination,
        attachmentRoot,
    }
}

function transformProperty(target, operationContext, transform, { replace = false, repair = false } = {}) {
    const { parent, key, attachmentRoot } = target
    if (!replace && !target.sourceVersion) languageProperties.readLanguageProperty(parent, key, operationContext)
    let baseline = propertyVersions.capturePlacement(parent, key, operationContext, target.sourceVersion)
    let originalPlacement
    let leased
    let gate
    // Replacement waits for unfinished publication without consuming old data.
    const readiness = replace
        ? propertyVersions.resolvePlacementTransition(baseline, operationContext, apply)
        : propertyVersions.resolvePlacement(baseline, operationContext, apply)
    function apply(placement) {
        originalPlacement = placement
        baseline = placement
        let current = baseline.value
        if (!replace && errorUtils.isPoisonError(current)) {
            if (!repair || !baseline.recovery) return { mutatedValue: current, result: current, placement: baseline }
            baseline = baseline.recovery
            current = baseline.value
        }
        if (!Error.isError(current) && !languageValues.isPending(current, operationContext)) {
            languageValues.admitReadyValue(current, operationContext)
            leased = metadata.incrementReadLease(current, operationContext)
        }
        return internalSteps.continueOperation(errorUtils.catchExternalThrow(
            () => transform(current, { present: baseline.present, baseline }), operationContext,
            errorUtils.ERROR_KIND.PropertyMutationFailed), operationContext, normalize)
    }
    if (!languageValues.isPending(readiness, operationContext)) return publish(readiness)
    const failure = errorUtils.catchExternalThrow(() => {
        gate = propertyVersions.installPlacementGate(parent, key, operationContext, target.sourceVersion)
        if (attachmentRoot) metadata.markShared(attachmentRoot, operationContext)
    }, operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)
    if (errorUtils.isPoisonError(failure)) {
        if (!repair) target.replaceReceiver(failure)
        return internalSteps.continueOperation(readiness, operationContext, outcome => finish({
            mutatedValue: failure, result: includePublicationFailure(outcome.result, failure, operationContext),
        }))
    }
    // Publication finishes this transition. A restored or assigned Promise is
    // ordinary property availability and does not extend the operation result.
    return internalSteps.continueOperation(readiness, operationContext, publish)

    function normalize(outcome) {
        if (errorUtils.isPoisonError(outcome)) outcome = { mutatedValue: outcome, result: outcome }
        if (!outcome.placement && errorUtils.isPoisonError(outcome.mutatedValue)) {
            propertyVersions.retainPlacement(baseline, operationContext)
            outcome.placement = { value: outcome.mutatedValue, present: true, recovery: baseline }
        }
        if (outcome.result === outcome.mutatedValue) metadata.markShared(outcome.mutatedValue, operationContext)
        return outcome
    }
    function publish(outcome) {
        const placement = outcome.placement ?? { value: outcome.mutatedValue, present: true }
        const destinationVersion = gate?.version ?? target.sourceVersion
        let published = false
        const failure = errorUtils.catchExternalThrow(() => {
            if (gate || placement !== originalPlacement) {
                const failure = propertyVersions.transferPlacement(placement, parent, key, operationContext, false, destinationVersion)
                published = true
                if (!destinationVersion && attachmentRoot && containsPromise(placement.value, operationContext))
                    metadata.markShared(attachmentRoot, operationContext)
                return failure
            }
        }, operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)
        if (errorUtils.isPoisonError(failure)) {
            const poison = errorUtils.isPoisonError(placement.value)
                ? errorUtils.combineErrors([placement.value, failure], "Mutation publication failed") : failure
            propertyVersions.retainPlacement(baseline, operationContext)
            const restoring = repair && placement === baseline
            if (destinationVersion) {
                propertyVersions.commitPlacementVersion(parent, key, destinationVersion,
                    restoring ? originalPlacement : { value: poison, present: true, recovery: baseline }, operationContext, false)
            }
            // A failed physical write leaves this container unchanged. Publish
            // at its owning placement, preserving aliases of the container.
            else if (published) {
                const version = propertyVersions.getPlacementVersion(parent, key, operationContext) ?? { value: poison }
                version.recovery = baseline
                propertyVersions.installPlacementVersion(parent, key, version, operationContext)
            } else if (!restoring) target.replaceReceiver(poison)
            outcome = { mutatedValue: poison, result: includePublicationFailure(outcome.result, poison, operationContext) }
        }
        return finish(outcome)
    }
    function finish(outcome) {
        gate?.resolve()
        if (leased) metadata.decrementReadLease(baseline.value, operationContext)
        return { mutatedValue: outcome.mutatedValue, result: outcome.result }
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

function captureMutationResult(chain, result, operationContext) {
    const placement = propertyVersions.capturePlacement(chain._state, "value", operationContext)
    return { mutatedValue: placement.value, placement, result }
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignManagedPath(
    chain,
    path,
    placement,
    operationContext,
) {
    const value = placement.value
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
                    return setPlacement(
                        target.parent,
                        target.key,
                        placement,
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
                const operation = new operationLifecycle.OperationOwner(operationContext)
                operation.mustPreserveValue = mustPreserveValue(target.receiver, target.attachmentRoot, operationContext)
                const outcome = internalSteps.continueOperation(transformArrayLength(target.receiver, operation), operationContext, outcome => {
                    operation.close()
                    return errorUtils.isPoisonError(outcome) ? { mutatedValue: outcome, result: outcome } : outcome
                })
                target.replaceReceiver(internalSteps.continueOperation(outcome, operationContext, outcome => outcome.mutatedValue))
                return internalSteps.continueOperation(outcome, operationContext, outcome => outcome.result)
            },
            result => result,
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
        setPlacement(extended, key, placement, operationContext, attachmentRoot)
        return extended
    }

    function transformArrayLength(array, operation) {
        return internalSteps.continueOperation(
            toArrayLength(value, operation),
            operation.operationContext,
            length => {
                if (errorUtils.isPoisonError(length)) return length
                const branch = findBranch(chain._externalMutationTree, path.slice(0, -1))
                if (truncatesLocations(branch, length))
                    return languageProperties.propertyValidationError("Array length cannot remove a fixed external namespace", operationContext)
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
// continuations install copied branches into their enclosing keys. External
// selection observes the prefix, preparing writable parents only on failure.
function walkMutationPath(
    chain,
    path,
    operationContext,
    onTarget,
    onComplete = undefined,
    {
        tryTargetMutation = undefined,
        deletesTarget = false,
        onExternalFailure = undefined,
        observeTarget = false,
        structuralOwner = false,
        preserveOnFailure = false,
    } = {},
) {
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
    function complete(writeBack, next, targetResult = undefined, recovery = undefined) {
        pathSelectionComplete = true
        if (!languageValues.isPending(next, operationContext)) languageValues.admitReadyValue(next, operationContext)
        const outcome =
            targetResult === undefined && errorUtils.isPoisonError(next)
                ? next
                : targetResult
        publicationValue = next
        operationResult = outcome
        writeBack(next, recovery)
        return onComplete ? onComplete(operationResult) : operationResult
    }

    function completeTarget(target, writeBack) {
        let nextReceiver = target.receiver
        const result = onTarget({
            ...target,
            replaceReceiver(next) { nextReceiver = next },
        })
        // Reconstruct the path once. Pending work publishes through its captured
        // placement; replaying this writeback would restore obsolete COW parents.
        return complete(writeBack, nextReceiver, result)
    }

    function walk(value, index, writeBack, placement = undefined) {
        if (placement) {
            const publish = writeBack
            const version = placement.sourceVersion ?? propertyVersions.getPlacementVersion(placement.parent, placement.key, operationContext)
            const baseline = { value, present: placement.present !== false, recovery: version?.recovery }
            writeBack = (next, recovery) => {
                if (errorUtils.isPoisonError(next) && !errorUtils.isPoisonError(value)) {
                    propertyVersions.retainPlacement(baseline, operationContext)
                    publish(next, recovery ?? baseline)
                } else publish(next, recovery)
            }
        }
        return errorUtils.catchExternalThrow(
            () => walkReady(value, index, writeBack, placement),
            operationContext,
            errorUtils.ERROR_KIND.PropertyMutationFailed,
            failure => {
                const failedValue = errorUtils.isPoisonError(publicationValue)
                    ? errorUtils.combineErrors([publicationValue, failure], "Mutation publication failed")
                    : failure
                if (preserveOnFailure) return failedValue
                return complete(writeBack, failedValue,
                    includePublicationFailure(operationResult, failedValue, operationContext))
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
        if (atTarget && deletesTarget && languageValues.isTraversable(value, operationContext) &&
            languageProperties.classifyLanguageProperty(value, key, operationContext) === languageProperties.ORDINARY_PROPERTY &&
            !languageProperties.hasLanguageProperty(value, key, operationContext))
            return complete(writeBack, value, { mutatedValue: undefined, result: undefined })
        if (atTarget) pathSelectionComplete = true
        const propertyKind = languageProperties.classifyLanguageProperty(
            value,
            key,
            operationContext,
        )
        if (structuralOwner && index > 0 && arrayViews.isLogicalArray(value, operationContext) &&
            (propertyKind !== languageProperties.ORDINARY_PROPERTY || Number(key) >= arrayViews.logicalArrayLength(value, operationContext))) {
            return completeTarget({ ...placement, attachmentRoot, receiver: placement.parent,
                propertyKind: languageProperties.ORDINARY_PROPERTY, pathDepth: index - 1 }, () => {
                    writeBack(propertyVersions.capturePlacement(placement.parent, placement.key, operationContext, placement.sourceVersion).value)
                })
        }
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
            const external = metadata.metaOf(value, operationContext)?.type === languageValues.TYPE.External
            const failure = external
                ? externalLocationError(operationContext)
                : errorUtils.pathAccessError(value, operationContext)
            if (external) onExternalFailure?.(failure)
            return complete(
                writeBack,
                failure,
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
        // Capture inherited protection before descent: failure-only copying
        // reconstructs upward and must not make the private holder look shared.
        const preserveParent = mustPreserveValue(value, attachmentRoot, operationContext)
        if (observeTarget && preserveParent) attachmentRoot ??= value
        if (!observeTarget) prepareParent()
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
            // Native selection captures managed state; its external reservation
            // owns ordering. Only managed mutation installs a publication version.
            const source = propertyVersions.requirePromiseVersion(parent, key, operationContext)
            const onValue = (propertyValue, promiseVersion) => walk(
                propertyValue,
                index + 1,
                (next, recovery) => {
                    if (next !== propertyValue && next !== promiseVersion.value) {
                        publicationValue = next
                        // This version is runtime-owned: ordinary mutation
                        // copies imported parents before descent; external
                        // prefixes wait only at runtime scope gates because
                        // initial authority paths are directly ready.
                        propertyVersions.publishPromiseVersion(
                            parent,
                            key,
                            promiseVersion,
                            { value: next, present: true, recovery },
                            operationContext,
                        )
                        operationResult = includePublicationFailure(
                            operationResult,
                            promiseVersion.value,
                            operationContext,
                        )
                    }
                },
                { parent, key, sourceVersion: promiseVersion, present: promiseVersion.present !== false },
            )
            const pending = observeTarget
                ? propertyVersions.continueCapturedPromiseVersion(child, source, operationContext, value => onValue(value, source))
                : propertyVersions.continueMutationVersion(parent, key, source, operationContext, onValue)
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
            (next, recovery) => {
                if (next === child) {
                    writeBack(value)
                    return
                }
                // A structural transition can already have installed its gate
                // at this placement. Reconstruct parents without replacing that
                // version and losing its presence or recovery state.
                if (propertyVersions.getPlacementVersion(parent, key, operationContext)?.value === next) {
                    writeBack(parent)
                    return
                }
                publicationValue = next
                if (observeTarget) prepareParent()
                if (recovery) propertyVersions.transferPlacement({ value: next, present: true, recovery }, parent, key, operationContext)
                else setProperty(parent, key, next, operationContext)
                writeBack(parent)
            },
            { parent, key, present },
        )

        function prepareParent() {
            const representationCopy = languageProperties.propertyMutationRequiresCopy(
                value, key, operationContext, atTarget && deletesTarget)
            const mustCopyParent = preserveParent ||
                arrayViews.requiresArrayMaterialization(value, operationContext) || representationCopy
            if (mustCopyParent) {
                const copied = shallowCopyPathContainer(parent, attachmentRoot, operationContext)
                parent = copied.value
                attachmentRoot = copied.attachmentRoot
            }
        }
    }
}

// --- deletePath :  delete a.k ----------------------------------------------
function deleteManagedPath(
    chain,
    path,
    operationContext,
    completion = false,
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
            completion ? result => result : undefined,
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

function assignPath(chain, path, value, operationContext, mutationScopeDepth = path.length, firstDynamicSegment = path.length) {
    return mutatePath(chain, path, { value, present: true }, operationContext, mutationScopeDepth, firstDynamicSegment, false)
}

function deletePath(chain, path, operationContext, mutationScopeDepth = path.length, firstDynamicSegment = path.length) {
    return mutatePath(chain, path, undefined, operationContext, mutationScopeDepth, firstDynamicSegment, true)
}

function mutatePath(chain, path, placement, operationContext, depth, dynamic, deleting) {
    const value = placement?.value
    return internalSteps.runInternalStep(operationContext, () => {
        if (errorUtils.isFatalError(value)) throw value
        const replaceScope = depth === path.length
        // A property write consumes its container, not the old final value.
        const operation = new PathOperation(chain, path, operationContext, depth, false, dynamic, Math.max(0, path.length - 1))
        path = operation.route.path
        const result = operation.externalScope
            ? operation.finishMutation(operation.observe(value => value, access => deleting ? access.delete() : access.write(value)))
            : operation.finishMutation(operation.mutate((scope, state, privateChain, suffix) => {
                if (findBranch(privateChain._externalMutationTree, suffix)) return languageProperties.propertyValidationError(
                    "A mutable external namespace cannot be replaced or deleted", operationContext)
                if (deleting && (path.length || chain._contextOrigin) && suffix.length === 0)
                    return { mutatedValue: undefined, result: undefined, placement: { value: undefined, present: false } }
                const action = deleting
                    ? deleteManagedPath(privateChain, suffix, operationContext, true)
                    : assignManagedPath(privateChain, suffix, placement, operationContext)
                return internalSteps.continueOperation(action, operationContext, result => {
                    if (errorUtils.isPoisonError(result)) return result
                    return captureMutationResult(privateChain, result, operationContext)
                })
            }, replaceScope, deleting))
        if (!deleting && languageValues.isPending(result, operationContext)) operation.retain([value])
        if (!languageValues.isPending(result, operationContext)) return result
        markPromiseHandled(result, operationContext)
        return undefined
    })
}

export {
    assignPath,
    captureMutationResult,
    createEmptyContainerCopy,
    deletePath,
    setProperty,
    transformProperty,
    walkMutationPath,
}
