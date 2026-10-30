import { MetadataCapture, MetadataSelection, empty, nativeMutation } from "./external-metadata.js"
import { initializeHolder } from "./parent-placements.js"
import * as errors from "./error.js"
import * as externalTree from "./external-mutation-tree.js"
import * as steps from "./internal-step.js"
import * as metadata from "./meta.js"
import * as versions from "./property-versions.js"
import * as properties from "./language-properties.js"
import { OperationOwner, releaseOnClose } from "./operation-lifecycle.js"
import { captureRoute, consumeSegment } from "./path-context.js"
import { ArrayView } from "./array-view.js"
import * as languageValues from "./language-values.js"
import { transformProperty, walkMutationPath } from "./mutations.js"
import { IdentityPublication } from "./captured-identity.js"
import { ExternalAccess } from "./external-access.js"
import { externalLocationError, ExternalEffect, validateExternalAccess } from "./external-operation.js"
import { captureSnapshotPlacement } from "./external-snapshot.js"
import { mayBeThenable, readCallableThen } from "./thenable-subscription.js"

class PathOperation extends OperationOwner {
    constructor(chain, path, operationContext, mutationScopeDepth, repair = false, firstDynamicSegment = path.length, receiverDepth = path.length, metadataOnly = false) {
        super(operationContext)
        chain._assertOperationContext(operationContext)
        this.chain = chain
        // Native failure ownership stops at the last statically selected scope.
        this.route = captureRoute(chain, path, firstDynamicSegment,
            metadataOnly ? path.length : Math.min(mutationScopeDepth ?? path.length, firstDynamicSegment, receiverDepth))
        this.metadataOnly = metadataOnly
        this.receiverDepth = receiverDepth + (chain._rootPath?.length ?? 0)
        if (mutationScopeDepth !== undefined) mutationScopeDepth += chain._rootPath?.length ?? 0
        this.mutation = mutationScopeDepth !== undefined
        const crossed = this.lastExternalNode()
        if (crossed) this.advanceRoute(crossed, crossed[externalTree.TREE_NODE].depth - this.route.origin)
        this.repair = repair
        this.scopeDepth = mutationScopeDepth
        if (this.mutation && chain._readOnly) throw new Error("Cannot mutate through a read-only Chain")
        // Claim external order before managed gates can suspend path capture.
        // Capture still proceeds now; waiting first could capture a later gate.
        const node = this.route.externalScope
        if (chain._externalMutationTree && (node || metadataOnly))
            this.metadata = new MetadataCapture(chain._externalMutationTree, chain._externalMetadataView, this)
        const selected = this.route.nodes.at(-1) ?? crossed
        if (metadataOnly && repair && selected)
            this.metadataSelection = new MetadataSelection(this.metadata, selected)
        if (node) {
            if (this.mutation && !metadataOnly && (!repair || !this.routeFailure)) {
                if (repair) {
                    this.metadataSelection = new MetadataSelection(this.metadata, node, false)
                    this.nativeMutation = nativeMutation()
                } else this.nativeMutation = this.metadata.mutation(node)
            }
            if (!metadataOnly && !this.routeFailure)
                this.externalEffect = new ExternalEffect(node, this.mutation, chain._externalReservationView, operationContext)
        }
    }

    advanceRoute(node, depth) {
        if (!this.metadataOnly && depth <= this.receiverDepth && node?.[externalTree.TREE_NODE].identity &&
            node[externalTree.TREE_NODE].depth > this.route.dynamicDepth)
            this.routeFailure ??= externalLocationError(this.operationContext)
        if (this.metadataOnly && this.metadataSelection?.node) {
            const selected = this.metadataSelection.node
            if (node && node[externalTree.TREE_NODE].depth > selected[externalTree.TREE_NODE].depth)
                this.metadataSelection.narrow(node)
            else if (!node && !selected[externalTree.TREE_NODE].identity) this.metadataSelection.narrow(undefined)
        }
    }

    lastExternalNode() { return this.route.nodes.findLast(node => node?.[externalTree.TREE_NODE].identity) }

