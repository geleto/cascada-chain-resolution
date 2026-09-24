import { Chain } from "./chain.js"
import * as externalTree from "./external-mutation-tree.js"
import { capturePathOrigin, captureRoute } from "./path-context.js"
import { createExternalReservationView, ExternalEffect, pendingExternalEffects } from "./external-operation.js"
import * as errors from "./error.js"
import * as steps from "./internal-step.js"
import * as properties from "./language-properties.js"
import * as metadata from "./meta.js"
import * as values from "./language-values.js"
import { requiresArrayMaterialization } from "./array-view.js"
import { shallowCopyPathContainer } from "./mutations.js"
import * as versions from "./property-versions.js"
import { markPromiseHandled } from "./thenable-subscription.js"

// Selection consumes no unavailable suffix. The same anchor/rebased reference
// represents missing, poisoned, pending, intrinsic, and native destinations.
function captureReference(chain, route, mutable, operationContext) {
    const staticDepth = route.dynamicDepth - (chain._contextOrigin?.depth ?? 0)
    return capture(chain._state, "value", versions.capturePlacement(chain._state, "value", operationContext), 0)

    function capture(parent, key, placement, depth) {
        let value = placement.value
        if (metadata.metaOf(value, operationContext)?.type === metadata.TYPE.External) {
            const scope = externalTree.tracePath(chain._externalMutationTree, route.path, staticDepth).externalScope
            if (scope) return {
                placement: { value: scope[externalTree.TREE_NODE].identity, present: true },
                depth: scope[externalTree.TREE_NODE].path.length - (chain._contextOrigin?.depth ?? 0),
                node: scope,
            }
        }
        const segment = route.path[depth]
        if (!values.isPending(value, operationContext) && values.isTraversable(value, operationContext) &&
            !(route.externalBoundary && depth >= staticDepth) && depth < route.path.length &&
            (typeof segment === "string" || typeof segment === "number")) {
            const selected = errors.catchExternalThrow(() => {
                const nextKey = String(segment)
                if (properties.classifyLanguageProperty(value, nextKey, operationContext) !== properties.ORDINARY_PROPERTY) return
                let next = properties.readLanguagePlacement(value, nextKey, operationContext)
                if (mutable && (metadata.requiresCopyOnWrite(value, operationContext) ||
                    requiresArrayMaterialization(value, operationContext) ||
                    properties.requiresRepresentationCopyForPropertyMutation(value, nextKey, operationContext) ||
                    properties.requiresRepresentationCopyForPropertyMutation(value, nextKey, operationContext, true))) {
                    const copy = shallowCopyPathContainer(value, undefined, operationContext).value
                    const copied = { ...placement, value: copy }
                    versions.replaceLogicalPlacement(parent, key, copied, operationContext)
                    placement = copied
                    value = copy
                    next = versions.capturePlacement(copy, nextKey, operationContext)
                }
                // Keep child gate preparation inside discovery's guard too.
                // A supported read failure leaves this enclosing reference usable.
                return capture(value, nextKey, next, depth + 1)
            }, operationContext, errors.ERROR_KIND.LookupReflectionFailed, () => undefined)
            if (selected) return selected
        }
        const gate = mutable ? versions.installPlacementGate(parent, key, operationContext, placement) : undefined
        return { key, placement, depth, gate,
            node: externalTree.findBranch(chain._externalMutationTree, route.path.slice(0, depth)) }
    }
}

function enter(chain, path, operationContext, mutable, onEntered, firstDynamicSegment = path.length) {
    return steps.runInternalStep(operationContext, () => {
        chain._assertOperationContext(operationContext)
        if (mutable && chain._readOnly) throw new Error("Cannot mutate through a read-only Chain")
        const route = captureRoute(chain, path, firstDynamicSegment)
        const { key, placement, depth, node, gate } = captureReference(chain, route, mutable, operationContext)
        const effect = node ? new ExternalEffect(node, mutable, chain._externalReservationView, operationContext) : undefined
        if (!mutable && values.isPending(placement.value, operationContext)) versions.retainPlacement(placement, operationContext)
        const entered = new Chain(undefined, operationContext)
        entered._readOnly = !mutable
        entered._rootKey = depth ? key ?? route.path[depth - 1] : chain._rootKey
        entered._rootPath = route.path.slice(depth)
        entered._externalMutationTree = node
        entered._contextOrigin = capturePathOrigin(route, (chain._contextOrigin?.depth ?? 0) + depth)
        entered._externalReservationView = node ? createExternalReservationView(node) : chain._externalReservationView
        versions.transferPlacement(placement, entered._state, "value", operationContext)
        let leased
        return versions.resolvePlacementTransition(placement, operationContext, captured => {
            // The private root holder has one placement, whose publication
            // authority is already captured by the entry's gate.
            if (gate) metadata.requireMeta(entered._state, operationContext).entryGate = gate
            if (!mutable && !values.isPending(captured.value, operationContext))
                leased = metadata.incrementReadLease(captured.value, operationContext)
            return steps.continueOperation(effect?.readiness, operationContext, () => {
                const result = onEntered(entered)
                if (operationContext.execution.fatalError) throw operationContext.execution.fatalError
                return steps.continueOperation(result, operationContext, complete, reason => {
                    if (!errors.isPoisonError(reason)) throw reason
                    return complete(reason)
                })
            })

            function complete(result) {
                if (errors.isFatalError(result)) throw result
                entered._closed = true
                if (leased) metadata.decrementReadLease(captured.value, operationContext)
                const publication = gate && versions.completePlacementGate(gate,
                    versions.capturePlacement(entered._state, "value", operationContext), operationContext)
                const external = node ? pendingExternalEffects(entered._externalReservationView) : undefined
                markPromiseHandled(steps.collectInputs([publication, external], operationContext, () => {
                    metadata.metaOf(entered._state, operationContext).entryGate = undefined
                    effect?.complete()
                }), operationContext)
                return result
            }
        })
    })
}

export { enter }
