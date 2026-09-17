import { Chain } from "./chain.js"
import * as errors from "./error.js"
import * as tree from "./external-mutation-tree.js"
import * as steps from "./internal-step.js"
import * as metadata from "./meta.js"
import * as versions from "./property-versions.js"
import * as properties from "./language-properties.js"
import { createLeaseLedger } from "./invocation.js"
import { OperationOwner } from "./operation-lifecycle.js"
import { captureOrigin, capturePath } from "./path-context.js"
import { walkObservationPath } from "./observations.js"
import { captureMutationResult, transformProperty, walkMutationPath } from "./mutations.js"
import { ExternalAccess } from "./external-access.js"
import { externalLocationError, ExternalEffect, validateExternalAccess } from "./external-operation.js"

class PathOperation extends OperationOwner {
    constructor(chain, path, operationContext, mutationScopeDepth, repair = false, firstDynamicSegment = path.length, receiverDepth = path.length) {
        super(operationContext)
        chain._assertOperationContext(operationContext)
        this.chain = chain
        // Native failure ownership stops at the last statically selected scope.
        this.route = capturePath(chain, path, firstDynamicSegment,
            Math.min(mutationScopeDepth ?? path.length, firstDynamicSegment, receiverDepth))
        if (mutationScopeDepth !== undefined) mutationScopeDepth += chain._rootPath?.length ?? 0
        this.mutation = mutationScopeDepth !== undefined
        const crossed = this.route.crossed
        if (crossed && this.route.dynamicDepth < crossed[tree.TREE_NODE].path.length) {
            this.routeFailure = errors.validationError(
                "Mutable external identities require a static context path", operationContext,
                errors.ERROR_KIND.ExternalLocationConflict)
        }
        this.repair = repair && !this.routeFailure
        this.scopeDepth = this.routeFailure && this.mutation ? Math.min(mutationScopeDepth, this.route.firstDynamicSegment) : mutationScopeDepth
        this.externalScope = Boolean(this.route.scope)
        if (this.mutation && chain._readOnly) throw new Error("Cannot mutate through a read-only Chain")
        // Claim external order before managed gates can suspend path capture.
        // Capture still proceeds now; waiting first could capture a later gate.
        const node = this.route.scope ?? (this.mutation
            ? tree.findBranch(chain._externalMutationTree, this.route.path.slice(0, this.scopeDepth))
            : undefined)
        this.reserve(node)
    }

    // Queries and readonly entries also consume external subtree metadata or
    // state. They call this at issuance, before starting managed path capture.
    reserve(node) {
        if (node && !this.effect && (this.mutation || !this.routeFailure)) {
            this.selectedScope = node
            this.effect = new ExternalEffect(node, this.mutation, this.chain._reservationView, this.operationContext)
        }
    }

    retain(values) {
        this.leases ??= createLeaseLedger(this.operationContext)
        for (const value of values) this.leases.retain(value)
    }

    observe(onValue, onExternal, onFailure, reflectionKind, owner = this) {
        const boundary = this.route.boundary
        const depth = boundary ? boundary[tree.TREE_NODE].path.length - (this.chain._contextOrigin?.depth ?? 0) : Infinity
        if (this.mutation && this.externalScope) return walkMutationPath(
            this.chain, this.route.path.slice(0, depth), this.operationContext, target =>
                steps.continueOperation(versions.resolvePropertyValueAtKey(target.parent, target.key, this.operationContext),
                    this.operationContext, value => errors.isPoisonError(value) ? onValue(value) :
                        this.reachExternal(value, this.route.path.slice(depth), onExternal, owner)),
            result => result, { observeTarget: true })
        return walkObservationPath(this.chain, this.route.path, this.operationContext, onValue,
            onFailure, reflectionKind, { onExternal: (identity, suffix) =>
                this.reachExternal(identity, suffix, onExternal, owner), externalDepth: depth, owner })
    }

    reachExternal(identity, suffix, action, owner = this) {
        const { operationContext, route: { boundary, scope } } = this
        const failure = (this.mutation ? undefined : this.routeFailure) ?? validateExternalAccess(identity, boundary, operationContext)
        if (failure) return failure
        if (this.mutation && !scope) return externalLocationError(operationContext)
        this.reachedExternal = true
        return steps.continueOperation(this.effect?.readiness, operationContext, () => {
            if (!owner.open) return undefined
            const failure = this.blocker(!this.repair)
            if (failure) return failure
            if (this.routeFailure) return this.routeFailure
            const access = new ExternalAccess(identity, suffix, boundary, this)
            if (this.repair) {
                const failure = access.validatePath()
                if (failure) return failure
                tree.clearPoison(scope)
            }
            return action(access)
        })
    }

