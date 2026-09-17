import { continueOperation } from "./internal-step.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import * as errorUtils from "./error.js"
import { commitExternalLocations, prepareExternalMutationTree } from "./external-mutation-tree.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import { capabilityError } from "./external-operation.js"
import { logicalArrayLength } from "./array-view.js"

function prepareImportedData(
    root,
    operationContext,
    importPolicy,
    externalMutationTreeSetup,
    failures,
) {
    if (errorUtils.isFatalError(root)) throw root
    if (Error.isError(root))
        return errorUtils.createPoisonError(
            root,
            operationContext,
            importPolicy.kind,
        )
    if (!metadata.isObjectLike(root)) return root

    let state = "staging"
    let failure
    let resultErrors = importPolicy.externalResult ? failures?.errors ?? new Set() : undefined
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
        if (failure) return resultErrors
            ? errorUtils.combineErrors(resultErrors, "Method result admission failed") : failure

        for (const [identity, facts] of admissions) {
            metadata.getOrCreateMeta(identity, operationContext, facts.type, facts.admittedPrototype)
            metadata.markImported(identity, operationContext)
        }
        for (const identity of retentions) metadata.markShared(identity, operationContext)
        for (const [source, container] of containers) {
            const { target, placements } = container
            if (target !== source) {
                const { type, admittedPrototype } = metadata.requireMeta(source, operationContext)
                metadata.getOrCreateMeta(target, operationContext, type, admittedPrototype)
                metadata.markShared(target, operationContext)
            }
            for (const [key, { version, original }] of placements) {
                version.value = containers.get(version.value)?.target ?? version.value
                if (target !== source && version.recovery)
                    propertyVersions.retainPlacement(version.recovery, operationContext)
                if (target !== source && version.present !== false) Object.defineProperty(target, key, {
                    value: version.value, enumerable: true, writable: true, configurable: true,
                })
                if (version.promiseBacked || (target !== source && version.recovery) || (target === source && version.value !== original))
                    propertyVersions.installPlacementVersion(target, key, version, operationContext)
            }
        }
        if (externalMutationTreeSetup) {
            commitExternalLocations(registrations, operationContext)
            externalMutationTreeSetup.tree = tree
        }
        state = "committed"
        return containers.get(value)?.target ?? value
    } finally {
        if (state === "staging") state = "abandoned"
        admissions.clear()
        retentions.clear()
        for (const container of containers.values()) {
            container.placements.clear()
            container.parents = undefined
        }
        containers.clear()
        registrations?.clear()
        resultErrors = externalMutationTreeSetup = failures = undefined
    }

    function inspect(action) {
        const result = errorUtils.catchExternalThrow(
            action,
            operationContext,
            errorUtils.ERROR_KIND.ImportReflectionFailed,
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

    function readPlacement(owner, key) {
        let placement = propertyVersions.capturePlacement(owner, key, operationContext)
        if (!placement.present) return undefined
        // Consume borrowed placements through their source first. This also
        // admits lazy children, so their placements remain borrowed at any depth.
        // Raw Errors may have just been produced by native receiver mutation;
        // the result boundary, rather than an ordinary read, attributes them.
        if (!placement.sourceVersion && importPolicy.externalResult && metadata.metaOf(owner, operationContext) &&
            metadata.isObjectLike(placement.value) && !Error.isError(placement.value)) {
            languageProperties.readLanguageProperty(owner, key, operationContext)
            placement = propertyVersions.capturePlacement(owner, key, operationContext)
        }
        return placement
    }

    // Result-specific validation can change a borrowed pending placement. Copy
    // that container and its borrowed ancestors; unchanged branches stay shared.
    // Parent links also propagate the copy through aliases and ready cycles.
    function copyContainer(source) {
        const container = containers.get(source)
        if (container.target !== source) return
        const { type, admittedPrototype } = metadata.requireMeta(source, operationContext)
        container.target = type === metadata.TYPE.Array
            ? new Array(logicalArrayLength(source, operationContext)) : Object.create(admittedPrototype)
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
                importPolicy.kind,
            )
            resultErrors?.add(value)
        }
        if (!metadata.isObjectLike(value)) return value
        if (importPolicy.externalResult && !Error.isError(value) &&
            (value === importPolicy.receiver || operationContext.execution._externalIdentities.has(value))) {
            const error = capabilityError(operationContext)
            failure ??= error
            resultErrors.add(error)
            failures?.capabilityErrors?.add(error)
            return error
        }
        if (retentions.has(value)) return value
        const existing = metadata.metaOf(value, operationContext)
        if (admissions.has(value)) {
            // A fresh result alias can precede the borrowed branch that owns it.
            // Adopt that branch's captures before committing result versions.
            if (existing) {
                admissions.delete(value)
                retentions.add(value)
                for (const [key, staged] of containers.get(value)?.placements ?? []) {
                    const source = inspect(() => readPlacement(value, key))
                    if (errorUtils.isPoisonError(source) || !source) continue
                    staged.sourceVersion = source.sourceVersion
                    if (languageValues.isPending(source.value, operationContext)) copyContainer(value)
                    else if (metadata.isObjectLike(source.value) && !Error.isError(source.value))
                        connectChild(value, walk(source.value))
                }
            }
            return value
        }
        if (existing) {
            retentions.add(value)
            if (!importPolicy.externalResult ||
                !languageValues.isTraversableType(existing.type)) return value
        } else {
            const facts = importPolicy.externalRoot && value === root && typeof value !== "function" && !Error.isError(value)
                ? { type: metadata.TYPE.External }
                : metadata.inspectAdmissionMetaFacts(value, operationContext)
            admissions.set(value, facts)
            if (!languageValues.isTraversableType(facts.type)) return value
        }

        prepareManagedContainer(value)
        return value
    }

    function prepareManagedContainer(value) {
        const container = { target: value, placements: new Map() }
        containers.set(value, container)
        inspect(() => {
            for (const key of languageProperties.enumerableLanguageKeyCandidates(value, operationContext)) {
                const placement = resultErrors ? inspect(() => readPlacement(value, key)) : readPlacement(value, key)
                if (errorUtils.isPoisonError(placement)) continue
                if (!placement) continue
                const child = placement.value
                const borrowed = retentions.has(value) && importPolicy.externalResult && languageValues.isPending(child, operationContext)
                const sourceVersion = borrowed ? placement.sourceVersion : undefined
                const version = { value: child, present: placement.present, recovery: placement.recovery,
                    pendingPresence: sourceVersion?.pendingPresence }
                const staged = { version, original: child, sourceVersion }
                container.placements.set(key, staged)
                if (borrowed) copyContainer(value)
                if (sourceVersion?.transition) {
                    // Publication fixes presence before data settles. Project it
                    // onto this result's version so repair and copies still use
                    // result validation, never the source's unchecked value.
                    const transition = version.transition = {}
                    transition.promise = propertyVersions.resolvePlacementTransition(placement, operationContext, published => {
                        if (state === "abandoned") return undefined
                        staged.sourceVersion = published.sourceVersion
                        version.present = published.present
                        version.recovery = published.recovery
                        subscribe(published.value)
                        delete version.pendingPresence
                        delete version.transition
                        transition.placement = { value: version.value, present: version.present,
                            recovery: version.recovery, sourceVersion: version }
                    })
                    if (languageValues.isPending(transition.promise, operationContext)) {
                        version.promiseBacked = true
                        version.publication ??= transition.promise
                        markPromiseHandled(transition.promise, operationContext)
                    }
                } else subscribe(child)
                if (!version.promiseBacked && !resultErrors && version.value === child) container.placements.delete(key)
                if (failure && !resultErrors) break

                // Read the source's normalized version after its own settlement.
                // Only the result copy applies this call's additional restrictions.
                function subscribe(value) {
                    const publication = continueOperation(value, operationContext, deliver, reason => {
                        if (state === "abandoned") return undefined
                        return deliver(staged.sourceVersion ? reason :
                            errorUtils.createPoisonError(reason, operationContext, importPolicy.kind))
                    })
                    if (languageValues.isPending(publication, operationContext)) {
                        version.promiseBacked = true
                        version.publication = publication
                        markPromiseHandled(publication, operationContext)
                    }
                }

                function deliver(resolved) {
                    if (state === "abandoned") return undefined
                    const sourceVersion = staged.sourceVersion
                    if (sourceVersion) {
                        if (languageValues.isPending(sourceVersion.value, operationContext))
                            return propertyVersions.continueCapturedPromiseVersion(
                                sourceVersion.value, sourceVersion, operationContext, deliver)
                        resolved = sourceVersion.value
                        version.present = sourceVersion.present
                        version.recovery = sourceVersion.recovery
                        delete version.pendingPresence
                    }
                    if (state === "staging") {
                        version.value = walk(resolved)
                        connectChild(value, version.value)
                    } else {
                        const imported = prepareImportedData(resolved, operationContext, importPolicy)
                        if (version.recovery) propertyVersions.retainPlacement(version.recovery, operationContext)
                        propertyVersions.commitPromiseVersion(container.target, key, version, imported,
                            operationContext, container.target !== value)
                        delete version.publication
                    }
                }
            }
        })
    }
}

export { prepareImportedData }
