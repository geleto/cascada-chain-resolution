import { ArrayView, isArrayView, isLogicalArray, isArrayIndex } from "./array-view.js"
import * as internalSteps from "./internal-step.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import * as errorUtils from "./error.js"
import * as arrayRemaps from "./array-remap.js"
import * as conversion from "./language-conversion.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"
import * as refcounts from "./refcounts.js"
import { PathOperation } from "./path-operation.js"
import * as externalTree from "./external-mutation-tree.js"
import { externalLocationError } from "./external-operation.js"
import { createEmptyContainer, defineCopyProperty, copyContainerStructure } from "./placement-structure.js"

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

function shallowCopyPathContainer(source, operationContext) {
    const destination = createEmptyContainer(source, operationContext)
    const { type, admittedPrototype } = metadata.requireMeta(source, operationContext)
    languageValues.admitReadyValue(destination, operationContext, type, admittedPrototype)

    // Copy only language-visible own enumerable string keys. Identity metadata
    // stays with the source; captured structural state is transferred below.
    // Both containers retain every copied child until replacement, including
    // when a path operation does nothing or its child is still pending.
    for (const key of languageProperties.enumerableLanguageKeys(
        source,
        operationContext,
    )) {
        const placement = languageProperties.readLanguagePlacement(source, key, operationContext)
        // Fresh records reserve physical key order even while presence is
        // undecided. Arrays must not grow merely to represent such a placement.
        if (placement.sourceVersion?.pendingPresence && !isLogicalArray(source, operationContext))
            defineCopyProperty(destination, key, undefined)
        propertyVersions.copyPlacement(placement, destination, key, operationContext)
    }
    // Initial population copies existing structure; it is not a new sequence
    // of insertions. Install captured order only after those physical writes.
    copyContainerStructure(source, destination, operationContext)
    refcounts.indexValueIfSourceIndexed(source, destination, operationContext)
    return destination
}

function transformProperty(target, operationContext, transform, { replace = false, repair = false } = {}) {
    const { parent, key, attachmentRoot } = target
    let baseline = replace || target.sourceVersion
        ? propertyVersions.capturePlacement(parent, key, operationContext, target.sourceVersion)
        : languageProperties.readLanguagePlacement(parent, key, operationContext)
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
        const captured = propertyVersions.capturePlacement(parent, key, operationContext, target.sourceVersion)
        gate = propertyVersions.installPlacementGate(parent, key, operationContext, captured, target.sourceVersion)
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
        // Result holders and assigned inputs are different placements. Only
        // this destination's preceding presence determines its insertion order.
        const publication = { ...placement, position: originalPlacement.present ? originalPlacement.position : Infinity }
        const destinationVersion = gate?.version ?? target.sourceVersion
        const structure = gate?.structure ?? target.structure
        const failure = errorUtils.catchExternalThrow(() => {
            if (gate || placement !== originalPlacement) {
                const failure = propertyVersions.transferPlacement(publication, parent, key, operationContext, false, destinationVersion,
                    errorUtils.ERROR_KIND.AssignmentValueFailed, true, structure)
                if (!destinationVersion && attachmentRoot && containsPromise(placement.value, operationContext))
                    metadata.markShared(attachmentRoot, operationContext)
                return failure
            }
        }, operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)
        if (errorUtils.isPoisonError(failure)) {
            const poison = propertyVersions.combinePublicationErrors(placement.value, failure)
            const restoring = repair && placement === baseline
            outcome = { mutatedValue: poison, result: includePublicationFailure(outcome.result, poison, operationContext) }
            if (restoring) {
                // A failed repair leaves the original poison and recovery intact.
                propertyVersions.retainPlacement(baseline, operationContext)
                if (destinationVersion) propertyVersions.commitPlacementVersion(parent, key, destinationVersion,
                    originalPlacement, operationContext, false, structure)
            } else if (destinationVersion) propertyVersions.publishPlacementFailure(parent, key, destinationVersion,
                poison, baseline, operationContext, structure)
            else target.publishFailure(poison, baseline, outcome)
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
        value => propertyVersions.combinePublicationErrors(value, publishedValue),
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
                    const logicalKey = path.length ? target.key : chain._rootKey
                    const publish = resolved => {
                        if (languageProperties.isCallableThenPlacement(logicalKey, resolved.value))
                            return languageProperties.propertyValidationError(
                                "Language data cannot contain a callable then property", operationContext)
                        const result = propertyVersions.transferPlacement(resolved, target.parent, target.key, operationContext)
                        if (target.attachmentRoot && containsPromise(
                            languageProperties.readLanguageProperty(target.parent, target.key, operationContext), operationContext,
                        )) metadata.markShared(target.attachmentRoot, operationContext)
                        return result
                    }
                    // This destination needs its value to prove assignment is
                    // valid. Keep that work inside the mutation's rollback and
                    // publication lifetime; other pending data publishes now.
                    return logicalKey === "then"
                        ? propertyVersions.resolvePlacement(placement, operationContext, publish,
                            errorUtils.ERROR_KIND.AssignmentValueFailed)
                        : publish(placement)
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
                return assignArrayLength(target)
            },
        )
    })

    function assignArrayLength(target) {
        const array = target.receiver
        const operation = new operationLifecycle.OperationOwner(operationContext)
        const changing = internalSteps.continueOperation(conversion.toNumberValue(value, operation), operationContext,
            number => {
                if (errorUtils.isPoisonError(number)) return number
                const length = number >>> 0
                if (length !== number) return errorUtils.validationError(
                    "Invalid array length", operationContext, errorUtils.ERROR_KIND.InvalidArrayLength)
                return internalSteps.continueOperation(resolveTruncatedArrayTransitions(array, length, operationContext),
                    operationContext, () => resize(length), undefined, operation)
            },
            undefined, operation)
        const resized = internalSteps.continueOperation(changing, operationContext, array => {
            operation.close()
            return array
        })
        target.replaceReceiver(resized)
        return internalSteps.continueOperation(resized, operationContext, array =>
            errorUtils.isPoisonError(array) ? array : undefined)

        function resize(length) {
            const branch = externalTree.findBranch(chain._externalMutationTree, path.slice(0, -1))
            if (externalTree.truncatesLocations(branch, length))
                return languageProperties.propertyValidationError("Array length cannot remove a fixed external namespace", operationContext)
            return errorUtils.catchExternalThrow(
                () => {
                    // Scope rollback retains this Array or an ancestor. Build the
                    // final range directly, preserving retained children and leaving
                    // discarded placements on the baseline without consuming them.
                    return arrayRemaps.createArrayFromRemap(
                        arrayRemaps.createRemap(array, operationContext, 0, length),
                        operationContext, array)
                },
                operationContext,
                errorUtils.ERROR_KIND.PropertyMutationFailed,
            )
        }
    }
}

