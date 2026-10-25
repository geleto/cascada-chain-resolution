import { createLeaseLedger } from "./ownership.js"
import { inheritIdentity, IdentityPublication } from "./captured-identity.js"
import { ArrayView, isLogicalArray, isArrayIndex } from "./array-view.js"
import * as internalSteps from "./internal-step.js"
import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import * as refcounts from "./refcounts.js"
import { externalLocationError } from "./external-operation.js"
import { createEmptyContainer, defineCopyProperty, prepareContainerStructureCopy } from "./placement-structure.js"
import { PlacementConstruction } from "./parent-placements.js"

function mustPreserveValue(value, attachmentRoot, operationContext) {
    return attachmentRoot !== undefined ||
        metadata.requiresCopyOnWrite(value, operationContext)
}

function shallowCopyPathContainer(source, operationContext) {
    const destination = createEmptyContainer(source, operationContext)
    const { type, admittedPrototype } = metadata.requireMeta(source, operationContext)
    languageValues.admitReadyValue(destination, operationContext, type, admittedPrototype)
    inheritIdentity(source, destination, operationContext)
    PlacementConstruction.initializeAndPublish(destination, operationContext, destination => {
        // Copy only language-visible own enumerable string keys. Captured
        // identity and structure survive protection-only materialization.
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
        prepareContainerStructureCopy(source, destination, operationContext)()
    })
    refcounts.indexValueIfSourceIndexed(source, destination, operationContext)
    return destination
}

function createMutationOutcome(mutatedValue, result, operationContext, published = true) {
    const publication = createLeaseLedger(operationContext)
    publication.acquire(mutatedValue)
    return { mutatedValue, result, published, releasePublication: publication.release }
}

