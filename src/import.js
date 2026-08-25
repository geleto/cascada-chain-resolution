import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"

function importValue(value, errorContext) {
    return errorUtils.runFatal(() => {
        if (!errorContext) {
            throw new Error("import requires an error context")
        }
        if (!metadata.isObjectLike(value)) return value
        const importBoundary = { errorContext }
        if (!languageValues.isPromise(value)) {
            return propertyVersions.prepareImportedValue(
                value,
                importBoundary,
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

export { importValue as import }
