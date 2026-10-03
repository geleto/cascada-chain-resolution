import { createMutationOutcome } from "./mutations.js"
import { ArrayView } from "./array-view.js"
import { walkManagedProperties } from "./managed-traversal.js"
import * as internalSteps from "./internal-step.js"
import * as errorUtils from "./error.js"
import * as imports from "./import.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import { createEmptyContainer, defineCopyProperty, captureContainerStructure, orderRecordKeys } from "./placement-structure.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"
import { initializePlacements } from "./parent-placements.js"
import { captureIdentity } from "./captured-identity.js"

function selectManagedMethodDescription(invocationWork) {
    const { mutation, receiver } = invocationWork
    const receiverType = languageValues.typeOf(receiver, invocationWork.operationContext)
    // Preparation resolves receiver contents but never changes its admitted type.
    const selectMethod = receiverType === languageValues.TYPE.Record
        ? selectManagedRecordMethod
        : selectManagedClassMethod
    return {
        receiverToLease: receiver,
        leaseInputsThroughResult: !mutation,
        prepareArguments: () =>
            prepareManagedReceiverAndArguments(invocationWork),
        invoke(prepared) {
            try {
                // Selection follows complete preparation and precedes isolation.
                // A rejected selection already carries its required mutation effect.
                const callable = errorUtils.catchExternalThrow(
                    () => selectMethod(prepared.capture.receiver, invocationWork),
                    invocationWork.operationContext,
                    errorUtils.ERROR_KIND.LookupReflectionFailed,
                )
                if (typeof callable !== "function") return callable
                const workingReceiver = prepareMethodReceiver(
                    prepared.capture,
                    invocationWork,
                )
                if (errorUtils.isPoisonError(workingReceiver)) {
                    return workingReceiver
                }
                return mutation
                    ? invokeMutation(
                        callable,
                        workingReceiver,
                        prepared.args,
                        invocationWork.operationContext,
                        invocationWork,
                    )
                    : invokeObservation(
                        callable,
                        workingReceiver,
                        prepared.args,
                        invocationWork.operationContext,
                        invocationWork,
                    )
            } finally { prepared.capture.release() }
        },
    }
}

function prepareManagedReceiverAndArguments(invocationWork) {
    invocationWork.prepareArgumentFrontier()
    const capture = { receiver: invocationWork.receiver, nodes: new Map(), identities: new Map(), errors: new Set(), release }
    const visited = new WeakSet()
    invocationWork.discardPreparedOutput = discardOutput
    let unregister
    const receiverReadiness = internalSteps.continueGraphTransition(visit(capture.receiver),
        invocationWork.operationContext, () => capture.errors.size
            ? errorUtils.combineErrors(capture.errors, "Managed receiver contains multiple Errors")
            : undefined, undefined, invocationWork)
    const readiness = internalSteps.prepareInputs(
        [receiverReadiness, invocationWork.exportArguments()],
        invocationWork.operationContext,
        ([, args]) => ({ capture, args }),
        invocationWork,
    )
    if (languageValues.isPending(readiness, invocationWork.operationContext))
        unregister = operationLifecycle.releaseOnClose(invocationWork, release)
    return internalSteps.continueGraphTransition(readiness, invocationWork.operationContext, prepared => {
        if (errorUtils.isPoisonError(prepared)) release()
        return prepared
    }, undefined, invocationWork)

    function visit(value) {
        if (!invocationWork.open) return
        const { operationContext } = invocationWork
        if (operationContext.execution._externalIdentities.has(value)) {
            collect(externalCapabilityEscapeError(operationContext))
            return
        }
        if (errorUtils.isPoisonError(value)) { collect(value); return }
        if (!languageValues.isTraversable(value, operationContext) || visited.has(value)) return
        visited.add(value)
        // Every storage representation is inspected, but equal generations
        // share one logical capture and acquire logical parent links directly.
        const identity = capture.nodes && captureIdentity(value, operationContext)
        const existing = capture.identities?.get(identity)
        const node = capture.nodes && (existing ?? { entries: new Map(), parents: new Set(), identity, source: value })
        if (node) {
            capture.identities.set(identity, node)
            capture.nodes.set(value, node)
            if (existing) node.duplicates = true
        }
        invocationWork.leaseReceiver(value)
        try {
            return walkManagedProperties(value, invocationWork, inspect,
                (child, key, present = true) => {
                    if (!present) { if (!existing) node?.entries.delete(key); return }
                    if (capture.nodes && !existing) node.entries.set(key, child)
                    const readiness = visit(child)
                    capture.nodes?.get(child)?.parents.add(node)
                    return readiness
                }, undefined, keys => {
                    // Reserve order before pending properties deliver, including holes
                    // or deletions whose final presence is not known yet.
                    if (!capture.nodes || existing) return
                    for (const key of keys) node.entries.set(key, undefined)
                    node.shape = inspect(() => captureContainerStructure(value, keys, operationContext))
                    return () => {
                        if (capture.nodes) {
                            if (node.shape?.length?.read) node.shape.length = node.shape.length.read()
                            node.keys = orderRecordKeys([...node.entries.keys()], node.shape?.order)
                        }
                    }
                })
        } finally { value = undefined }
    }

    function inspect(step) {
        return errorUtils.catchExternalThrow(step, invocationWork.operationContext,
            errorUtils.ERROR_KIND.InvalidManagedReceiver, failure => {
                languageValues.admitReadyValue(failure, invocationWork.operationContext)
                collect(failure)
            })
    }

    function release() {
        unregister?.()
        unregister = undefined
        discardOutput()
        capture.errors.clear()
        invocationWork.discardPreparedOutput = undefined
    }

    function collect(failure) {
        capture.errors.add(failure)
        invocationWork.preparationFailed()
    }

    function discardOutput() {
        for (const node of capture.identities?.values() ?? []) {
            node.shape?.length?.release?.()
            node.entries.clear()
            node.parents.clear()
            node.shape = node.keys = node.copy = node.source = undefined
        }
        capture.nodes?.clear()
        capture.identities?.clear()
        capture.nodes = capture.identities = undefined
        capture.receiver = undefined
    }
}

