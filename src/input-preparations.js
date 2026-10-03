import { createLeaseLedger } from "./ownership.js"
import { isLogicalArray } from "./array-view.js"
import { continueGraphTransition } from "./internal-step.js"
import * as errorUtils from "./error.js"
import { commitExternalLocations, prepareExternalMutationTree } from "./external-mutation-tree.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import { createEmptyContainer, defineCopyProperty, prepareContainerStructureCopy } from "./placement-structure.js"
import { CONSTRUCTION_STATE, PlacementConstruction } from "./parent-placements.js"

// One inward transition consumes availability, prepares the delivered input,
// and captures it before later work can change its ownership.
function receiveValue(value, operationContext, policy, onValue = value => value, owner, externalMutationTreeSetup) {
    const accept = root => {
        const prepared = prepareInput(root, operationContext, policy,
            // Context discovery applies only to the supplied, ready root.
            root === value ? externalMutationTreeSetup : undefined)
        languageValues.admitReadyValue(prepared, operationContext)
        return onValue(prepared)
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
) {
    if (errorUtils.isFatalError(root)) throw root
    if (Error.isError(root))
        return errorUtils.createPoisonError(
            root,
            operationContext,
            policy.kind,
        )
    if (!metadata.isObjectLike(root)) return root
    const existing = metadata.metaOf(root, operationContext)
    if (!policy.methodResult && !externalMutationTreeSetup && existing &&
        (existing.placementsInitialized || !metadata.isTraversableType(existing.type)))
        return root // The receiving placement or lease restores inactive relationships.

    const leases = createLeaseLedger(operationContext)
    let failure
    let resultErrors = policy.methodResult ? failures?.errors ?? new Set() : undefined
    const admissions = new Map()
    const retentions = new Set()
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
                    const facts = { type: metadata.TYPE.External }
                    admissions.set(identity, facts)
                    return facts
                },
            ))
            : undefined
        if (!failure) for (const [source, container] of containers) {
            if (container.target !== source) container.commitStructure = inspect(() =>
                prepareContainerStructureCopy(source, container.target, operationContext))
            else if (container.initializing)
                container.initialEntries = inspect(() => captureInitialEntries(source, container))
        }
        if (failure) return resultErrors
            ? errorUtils.combineErrors(resultErrors, "Method result admission failed") : failure

        commitPreparedInput(admissions, containers, policy, operationContext)
        if (externalMutationTreeSetup) {
            commitExternalLocations(registrations, operationContext)
            externalMutationTreeSetup.tree = tree
        }
        return containers.get(value)?.target ?? value
    } finally {
        leases.release()
        admissions.clear()
        retentions.clear()
        for (const container of containers.values()) {
            container.discard()
            if (container.state === CONSTRUCTION_STATE.Discarded) for (const staged of container.placements.values()) {
                staged.version.value = staged.version.recovery = undefined
                staged.original = staged.placement = undefined
            }
            container.target = undefined
            container.placements = undefined
            container.parents = undefined
            container.commitStructure = undefined
            container.initialEntries = undefined
        }
        containers.clear()
        registrations?.clear()
        // Pending callbacks need their destination, not the staging root or failure.
        value = root = failure = resultErrors = externalMutationTreeSetup = failures = undefined
    }

    function inspect(action) {
        const result = errorUtils.catchExternalThrow(
            action,
            operationContext,
            policy.imported ? errorUtils.ERROR_KIND.ImportReflectionFailed : policy.kind,
        )
        if (errorUtils.isPoisonError(result)) {
            failure = result
            resultErrors?.add(result)
        }
        return result
    }

    function factsOf(value) {
        return metadata.metaOf(value, operationContext) ?? admissions.get(value)
    }

    function captureInitialEntries(source, container) {
        const versions = factsOf(source).type === metadata.TYPE.Array
            ? metadata.metaOf(source, operationContext)?.placementVersions : undefined
        const entries = []
        for (const [key, { original }] of container.placements)
            if (!versions?.[key]) entries.push([key, original])
        // A control input may already have overlays. Their logical values say
        // nothing about backing storage, including slots masked as absent.
        // Capture that storage before publishing this batch.
        for (const key of Object.keys(versions ?? {})) {
            const descriptor = languageProperties.getLanguagePlacementDescriptor(source, key, operationContext)
            if (descriptor) entries.push([key, descriptor.value])
        }
        return entries
    }

    // Result-specific validation can change a borrowed pending placement. Copy
    // that container and its borrowed ancestors; unchanged branches stay shared.
    // Parent links also propagate the copy through aliases and ready cycles.
    function copyContainer(source) {
        const container = containers.get(source)
        if (container.target !== source) return
        container.target = createEmptyContainer(source, operationContext)
        for (const parent of container.parents ?? []) {
            if (retentions.has(parent)) copyContainer(parent)
        }
    }

    function connectChild(parent, child) {
        const childContainer = containers.get(child)
        if (!childContainer) return
        (childContainer.parents ??= new Set()).add(parent)
        if (retentions.has(parent) && childContainer.target !== child) copyContainer(parent)
    }

    function walk(value) {
        if (errorUtils.isFatalError(value)) throw value
        if (Error.isError(value)) {
            value = errorUtils.createPoisonError(
                value,
                operationContext,
                policy.kind,
            )
            resultErrors?.add(value)
        }
        if (!metadata.isObjectLike(value)) return value
        if (policy.methodResult && !Error.isError(value) &&
            (value === policy.receiver || operationContext.execution._externalIdentities.has(value))) {
            const error = externalCapabilityEscapeError(operationContext)
            failure ??= error
            resultErrors.add(error)
            failures?.capabilityErrors?.add(error)
            return error
        }
        if (retentions.has(value)) return value
        const existing = metadata.metaOf(value, operationContext)
        if (admissions.has(value)) return value
        if (existing) {
            retentions.add(value)
            leases.acquire(value)
            if ((!policy.methodResult && existing.placementsInitialized) ||
                !languageValues.isTraversableType(existing.type)) return value
        } else {
            const facts = policy.externalRoot && value === root && typeof value !== "function" && !Error.isError(value)
                ? { type: metadata.TYPE.External }
                : metadata.inspectAdmissionMetaFacts(value, operationContext)
            admissions.set(value, facts)
            if (!languageValues.isTraversableType(facts.type)) return value
        }

        prepareManagedContainer(value)
        return value
    }

    function prepareManagedContainer(value) {
        const container = new PlacementConstruction(value, operationContext)
        container.target = value
        container.placements = new Map()
        container.initializing = !metadata.metaOf(value, operationContext)?.placementsInitialized
        containers.set(value, container)
        try { inspect(() => {
            for (const key of languageProperties.enumerableLanguageKeyCandidates(
                value, operationContext, 0, undefined, factsOf(value).type)) {
                const placement = resultErrors
                    ? inspect(() => propertyVersions.capturePlacement(value, key, operationContext))
                    : propertyVersions.capturePlacement(value, key, operationContext)
                if (errorUtils.isPoisonError(placement)) continue
                if (!placement.present) continue
                const child = placement.value
                const borrowed = retentions.has(value) && policy.methodResult && languageValues.isPending(child, operationContext)
                const sourceVersion = placement.sourceVersion
                const version = propertyVersions.createVersionFromPlacement(placement)
                const staged = { version, original: child, placement }
                container.placements.set(key, staged)
                if (borrowed) copyContainer(value)
                if (sourceVersion?.transition) {
                    // Publication fixes presence before data settles. Project it
                    // onto this result's version so repair and copies still use
                    // result validation, never the source's unchecked value.
                    const transition = version.transition = {}
                    transition.promise = propertyVersions.resolvePlacementTransition(placement, operationContext, published => {
                        if (container.state === CONSTRUCTION_STATE.Discarded) return undefined
                        staged.placement = published
                        subscribe()
                        delete version.pendingPresence
                        delete version.transition
                        transition.placement = propertyVersions.capturePlacementFromVersion(version)
                    })
                    const pending = propertyVersions.trackVersionPublication(version, transition.promise, operationContext)
                    container.pending ||= pending
                } else subscribe()
                if (failure && !resultErrors) break

                // Read the source's normalized version after its own settlement.
                // Only the result copy applies this call's additional restrictions.
                function subscribe() {
                    // Presence is fixed at publication even when its data stays
                    // pending. Result validation still owns that later delivery.
                    version.present = staged.placement.present
                    version.recovery = staged.placement.recovery
                    version.position = staged.placement.position
                    const publication = continueGraphTransition(staged.placement.value, operationContext, deliver, reason => {
                        if (container.state === CONSTRUCTION_STATE.Discarded) return undefined
                        return deliver(staged.placement.sourceVersion ? reason :
                            errorUtils.createPoisonError(reason, operationContext, policy.kind))
                    })
                    const pending = propertyVersions.trackVersionPublication(version, publication, operationContext)
                    container.pending ||= pending
                }

                function deliver(resolved) {
                    if (container.state === CONSTRUCTION_STATE.Discarded) return undefined
                    const source = staged.placement.sourceVersion
                    return source
                        ? propertyVersions.resolvePlacement(propertyVersions.capturePlacementFromVersion(source), operationContext, publish)
                        : publish({ ...staged.placement, value: resolved })
                }

                function publish(placement, releaseCapture) {
                    try {
                        if (container.state === CONSTRUCTION_STATE.Discarded) return undefined
                        const validated = languageProperties.validatePropertyValue(key, placement.value, operationContext)
                            ?? placement.value
                        if (container.state === CONSTRUCTION_STATE.Staged) {
                            const child = walk(validated)
                            version.value = child
                            version.present = placement.present
                            version.recovery = placement.recovery
                            version.position = placement.position
                            delete version.pendingPresence
                            delete version.publication
                            connectChild(container.owner, version.value)
                        } else {
                            const prepared = prepareInput(validated, operationContext, policy)
                            propertyVersions.commitPromiseVersion(container.owner, key, version,
                                { ...placement, value: prepared },
                                operationContext, !metadata.isImported(container.owner, operationContext))
                        }
                    } finally { releaseCapture?.() }
                }
            }
        }) } finally { value = undefined }
    }
}