    metadataNode() {
        return this.metadataOnly ? this.route.nodes[this.route.path.length] ?? this.lastExternalNode() : this.route.externalScope
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
        const depth = boundary ? boundary[externalTree.TREE_NODE].depth - this.route.origin : Infinity
        if (this.mutation && this.route.externalScope) {
            // Finish managed selection and recovery before starting native work.
            // Native availability and reservations cannot extend its publication.
            const selected = walkMutationPath(
                chain._state, this, target => {
                    // The fixed native binding can itself have managed placement
                    // recovery. The declared repair scope selects that placement;
                    // a deeper receiver does not turn it into a strict ancestor.
                    if (this.repair && depth === this.scopeDepth) {
                        return this.repairPlacement(target)
                    }
                    return steps.continueGraphTransition(versions.resolvePropertyValueAtKey(target.parent, target.key, this.operationContext),
                        this.operationContext, value => ({ mutatedValue: value, result: undefined }))
                }, { end: depth, observeTarget: !this.repair, preserveOnFailure: this.repair, beforeWait: this.beforeWait })
            return steps.continueGraphTransition(selected, this.operationContext, outcome => {
                if (errors.isPoisonError(outcome.result)) return outcome.result
                const value = errors.isPoisonError(outcome) ? outcome : outcome.mutatedValue
                return errors.isPoisonError(value) ? onValue(value) :
                    this.reachExternal(value, depth, onExternal)
            })
        }
        return walkObservationPath(chain, this, onValue,
            onFailure, reflectionKind, { onExternal: (identity, index) =>
                this.metadataOnly && (this.route.nodes[index]?.[externalTree.TREE_NODE].identity || index === this.route.path.length)
                    ? steps.continueGraphTransition(this.selectRoute(index, true), this.operationContext,
                        failure => failure ?? onValue(undefined, true, this.route.path.length), undefined, this) :
                    this.reachExternal(identity, index, onExternal), externalDepth: depth })
    }

    selectRoute(index, consumeSuffix = false) {
        if (index === this.route.path.length) return consumeSuffix && this.repair
            ? this.metadata?.blockers(this.metadataNode(), false) : undefined
        if (!consumeSuffix && (!this.route.nodes[index] || this.routeFailure)) return
        const select = () => consumeSegment(this, index, key => errors.isPoisonError(key) ? key :
            this.selectRoute(index + 1, consumeSuffix))
        // Native mutation checks its fixed scope once before this walk.
        // Metadata repair can narrow its scope, making earlier own poison a
        // strict-ancestor blocker before the next key is consumed.
        return this.mutation && !this.metadataOnly ? select() : steps.continueGraphTransition(
            this.metadata?.blockers(this.route.nodes[index], !this.repair, false), this.operationContext,
            blocker => blocker ?? select(), undefined, this)
    }

    reachExternal(identity, start, action) {
        const { operationContext } = this
        let { externalBoundary: boundary, externalScope: scope } = this.route
        if (this.routeFailure && !this.mutation && !scope) return this.routeFailure
        const failure = validateExternalAccess(identity, boundary, operationContext)
        if (failure) return failure
        if (this.mutation && !scope) return externalLocationError(operationContext)
        this.reachedExternal = true
        const select = blocker => {
            if (blocker) {
                identity = boundary = scope = undefined
                return { mutatedValue: undefined, result: blocker }
            }
            return steps.continueGraphTransition(this.selectRoute(start), operationContext, invalid => {
                if (invalid && (!this.mutation || this.repair)) {
                    identity = boundary = scope = undefined
                    return invalid
                }
                const rejected = this.routeFailure && (!this.mutation || this.repair)
                // Mutation already consumed its fixed scope. A failed repair
                // route must additionally preserve that scope's own old poison.
                const blocker = !this.mutation || (this.repair && rejected) ? this.metadata?.blockers(scope,
                    !this.repair || Boolean(this.routeFailure), !rejected) : undefined
                if (!rejected && this.externalEffect?.readiness) this.beforeWait?.()
                return steps.collectInputs([rejected ? undefined : this.externalEffect?.readiness, blocker], operationContext, ([, blocker]) => {
                    try {
                        if (!this.open) return undefined
                        if (blocker) return this.mutation ? { mutatedValue: undefined, result: blocker } : blocker
                        if (invalid) return invalid
                        // Invalid observations stop before the child: preserve the reached
                        // prefix's own poison, without collecting any descendant Errors.
                        if (this.routeFailure) return this.routeFailure
                        const access = this.externalAccess = new ExternalAccess(identity, start, boundary, this)
                        if (this.repair) {
                            this.commitRepairMetadata()
                        }
                        // Blockers and publishers retain their selected states.
                        // Native work no longer needs the issuance snapshot.
                        this.metadata?.close()
                        return action(access)
                    } finally { identity = boundary = scope = undefined }
                }, this)
            }, undefined, this)
        }
        // An ordinary mutation consumes its whole declared scope; repair-and-
        // call ignores the subtree it can clear, but still checks ancestors.
        return this.mutation ? steps.continueGraphTransition(
            this.metadata?.blockers(scope, !this.repair), operationContext, select, undefined, this) : select()
    }

    commitRepairMetadata() {
        this.metadataSelection?.finish(true, this.nativeMutation?.state ?? empty)
        this.metadataSelection = undefined
    }