// Direct length assignment waits for transitions in its truncated suffix,
// never for ordinary data they publish. Retained-prefix transitions transfer
// to the new Array without delaying its publication.
function resolveTruncatedArrayTransitions(array, start, operationContext) {
    const versions = metadata.metaOf(array, operationContext)?.placementVersions
    if (!versions) return undefined
    const waits = []
    for (const key of Object.keys(versions)) {
        const version = versions[key]
        if (Number(key) < start || !version?.transition) continue
        const wait = propertyVersions.resolvePlacementTransition(
            propertyVersions.capturePlacementFromVersion(version), operationContext, () => undefined)
        if (languageValues.isPending(wait, operationContext)) waits.push(wait)
    }
    return waits.length > 1 ? Promise.all(waits) : waits[0]
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
    {
        deletesTarget = false,
        onExternalFailure = undefined,
        observeTarget = false,
        targetArrayStructure = false,
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

    // Target callbacks return a mutation outcome, poison, or no result. Keep
    // an independent result inside its outcome when reconstruction also fails;
    // publishing the graph failure must not wait for that result.
    function includePathFailure(failure) {
        return internalSteps.continueOperation(operationResult, operationContext, outcome =>
            outcome && !errorUtils.isPoisonError(outcome)
                ? { mutatedValue: failure, result: includePublicationFailure(outcome.result, failure, operationContext) }
                : includePublicationFailure(outcome, failure, operationContext))
    }

    function combinePathFailure(failure) {
        return propertyVersions.combinePublicationErrors(publicationValue, operationResult?.mutatedValue, failure)
    }

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
        return operationResult
    }

    function completeTarget(target, writeBack) {
        let nextReceiver = target.receiver
        const result = onTarget({
            ...target,
            replaceReceiver(next) { nextReceiver = next },
            publishFailure(failure, baseline, outcome) {
                // Preserve both outcomes before fallible copying/reconstruction.
                operationResult = outcome
                // The holder is private. Other containers may have aliases:
                // preserve them while replacing only this path's failed scope.
                const owner = target.parent === rootState ? rootState :
                    shallowCopyPathContainer(target.parent, operationContext)
                propertyVersions.publishPlacementFailure(owner, target.key, undefined, failure, baseline, operationContext)
                nextReceiver = owner
            },
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
                const failedValue = combinePathFailure(failure)
                if (preserveOnFailure) return failedValue
                return complete(writeBack, failedValue, includePathFailure(failedValue))
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
        if (targetArrayStructure && index > 0 && isLogicalArray(value, operationContext) &&
            propertyKind !== languageProperties.ORDINARY_PROPERTY) {
            return completeTarget({ ...placement, attachmentRoot, receiver: placement.parent,
                propertyKind: languageProperties.ORDINARY_PROPERTY, pathDepth: index - 1 }, parent => {
                    // Failed publication may have copied the parent to hold poison.
                    writeBack(propertyVersions.capturePlacement(parent, placement.key, operationContext, placement.sourceVersion).value)
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

        const { value: capturedValue, present } = languageProperties.readLanguagePlacement(parent, key, operationContext)
        const child = present ? capturedValue : undefined
        if (languageValues.isPending(child, operationContext)) {
            // Native selection captures managed state; its external reservation
            // owns ordering. Only managed mutation installs a publication version.
            const source = propertyVersions.requirePromiseVersion(parent, key, operationContext)
            const onValue = (propertyValue, promiseVersion, structure) => walk(
                propertyValue,
                index + 1,
                (next, recovery) => {
                    if (next !== propertyValue && next !== promiseVersion.value) {
                        publicationValue = next
                        // This version is runtime-owned: ordinary mutation
                        // copies imported parents before descent; external
                        // prefixes wait only at runtime scope gates because
                        // initial authority paths are directly ready.
                        const publicationFailure = errorUtils.catchExternalThrow(
                            () => propertyVersions.transferPlacement({ value: next, present: true, recovery },
                                parent, key, operationContext, false, promiseVersion,
                                errorUtils.ERROR_KIND.AssignmentValueFailed, true, structure),
                            operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)
                        if (errorUtils.isPoisonError(publicationFailure) || errorUtils.isPoisonError(promiseVersion.value)) {
                            const failure = combinePathFailure(publicationFailure ?? promiseVersion.value)
                            const baseline = recovery ?? { value: propertyValue, present }
                            propertyVersions.publishPlacementFailure(parent, key, promiseVersion,
                                failure, baseline, operationContext, structure, promiseVersion.position)
                            operationResult = includePathFailure(failure)
                        }
                    }
                },
                { parent, key, sourceVersion: promiseVersion, present: promiseVersion.present !== false, structure },
            )
            const pending = observeTarget
                ? propertyVersions.continueCapturedPromiseVersion(child, source, operationContext, value => onValue(value, source))
                : propertyVersions.installMutationVersion(parent, key, source, operationContext, onValue)
            if (!pathSelectionComplete) writeBack(parent)
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
                else propertyVersions.assignProperty(parent, key, next, operationContext)
                writeBack(parent)
            },
            { parent, key, present },
        )

        function prepareParent() {
            const projection = ArrayView.projectionOf(value, operationContext)
            if (atTarget && !deletesTarget && !preserveOnFailure &&
                isArrayView(projection, operationContext) && isArrayIndex(key)) {
                const growth = Number(key) + 1 - ArrayView.minimumLength(value, operationContext)
                const extended = growth > 0 && ArrayView.tryExtendEnd(value, growth,
                    view => propertyVersions.prepareRetainedArrayProperties(value, view, operationContext), operationContext)
                if (extended) {
                    parent = extended
                    attachmentRoot ??= parent
                    refcounts.indexValueIfSourceIndexed(value, parent, operationContext)
                    return
                }
            }
            if (preserveParent || languageProperties.requiresRepresentationCopyForPropertyMutation(
                value, key, operationContext,
                atTarget && deletesTarget
                    ? languageProperties.PROPERTY_MUTATION_MODE.Delete
                    : languageProperties.PROPERTY_MUTATION_MODE.Assign)) {
                parent = shallowCopyPathContainer(parent, operationContext)
                attachmentRoot ??= parent
            }
        }
    }
}

// --- deletePath :  delete a.k ----------------------------------------------
function deleteManagedPath(
    chain,
    path,
    operationContext,
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
                    propertyVersions.assignProperty(target.parent, target.key, null, operationContext)
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
            deletesRoot ? undefined : { deletesTarget: true },
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
        const result = operation.route.externalScope
            ? operation.finishMutation(operation.observe(value => value, access => deleting ? access.delete() : access.write(value)))
            : operation.finishMutation(operation.mutate((scope, state, privateChain, suffix) => {
                if (externalTree.findBranch(privateChain._externalMutationTree, suffix)) return languageProperties.propertyValidationError(
                    "A mutable external namespace cannot be replaced or deleted", operationContext)
                if (deleting && (path.length || chain._rootKey !== undefined) && suffix.length === 0)
                    return { mutatedValue: undefined, result: undefined, placement: { value: undefined, present: false } }
                const action = deleting
                    ? deleteManagedPath(privateChain, suffix, operationContext)
                    : assignManagedPath(privateChain, suffix, placement, operationContext)
                return internalSteps.continueOperation(action, operationContext, result => {
                    if (errorUtils.isPoisonError(result)) return result
                    return captureMutationResult(privateChain, result, operationContext)
                })
            }, replaceScope, deleting))
        if (!deleting && languageValues.isPending(result, operationContext)) operation.leaseValues([value])
        if (!languageValues.isPending(result, operationContext)) return result
        markPromiseHandled(result, operationContext)
        return undefined
    })
}

export {
    assignPath,
    captureMutationResult,
    deletePath,
    transformProperty,
    walkMutationPath,
    shallowCopyPathContainer,
}
