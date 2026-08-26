import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

function prepareImportedData(root, importBoundary, installPromise) {
    if (!metadata.isObjectLike(root)) return root

    const admitted = new Map()
    const retained = new Set()
    const promises = []
    const failure = errorUtils.catchUserCodeFailure(
        () => walk(root),
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
    return root

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
            return undefined
        }

        const facts = metadata.inspectMetaFacts(value)
        admitted.set(value, facts)
        if (!languageValues.isTraversableType(facts.type)) return undefined

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
