import * as internalSteps from "./internal-step.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import * as errorUtils from "./error.js"
import * as arrayRemaps from "./array-remap.js"
import * as conversion from "./language-conversion.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import { PathOperation } from "./path-operation.js"
import * as externalTree from "./external-mutation-tree.js"
import { walkMutationPath } from "./mutations.js"
import { exportValue } from "./export.js"
import { receiveValue } from "./input-preparations.js"
import { ArrayView, isArrayIndex, isArrayView } from "./array-view.js"
import { visitParentPlacements } from "./parent-placements.js"
import { IdentityPublication } from "./captured-identity.js"
import { CHAIN_MODE } from "./chain.js"
import { MAX_ARRAY_LENGTH, capacityError, captureLayout, structuralPlacement } from "./array-layout.js"
import { publishLayout } from "./array-sequence.js"
import { indexValueIfSourceIndexed } from "./refcounts.js"

function prepareAssignment(placement, key, operationContext) {
    const validate = resolved => languageProperties.validatePropertyValue(key, resolved.value, operationContext) ?? resolved
    // Only callable-then validation consumes assignment availability. Other
    // pending values publish now, without extending the mutation lifetime.
    return key === "then"
        ? propertyVersions.resolvePlacement(placement, operationContext, validate)
        : validate(placement)
}