    repairPlacement(target) {
        return transformProperty(target, this.operationContext, (value, state) => {
            // Key validation can retain this callback in an unformatted Error stack.
            value = undefined
            return steps.continueGraphTransition(this.metadata?.blockers(this.metadataNode(), false), this.operationContext, blocker => {
                // Native repair validates its fixed route before restoration.
                // Keep that wait inside the placement transition so later work
                // cannot pass it or replace the baseline selected for recovery.
                const selection = blocker ?? (this.metadataOnly ? undefined :
                    steps.continueGraphTransition(this.selectRoute(this.scopeDepth), this.operationContext,
                        invalid => invalid ?? (this.routeFailure ? this.metadata?.blockers(this.metadataNode(), true, false) : undefined),
                        undefined, this))
                return steps.continueGraphTransition(selection, this.operationContext, rejected => {
                    try {
                        const failure = rejected ?? this.routeFailure
                        const placement = failure ? state.originalPlacement : state.baseline
                        return { mutatedValue: placement.value, result: failure, placement }
                    } finally { state = undefined }
                }, undefined, this)
            })
        }, { repair: true, beforeWait: this.beforeWait })
    }

    mutate(transform, replaceScope = false, deleting = false) {
        let { chain, route } = this
        const { operationContext, scopeDepth: requestedDepth } = this
        const result = walkMutationPath(chain._state, this, target => {
            if (target.propertyKind !== properties.ORDINARY_PROPERTY) {
                const failure = properties.propertyValidationError("A mutation scope cannot be an intrinsic length property", operationContext)
                target.replaceReceiver(failure)
                return failure
            }
            const depth = target.pathDepth ?? requestedDepth
            let node = route.nodes[depth]
            let holder
            // A mixed managed scope is invalid before any deeper crossing.
            // At the resource itself, the crossing's authority failure wins.
            const scopeFailure = node && !replaceScope && (!node[externalTree.TREE_NODE].identity || !this.routeFailure)
                ? properties.propertyValidationError("A managed mutation scope cannot contain mutable external locations", operationContext)
                : this.routeFailure
            // Structural rejection must not restore the scope just to fail its
            // call. Ordinary mutations still publish their own scope failure.
            const outcome = this.repair && scopeFailure ? scopeFailure : transformProperty(target, operationContext, (value, state) => {
                if (scopeFailure) return scopeFailure
                if (!replaceScope && metadata.metaOf(value, operationContext)?.type === metadata.TYPE.External)
                    return externalLocationError(operationContext)
                state.key = depth ? target.key : chain._rootKey
                let working
                // Whole-scope producers already return their replacement.
                // Only a nested edit needs a private root for rollback.
                if (depth < route.path.length) {
                    holder = initializeHolder({}, operationContext)
                    working = { holder, publication: new IdentityPublication(operationContext) }
                    versions.transferPlacement(state.baseline, holder, "value", operationContext)
                }
                return transform(value, state, working, depth)
            }, { replace: replaceScope && depth === requestedDepth, repair: this.repair,
                consumeRestored: true, beforeWait: this.beforeWait })
            return steps.continueGraphTransition(outcome, operationContext, published => {
                // The destination has accepted the capture. Detach this private
                // placement so later delivery cannot repopulate a spent holder.
                if (holder) versions.releaseHolder(holder, operationContext)
                // Spent selection state must not outlive the command through an unformatted Error.
                holder = target = node = undefined
                return published
            })
        }, { end: requestedDepth, targetArrayStructure: true, deletesTarget: deleting && replaceScope,
            preserveOnFailure: this.repair, beforeWait: this.beforeWait })
        return steps.continueGraphTransition(result, operationContext, outcome => {
            chain = route = transform = undefined
            return outcome
        })
    }

