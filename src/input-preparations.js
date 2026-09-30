import { isLogicalArray } from "./array-view.js"
import { continueOperation } from "./internal-step.js"
import * as errorUtils from "./error.js"
import { commitExternalLocations, prepareExternalMutationTree } from "./external-mutation-tree.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import { createEmptyContainer, defineCopyProperty, prepareContainerStructureCopy } from "./placement-structure.js"
import { PlacementConstruction } from "./parent-placements.js"

// Ordinary reception shares input preparation with import, but keeps runtime
// ownership and attributes both input and inspection failures to the receiver.
function receiveValue(value, operationContext, kind, onValue = value => value, owner) {
    const deliver = ready => {
        languageValues.admitReadyValue(ready, operationContext)
        return onValue(ready)
    }
    return continueOperation(value, operationContext,
        ready => deliver(prepareInput(ready, operationContext, { kind })),
        reason => deliver(errorUtils.createPoisonError(reason, operationContext, kind)), owner)
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
        (existing.placementsInitialized || !metadata.isTraversableType(existing.type))) {
        if (policy.imported) metadata.markShared(root, operationContext)
        return root
    }

    let failure
    let resultErrors = policy.methodResult ? failures?.errors ?? new Set() : undefined
    const admissions = new Map()
    const retentions = new Set()
    const containers = new Map()
    const registrations = externalMutationTreeSetup ? new Map() : undefined
    try {
        const value = walk(root)
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
        // Later subscriptions may complete an earlier container's initialization.
        // Reconcile its source authority before fixing any copy shapes or edges.
        // Adoption only inspects captures; it starts no new value consumption.
        if (!failure) for (const container of containers.values()) reconcileInitialization(container)
        if (!failure) for (const [source, container] of containers) {
            if (container.target !== source) container.commitStructure = inspect(() =>
                prepareContainerStructureCopy(source, container.target, operationContext))
            else if (container.initializing && container.state === "staged")
                container.initialEntries = inspect(() => captureInitialEntries(source, container))
        }
        if (failure) return resultErrors
            ? errorUtils.combineErrors(resultErrors, "Method result admission failed") : failure

        commitPreparedInput(admissions, retentions, containers, policy, operationContext)
        if (externalMutationTreeSetup) {
            commitExternalLocations(registrations, operationContext)
            externalMutationTreeSetup.tree = tree
        }
        return containers.get(value)?.target ?? value
    } finally {
        admissions.clear()
        retentions.clear()
        for (const container of containers.values()) {
            container.discard()
            container.target = undefined
            container.placements = undefined
            container.parents = undefined
            container.commitStructure = undefined
            container.initialEntries = undefined
        }
        containers.clear()
        registrations?.clear()
        // Pending callbacks need their destination, not the staging root or failure.
        root = failure = resultErrors = externalMutationTreeSetup = failures = undefined
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
        // Capture that storage after subscriptions, before publishing this batch.
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
        if (admissions.has(value)) {
            const container = containers.get(value)
            if (container) reconcileInitialization(container)
            return value
        }
        if (existing) {
            retentions.add(value)
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
        inspect(() => {
            for (const key of languageProperties.enumerableLanguageKeyCandidates(
                value, operationContext, 0, undefined, factsOf(value).type)) {
                if (!reconcileInitialization(container)) break
                const placement = resultErrors
                    ? inspect(() => propertyVersions.capturePlacement(value, key, operationContext))
                    : propertyVersions.capturePlacement(value, key, operationContext)
                if (!reconcileInitialization(container)) break
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
                        if (!reconcileInitialization(container)) return undefined
                        staged.placement = published
                        subscribe()
                        delete version.pendingPresence
                        delete version.transition
                        transition.placement = propertyVersions.capturePlacementFromVersion(version)
                    })
                    propertyVersions.trackVersionPublication(version, transition.promise, operationContext)
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
                    const publication = continueOperation(staged.placement.value, operationContext, deliver, reason => {
                        if (!reconcileInitialization(container)) return undefined
                        return deliver(staged.placement.sourceVersion ? reason :
                            errorUtils.createPoisonError(reason, operationContext, policy.kind))
                    })
                    propertyVersions.trackVersionPublication(version, publication, operationContext)
                }

                function deliver(resolved) {
                    if (!reconcileInitialization(container)) return undefined
                    const source = staged.placement.sourceVersion
                    return source
                        ? propertyVersions.resolvePlacement(propertyVersions.capturePlacementFromVersion(source), operationContext, publish)
                        : publish({ ...staged.placement, value: resolved })
                }

                function publish(placement) {
                    if (!reconcileInitialization(container)) return undefined
                    const validated = languageProperties.validatePropertyValue(key, placement.value, operationContext)
                        ?? placement.value
                    if (container.state === "staged") {
                        const child = walk(validated)
                        if (!reconcileInitialization(container)) return undefined
                        version.value = child
                        version.present = placement.present
                        version.recovery = placement.recovery
                        version.position = placement.position
                        delete version.pendingPresence
                        delete version.publication
                        connectChild(container.owner, version.value)
                    } else {
                        const prepared = prepareInput(validated, operationContext, policy)
                        if (placement.recovery) propertyVersions.retainPlacement(placement.recovery, operationContext)
                        propertyVersions.commitPromiseVersion(container.owner, key, version,
                            { ...placement, value: prepared },
                            operationContext, !metadata.isImported(container.owner, operationContext))
                    }
                }
            }
        })
        value = undefined
    }

    function reconcileInitialization(container) {
        if (container.state === "discarded") return false
        if (container.state === "staged" && container.initializing &&
            metadata.metaOf(container.owner, operationContext)?.placementsInitialized) {
            // Completion supersedes initialization, never this boundary's
            // independent result validation or an adopted copy's construction.
            if (policy.methodResult) {
                container.initializing = false
                adoptCapturedSources(container.owner)
                return true
            }
            admissions.delete(container.owner)
            retentions.add(container.owner)
            // A superseded initializer can never redirect aliases to a shell.
            container.target = container.owner
            container.discard()
            return false
        }
        return true
    }

    function adoptCapturedSources(value) {
        admissions.delete(value)
        retentions.add(value)
        for (const [key, staged] of containers.get(value)?.placements ?? []) {
            const source = inspect(() => propertyVersions.capturePlacement(value, key, operationContext))
            if (errorUtils.isPoisonError(source)) continue
            staged.placement.sourceVersion ??= source.sourceVersion
            // The existing subscription owns discovery and result validation.
            // Keep unfinished or independently validated outcomes in a copy;
            // even ready Error attribution may differ from the source's outcome.
            const version = staged.version
            if (languageValues.isPending(source.value, operationContext) ||
                languageValues.isPending(version.value, operationContext) ||
                !Object.is(source.value, version.value) || source.present !== version.present ||
                source.recovery !== version.recovery || source.position !== version.position) copyContainer(value)
            connectChild(value, version.value)
        }
    }
}

