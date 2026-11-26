import { runOutsideGraphTransition, runReceivingCommand } from "./ownership.js"
import { CHAIN_MODE, chainFromPlacement } from "./chain.js"
import { OpenAppend } from "./array-append.js"
import { ArrayView } from "./array-view.js"
import { MAX_ARRAY_LENGTH } from "./array-layout.js"
import * as externalTree from "./external-mutation-tree.js"
import { captureRoute } from "./path-context.js"
import { createExternalReservationView, ExternalEffect, pendingExternalEffects } from "./external-operation.js"
import * as errors from "./error.js"
import * as steps from "./internal-step.js"
import * as properties from "./language-properties.js"
import * as metadata from "./meta.js"
import * as values from "./language-values.js"
import { shallowCopyPathContainer } from "./mutations.js"
import * as versions from "./property-versions.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import { receiveValue } from "./input-preparations.js"
import { IdentityPublication } from "./captured-identity.js"
import { enterMetadata } from "./external-metadata.js"

// Selection consumes no unavailable suffix. The same anchor/rebased reference
// represents missing, poisoned, pending, intrinsic, and native destinations.
function captureReference(chain, route, mutable, operationContext) {
    const staticDepth = route.dynamicDepth - route.origin
    const publication = mutable ? new IdentityPublication(operationContext,
        metadata.metaOf(chain._state, operationContext)?.entryPublication) : undefined
    return capture(chain._state, "value", versions.capturePlacement(chain._state, "value", operationContext), 0)

    function capture(parent, key, placement, depth) {
        let value = versions.placementValue(placement)
        if (metadata.metaOf(value, operationContext)?.type === metadata.TYPE.External) {
            const scope = route.externalScope
            if (scope) {
                publication?.finish(false)
                return {
                    placement: { value: scope[externalTree.TREE_NODE].identity, present: true },
                    depth: scope[externalTree.TREE_NODE].depth - route.origin,
                    node: scope,
                }
            }
        }
        const segment = route.path[depth]
        if (!values.isPending(value, operationContext) && values.isTraversable(value, operationContext) &&
            !(route.externalBoundary && depth >= staticDepth) && depth < route.path.length &&
            (typeof segment === "string" || typeof segment === "number")) {
            const capturedAncestors = publication?.captures.length
            const selected = errors.catchExternalThrow(() => {
                const nextKey = String(segment)
                if (properties.classifyLanguageProperty(value, nextKey, operationContext) !== properties.ORDINARY_PROPERTY) return
                // If this key proves invalid, a contained edit can fail at the
                // Array itself. Keep that reference without consuming its suffix.
                if (ArrayView.mayHaveVirtualIndex(value, nextKey, operationContext) &&
                    Number(nextKey) >= ArrayView.minimumLength(value, operationContext)) return
                let next = properties.readLanguagePlacement(value, nextKey, operationContext)
                if (mutable && (metadata.requiresCopyOnWrite(value, operationContext) ||
                    properties.requiresRepresentationCopyForPropertyMutation(value, nextKey, operationContext,
                        properties.PROPERTY_MUTATION_MODE.AssignOrDelete))) {
                    const copy = shallowCopyPathContainer(value, operationContext)
                    const copied = { ...placement, value: copy }
                    versions.replacePlacement(parent, key, copied, operationContext, false)
                    placement = copied
                    value = copy
                    next = versions.capturePlacement(copy, nextKey, operationContext)
                }
                publication?.capture(value)
                // Keep child gate preparation inside discovery's guard too.
                // A supported read failure leaves this enclosing reference usable.
                return capture(value, nextKey, next, depth + 1)
            }, operationContext, errors.ERROR_KIND.LookupReflectionFailed, () => undefined)
            if (selected) return selected
            // Failed optional discovery selects this enclosing placement. Its
            // value belongs to the private prefix, not the public ancestor future.
            if (publication) publication.captures.length = capturedAncestors
        }
        const gate = mutable ? versions.installPlacementGate(parent, key, operationContext, placement) : undefined
        if (gate) {
            gate.publication = publication
            publication.suspend()
        }
        return { key, placement, depth, gate, node: route.nodes[depth] }
    }
}