    blocker(includeSubtree = true) {
        return tree.scopeBlocker(this.selectedScope, includeSubtree)
    }

    mutate(transform, replaceScope = false, deleting = false) {
        const { chain, route, operationContext } = this
        if (this.routeFailure && this.externalScope) return this.observe(value => value, () => this.routeFailure)
        const requestedDepth = this.scopeDepth
        if (!route.boundary && route.firstDynamicSegment < requestedDepth) {
            const depth = route.firstDynamicSegment
            return this.mutateSelected(chain, route, depth, (value, state, selected, suffix) =>
                steps.continueOperation(this.mutateSelected(selected, capturePath(selected, suffix, 0),
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
            const node = tree.findBranch(chain._externalMutationTree, route.path.slice(0, depth))
            return transformProperty(target, operationContext, (value, state) => {
                return steps.continueOperation(this.effect?.readiness, operationContext, () => {
                    const blocker = this.blocker(false)
                    if (blocker) return blocker
                    if (this.routeFailure) return this.routeFailure
                    if (this.repair) tree.clearPoison(node)
                    if (node && depth === requestedDepth && !replaceScope)
                        return properties.propertyValidationError("A managed mutation scope cannot contain mutable external locations", operationContext)
                    if (!replaceScope && metadata.metaOf(value, operationContext)?.type === metadata.TYPE.External)
                        return this.routeFailure = externalLocationError(operationContext)
                    const privateChain = new Chain(undefined, operationContext)
                    versions.transferPlacement(state.baseline, privateChain._state, "value", operationContext)
                    privateChain._externalMutationTree = node
                    privateChain._contextOrigin = captureOrigin(route, (chain._contextOrigin?.depth ?? 0) + depth)
                    privateChain._reservationView = chain._reservationView
                    return transform(value, state, privateChain, route.path.slice(depth), node)
                })
            }, { replace: replaceScope && depth === requestedDepth, repair: this.repair })
        }, outcome => outcome, { structuralOwner: true, deletesTarget: deleting,
            preserveOnFailure: this.repair,
            onExternalFailure: error => { this.routeFailure = error } })
    }

    finishMutation(outcome) {
        return steps.continueOperation(outcome, this.operationContext, outcome => {
            const failure = errors.isPoisonError(outcome) ? outcome : errors.isPoisonError(outcome.mutatedValue) ? outcome.mutatedValue : null
            if (failure && this.reachedExternal && this.selectedScope?.[tree.TREE_NODE].identity && !this.blocker())
                tree.poisonScope(this.selectedScope, failure)
            // Publication, not an independently pending result, ends authority.
            this.completeEffect()
            return this.finish(errors.isPoisonError(outcome) ? outcome : outcome.result)
        })
    }

    finish(result) {
        return steps.continueOperation(result, this.operationContext, value => {
            this.completeEffect()
            this.close()
            return value
        })
    }

    completeEffect() {
        this.effect?.complete()
        this.effect = undefined
    }

    release() {
        this.leases?.release()
        this.chain = this.route = this.effect = this.selectedScope = this.leases = undefined
    }
}

function repairPath(chain, path, operationContext, firstDynamicSegment = path.length) {
    return steps.runInternalStep(operationContext, () => {
        const operation = new PathOperation(chain, path, operationContext, path.length, true, firstDynamicSegment)
        if (operation.routeFailure) {
            // Invalid source selection is a failed mutation of its known
            // prefix, not permission to repair the dynamically chosen scope.
            return operation.finishMutation(operation.mutate(() => operation.routeFailure))
        }
        if (operation.externalScope) return operation.finish(operation.observe(value => value, () => undefined))
        const node = operation.route.node
        // Restoration selects exactly the requested placement. It neither
        // creates working state nor widens an absent Array index to its owner.
        const result = walkMutationPath(chain, operation.route.path, operationContext, target => {
            if (target.propertyKind !== properties.ORDINARY_PROPERTY)
                return { mutatedValue: undefined, result: undefined }
            return transformProperty(target, operationContext, (value, state) =>
                steps.continueOperation(operation.effect?.readiness, operationContext, () =>
                    operation.blocker(false) ?? operation.routeFailure ??
                    { mutatedValue: value, result: undefined, placement: state.baseline }),
            { repair: true })
        }, outcome => outcome, { preserveOnFailure: true })
        return operation.finishMutation(steps.continueOperation(result, operationContext, outcome => {
            if (!errors.isPoisonError(outcome) && !errors.isPoisonError(outcome.result)) tree.clearPoison(node)
            return outcome
        }))
    })
}

export { PathOperation, repairPath }