// Common dispatch rejects `constructor` before either managed policy runs.
function selectManagedRecordMethod(receiver, invocationWork) {
    const { value: callable, present } = languageProperties.readLanguagePlacement(
        receiver,
        invocationWork.method,
        invocationWork.operationContext,
    )
    return typeof callable === "function"
        ? callable
        : invocation.methodNotCallableError(
            invocationWork.method,
            invocationWork.operationContext,
            present,
        )
}

function selectManagedClassMethod(receiver, invocationWork) {
    const { method, operationContext } = invocationWork
    if (languageProperties.hasLanguageProperty(receiver, method, operationContext)) {
        return errorUtils.validationError(
            `Cannot call ${method} because an own data property ` +
            "with that name hides the method",
            operationContext,
            errorUtils.ERROR_KIND.NotAFunction,
        )
    }
    let prototype = metadata.requireMeta(
        receiver,
        operationContext,
    ).admittedPrototype
    while (
        prototype !== null &&
        !errorUtils.runExternalAction(operationContext, () =>
            metadata.isPlainObjectPrototype(prototype),
        )
    ) {
        const descriptor = errorUtils.runExternalAction(
            operationContext,
            () => Object.getOwnPropertyDescriptor(prototype, method),
        )
        if (descriptor) {
            if (!("value" in descriptor)) {
                return errorUtils.validationError(
                    "Managed class methods must be data properties",
                    operationContext,
                    errorUtils.ERROR_KIND.InvalidManagedReceiver,
                )
            }
            return typeof descriptor.value === "function"
                ? descriptor.value
                : invocation.methodNotCallableError(
                    method,
                    operationContext,
                )
        }
        prototype = errorUtils.runExternalAction(
            operationContext,
            () => Object.getPrototypeOf(prototype),
        )
    }
    return invocation.methodNotCallableError(method, operationContext, false)
}

// Observation materialization path-copies only required representation changes.
// Mutation isolation copies complete protected subgraphs before arbitrary writes.
function prepareMethodReceiver(capture, invocationWork) {
    const { operationContext, mutation } = invocationWork
    return errorUtils.catchExternalThrow(() => {
        if (mutation) invocationWork.releaseReceiverLeases()
        else {
            const queue = []
            const requireCopy = node => {
                if (node.copyRequired) return
                node.copyRequired = true
                queue.push(node)
            }
            // Logical contents are fixed by capture; physical synchronization may
            // finish during preparation. Check representation only after settlement.
            for (const [source, node] of capture.nodes)
                if (requiresObservationCopy(source, node, operationContext)) requireCopy(node)
            for (const node of capture.identities.values())
                if (node.duplicates) for (const parent of node.parents) requireCopy(parent)
            for (let index = 0; index < queue.length; index++)
                for (const parent of queue[index].parents) requireCopy(parent)
        }
        return copyCompleteGraph(capture.receiver, capture.nodes, operationContext, mutation)
    }, operationContext, errorUtils.ERROR_KIND.InvalidManagedReceiver, failure => {
        languageValues.admitReadyValue(failure, operationContext)
        return failure
    })
}

function requiresObservationCopy(source, node, operationContext) {
    if (ArrayView.requiresMaterialization(source, operationContext)) return true
    if (node.shape?.order) {
        const physical = errorUtils.runExternalAction(operationContext, () => Object.keys(source))
            .filter(key => node.entries.has(key))
        if (physical.length !== node.keys.length || physical.some((key, index) => key !== node.keys[index])) return true
    }
    // Include absent overlays: they may still hide a physical placement.
    const versions = metadata.requireMeta(source, operationContext).placementVersions
    for (const key of Object.keys(versions ?? {})) {
        const descriptor = languageProperties.getLanguagePlacementDescriptor(source, key, operationContext)
        if (node.entries.has(key)
            ? !descriptor || !Object.is(descriptor.value, node.entries.get(key))
            : descriptor) return true
    }
    return false
}

