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

function importContext(value, operationContext, externalMutationTreeSetup) {
    return importData(value, operationContext, false, externalMutationTreeSetup)
}

function importData(
    value,
    operationContext,
    shareAdmittedGraph,
    externalMutationTreeSetup = undefined,
) {
    return errorUtils.runFatal(operationContext, () => {
        if (!metadata.isObjectLike(value)) return value
        const importBoundary = { errorContext: operationContext.errorContext }
        if (shareAdmittedGraph) importBoundary.shareAdmittedGraph = true
        if (!languageValues.isPromise(value, operationContext)) {
            return propertyVersions.prepareImportedValue(
                value,
                operationContext,
                importBoundary,
                externalMutationTreeSetup,
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
