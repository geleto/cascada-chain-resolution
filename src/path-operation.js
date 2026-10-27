import { Chain } from "./chain.js"
import * as errors from "./error.js"
import * as externalTree from "./external-mutation-tree.js"
import * as steps from "./internal-step.js"
import * as metadata from "./meta.js"
import * as versions from "./property-versions.js"
import * as properties from "./language-properties.js"
import { OperationOwner } from "./operation-lifecycle.js"
import { capturePathOrigin, captureRoute } from "./path-context.js"
import { ArrayView } from "./array-view.js"
import * as languageValues from "./language-values.js"
import { captureMutationResult, transformProperty, walkMutationPath } from "./mutations.js"
import { IdentityPublication } from "./captured-identity.js"
import { ExternalAccess } from "./external-access.js"
import { externalLocationError, ExternalEffect, validateExternalAccess } from "./external-operation.js"
import { captureSnapshotPlacement } from "./external-snapshot.js"
import { mayBeThenable, readCallableThen } from "./thenable-subscription.js"

class PathOperation extends OperationOwner {
    constructor(chain, path, operationContext, mutationScopeDepth, repair = false, firstDynamicSegment = path.length, receiverDepth = path.length) {
        super(operationContext)
        chain._assertOperationContext(operationContext)
        this.chain = chain
        // Native failure ownership stops at the last statically selected scope.
        this.route = captureRoute(chain, path, firstDynamicSegment,
            Math.min(mutationScopeDepth ?? path.length, firstDynamicSegment, receiverDepth))
        if (mutationScopeDepth !== undefined) mutationScopeDepth += chain._rootPath?.length ?? 0
        this.mutation = mutationScopeDepth !== undefined
        const crossed = this.route.deepestExternalScope
        if (crossed && this.route.dynamicDepth < crossed[externalTree.TREE_NODE].depth) {
            this.routeFailure = errors.validationError(
                "Mutable external identities require a static context path", operationContext,
                errors.ERROR_KIND.ExternalLocationConflict)
        }
        this.repair = repair && !this.routeFailure
        this.scopeDepth = this.routeFailure && this.mutation ? Math.min(mutationScopeDepth, this.route.firstDynamicSegment) : mutationScopeDepth
        if (this.mutation && chain._readOnly) throw new Error("Cannot mutate through a read-only Chain")
        // Claim external order before managed gates can suspend path capture.
        // Capture still proceeds now; waiting first could capture a later gate.
        const node = this.route.externalScope ?? (this.mutation
            ? externalTree.findBranch(chain._externalMutationTree, this.route.path.slice(0, this.scopeDepth))
            : undefined)
        this.reserveExternal(node)
    }

    // Error queries also select external subtree metadata. Reserve that
    // coverage at issuance, before starting managed path capture.
    reserveExternal(node) {
        const subtree = this.mutation || !this.routeFailure
        // A forbidden selection reaches only its static prefix. A query's
        // fallback node cannot grant coverage of the dynamically chosen child.
        if (!subtree) node = this.route.externalScope
        if (node && !this.externalEffect) {
            this.selectedExternalNode = node
            this.externalEffect = new ExternalEffect(node, this.mutation, this.chain._externalReservationView, this.operationContext, subtree)
        }
    }

    retainInput(placement) {
        this.releaseInput ??= versions.retainPlacement(placement, this.operationContext)
    }

    observe(onValue, onExternal, onFailure, reflectionKind) {
        const chain = this.chain
        // The walker captures the root placement; subsequent work uses those
        // versions and the reserved route, never the source Chain again.
        this.chain = undefined
        const boundary = this.route.externalBoundary
        const depth = boundary ? boundary[externalTree.TREE_NODE].depth - (chain._contextOrigin?.depth ?? 0) : Infinity
        if (this.mutation && this.route.externalScope) {
            // Finish managed selection and recovery before starting native work.
            // Native availability and reservations cannot extend its publication.
            const selected = walkMutationPath(
                chain, this.route.path.slice(0, depth), this.operationContext, target => {
                    // The fixed native binding can itself have managed placement
                    // recovery. Restore only the selected placement, never a poisoned
                    // strict ancestor, before repairing its native metadata or calling.
                    if (this.repair && depth === this.route.path.length) {
                        return this.repairPlacement(target)
                    }
                    return steps.continueGraphTransition(versions.resolvePropertyValueAtKey(target.parent, target.key, this.operationContext),
                        this.operationContext, value => ({ mutatedValue: value, result: undefined }))
                }, { observeTarget: !this.repair, preserveOnFailure: this.repair, beforeWait: this.beforeWait })
            return steps.continueGraphTransition(selected, this.operationContext, outcome => {
                const value = errors.isPoisonError(outcome) ? outcome : outcome.mutatedValue
                return errors.isPoisonError(value) ? onValue(value) :
                    this.reachExternal(value, this.route.path.slice(depth), onExternal)
            })
        }
        return walkObservationPath(chain, this.route.path, this.operationContext, onValue,
            onFailure, reflectionKind, { onExternal: (identity, suffix) =>
                this.reachExternal(identity, suffix, onExternal), externalDepth: depth, owner: this })
    }