// Every fallible source read and subscription is complete before this boundary.
function commitPreparedInput(admissions, retentions, containers, policy, operationContext) {
    for (const [identity, facts] of admissions) {
        metadata.getOrCreateMeta(identity, operationContext, facts.type, facts.admittedPrototype)
        if (policy.imported) metadata.markImported(identity, operationContext)
    }
    if (policy.imported) for (const identity of retentions) metadata.markShared(identity, operationContext)
    // Admit all copy shells before publishing any cyclic/aliased edges.
    for (const [source, container] of containers) {
        if (container.state === "discarded" || container.target === source) continue
        const { type, admittedPrototype } = metadata.requireMeta(source, operationContext)
        metadata.getOrCreateMeta(container.target, operationContext, type, admittedPrototype)
    }
    for (const [source, container] of containers) {
        if (container.state === "discarded") continue
        const { target, placements } = container
        if (target !== source) {
            container.commitStructure()
            metadata.markShared(target, operationContext)
        }
        for (const [key, { version, original }] of placements) {
            version.value = containers.get(version.value)?.target ?? version.value
            if (target !== source && version.recovery)
                propertyVersions.retainPlacement(version.recovery, operationContext)
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
            container.owner = target
            container.commit(container.initialEntries)
        } else container.finish("published")
    }
}

export { prepareInput, receiveValue }
