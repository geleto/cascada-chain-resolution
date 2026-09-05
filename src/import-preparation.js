import * as errorUtils from "./error.js"
import { ExternalMutationTree } from "./external-mutation-tree.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import * as resolution from "./resolution.js"

function prepareImportedData(root, operationContext, importPolicy, externalMutationTreeSetup) {
    if (errorUtils.isFatalError(root)) throw root
    if (Error.isError(root)) return errorUtils.toPoison(root, operationContext, importPolicy.valueKind)
    if (!metadata.isObjectLike(root)) return root

    let state = "staging"
    let failure
    const admissions = new Map()
    const retentions = new Set()
    const versions = new Map()
    try {
        const value = walk(root)
        const tree = !failure && externalMutationTreeSetup
            ? inspect(() => ExternalMutationTree.prepare(
                value,
                operationContext,
                factsOf,
                readPlacement,
                externalMutationTreeSetup.scopeMutationPaths,
                externalMutationTreeSetup.propertyMutationPaths,
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
            externalMutationTreeSetup.externalMutationTree = tree?.commit(operationContext)
        }
        state = "committed"
        return value
    } finally {
        if (state === "staging") state = "abandoned"
        admissions.clear()
        retentions.clear()
        versions.clear()
    }

    function inspect(action) {
        return errorUtils.catchUserCodeFailure(
            action, operationContext, errorUtils.ERROR_KIND.ImportThrew,
            error => { failure = error },
        )
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
        if (Error.isError(value)) value = errorUtils.toPoison(value, operationContext, importPolicy.valueKind)
        if (!metadata.isObjectLike(value)) return value
        if (admissions.has(value) || retentions.has(value)) return value
        const existing = metadata.metaOf(value, operationContext)
        if (existing) {
            retentions.add(value)
            if (!importPolicy.shareAdmittedGraph || !languageValues.isTraversableType(existing.type)) return value
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
                const publication = languageValues.consumeValue(
                    child,
                    operationContext,
                    resolved => errorUtils.runOrFailExecution(operationContext, () => deliver(resolved)),
                    reason => errorUtils.runOrFailExecution(operationContext, () => {
                        if (state === "abandoned") return undefined
                        return deliver(errorUtils.toPoison(reason, operationContext, importPolicy.rejectionKind))
                    }),
                )
                if (languageValues.isPending(publication, operationContext)) {
                    version.promise = true
                    resolution.markPromiseHandled(publication)
                } else if (version.value === child) placements.delete(key)
                if (failure) break

                function deliver(resolved) {
                    if (state === "abandoned") return undefined
                    if (state === "staging") {
                        version.value = walk(resolved)
                    } else {
                        const imported = prepareImportedData(resolved, operationContext, importPolicy)
                        propertyVersions.commitPromiseValue(value, key, version, imported, operationContext, false)
                    }
                }
            }
        })
        return value
    }
}

export { prepareImportedData }