    reachExternal(identity, suffix, action) {
        const { operationContext } = this
        let { externalBoundary: boundary, externalScope: scope } = this.route
        if (this.routeFailure && !this.mutation && !scope) return this.routeFailure
        const failure = validateExternalAccess(identity, boundary, operationContext)
        if (failure) return failure
        if (this.mutation && !scope) return externalLocationError(operationContext)
        this.reachedExternal = true
        if (this.externalEffect?.readiness) this.beforeWait?.()
        return steps.continueGraphTransition(this.externalEffect?.readiness, operationContext, () => {
            try {
                if (!this.open) return undefined
                const failure = this.externalBlocker(!this.repair && (this.mutation || !this.routeFailure))
                if (failure) return this.mutation ? { mutatedValue: undefined, result: failure } : failure
                // Invalid observations stop before the child: preserve the reached
                // prefix's own poison, without collecting any descendant Errors.
                if (this.routeFailure) return scope?.[externalTree.TREE_NODE].ownPoison ?? this.routeFailure
                const access = this.externalAccess = new ExternalAccess(identity, suffix, boundary, this)
                if (this.repair) {
                    const failure = access.validatePath()
                    if (failure) return failure
                    externalTree.clearPoison(scope)
                }
                return action(access)
            } finally { identity = boundary = scope = undefined }
        })
    }

    externalBlocker(includeSubtree = true) {
        return externalTree.scopeBlocker(this.selectedExternalNode, includeSubtree)
    }

    repairPlacement(target) {
        return transformProperty(target, this.operationContext, (value, state) =>
            steps.continueGraphTransition(this.externalEffect?.readiness, this.operationContext, () => {
                const failure = this.externalBlocker(false) ?? this.routeFailure
                const placement = failure ? state.originalPlacement : state.baseline
                return { mutatedValue: placement.value, result: failure, placement }
            }), { repair: true, beforeWait: this.beforeWait })
    }

    mutate(transform, replaceScope = false, deleting = false) {
        const { chain, route, operationContext } = this
        if (this.routeFailure && this.route.externalScope) return this.observe(value => value, () => this.routeFailure)
        const requestedDepth = this.scopeDepth
        if (!route.externalBoundary && route.firstDynamicSegment < requestedDepth) {
            const depth = route.firstDynamicSegment
            return this.mutateSelected(chain, route, depth, (value, state, selected, suffix) =>
                steps.continueGraphTransition(this.mutateSelected(selected, captureRoute(selected, suffix, 0),
                    requestedDepth - depth, transform, replaceScope, deleting), operationContext, outcome => {
                    if (this.routeFailure) return this.routeFailure
                    return captureMutationResult(selected,
                        errors.isPoisonError(outcome) ? outcome : outcome.result, operationContext)
                }))
        }
        return this.mutateSelected(chain, route, requestedDepth, transform, replaceScope, deleting)
    }