// One copier consumes the captured graph. Observation reuses unchanged identities;
// mutation copies every node. Shells precede edges to preserve aliases and cycles.
function copyCompleteGraph(source, nodes, operationContext, mutation) {
    const node = nodes.get(source)
    if (!node) return source
    source = node.source
    if (!mutation && !node.copyRequired) return source
    if (node.copy) return node.copy
    const copy = node.copy = createEmptyContainer(source, operationContext)
    const { type, admittedPrototype } = metadata.requireMeta(source, operationContext)
    languageValues.admitReadyValue(copy, operationContext, type, admittedPrototype)
    if (!mutation) metadata.requireMeta(copy, operationContext).generation = node.identity
    if (node.shape?.length !== undefined) copy.length = node.shape.length
    for (const key of node.keys)
        defineCopyProperty(copy, key, copyCompleteGraph(node.entries.get(key), nodes, operationContext, mutation))
    return copy
}

function invokeObservation(callable, receiver, args, operationContext, work) {
    return imports.importMethodResult(
        invocation.invokeFunction(
            callable,
            receiver,
            args,
            operationContext,
        ),
        operationContext,
        { capture: work.retainOutput },
    )
}

function invokeMutation(callable, receiver, args, operationContext, work) {
    const result = invocation.invokeFunction(
        callable,
        receiver,
        args,
        operationContext,
    )
    return internalSteps.continueGraphTransition(
        result,
        operationContext,
        complete,
        failed,
    )

    function failed(reason) {
        const failure = errorUtils.createPoisonError(
            reason,
            operationContext,
            errorUtils.ERROR_KIND.InvocationFailed,
        )
        return { mutatedValue: failure, result: failure }
    }

    function complete(value) {
        if (Error.isError(value)) return failed(value)
        // Direct method failure poisons the receiver. Importing an independent
        // result can fail separately after the method has completed its mutation.
        const failures = { errors: new Set() }
        const receiverFailure = validateReceiver(receiver, operationContext)
        const outcome = createMutationOutcome(receiverFailure ?? receiver, undefined, operationContext)
        const imported =
            value === receiver
                ? receiver
                : imports.importReadyMethodResult(
                      value,
                      operationContext,
                      failures,
                  )
        work.retainOutput(imported)
        outcome.result = receiverFailure
            ? errorUtils.combineErrors([receiverFailure, ...failures.errors], "Managed mutation failed") : imported
        return outcome
    }
}

function validateReceiver(receiver, operationContext) {
    const visited = new Set()
    const errors = new Set()
    const entries = new Map()
    walk(receiver)
    if (!errors.size) for (const [owner, placements] of entries) initializePlacements(owner, operationContext, placements)
    return errors.size === 0
        ? undefined
        : errorUtils.combineErrors(
            errors,
            "Managed mutation produced invalid state",
        )

    function walk(value) {
        if (Error.isError(value)) {
            errors.add(
                errorUtils.createPoisonError(
                    value,
                    operationContext,
                    errorUtils.ERROR_KIND.InvalidManagedReceiver,
                ),
            )
            return
        }
        if (value === null || typeof value !== "object" || visited.has(value)) return
        visited.add(value)
        const meta = metadata.metaOf(value, operationContext)
        if (meta && !metadata.isTraversableType(meta.type)) return
        if (!meta) {
            // Recognize new stored thenables without subscribing. Admitted
            // values keep their category; native surface stability is a host contract.
            const thenable = inspect(() => errorUtils.runExternalAction(operationContext,
                () => typeof value.then === "function"))
            if (errorUtils.isPoisonError(thenable)) return
            if (thenable) {
                errors.add(errorUtils.validationError(
                    "Managed mutation receiver contains a Promise or thenable",
                    operationContext,
                    errorUtils.ERROR_KIND.InvalidManagedReceiver,
                ))
                return
            }
        }
        languageValues.admitReadyValue(value, operationContext)
        if (!languageValues.isTraversable(value, operationContext)) return
        const placements = metadata.metaOf(value, operationContext).placementsInitialized ? undefined : []
        if (placements) entries.set(value, placements)
        const keys = languageProperties.enumerableLanguageKeys(value, operationContext, 0, undefined, inspect)
        for (const key of keys) {
            // Validation must inspect leased data without consuming it.
            const child = inspect(() => propertyVersions.capturePlacement(value, key, operationContext).value)
            const failure = languageProperties.validatePropertyValue(key, child, operationContext,
                errorUtils.ERROR_KIND.InvalidManagedReceiver)
            if (failure) errors.add(failure)
            walk(child)
            placements?.push([key, child])
        }
    }

    function inspect(action) {
        const result = errorUtils.catchExternalThrow(
            action,
            operationContext,
            errorUtils.ERROR_KIND.InvalidManagedReceiver,
        )
        if (errorUtils.isPoisonError(result)) errors.add(result)
        return result
    }
}

export { selectManagedMethodDescription }