function transformProperty(target, operationContext, transform, { replace = false, repair = false, beforeWait } = {}) {
    let { parent, key } = target
    let baseline = replace || target.sourceVersion
        ? propertyVersions.capturePlacement(parent, key, operationContext, target.sourceVersion)
        : languageProperties.readLanguagePlacement(parent, key, operationContext)
    if (languageValues.isPending(baseline.value, operationContext) || baseline.sourceVersion?.transition) beforeWait?.()
    let originalPlacement
    let leased
    let gate, releasePublication
    // Replacement waits for unfinished publication without consuming old data.
    const readiness = replace
        ? propertyVersions.resolvePlacementTransition(baseline, operationContext, apply)
        : propertyVersions.resolvePlacement(baseline, operationContext, apply)
    function apply(placement) {
        originalPlacement = placement
        baseline = placement
        let current = baseline.value
        if (!replace && errorUtils.isPoisonError(current)) {
            if (!repair || !baseline.recovery) return { mutatedValue: current, result: current, placement: baseline, published: false }
            baseline = baseline.recovery
            current = baseline.value
        }
        if (!errorUtils.isPoisonError(current) && !languageValues.isPending(current, operationContext)) {
            languageValues.admitReadyValue(current, operationContext)
            leased = metadata.incrementReadLease(current, operationContext)
        }
        try { return internalSteps.continueGraphTransition(errorUtils.catchExternalThrow(
            () => transform(current, { present: baseline.present, baseline, originalPlacement, preserveBaseline }), operationContext,
            errorUtils.ERROR_KIND.PropertyMutationFailed), operationContext, normalize) }
        finally { current = undefined }
    }
    if (!languageValues.isPending(readiness, operationContext)) return publish(readiness)
    const failure = errorUtils.catchExternalThrow(() => {
        const captured = propertyVersions.capturePlacement(parent, key, operationContext, target.sourceVersion)
        gate = propertyVersions.installPlacementGate(parent, key, operationContext, captured, target.sourceVersion)
        target.publication.suspend()
    }, operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)
    if (errorUtils.isPoisonError(failure)) {
        if (!repair) target.replaceReceiver(failure)
        return internalSteps.continueGraphTransition(readiness, operationContext, outcome => finish({
            mutatedValue: failure, result: includePublicationFailure(outcome.result, failure, operationContext),
        }))
    }
    // Publication finishes this transition. A restored or assigned Promise is
    // ordinary property availability and does not extend the operation result.
    return internalSteps.continueGraphTransition(readiness, operationContext, publish)

    // A controlled write can preserve the same logical baseline in another
    // representation. Select ordinary COW without this operation's own lease,
    // restore it before capture, then transfer it before any write can occur.
    function preserveBaseline(selectCapture) {
        // Once a gate displaced the receiver, its remaining incoming edges may
        // all belong to other uses. The operation's lease is then its only
        // receiver authority; ordinary private materialization preserves it.
        if (gate) return false
        let capture
        if (leased) metadata.decrementReadLease(baseline.value, operationContext)
        try { capture = selectCapture(baseline.value) }
        finally { if (leased) metadata.incrementReadLease(baseline.value, operationContext) }
        if (!capture) return false
        const value = capture()
        metadata.incrementReadLease(value, operationContext)
        if (leased) metadata.decrementReadLease(baseline.value, operationContext)
        leased = true
        baseline = { ...baseline, value }
        return true
    }

    function normalize(outcome) {
        releasePublication = outcome.releasePublication
        if (errorUtils.isPoisonError(outcome)) outcome = { mutatedValue: outcome, result: outcome }
        if (!outcome.placement && errorUtils.isPoisonError(outcome.mutatedValue)) {
            outcome.placement = { value: outcome.mutatedValue, present: true, recovery: baseline }
            outcome.published = true
        }
        return outcome
    }
    function publish(outcome) {
        let placement, publication, destinationVersion, structure
        try {
            // A blocked repair can select the original poison and recovery intact;
            // a successful repair selects the unwrapped baseline instead.
            placement = outcome.published === false ? baseline :
                outcome.placement ?? { value: outcome.mutatedValue, present: true }
            let published = baseline !== originalPlacement && placement !== originalPlacement
                ? true : outcome.published ?? placement !== originalPlacement
            // Result holders and assigned inputs are different placements. Only
            // this destination's preceding presence determines its insertion order.
            publication = { ...placement, position: originalPlacement.present ? originalPlacement.position : Infinity }
            destinationVersion = gate?.version ?? target.sourceVersion
            structure = gate?.structure ?? target.structure
            const failure = errorUtils.catchExternalThrow(() => {
                if (gate || placement !== originalPlacement) {
                    const failure = propertyVersions.transferPlacement(publication, parent, key, operationContext, destinationVersion,
                        errorUtils.ERROR_KIND.AssignmentValueFailed, true, structure)
                    return failure
                }
            }, operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)
            if (errorUtils.isPoisonError(failure)) {
                const poison = propertyVersions.combinePublicationErrors(placement.value, failure)
                const restoring = repair && (placement === baseline || placement === originalPlacement)
                outcome = { mutatedValue: poison, result: includePublicationFailure(outcome.result, poison, operationContext) }
                if (restoring) {
                    published = false
                    // A failed repair leaves the original poison and recovery intact.
                    if (destinationVersion) propertyVersions.commitPlacementVersion(parent, key, destinationVersion,
                        originalPlacement, operationContext, false, structure)
                } else if (destinationVersion) propertyVersions.publishPlacementFailure(parent, key, destinationVersion,
                    poison, baseline, operationContext, structure)
                else target.publishFailure(poison, baseline, outcome)
                if (!restoring) published = true
            }
            target.publication.record(published)
            return finish(outcome)
        } finally { placement = publication = destinationVersion = structure = undefined }
    }

    function finish(outcome) {
        if (gate) {
            target.publication.finish()
            gate.resolve()
        }
        releasePublication?.()
        if (leased) metadata.decrementReadLease(baseline.value, operationContext)
        target = parent = transform = baseline = originalPlacement = gate = releasePublication = beforeWait = undefined
        return { mutatedValue: outcome.mutatedValue, result: outcome.result }
    }
}

