import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"

function importValue(value, operationContext) {
    return importData(value, operationContext, false)
}

// Unlike ordinary import, revisit and share admitted managed descendants.
function importManagedMutationResult(value, operationContext) {
    return importData(value, operationContext, true)
}

function importContext(value, operationContext, externalTreeSetup) {
    return importData(value, operationContext, false, externalTreeSetup)
}

function importData(value, operationContext, shareGraph, externalTreeSetup = undefined) {
    return errorUtils.runFatal(operationContext, () => {
        if (!metadata.isObjectLike(value)) return value
        const importBoundary = { errorContext: operationContext.errorContext }
        if (shareGraph) importBoundary.shareGraph = true
        if (!languageValues.isPromise(value, operationContext)) {
            return propertyVersions.prepareImportedValue(
                value,
                operationContext,
                importBoundary,
                externalTreeSetup,
            )
        }
        return languageValues.continuePromise(
            value,
            operationContext,
            resolvedValue => errorUtils.runFatal(
                operationContext,
                () => propertyVersions.prepareImportedValue(
                    resolvedValue,
                    operationContext,
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
