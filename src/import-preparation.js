import * as errorUtils from "./error.js"
import { ExternalMutationTree } from "./external-mutation-tree.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

function prepareImportedData(
    root,
    operationContext,
    importBoundary,
    installPromise,
    externalMutationTreeSetup,
) {
    if (!metadata.isObjectLike(root)) return root

    const shareAdmittedGraph = importBoundary.shareAdmittedGraph === true
    const stagedAdmissions = new Map()
    const stagedRetentions = new Set()
    const promisePlacements = []
    let preparedExternalMutationTree
    const failure = errorUtils.catchUserCodeFailure(
        () => {
            const failure = walk(root)
            if (failure) return failure
            if (externalMutationTreeSetup) {
                preparedExternalMutationTree = ExternalMutationTree.prepare(
                    root,
                    operationContext,
                    factsOf,
                    externalMutationTreeSetup.scopeMutationPaths,
                    externalMutationTreeSetup.propertyMutationPaths,
                )
            }
            return undefined
        },
        error => error,
    )
    if (failure) {
        languageValues.admitReadyValue(failure, operationContext)
        return failure
    }

    for (const [value, facts] of stagedAdmissions) {
        metadata.getOrCreateMeta(
            value,
            operationContext,
            facts.type,
            facts.admittedPrototype,
        )
        metadata.markImported(value, importBoundary, operationContext)
    }
    for (const value of stagedRetentions) {
        metadata.markShared(value, operationContext)
    }
    for (const { owner, key, promise } of promisePlacements) {
        installPromise(owner, key, promise, importBoundary)
    }
    if (externalMutationTreeSetup) {
        externalMutationTreeSetup.externalMutationTree =
            preparedExternalMutationTree?.commit(operationContext)
    }
    return root

    // Tree discovery repeats the occurrence walk before commit, so it must
    // see both existing metadata and admissions staged by this import.
    function factsOf(value) {
        return metadata.metaOf(value, operationContext) ?? stagedAdmissions.get(value)
    }

    function walk(value) {
        if (!metadata.isObjectLike(value)) return undefined
        if (languageValues.isPromise(value, operationContext)) {
            return errorUtils.validationError(
                "A Promise must occupy a captured import boundary",
                importBoundary.errorContext,
            )
        }
        if (stagedAdmissions.has(value) || stagedRetentions.has(value)) return undefined

        const existing = metadata.metaOf(value, operationContext)
        if (existing) {
            stagedRetentions.add(value)
            if (
                !shareAdmittedGraph ||
                !languageValues.isTraversableType(existing.type)
            ) return undefined
        } else {
            const facts = metadata.inspectMetaFacts(value)
            stagedAdmissions.set(value, facts)
            if (!languageValues.isTraversableType(facts.type)) return undefined
        }

        for (const key of languageProperties.enumerableLanguageKeys(
            value,
            operationContext,
        )) {
            const descriptor = languageProperties
                .getLanguagePlacementDescriptor(value, key, operationContext)
            if (!descriptor) continue
            const child = descriptor.value
            if (languageValues.isPromise(child, operationContext)) {
                promisePlacements.push({ owner: value, key, promise: child })
                continue
            }
            const childFailure = walk(child)
            if (childFailure) return childFailure
        }
        return undefined
    }
}

export { prepareImportedData }