// Every fallible source read and subscription is complete before this boundary.
function commitPreparedInput(admissions, containers, policy, operationContext) {
    for (const [identity, facts] of admissions) {
        metadata.getOrCreateMeta(identity, operationContext, facts.type, facts.admittedPrototype)
        if (policy.imported) metadata.markImported(identity, operationContext)
    }
    // Admit all copy shells before publishing any cyclic/aliased edges.
    for (const [source, container] of containers) {
        if (container.target === source) continue
        const { type, admittedPrototype } = metadata.requireMeta(source, operationContext)
        metadata.getOrCreateMeta(container.target, operationContext, type, admittedPrototype)
        if (metadata.isImported(source, operationContext)) metadata.markImported(container.target, operationContext)
    }
    for (const [source, container] of containers) {
        const { target, placements } = container
        if (target !== source) {
            container.commitStructure()
        }
        for (const [key, { version, original }] of placements) {
            version.value = containers.get(version.value)?.target ?? version.value
            // Record slots preserve key order beneath pending overlays;
            // Array slots would incorrectly commit speculative growth.
            if (target !== source && version.present !== false &&
                (!version.pendingPresence || !isLogicalArray(target, operationContext)))
                defineCopyProperty(target, key, version.value)
            if (version.promiseBacked || (target !== source && version.recovery) || (target === source && version.value !== original))
                propertyVersions.installPlacementVersion(target, key, version, operationContext)
        }
        if (container.initializing || target !== source) {
            // Pending deliveries now belong to the published copy, if any.
            container.initialOwner = target
            container.commit(container.initialEntries)
        } else container.finish(CONSTRUCTION_STATE.Published)
    }
}

export { prepareInput, receiveValue }
