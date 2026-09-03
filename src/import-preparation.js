import * as errorUtils from "./error.js"
import { ExternalMutationTree } from "./external-mutation-tree.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

function prepareImportedData(
    root,
    operationContext,
    importPolicy,
    installPromise,
    installFixedVersion,
    externalMutationTreeSetup,
) {
    if (!metadata.isObjectLike(root)) return root

    const shareAdmittedGraph = importPolicy.shareAdmittedGraph === true
    const stagedAdmissions = new Map()
    const stagedRetentions = new Set()
    const promisePlacements = []
    const fixedVersions = []
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
        operationContext,
        errorUtils.ERROR_KIND.ImportThrew,
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
        metadata.markImported(value, operationContext)
    }
    for (const value of stagedRetentions) {
        metadata.markShared(value, operationContext)
    }
    for (const { owner, key, promise } of promisePlacements) {
        installPromise(owner, key, promise, importPolicy)
    }
    for (const { owner, key, value } of fixedVersions) {
        installFixedVersion(owner, key, value)
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

    function walk(value, owner = undefined, key = undefined) {
        if (!metadata.isObjectLike(value)) return undefined
        if (errorUtils.isFatalError(value)) throw value
        const isError = languageValues.isError(value)
        if (isError && !(value instanceof errorUtils.PoisonError)) {
            fixedVersions.push({
                owner,
                key,
                value: errorUtils.toPoison(
                    value,
                    operationContext,
                    importPolicy.valueKind,
                ),
            })
            return undefined
        }
        if (languageValues.isPromise(value, operationContext)) {
            return errorUtils.validationError(
                "A Promise must occupy a captured import boundary",
                operationContext,
                errorUtils.ERROR_KIND.InvalidImportValue,
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
        if (isError) return undefined

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
            const childFailure = walk(child, value, key)
            if (childFailure) return childFailure
        }
        return undefined
    }
}

export { prepareImportedData }
