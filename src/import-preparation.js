import { continueOperation } from "./internal-step.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import * as errorUtils from "./error.js"
import { commitExternalLocations, prepareExternalMutationTree } from "./external-mutation-tree.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"

function prepareImportedData(
    root,
    operationContext,
    importPolicy,
    externalMutationTreeSetup,
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
    const admissions = new Map()
    const retentions = new Set()
    const versions = new Map()
    const registrations = externalMutationTreeSetup ? new Map() : undefined
    try {
        const value = walk(root)
        const tree = !failure && externalMutationTreeSetup
            ? inspect(() => prepareExternalMutationTree(
                value,
                externalMutationTreeSetup.mutationAccessTree,
                externalMutationTreeSetup.context,
                operationContext,
                factsOf,
                registrations,
            ))
            : undefined
        if (failure) return failure

        for (const [identity, facts] of admissions) {
            metadata.getOrCreateMeta(identity, operationContext, facts.type, facts.admittedPrototype)
            metadata.markImported(identity, operationContext)
        }
        for (const identity of retentions) metadata.markShared(identity, operationContext)
        for (const [owner, placements] of versions) {
            for (const [key, version] of placements) {
                propertyVersions.installPlacementVersion(owner, key, version, operationContext)
            }
        }
        if (externalMutationTreeSetup) {
            commitExternalLocations(registrations, operationContext)
            externalMutationTreeSetup.tree = tree
        }
        state = "committed"
        return value
    } finally {
        if (state === "staging") state = "abandoned"
        admissions.clear()
        retentions.clear()
        versions.clear()
        registrations?.clear()
        externalMutationTreeSetup = undefined
    }

    function inspect(action) {
        const result = errorUtils.catchExternalThrow(
            action,
            operationContext,
            errorUtils.ERROR_KIND.ImportReflectionFailed,
        )
        if (errorUtils.isPoisonError(result)) failure = result
        return result
    }

    function factsOf(value) {
        return metadata.metaOf(value, operationContext) ?? admissions.get(value)
    }

    function readPlacement(owner, key) {
        const descriptor = languageProperties.getLanguagePlacementDescriptor(owner, key, operationContext)
        if (!descriptor) return undefined
        const version = versions.get(owner)?.get(key) ??
            metadata.metaOf(owner, operationContext)?.placementVersions?.[key]
        return version ? { ...descriptor, value: version.value } : descriptor
    }

    function walk(value) {
        if (errorUtils.isFatalError(value)) throw value
        if (Error.isError(value))
            value = errorUtils.createPoisonError(
                value,
                operationContext,
                importPolicy.kind,
            )
        if (!metadata.isObjectLike(value)) return value
        if (admissions.has(value) || retentions.has(value)) return value
        const existing = metadata.metaOf(value, operationContext)
        if (existing) {
            retentions.add(value)
            if (!importPolicy.retainAdmittedDescendants || !languageValues.isTraversableType(existing.type)) return value
        } else {
            const facts = metadata.inspectAdmissionMetaFacts(value, operationContext)
            admissions.set(value, facts)
            if (!languageValues.isTraversableType(facts.type)) return value
        }

        inspect(() => {
            for (const key of languageProperties.enumerableLanguageKeys(value, operationContext)) {
                const descriptor = readPlacement(value, key)
                if (!descriptor) continue
                const child = descriptor.value
                const version = { value: child }
                let placements = versions.get(value)
                if (!placements) versions.set(value, placements = new Map())
                placements.set(key, version)
                const publication = continueOperation(
                    child,
                    operationContext,
                    deliver,
                    reason => {
                        if (state === "abandoned") return undefined
                        return deliver(
                            errorUtils.createPoisonError(
                                reason,
                                operationContext,
                                importPolicy.kind,
                            ),
                        )
                    },
                )
                if (languageValues.isPending(publication, operationContext)) {
                    version.promiseBacked = true
                    markPromiseHandled(publication, operationContext)
                } else if (version.value === child) placements.delete(key)
                if (failure) break

                function deliver(resolved) {
                    if (state === "abandoned") return undefined
                    if (state === "staging") {
                        version.value = walk(resolved)
                    } else {
                        const imported = prepareImportedData(resolved, operationContext, importPolicy)
                        propertyVersions.commitPromiseVersion(value, key, version, imported, operationContext, false)
                    }
                }
            }
        })
        return value
    }
}

export { prepareImportedData }