function pointEdit(parent, key, deleting, operation, baseline, ordinary, target) {
    const ctx = operation.operationContext
    // An entered root publishes into the selected parent placement, including
    // through nested entries. Its private holder has no Array shape of its own.
    let gate
    while ((gate = metadata.metaOf(parent, ctx)?.entryGate)) parent = gate.owner
    if (!ArrayView.region(parent, ctx) || ArrayView.maximumLength(parent, ctx) <= MAX_ARRAY_LENGTH) return ordinary()
    if (operation.mode === CHAIN_MODE.Complete) {
        const over = ArrayView.captureInRange(parent, MAX_ARRAY_LENGTH, ctx)
        const present = !deleting || propertyVersions.resolvePlacementTransition(
            baseline ?? propertyVersions.capturePlacement(parent, key, ctx), ctx, propertyVersions.placementPresent)
        const exceeds = internalSteps.decideInputs([over, present], ctx, ([large, writes], _, remaining) =>
            large === false || writes === false ? false : remaining ? undefined : true)
        return internalSteps.continueGraphTransition(exceeds, ctx, failed => failed ? capacityError(ctx) : ordinary())
    }
    if (ArrayView.mayHaveVirtualIndex(parent, key, ctx)) {
        const failure = capacityError(ctx)
        const placement = structuralPlacement(failure)
        if (target) {
            propertyVersions.transferPlacement(placement, target.parent, target.key, ctx)
            target.publication.published = true
        }
        return { placement, result: failure, published: true }
    }
    return ordinary()
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignManagedPath(
    scope,
    start,
    placement,
    operation,
) {
    const { operationContext } = operation
    const value = placement.value
    return internalSteps.runInternalStep(operationContext, () => {
        if (errorUtils.isFatalError(value)) throw value
        return walkMutationPath(
            scope.holder,
            operation,
            target => {
                if (
                    target.propertyKind ===
                    languageProperties.ORDINARY_PROPERTY
                ) {
                    // Replacement needs the preceding structural outcome, not
                    // the old payload: deletion makes this a new insertion.
                    return pointEdit(target.parent, target.key, false, operation, undefined, () => propertyVersions.replacePlacementTransition(
                        propertyVersions.capturePlacement(target.parent, target.key, operationContext),
                        operationContext, before => {
                            const position = propertyVersions.placementPresent(before) ? before.position : Infinity
                            return internalSteps.continueGraphTransition(prepareAssignment(placement, target.key, operationContext),
                                operationContext, resolved => {
                                    if (errorUtils.isPoisonError(resolved)) return resolved
                                    const result = errorUtils.catchExternalThrow(
                                        () => propertyVersions.transferPlacement({ ...resolved, position },
                                            target.parent, target.key, operationContext),
                                        operationContext, errorUtils.ERROR_KIND.PropertyMutationFailed)
                                    target.publication.published = true
                                    return result
                                })
                        }), target)
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
            }, { start, publication: scope.publication, preservePoint: scope.preservePoint },
        )
    })

    function assignArrayLength(target) {
        let array = target.receiver
        const converted = propertyVersions.resolvePlacement(placement, operationContext,
            resolved => conversion.toNumberValue(resolved.value, operation))
        const changing = internalSteps.continueGraphTransition(converted, operationContext,
            number => {
                if (errorUtils.isPoisonError(number)) return number
                const length = number >>> 0
                if (length !== number) return errorUtils.validationError(
                    "Invalid array length", operationContext, errorUtils.ERROR_KIND.InvalidArrayLength)
                return internalSteps.continueGraphTransition(resolveTruncatedArrayTransitions(array, length, operationContext),
                    operationContext, () => resize(length), undefined, operation)
            },
            undefined, operation)
        const resized = internalSteps.continueGraphTransition(changing, operationContext, result => {
            array = undefined
            return result
        })
        target.replaceReceiver(resized)
        return internalSteps.continueGraphTransition(resized, operationContext, array =>
            errorUtils.isPoisonError(array) ? array : undefined)

        function resize(length) {
            const branch = operation.route.nodes[operation.route.path.length - 1]
            if (externalTree.truncatesLocations(branch, length))
                return languageProperties.propertyValidationError("Array length cannot remove a fixed external namespace", operationContext)
            return errorUtils.catchExternalThrow(
                () => {
                    const region = ArrayView.region(array, operationContext)
                    if (!region && isArrayView(array, operationContext) && length <= ArrayView.minimumLength(array, operationContext)) {
                        const resized = arrayRemaps.sliceOutput(array, 0, length, operationContext)
                        indexValueIfSourceIndexed(array, resized, operationContext)
                        return resized
                    }
                    if (region?.layout) return publishLayout(captureLayout(array, operationContext, length), operationContext)
                    // Scope rollback retains this Array or an ancestor. Build the
                    // final range directly, preserving retained children and leaving
                    // discarded placements on the baseline without consuming them.
                    const resized = arrayRemaps.createArrayFromRemap(arrayRemaps.createRemap(array, operationContext, 0, length), operationContext)
                    indexValueIfSourceIndexed(array, resized, operationContext)
                    return resized
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
    const waits = []
    for (const [key, version] of propertyVersions.ownPlacementVersionEntries(array, operationContext)) collect(key, version)
    for (const [key, version] of ArrayView.backingVersions(array, start, operationContext)) collect(key, version)
    return waits.length > 1 ? Promise.all(waits) : waits[0]

    function collect(key, version) {
        if (Number(key) < start || !version.transition) return
        const wait = propertyVersions.resolvePlacementTransition(
            propertyVersions.capturePlacementFromVersion(version), operationContext, () => undefined)
        if (languageValues.isPending(wait, operationContext)) waits.push(wait)
    }
}

// --- deletePath :  delete a.k ----------------------------------------------
function deleteManagedPath(
    scope,
    start,
    operation,
) {
    const { operationContext } = operation
    return internalSteps.runInternalStep(operationContext, () => {
        return walkMutationPath(
            scope.holder,
            operation,
            target => {
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

                // Absence is ready immediately. Only identity depends on whether
                // the preceding transition left anything for this delete to write.
                return pointEdit(target.parent, target.key, true, operation, undefined, () => {
                    const presence = propertyVersions.resolvePlacementTransition(
                        propertyVersions.capturePlacement(target.parent, target.key, operationContext),
                        operationContext, placement => propertyVersions.placementPresent(placement))
                    propertyVersions.deleteProperty(target.parent, target.key, operationContext)
                    if (languageValues.isPending(presence, operationContext)) target.publication.addPending(presence)
                    else target.publication.record(presence)
                }, target)
            },
            { start, deletesTarget: true, publication: scope.publication, preservePoint: scope.preservePoint },
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
    let value = placement?.value
    if (errorUtils.isFatalError(value)) throw value
    const replaceScope = depth === path.length
    // A property write consumes its container, not the old final value.
    const operation = new PathOperation(chain, path, operationContext, depth, false, dynamic, Math.max(0, path.length - 1))
    const external = Boolean(operation.route.externalScope)
    const end = operation.route.path.length
    path = undefined
    if (!deleting && !operation.routeFailure && !external) {
        placement = propertyVersions.prepareInputPlacement(value, operationContext, errorUtils.ERROR_KIND.AssignmentValueFailed)
        operation.retainInput(placement)
    }
    let outward = !deleting && !operation.routeFailure && external
        ? receiveValue(value, operationContext, { kind: errorUtils.ERROR_KIND.OperationInputFailed },
            value => exportValue(value, operation), operation)
        : undefined
    value = undefined
    if (external) {
        placement = undefined
        markPromiseHandled(outward, operationContext)
    }
    const result = external
        ? operation.finishMutation(operation.observe(value => value, access => {
            try {
                return deleting ? access.delete() : internalSteps.continueGraphTransition(outward,
                    operationContext, value => access.write(value), undefined, operation)
            } finally { outward = undefined }
        }))
        : operation.finishMutation(operation.mutate((scope, state, working, start, parent) => {
            try {
                if (operation.route.nodes[end]) return languageProperties.propertyValidationError(
                    "A mutable external namespace cannot be replaced or deleted", operationContext)
                if (start === end) {
                    return replacePoint(parent, state.key, state.baseline, placement, deleting, operation)
                }
                if (start + 1 === end && isArrayView(scope, operationContext) && !ArrayView.region(scope, operationContext)) {
                    working.preservePoint = (array, key) => {
                        if (array !== scope || !isArrayIndex(key)) return
                        const length = ArrayView.readyLength(scope, operationContext), index = Number(key)
                        if (length === undefined || index >= length) return
                        return state.preserveBaseline(source => {
                            if (metadata.hasReadLease(source, operationContext) || metadata.isImported(source, operationContext)) return
                            let shared = false
                            visitParentPlacements(source, operationContext, (owner, at) => {
                                shared = !(owner === parent && at === (state.key ?? "value") || owner === working.holder && at === "value")
                                return !shared
                            })
                            if (!shared) return arrayRemaps.captureRangeBaseline(source, index, index + 1, length, operationContext)
                        })
                    }
                }
                return deleting
                    ? deleteManagedPath(working, start, operation)
                    : assignManagedPath(working, start, placement, operation)
            } finally { placement = undefined }
        }, replaceScope, deleting))
    if (!languageValues.isPending(result, operationContext)) return result
    markPromiseHandled(result, operationContext)
    return undefined
}

function replacePoint(parent, key, baseline, input, deleting, operation) {
    const ctx = operation.operationContext
    return pointEdit(parent, key, deleting, operation, baseline, () => {
        if (!deleting) {
            baseline = undefined
            return internalSteps.continueGraphTransition(prepareAssignment(input, key, ctx), ctx,
                assigned => errorUtils.isPoisonError(assigned) ? assigned : { placement: assigned, result: undefined, published: true })
        }
        if (key === undefined) return { placement: { value: null, present: true }, published: true }
        let published = propertyVersions.resolvePlacementTransition(baseline, ctx, propertyVersions.placementPresent)
        if (languageValues.isPending(published, ctx)) {
            const identity = new IdentityPublication(ctx)
            identity.addPending(published)
            identity.finish()
            published = identity.outcome()
        }
        return { placement: { value: undefined, present: false }, published }
    })
}

export { assignPath, deletePath }
