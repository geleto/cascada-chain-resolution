import { continueGraphTransition } from "./internal-step.js"
import * as errorUtils from "./error.js"
import { commitExternalLocations, prepareExternalMutationTree } from "./external-mutation-tree.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import { CONSTRUCTION_STATE, PlacementConstruction } from "./parent-placements.js"

// One inward transition consumes availability, prepares the delivered input,
// and captures it before later work can change its ownership.
function receiveValue(value, operationContext, policy, onValue = value => value, owner, externalMutationTreeSetup) {
    const accept = root => {
        try {
            const prepared = prepareInput(root, operationContext, policy,
                // Context discovery applies only to the supplied, ready root.
                root === value ? externalMutationTreeSetup : undefined)
            languageValues.admitReadyValue(prepared, operationContext)
            return onValue(prepared)
        } finally { onValue = undefined }
    }
    try {
        return continueGraphTransition(value, operationContext, accept,
            reason => accept(errorUtils.createPoisonError(reason, operationContext, policy.kind)), owner)
    } finally {
        // Pending delivery needs neither the original input nor discovery data.
        value = externalMutationTreeSetup = undefined
    }
}

function prepareInput(
    root,
    operationContext,
    policy,
    externalMutationTreeSetup,
    failures,
    inspectionFailures,
) {
    if (errorUtils.isFatalError(root)) throw root
    if (errorUtils.isPoisonError(root)) return errorUtils.createPoisonError(root, operationContext, policy.kind)
    if (!metadata.isObjectLike(root)) return root
    const priorFailure = inspectionFailures?.get(root)
    if (priorFailure) return priorFailure
    const existing = metadata.metaOf(root, operationContext)
    // Only an exact-receiver check or authority discovery needs a prepared root.
    if (!policy.receiverIdentity && !externalMutationTreeSetup && existing &&
        (existing.placementsInitialized || !metadata.isTraversableType(existing.type)))
        return root // The receiving placement or lease restores inactive relationships.

    // Pending segments share failed inspections without retaining their sources.
    inspectionFailures ??= new WeakMap()
    let failure
    let resultErrors = policy.methodResult ? failures?.errors ?? new Set() : undefined
    const admissions = new Map()
    const containers = new Map()
    const registrations = externalMutationTreeSetup ? new Map() : undefined
    let value
    try {
        value = walk(root)
        const tree = !failure && externalMutationTreeSetup
            ? inspect(() => prepareExternalMutationTree(
                value,
                externalMutationTreeSetup.mutationAccessTree,
                operationContext,
                factsOf,
                registrations,
                identity => {
                    // Native availability is checked first by discovery. Reuse
                    // classification, including failure, at its existing turn.
                    const facts = inspectionFailures.get(identity) ??
                        metadata.inspectAdmissionMetaFacts(identity, operationContext)
                    if (facts.type === metadata.TYPE.External) admissions.set(identity, facts)
                    return facts
                },
                (owner, key) => {
                    const container = containers.get(owner)
                    if (container?.poison) return undefined
                    if (container) {
                        const placement = container.placements.get(key)?.placement
                        return placement?.present ? { enumerable: true, value: placement.value } : undefined
                    }
                    const version = propertyVersions.getPlacementVersion(owner, key, operationContext)
                    if (version) {
                        if (version.discoveryBlocked || version.present === false || version.pendingPresence ||
                            errorUtils.isPoisonError(version.value) ||
                            languageValues.isPending(version.value, operationContext)) return undefined
                        return { enumerable: true, value: version.value }
                    }
                    return languageProperties.getLanguagePlacementDescriptor(owner, key, operationContext)
                },
            ))
            : undefined
        if (errorUtils.isPoisonError(tree)) failure = tree
        if (failure) return resultErrors
            ? errorUtils.combineErrors(resultErrors) : failure

        commitPreparedInput(admissions, containers, policy, operationContext)
        if (externalMutationTreeSetup) {
            commitExternalLocations(registrations, operationContext)
            externalMutationTreeSetup.tree = tree
        }
        return value
    } finally {
        admissions.clear()
        for (const container of containers.values()) {
            container.discard()
            if (container.state === CONSTRUCTION_STATE.Discarded) for (const staged of container.placements.values()) {
                if (staged.version) staged.version.value = staged.version.recovery = undefined
                staged.placement = staged.inspectionFailures = undefined
            }
            container.placements = undefined
            container.initialEntries = undefined
        }
        containers.clear()
        registrations?.clear()
        // Pending callbacks need their destination, not the staging root or failure.
        value = root = failure = resultErrors = externalMutationTreeSetup = failures = inspectionFailures = undefined
    }

    function inspect(action) {
        const result = errorUtils.catchExternalThrow(
            action,
            operationContext,
            policy.imported ? errorUtils.ERROR_KIND.ImportReflectionFailed : policy.kind,
        )
        if (errorUtils.isPoisonError(result)) {
            resultErrors?.add(result)
        }
        return result
    }

    function factsOf(value) {
        return metadata.metaOf(value, operationContext) ?? admissions.get(value)
    }

    function failedInspection(value, error) {
        inspectionFailures.set(value, error)
        // Keep successful category facts for discovery, but never admit a
        // container whose structural preparation failed.
        const container = containers.get(value)
        if (container) container.poison = error
        return error
    }

    function walk(value) {
        try {
            if (errorUtils.isFatalError(value)) throw value
            if (errorUtils.isPoisonError(value)) {
                value = errorUtils.createPoisonError(value, operationContext, policy.kind)
                resultErrors?.add(value)
            }
            if (!metadata.isObjectLike(value)) return value
            if (!errorUtils.isPoisonError(value) && policy.receiverIdentity?.has(value)) {
                const error = externalCapabilityEscapeError(operationContext)
                failure ??= error
                resultErrors.add(error)
                return error
            }
            const failed = inspectionFailures.get(value)
            if (failed) {
                resultErrors?.add(failed)
                return failed
            }
            if (containers.has(value)) return containers.get(value).poison ?? value
            if (admissions.has(value)) return value
            const existing = metadata.metaOf(value, operationContext)
            if (existing) {
                // A prepared reference keeps its existing producers and policy.
                if (existing.placementsInitialized || !languageValues.isTraversableType(existing.type)) return value
            } else {
                const facts = inspect(() => metadata.inspectAdmissionMetaFacts(value, operationContext))
                if (errorUtils.isPoisonError(facts)) return failedInspection(value, facts)
                admissions.set(value, facts)
                if (!languageValues.isTraversableType(facts.type)) return value
            }

            return prepareManagedContainer(value)
        } finally { value = undefined }
    }

    function prepareManagedContainer(value) {
        const container = new PlacementConstruction(value, operationContext)
        container.placements = new Map()
        containers.set(value, container)
        try {
            const keys = inspect(() => [...languageProperties.enumerableLanguageKeyCandidates(
                value, operationContext, 0, undefined, factsOf(value).type)])
            if (errorUtils.isPoisonError(keys)) return failedInspection(value, keys)
            container.initialEntries = []
            for (const key of keys) {
                if (propertyVersions.getPlacementVersion(value, key, operationContext)) continue
                const placement = inspect(() => propertyVersions.capturePlacement(value, key, operationContext))
                // An unreadable descriptor has no recoverable source capture.
                // Its fixed logical poison masks storage without changing it.
                container.placements.set(key, errorUtils.isPoisonError(placement)
                    ? { version: { value: placement, present: true, position: -1 } }
                    : { placement })
                if (placement.present) container.initialEntries.push([key, placement.value])
            }
            // Capture the source's own facts before descending into cycles.
            if (factsOf(value).type === metadata.TYPE.Array)
            for (const key of Object.keys(metadata.metaOf(value, operationContext)?.placementVersions ?? {})) {
                const descriptor = inspect(() => languageProperties.getLanguagePlacementDescriptor(value, key, operationContext))
                if (errorUtils.isPoisonError(descriptor)) return failedInspection(value, descriptor)
                if (descriptor) container.initialEntries.push([key, descriptor.value])
            }
            for (const [key, staged] of container.placements) {
                if (staged.placement?.present)
                    container.pending = preparePlacement(container, key, staged) || container.pending
            }
            return value
        } finally { value = undefined }
    }

    function preparePlacement(container, key, staged) {
        const { placement } = staged
        const version = staged.version = propertyVersions.createVersionFromPlacement(placement)
        staged.container = container
        staged.inspectionFailures = inspectionFailures
        // Each delivery drops its own captures, independently of pending siblings.
        let delivery = staged
        const publication = continueGraphTransition(placement.value, operationContext, deliver,
            reason => deliver(delivery.container.state === CONSTRUCTION_STATE.Discarded
                ? undefined : errorUtils.createPoisonError(reason, operationContext, errorUtils.ERROR_KIND.OperationInputFailed)))
        return propertyVersions.trackVersionPublication(version, publication, operationContext)

        function deliver(resolved) {
            try {
                const { container, placement, version } = delivery
                if (container.state === CONSTRUCTION_STATE.Discarded) return undefined
                const validated = languageProperties.validatePropertyValue(key, resolved, operationContext) ?? resolved
                if (container.state === CONSTRUCTION_STATE.Staged) version.value = walk(validated)
                else {
                    const prepared = prepareInput(validated, operationContext, policy,
                        undefined, undefined, delivery.inspectionFailures)
                    propertyVersions.commitPromiseVersion(container.owner, key, version,
                        { ...placement, value: prepared, discoveryBlocked: version.discoveryBlocked }, operationContext,
                        !metadata.isImported(container.owner, operationContext))
                }
            } finally { delivery = resolved = undefined }
        }
    }
}

// Every fallible source read and subscription is complete before this boundary.
function commitPreparedInput(admissions, containers, policy, operationContext) {
    for (const [identity, facts] of admissions) {
        if (containers.get(identity)?.poison) continue
        metadata.getOrCreateMeta(identity, operationContext, facts.type, facts.admittedPrototype)
        if (policy.imported) metadata.markImported(identity, operationContext)
    }
    for (const [source, container] of containers) {
        if (container.poison) continue
        for (const [key, { version, placement }] of container.placements)
            if (version && (!placement || version.promiseBacked || version.value !== placement.value)) {
                // All available identities were admitted above. A consumed input
                // thenable was not; remember this without retaining its source or
                // depending on optional storage writeback after settlement.
                version.discoveryBlocked = placement && metadata.isObjectLike(placement.value) &&
                    !metadata.metaOf(placement.value, operationContext)
                propertyVersions.installPlacementVersion(source, key, version, operationContext)
            }
        container.commit(container.initialEntries)
    }
}

export { prepareInput, receiveValue }