    finishMutation(outcome) {
        return steps.continueGraphTransition(outcome, this.operationContext, outcome => {
            const failure = errors.isPoisonError(outcome) ? outcome : errors.isPoisonError(outcome.mutatedValue) ? outcome.mutatedValue : null
            // Blocked operations return result-only outcomes and preserve the
            // predecessor metadata captured at issuance.
            this.metadataSelection?.finish(false)
            this.metadataSelection = undefined
            this.nativeMutation?.finish(this.reachedExternal && !(this.repair && this.routeFailure) ? failure : undefined)
            this.nativeMutation = undefined
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
        this.metadata?.close()
        if (this.externalAccess) {
            this.externalAccess.authorityIdentities = undefined
            this.externalAccess.identity = this.externalAccess.boundary = undefined
            this.externalAccess = undefined
        }
        this.route = undefined
    }

    release() {
        this.releaseInput?.()
        this.metadata?.close()
        this.metadata = undefined
        this.chain = this.route = this.externalEffect = this.releaseInput = this.beforeWait = undefined
    }
}

function repairPath(chain, path, operationContext, firstDynamicSegment = path.length) {
    const operation = new PathOperation(chain, path, operationContext, path.length, true, firstDynamicSegment, path.length, true)
    // Restoration selects exactly the requested placement. It neither
    // creates working state nor widens an absent Array index to its owner.
    const result = walkMutationPath(chain._state, operation, target => {
        if (target.propertyKind !== properties.ORDINARY_PROPERTY)
            return { mutatedValue: undefined, result: undefined }
        return operation.repairPlacement(target)
    }, { preserveOnFailure: true,
        onExternal: depth => {
            if (!operation.route.nodes[depth]?.[externalTree.TREE_NODE].identity) return
            return steps.continueGraphTransition(operation.selectRoute(depth, true), operationContext,
                failure => ({ mutatedValue: undefined, result: failure ?? undefined }), undefined, operation)
        } })
    return operation.finishMutation(steps.continueGraphTransition(result, operationContext, outcome => {
        if (!errors.isPoisonError(outcome) && !errors.isPoisonError(outcome.result)) operation.commitRepairMetadata()
        return outcome
    }))
}

// Observational path resolution follows raw logical values.
function walkObservationPath(
    chain,
    operation,
    onResolved,
    onUserCodeFailure = undefined,
    reflectionKind = errors.ERROR_KIND.LookupReflectionFailed,
    options = {},
) {
    const { operationContext } = operation
    let placement
    try {
        return errors.catchExternalThrow(() => {
            placement = properties.readLanguagePlacement(chain._state, "value", operationContext)
            return versions.resolvePlacement(placement, operationContext, ready => {
                try {
                    return walkObservationValue(ready.value, operation, onResolved,
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
    owner,
    onResolved,
    onUserCodeFailure = undefined,
    reflectionKind = errors.ERROR_KIND.LookupReflectionFailed,
    { start = 0, end = owner.route.path.length, onExternal, externalDepth = Infinity, snapshotAccess, type } = {},
    present = true,
) {
    const { operationContext } = owner
    let prefix, unregister
    const release = () => {
        if (prefix !== undefined) metadata.decrementReadLease(prefix, operationContext)
        prefix = undefined
        unregister?.()
        unregister = undefined
    }
    const resolve = (value, present, index) => {
        try { return onResolved(value, present, index) }
        finally { release() }
    }
    try { return runTraversal(() => walkValue(value, start, present, type)) }
    finally { value = undefined }

    function walkFromParent(parent, index, type) {
        const key = consumeSegment(owner, index, key => key)
        if (prefix === undefined && languageValues.isPending(key, operationContext) &&
            (!snapshotAccess || metadata.metaOf(parent, operationContext)) &&
            metadata.incrementReadLease(parent, operationContext)) {
            prefix = parent
            unregister = releaseOnClose(owner, release)
        }
        return steps.continueGraphTransition(key, operationContext, key => runTraversal(() => {
            try {
                if (errors.isPoisonError(key)) return resolve(key, false, index)
                if (typeof parent === "string" && !properties.hasLanguageProperty(parent, key, operationContext))
                    return resolve(errors.pathAccessError(parent, operationContext), false, index)
                return readPlacement(parent, key, index + 1, type)
            } finally { parent = undefined }
        }), undefined, owner)
    }

    function readPlacement(parent, key, index, type) {
        // The next capture happens in this transition. A later pending key
        // protects that child, independently of this spent prefix.
        release()
        if (snapshotAccess && typeof parent !== "string") {
            // Raw host storage is protected by its native reservation, not a
            // managed lease. A key wait may have crossed a new registration.
            const failure = snapshotAccess.validateRetainedIdentities()
            if (failure) return resolve(failure, false, index)
            const { value, present } = captureSnapshotPlacement(parent, key, operationContext, type)
            if (mayBeThenable(value, operationContext) && readCallableThen(value, operationContext))
                return resolve(errors.validationError("External snapshots require ready managed properties",
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
        if (snapshotAccess && type === undefined && metadata.isObjectLike(value))
            type = metadata.inspectAdmissionMetaFacts(value, operationContext).type
        if (onExternal && !errors.isPoisonError(value) &&
            (index === externalDepth || type === languageValues.TYPE.External))
            { try { return onExternal(value, index) } finally { release() } }
        if (
            index === end ||
            errors.isPoisonError(value)
        ) {
            return resolve(value, present, index)
        }
        if (typeof value !== "string" && !metadata.isTraversableType(type)) {
            const failure = errors.pathAccessError(value, operationContext)
            languageValues.admitReadyValue(failure, operationContext)
            return resolve(failure, false, index)
        }
        return walkFromParent(value, index, type)
    }

    function runTraversal(traverse) {
        if (!owner.open) return undefined
        return errors.catchExternalThrow(
            traverse,
            operationContext,
            reflectionKind,
            onUserCodeFailure,
        )
    }
}

export { PathOperation, repairPath, walkObservationPath, walkObservationValue }
