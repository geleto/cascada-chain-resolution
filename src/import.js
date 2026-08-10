import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as propertyVersions from "./property-versions.js"
import * as resolution from "./resolution.js"

function importValue(value, errorContext) {
    return errorUtils.runFatal(() => {
        if (!errorContext) {
            throw new Error("import requires an error context")
        }
        return resolution.resolveInitialValueOrPoison(value, resolvedValue => {
            if (!languageValues.isTracked(resolvedValue)) return resolvedValue

            propertyVersions.prepareImportedRoot(
                resolvedValue,
                { errorContext },
            )
            return resolvedValue
        })
    })
}

export { importValue as import }
