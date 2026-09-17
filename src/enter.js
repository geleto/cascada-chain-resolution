import { Chain } from "./chain.js"
import * as tree from "./external-mutation-tree.js"
import { captureOrigin } from "./path-context.js"
import { PathOperation } from "./path-operation.js"
import { createReservationView, pendingEffects, validateExternalAccess } from "./external-operation.js"
import * as errors from "./error.js"
import * as steps from "./internal-step.js"
import * as properties from "./language-properties.js"
import * as metadata from "./meta.js"
import { transformProperty, walkMutationPath } from "./mutations.js"
import { walkObservationPath } from "./observations.js"
import * as versions from "./property-versions.js"
import { markPromiseHandled } from "./thenable-subscription.js"

function enter(chain, path, operationContext, mutable, onEntered, firstDynamicSegment = path.length) {
    return steps.runInternalStep(operationContext, () => {
        const operation = new PathOperation(chain, path, operationContext,
            mutable ? path.length : undefined, false, firstDynamicSegment)
        const route = operation.route
        path = route.path
        const { node } = route
        if (mutable && operation.routeFailure) {
            return operation.finishMutation(operation.mutate(() => operation.routeFailure))
        }
        if (!mutable) operation.reserve(node)
        let entered
        let source
        let gate
        let selectedNode = node
        let lease
        const native = route.boundary
        const fail = failure => {
            if (lease) metadata.decrementReadLease(source.value, operationContext)
            if (gate && entered) versions.completePlacementGate(gate, versions.capturePlacement(entered._state, "value", operationContext), operationContext)
            if (entered) entered._closed = true
            return operation.finish(failure)
        }
        const start = () => {
            return steps.continueOperation(operation.effect?.readiness, operationContext, () => {
                const blocker = operation.blocker(false)
                if (blocker) return fail(blocker)
                entered._reservationView = node ? createReservationView(node) : chain._reservationView
                return runCallback(entered, result => {
                    if (lease) metadata.decrementReadLease(source.value, operationContext)
                    if (gate) versions.completePlacementGate(gate, versions.capturePlacement(entered._state, "value", operationContext), operationContext)
                    const pending = node ? pendingEffects(entered._reservationView) : undefined
                    markPromiseHandled(operation.finish(pending), operationContext)
                    return result
                })
            })
        }
        function initialize(placement, depth = path.length) {
            source = placement
            entered = new Chain(undefined, operationContext)
            entered._readOnly = !mutable
            entered._externalMutationTree = selectedNode
            entered._contextOrigin = captureOrigin(route, (chain._contextOrigin?.depth ?? 0) + depth)
            versions.transferPlacement(placement, entered._state, "value", operationContext)
        }
        function runCallback(privateChain, complete) {
            const result = onEntered(privateChain)
            if (operationContext.execution.fatalError) throw operationContext.execution.fatalError
            return steps.continueOperation(result, operationContext, finish, reason => {
                if (!errors.isPoisonError(reason)) throw reason
                return finish(reason)
            })
            function finish(value) {
                if (errors.isFatalError(value)) throw value
                privateChain._closed = true
                return complete(value)
            }
        }
        if (native) {
            return walkObservationPath(chain, path, operationContext, fail, fail,
                errors.ERROR_KIND.LookupReflectionFailed, { owner: operation, externalDepth: native[tree.TREE_NODE].path.length - (chain._contextOrigin?.depth ?? 0),
                    onExternal: identity => {
                        const invalid = validateExternalAccess(identity, native, operationContext)
                        if (invalid) return fail(invalid)
                        operation.reachedExternal = true
                        if (!node?.[tree.TREE_NODE].identity || route.dynamicDepth < node[tree.TREE_NODE].path.length) {
                            const failure = properties.propertyValidationError("Entry must select a registered external scope through a static path", operationContext)
                            if (!mutable) return fail(failure)
                            return steps.continueOperation(operation.effect?.readiness, operationContext, () =>
                                operation.finishMutation(operation.blocker() ?? failure))
                        }
                        initialize({ value: node[tree.TREE_NODE].identity, present: true })
                        return start()
                    } })
        }
        if (!mutable) {
            return walkObservationPath(chain, path, operationContext, (value, present, depth, recovery) => {
                if (errors.isPoisonError(value) && depth !== path.length) return fail(value)
                initialize({ value, present, recovery })
                lease = metadata.incrementReadLease(value, operationContext)
                return start()
            }, fail, errors.ERROR_KIND.LookupReflectionFailed, { owner: operation })
        }
        return walkMutationPath(chain, path, operationContext, target => {
            if (target.propertyKind !== properties.ORDINARY_PROPERTY) {
                const failure = properties.propertyValidationError("Cannot enter length for mutation", operationContext)
                target.replaceReceiver(failure)
                return failure
            }
            const depth = target.pathDepth ?? path.length
            const suffix = path.slice(depth)
            const captured = versions.capturePlacement(target.parent, target.key, operationContext, target.sourceVersion)
            if (suffix.length) {
                const kind = properties.classifyLanguageProperty(captured.value, suffix[0], operationContext)
                if (kind !== properties.ORDINARY_PROPERTY || suffix.length > 1) {
                    const failure = kind !== properties.ORDINARY_PROPERTY
                        ? properties.propertyValidationError("Cannot enter length for mutation", operationContext)
                        : errors.pathAccessError(undefined, operationContext)
                    return steps.continueOperation(transformProperty(target, operationContext, () => failure), operationContext, outcome => outcome.result)
                }
            }
            selectedNode = tree.findBranch(chain._externalMutationTree, path.slice(0, depth))
            gate = versions.installPlacementGate(target.parent, target.key, operationContext, target.sourceVersion)
            if (target.attachmentRoot) metadata.markShared(target.attachmentRoot, operationContext)
            initialize(captured, depth)
            // The reference denotes the element, but every command traverses
            // its protected Array so structural effects happen at that turn.
            if (suffix.length) entered._rootPath = suffix
        }, result => steps.continueOperation(result, operationContext, failure => failure ? fail(failure) : start()), {
            structuralOwner: true,
        })
    })
}

export { enter }