// Publication and an independent result can both fail. Waiting for the result
// does not extend the completed publication's owner or receiver protection.
function includePublicationFailure(result, publishedValue, operationContext) {
    if (!errorUtils.isPoisonError(publishedValue) || result === publishedValue) return result
    return internalSteps.continueGraphTransition(
        result,
        operationContext,
        value => propertyVersions.combinePublicationErrors(value, publishedValue),
    )
}

function captureMutationResult(chain, result, operationContext) {
    const placement = propertyVersions.capturePlacement(chain._state, "value", operationContext)
    chain._publication.finish()
    return { mutatedValue: placement.value, placement, result, published: chain._publication.outcome() }
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
        beforeWait,
        targetArrayStructure = false,
        preserveOnFailure = false,
    } = {},
) {
    let rootState = chain._state
    const publication = new IdentityPublication(operationContext,
        chain._publication ?? metadata.metaOf(rootState, operationContext)?.entryGate?.publication)
    const targetPath = ["value", ...path]
    let attachmentRoot
    let pathSelectionComplete = false
    let operationResult
    let publicationValue
    // Each path copy attaches in this graph transition; pending publication
    // has its own writer hold. No read lease spans the rest of the walk.
    const outcome = walk(rootState, 0, () => {})
    if (languageValues.isPending(outcome, operationContext)) publication.suspend()
    return internalSteps.continueGraphTransition(outcome, operationContext, result => {
        try {
            publication.finish()
            return result
        } finally {
            // A returned Error may keep this walk's frames: drop its spent graph roots.
            operationResult = publicationValue = attachmentRoot = rootState = chain = onTarget = onExternalFailure = beforeWait = undefined
        }
    })

    // Target callbacks return a mutation outcome, poison, or no result. Keep
    // an independent result inside its outcome when reconstruction also fails;
    // publishing the graph failure must not wait for that result.
    function includePathFailure(failure) {
        return internalSteps.continueGraphTransition(operationResult, operationContext, outcome =>
            outcome && !errorUtils.isPoisonError(outcome)
                ? { mutatedValue: failure, result: includePublicationFailure(outcome.result, failure, operationContext) }
                : includePublicationFailure(outcome, failure, operationContext))
    }

    function combinePathFailure(failure) {
        return propertyVersions.combinePublicationErrors(publicationValue, operationResult?.mutatedValue, failure)
    }

    function fail(writeBack, failure) {
        if (preserveOnFailure) return failure
        publication.published = true
        return complete(writeBack, failure, includePathFailure(failure))
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
            publication,
            replaceReceiver(next) { nextReceiver = next; publication.published = true },
            publishFailure(failure, baseline, outcome) {
                // Preserve both outcomes before fallible copying/reconstruction.
                operationResult = outcome
                // The holder is private. Other containers may have aliases:
                // preserve them while replacing only this path's failed scope.
                const owner = target.parent === rootState ? rootState :
                    shallowCopyPathContainer(target.parent, operationContext)
                if (owner !== rootState) publication.capture(owner)
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
            const wasPoison = errorUtils.isPoisonError(value)
            writeBack = (next, recovery) => {
                if (errorUtils.isPoisonError(next) && !wasPoison) {
                    publish(next, recovery ?? baseline)
                } else publish(next, recovery)
            }
        }
        try { return errorUtils.catchExternalThrow(
            () => walkReady(value, index, writeBack, placement),
            operationContext,
            errorUtils.ERROR_KIND.PropertyMutationFailed,
            failure => {
                const failedValue = combinePathFailure(failure)
                return fail(writeBack, failedValue)
            },
        ) } finally { value = placement = writeBack = undefined }
    }

    function walkReady(value, index, writeBack, placement) {
        if (errorUtils.isPoisonError(value)) {
            return complete(writeBack, value)
        }
        // Strings may expose intrinsic length; all other terminal prefixes
        // fail before the next path segment is consumed.
        if (typeof value !== "string" && !languageValues.isTraversable(value, operationContext)) {
            const external = metadata.metaOf(value, operationContext)?.type === languageValues.TYPE.External
            const failure = external ? externalLocationError(operationContext) : errorUtils.pathAccessError(value, operationContext)
            if (external) onExternalFailure?.(failure)
            return fail(writeBack, failure)
        }
        const key = languageProperties.normalizePathSegment(
            targetPath[index],
            operationContext,
        )
        if (errorUtils.isPoisonError(key)) {
            return fail(writeBack, key)
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
            return fail(writeBack, error)
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
            return fail(writeBack, errorUtils.pathAccessError(value, operationContext))
        }

        let parent = value
        // Capture inherited protection before descent: failure-only copying
        // reconstructs upward and must not make the private holder look shared.
        const preserveParent = mustPreserveValue(value, attachmentRoot, operationContext)
        if (observeTarget && preserveParent) attachmentRoot ??= value
        if (!observeTarget) {
            parent = prepareParent(value, key, atTarget, preserveParent)
            if (index > 0) publication.capture(parent)
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

        const { value: capturedValue, present } = languageProperties.readLanguagePlacement(parent, key, operationContext)
        const child = present ? capturedValue : undefined
        if (languageValues.isPending(child, operationContext)) {
            beforeWait?.()
            // Native selection captures managed state; its external reservation
            // owns ordering. Only managed mutation installs a publication version.
            const source = propertyVersions.requirePromiseVersion(parent, key, operationContext)
            const onValue = (propertyValue, promiseVersion, structure) => {
                const result = walk(
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
                                    parent, key, operationContext, promiseVersion,
                                    errorUtils.ERROR_KIND.AssignmentValueFailed, true, structure),
                                operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)
                            if (errorUtils.isPoisonError(publicationFailure) || errorUtils.isPoisonError(promiseVersion.value)) {
                                publication.published = true
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
                // Finish identity in the same transition as the resumed path,
                // before its ready placement can reach an earlier observer.
                if (!languageValues.isPending(result, operationContext)) publication.finish()
                return result
            }
            const pending = observeTarget
                ? propertyVersions.continueCapturedPromiseVersion(child, source, operationContext, value => onValue(value, source))
                : propertyVersions.installMutationVersion(parent, key, source, operationContext, onValue)
            if (!pathSelectionComplete) writeBack(parent)
            if (languageValues.isPending(pending, operationContext)) publication.suspend()
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
                if (observeTarget) {
                    parent = prepareParent(value, key, atTarget, preserveParent)
                    if (index > 0) publication.capture(parent)
                }
                if (recovery) propertyVersions.transferPlacement({ value: next, present: true, recovery }, parent, key, operationContext)
                else propertyVersions.assignProperty(parent, key, next, operationContext)
                writeBack(parent)
            },
            { parent, key, present },
        )

    }

    // Shared across path frames: a failed preflight need not retain that frame's
    // value, placement or reconstruction closures through its diagnostic stack.
    function prepareParent(value, key, atTarget, preserveParent) {
        if (atTarget && !deletesTarget && !preserveOnFailure &&
            metadata.metaOf(value, operationContext)?.arrayRange && isArrayIndex(key)) {
            const growth = Number(key) + 1 - ArrayView.minimumLength(value, operationContext)
            const extended = growth > 0 && ArrayView.tryExtendEnd(value, growth, operationContext)
            if (extended) {
                inheritIdentity(value, extended, operationContext)
                attachmentRoot ??= extended
                refcounts.indexValueIfSourceIndexed(value, extended, operationContext)
                return extended
            }
        }
        if (preserveParent || languageProperties.requiresRepresentationCopyForPropertyMutation(
            value, key, operationContext,
            atTarget && deletesTarget
                ? languageProperties.PROPERTY_MUTATION_MODE.Delete
                : languageProperties.PROPERTY_MUTATION_MODE.Assign)) {
            const parent = shallowCopyPathContainer(value, operationContext)
            attachmentRoot ??= parent
            return parent
        }
        return value
    }
}

export {
    createMutationOutcome,
    captureMutationResult,
    transformProperty,
    walkMutationPath,
    shallowCopyPathContainer,
}