    mutateSelected(chain, route, requestedDepth, transform, replaceScope = false, deleting = false) {
        const { operationContext } = this
        return walkMutationPath(chain, route.path.slice(0, requestedDepth), operationContext, target => {
            if (target.propertyKind !== properties.ORDINARY_PROPERTY) {
                const failure = properties.propertyValidationError("A mutation scope cannot be an intrinsic length property", operationContext)
                target.replaceReceiver(failure)
                return failure
            }
            const depth = target.pathDepth ?? requestedDepth
            // A computed path may capture its static failure prefix before
            // selecting the actual scope. Validate authority only at that
            // scope, comparing depths in the shared context coordinates.
            const scopeSelected = depth + (chain._contextOrigin?.depth ?? 0) ===
                this.scopeDepth + (this.chain._contextOrigin?.depth ?? 0)
            let node = externalTree.findBranch(chain._externalMutationTree, route.path.slice(0, depth))
            let holder
            const outcome = transformProperty(target, operationContext, (value, state) => {
                return steps.continueGraphTransition(this.externalEffect?.readiness, operationContext, () => {
                    try {
                        const blocker = this.externalBlocker(false)
                        if (blocker) return blocker
                        if (this.routeFailure) return this.routeFailure
                        if (this.repair && scopeSelected) externalTree.clearPoison(node)
                        if (node && scopeSelected && !replaceScope)
                            return properties.propertyValidationError("A managed mutation scope cannot contain mutable external locations", operationContext)
                        if (!replaceScope && metadata.metaOf(value, operationContext)?.type === metadata.TYPE.External)
                            return this.routeFailure = externalLocationError(operationContext)
                        const suffix = route.path.slice(depth)
                        state.key = depth ? target.key : chain._rootKey
                        let privateChain
                        // Whole-scope producers already return their replacement.
                        // Only a nested edit needs a private root for rollback.
                        if (suffix.length) {
                            privateChain = new Chain(undefined, operationContext)
                            privateChain._publication = new IdentityPublication(operationContext)
                            holder = privateChain._state
                            versions.transferPlacement(state.baseline, holder, "value", operationContext)
                            privateChain._externalMutationTree = node
                            privateChain._contextOrigin = capturePathOrigin(route, (chain._contextOrigin?.depth ?? 0) + depth)
                            privateChain._rootKey = state.key
                        }
                        return transform(value, state, privateChain, suffix, node)
                    } finally { value = state = undefined }
                })
            }, { replace: replaceScope && depth === requestedDepth, repair: this.repair && scopeSelected, beforeWait: this.beforeWait })
            return steps.continueGraphTransition(outcome, operationContext, published => {
                // The destination has accepted the capture. Detach this private
                // placement so later delivery cannot repopulate a spent holder.
                if (holder) versions.releaseHolder(holder, operationContext)
                // Spent selection state must not outlive the command through an unformatted Error.
                holder = target = node = chain = route = transform = undefined
                return published
            })
        }, { targetArrayStructure: true, deletesTarget: deleting && replaceScope,
            preserveOnFailure: this.repair, beforeWait: this.beforeWait,
            onExternalFailure: error => { this.routeFailure = error } })
    }

    finishMutation(outcome) {
        return steps.continueGraphTransition(outcome, this.operationContext, outcome => {
            const failure = errors.isPoisonError(outcome) ? outcome : errors.isPoisonError(outcome.mutatedValue) ? outcome.mutatedValue : null
            // Blocked operations return result-only outcomes. A later binding
            // conflict cannot erase this operation's own mutation failure.
            if (failure && this.reachedExternal && this.selectedExternalNode?.[externalTree.TREE_NODE].identity)
                externalTree.poisonScope(this.selectedExternalNode, failure)
            // Publication ends source access and authority independently of
            // any pending result (for example an Array's removed element).
            this.chain = undefined
            this.completeExternalEffect()
            return this.finish(errors.isPoisonError(outcome) ? outcome : outcome.result)
        })
    }

    finish(result) {
        return steps.continueGraphTransition(result, this.operationContext, value => {
            this.completeExternalEffect()
            this.close()
            return value
        })
    }

    completeExternalEffect() {
        this.externalEffect?.complete()
        this.externalEffect = undefined
        if (this.externalAccess) {
            this.externalAccess.identity = this.externalAccess.path = this.externalAccess.boundary = undefined
            this.externalAccess = undefined
        }
        this.route = this.selectedExternalNode = undefined
    }

    release() {
        this.releaseInput?.()
        this.chain = this.route = this.externalEffect = this.selectedExternalNode = this.releaseInput = this.beforeWait = undefined
    }
}

function repairPath(chain, path, operationContext, firstDynamicSegment = path.length) {
    const operation = new PathOperation(chain, path, operationContext, path.length, true, firstDynamicSegment)
    if (operation.routeFailure) {
        // Invalid source selection is a failed mutation of its known
        // prefix, not permission to repair the dynamically chosen scope.
        return operation.finishMutation(operation.mutate(() => operation.routeFailure))
    }
    if (operation.route.externalScope) return operation.finishMutation(operation.observe(
        value => value, () => ({ mutatedValue: undefined, result: undefined })))
    const node = operation.route.externalTreeNode
    // Restoration selects exactly the requested placement. It neither
    // creates working state nor widens an absent Array index to its owner.
    const result = walkMutationPath(chain, operation.route.path, operationContext, target => {
        if (target.propertyKind !== properties.ORDINARY_PROPERTY)
            return { mutatedValue: undefined, result: undefined }
        return operation.repairPlacement(target)
    }, { preserveOnFailure: true })
    return operation.finishMutation(steps.continueGraphTransition(result, operationContext, outcome => {
        if (!errors.isPoisonError(outcome) && !errors.isPoisonError(outcome.result)) externalTree.clearPoison(node)
        return outcome
    }))
}