function enter(chain, path, operationContext, mutable, onEntered, firstDynamicSegment = path.length, delivery) {
    chain._assertOperationContext(operationContext)
    if (mutable && chain._readOnly) throw new Error("Cannot mutate through a read-only Chain")
    if (mutable && chain._appendOnly && path.length) throw new Error("Cannot mutate a descendant of a push-only reference")
    const append = mutable && (typeof mutable === "object" ? { ...mutable } : chain._appendOnly)
    let enclosing = chain._openAppend
    let route = captureRoute(chain, path, firstDynamicSegment)
    let { key, placement, depth, node, gate } = captureReference(chain, route, mutable, operationContext)
    let effect = node ? new ExternalEffect(node, mutable, chain._externalReservationView, operationContext) : undefined
    let metadataEntry = node ? enterMetadata(node, chain._externalMetadataView, mutable) : undefined
    let entered = chainFromPlacement(placement, operationContext, chain._mode)
    entered._readOnly = !mutable
    entered._appendOnly = append
    entered._rootKey = depth ? key ?? route.path[depth - 1] : chain._rootKey
    entered._rootPath = route.path.slice(depth)
    entered._externalMutationTree = node
    // A negative boundary preserves a computed ancestor before this anchor.
    entered._firstDynamicSegment = route.dynamicDepth - route.origin - depth
    entered._externalReservationView = node ? createExternalReservationView(node) : chain._externalReservationView
    entered._externalMetadataView = metadataEntry?.view ?? chain._externalMetadataView
    chain = route = path = undefined
    let leasedValue, appendPublication
    return versions.resolvePlacementTransition(placement, operationContext, captured => {
        // The private root holder has one placement, whose publication
        // authority is already captured by the entry's gate.
        if (gate) {
            const holderMeta = metadata.requireMeta(entered._state, operationContext)
            holderMeta.entryGate = gate
            holderMeta.entryPublication = gate.publication
            if (append && append.mayPoisonScope === false && !node && !entered._rootPath.length &&
                !captured.ownFailure &&
                metadata.metaOf(captured.value, operationContext)?.type === metadata.TYPE.Array) {
                const open = errors.catchExternalThrow(() => {
                    if (entered._mode === CHAIN_MODE.Complete && (append.mayEmitMissingOutput ||
                        !(append.maximumCount <= MAX_ARRAY_LENGTH - ArrayView.maximumLength(captured.value, operationContext)))) return
                    return new OpenAppend(captured.value, append.maximumCount, operationContext)
                }, operationContext, errors.ERROR_KIND.LookupReflectionFailed, () => undefined)
                if (open) {
                    entered._openAppend = open
                    appendPublication = new IdentityPublication(operationContext, gate.publication)
                    const placement = { value: open.output, present: true }
                    versions.completePlacementGate(gate, placement, operationContext)
                    holderMeta.entryGate = undefined
                    holderMeta.entryPublication = appendPublication
                    enclosing?.update(placement)
                    gate = undefined
                }
            }
        }
        enclosing = undefined
        if (!mutable && !values.isPending(captured.value, operationContext) &&
            metadata.incrementReadLease(captured.value, operationContext)) leasedValue = captured.value
        captured = undefined
        return steps.continueGraphTransition(effect?.readiness, operationContext, () => {
            let result
            try { result = runOutsideGraphTransition(operationContext, () => onEntered(entered)) }
            finally { onEntered = undefined }
            if (operationContext.execution.fatalError) throw operationContext.execution.fatalError
            const receive = result => runReceivingCommand(operationContext, () =>
                receiveValue(result, operationContext, { kind: errors.ERROR_KIND.OperationInputFailed }, complete))
            return steps.continueOperation(result, operationContext, receive, reason => {
                if (!errors.isPoisonError(reason)) throw reason
                return receive(reason)
            })
        })

        function complete(result) {
            delivery?.capture(result)
            entered._closed = true
            if (leasedValue !== undefined) metadata.decrementReadLease(leasedValue, operationContext)
            leasedValue = undefined
            const final = (gate || entered._openAppend) && versions.capturePlacement(entered._state, "value", operationContext)
            entered._openAppend?.seal(final)
            entered._openAppend = undefined
            appendPublication?.finish()
            const publication = gate && versions.completePlacementGate(gate, final, operationContext)
            const external = node ? pendingExternalEffects(entered._externalReservationView) : undefined
            metadataEntry?.close()
            metadataEntry = node = undefined
            entered._externalMutationTree = entered._externalReservationView = entered._externalMetadataView = entered._rootPath = undefined
            markPromiseHandled(steps.collectInputs([publication, external], operationContext, () => {
                // Stop mirroring before deleting the spent private placement.
                const meta = metadata.requireMeta(entered._state, operationContext)
                meta.entryGate = meta.entryPublication = undefined
                versions.releaseHolder(entered._state, operationContext)
                effect?.complete()
                gate = entered = effect = undefined
            }), operationContext)
            return result
        }
    })
}

export { enter }
