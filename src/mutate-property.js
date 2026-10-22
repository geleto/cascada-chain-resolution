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
import { captureMutationResult, walkMutationPath } from "./mutations.js"
import { exportValue } from "./export.js"
import { receiveValue } from "./input-preparations.js"

function prepareAssignment(placement, key, operationContext) {
    const validate = resolved => languageProperties.validatePropertyValue(key, resolved.value, operationContext) ?? resolved
    // Only callable-then validation consumes assignment availability. Other
    // pending values publish now, without extending the mutation lifetime.
    return key === "then"
        ? propertyVersions.resolvePlacement(placement, operationContext, validate)
        : validate(placement)
}

// --- assignPath :  a.k.y = 1 -----------------------------------------------
function assignManagedPath(
    chain,
    path,
    placement,
    operation,
) {
    const { operationContext } = operation
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
                    // Replacement needs the preceding structural outcome, not
                    // the old payload: deletion makes this a new insertion.
                    return propertyVersions.resolvePlacementTransition(
                        propertyVersions.capturePlacement(target.parent, target.key, operationContext),
                        operationContext, before => {
                            const position = before.present ? before.position : Infinity
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
                        })
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

// --- deletePath :  delete a.k ----------------------------------------------
function deleteManagedPath(
    chain,
    path,
    operationContext,
) {
    return internalSteps.runInternalStep(operationContext, () => {
        chain._assertOperationContext(operationContext)
        const preparedPath = [...path]
        return walkMutationPath(
            chain,
            preparedPath,
            operationContext,
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
                const presence = propertyVersions.resolvePlacementTransition(
                    propertyVersions.capturePlacement(target.parent, target.key, operationContext),
                    operationContext, placement => placement.present)
                propertyVersions.deleteProperty(target.parent, target.key, operationContext)
                if (languageValues.isPending(presence, operationContext)) target.publication.addPending(presence)
                else target.publication.record(presence)
            },
            { deletesTarget: true },
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
    path = operation.route.path
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
        : operation.finishMutation(operation.mutate((scope, state, privateChain, suffix, node) => {
            try {
                if (externalTree.findBranch(node, suffix)) return languageProperties.propertyValidationError(
                    "A mutable external namespace cannot be replaced or deleted", operationContext)
                if (suffix.length === 0) {
                    if (deleting) return state.key !== undefined
                        ? { mutatedValue: undefined, result: undefined, placement: { value: undefined, present: false }, published: state.present }
                        : { mutatedValue: null, result: undefined, published: true }
                    return internalSteps.continueGraphTransition(prepareAssignment(placement, state.key, operationContext),
                        operationContext, assigned => errorUtils.isPoisonError(assigned) ? assigned :
                            { mutatedValue: assigned.value, placement: assigned, result: undefined, published: true })
                }
                const action = deleting
                    ? deleteManagedPath(privateChain, suffix, operationContext)
                    : assignManagedPath(privateChain, suffix, placement, operation)
                return internalSteps.continueGraphTransition(action, operationContext, result => {
                    if (errorUtils.isPoisonError(result)) return result
                    return captureMutationResult(privateChain, result, operationContext)
                })
            } finally { placement = undefined }
        }, replaceScope, deleting))
    if (!languageValues.isPending(result, operationContext)) return result
    markPromiseHandled(result, operationContext)
    return undefined
}

export { assignPath, deletePath }