// Observational path resolution follows raw logical values.
function walkObservationPath(
    chain,
    path,
    operationContext,
    onResolved,
    onUserCodeFailure = undefined,
    reflectionKind = errors.ERROR_KIND.LookupReflectionFailed,
    options = {},
) {
    let placement
    try {
        return errors.catchExternalThrow(() => {
            placement = properties.readLanguagePlacement(chain._state, "value", operationContext)
            return versions.resolvePlacement(placement, operationContext, ready => {
                try {
                    return walkObservationValue(ready.value, path, operationContext, onResolved,
                        onUserCodeFailure, reflectionKind, options, ready.present)
                } finally { ready = undefined }
            })
        }, operationContext, reflectionKind, onUserCodeFailure)
    } finally { placement = chain = undefined }
}

// Continue a received managed value through the same logical path semantics
// as a Chain root, without creating a temporary holder.
function walkObservationValue(
    value,
    path,
    operationContext,
    onResolved,
    onUserCodeFailure = undefined,
    reflectionKind = errors.ERROR_KIND.LookupReflectionFailed,
    { onExternal, externalDepth = Infinity, owner, snapshot = false, type } = {},
    present = true,
) {
    try { return runTraversal(() => walkValue(value, 0, present, type)) }
    finally { value = undefined }

    function walkFromParent(parent, index, type) {
        const key = properties.normalizePathSegment(
            path[index],
            operationContext,
        )
        if (errors.isPoisonError(key)) {
            languageValues.admitReadyValue(key, operationContext)
            return onResolved(key, false)
        }
        return readPlacement(parent, key, index + 1, type)
    }

    function readPlacement(parent, key, index, type) {
        if (snapshot && typeof parent !== "string") {
            const { value, present } = captureSnapshotPlacement(parent, key, operationContext, type)
            if (mayBeThenable(value, operationContext) && readCallableThen(value, operationContext))
                return onResolved(errors.validationError("External snapshots require ready managed properties",
                    operationContext, errors.ERROR_KIND.InvalidExternalSnapshot), false)
            return walkValue(value, index, present)
        }
        if (properties.classifyLanguageProperty(parent, key, operationContext) === properties.ARRAY_LENGTH)
            return ArrayView.resolveLength(parent, owner, value => runTraversal(() => walkValue(value, index, true)))
        const { value, present, sourceVersion: version } =
            properties.readLanguagePlacement(parent, key, operationContext)
        if (!languageValues.isPending(value, operationContext)) return walkValue(value, index, present)
        return versions.observePromiseVersion(
            value, version, operationContext,
            (propertyValue, captured) => {
                try { return runTraversal(() => walkValue(propertyValue, index, captured.present !== false)) }
                finally { propertyValue = captured = undefined }
            }, owner,
        )
    }

    function walkValue(value, index, present, type = metadata.metaOf(value, operationContext)?.type) {
        if (errors.isFatalError(value)) errors.failExecution(operationContext, value)
        if (snapshot && type === undefined && metadata.isObjectLike(value))
            type = metadata.inspectAdmissionMetaFacts(value, operationContext).type
        if (onExternal && !errors.isPoisonError(value) &&
            (index === externalDepth || type === languageValues.TYPE.External))
            return onExternal(value, path.slice(index))
        if (
            index === path.length ||
            errors.isPoisonError(value)
        ) {
            return onResolved(value, present)
        }
        if (typeof value === "string") {
            const key = properties.normalizePathSegment(
                path[index],
                operationContext,
            )
            if (errors.isPoisonError(key)) {
                languageValues.admitReadyValue(key, operationContext)
                return onResolved(key, false)
            }
            if (properties.hasLanguageProperty(value, key, operationContext)) {
                return walkFromParent(value, index)
            }
        }
        if (!metadata.isTraversableType(type)) {
            const failure = errors.pathAccessError(value, operationContext)
            languageValues.admitReadyValue(failure, operationContext)
            return onResolved(failure, false)
        }
        return walkFromParent(value, index, type)
    }

    function runTraversal(traverse) {
        if (owner && !owner.open) return undefined
        return errors.catchExternalThrow(
            traverse,
            operationContext,
            reflectionKind,
            onUserCodeFailure,
        )
    }
}

export { PathOperation, repairPath, walkObservationPath, walkObservationValue }
