import * as errorUtils from "./error.js"
import { ExternalMutationTree } from "./external-mutation-tree.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

function prepareImportedData(root, importBoundary, installPromise, externalTreeSetup) {
    if (!metadata.isObjectLike(root)) return root

    const shareGraph = importBoundary.shareGraph === true
    const admitted = new Map()
    const retained = new Set()
    const promises = []
    let preparedTree
    const failure = errorUtils.catchUserCodeFailure(
        () => {
            const failure = walk(root)
            if (failure) return failure
            if (externalTreeSetup) {
                preparedTree = ExternalMutationTree.prepare(
                    root,
                    factsOf,
                    externalTreeSetup.scopeMutationPaths,
                    externalTreeSetup.propertyMutationPaths,
                )
            }
            return undefined
        },
        error => error,
    )
    if (failure) {
        languageValues.admitReadyValue(failure)
        return failure
    }

    for (const [value, facts] of admitted) {
        metadata.getOrCreateMeta(
            value,
            facts.type,
            facts.admittedPrototype,
        )
        metadata.markImported(value, importBoundary)
    }
    for (const value of retained) metadata.markShared(value)
    for (const { owner, key, promise } of promises) {
        installPromise(owner, key, promise, importBoundary)
    }
    if (externalTreeSetup) {
        externalTreeSetup.externalMutationTree = preparedTree?.commit(
            externalTreeSetup.execution,
        )
    }
    return root

    // Tree discovery repeats the occurrence walk before commit, so it must
    // see both existing metadata and admissions staged by this import.
    function factsOf(value) {
        return metadata.metaOf(value) ?? admitted.get(value)
    }

    function walk(value) {
        if (!metadata.isObjectLike(value)) return undefined
        if (languageValues.isPromise(value)) {
            return errorUtils.validationError(
                "A Promise must occupy a captured import boundary",
                importBoundary.errorContext,
            )
        }
        if (admitted.has(value) || retained.has(value)) return undefined

        const existing = metadata.metaOf(value)
        if (existing) {
            retained.add(value)
            if (
                !shareGraph ||
                !languageValues.isTraversableType(existing.type)
            ) return undefined
        } else {
            const facts = metadata.inspectMetaFacts(value)
            admitted.set(value, facts)
            if (!languageValues.isTraversableType(facts.type)) return undefined
        }

        for (const key of languageProperties.enumerableLanguageKeys(value)) {
            const descriptor = languageProperties
                .getLanguagePlacementDescriptor(value, key)
            if (!descriptor) continue
            const child = descriptor.value
            if (languageValues.isPromise(child)) {
                promises.push({ owner: value, key, promise: child })
                continue
            }
            const childFailure = walk(child)
            if (childFailure) return childFailure
        }
        return undefined
    }
}

export { prepareImportedData }
