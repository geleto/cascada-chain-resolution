import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"

function importValue(value, errorContext) {
    return importData(value, errorContext, false)
}

// Unlike ordinary import, revisit and share admitted managed descendants.
function importManagedMutationResult(value, errorContext) {
    return importData(value, errorContext, true)
}

function importContext(value, errorContext, externalTreeSetup) {
    return importData(value, errorContext, false, externalTreeSetup)
}

function importData(value, errorContext, shareGraph, externalTreeSetup = undefined) {
    return errorUtils.runFatal(() => {
        if (!errorContext) {
            throw new Error("import requires an error context")
        }
        if (!metadata.isObjectLike(value)) return value
        const importBoundary = { errorContext }
        if (shareGraph) importBoundary.shareGraph = true
        if (!languageValues.isPromise(value)) {
            return propertyVersions.prepareImportedValue(
                value,
                importBoundary,
                externalTreeSetup,
            )
        }
        return languageValues.continuePromise(
            value,
            resolvedValue => errorUtils.runFatal(
                () => propertyVersions.prepareImportedValue(
                    resolvedValue,
                    importBoundary,
                ),
            ),
            reason => {
                throw reason
            },
        )
    })
}

export {
    importContext,
    importManagedMutationResult,
    importValue as import,
}
