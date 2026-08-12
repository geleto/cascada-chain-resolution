import * as errorUtils from "./error.js"
import * as propertyVersions from "./property-versions.js"
import * as resolution from "./resolution.js"

function importValue(value, errorContext) {
    return errorUtils.runFatal(() => {
        if (!errorContext) {
            throw new Error("import requires an error context")
        }
        return resolution.resolveInitialValueOrPoison(value, resolvedValue => {
            propertyVersions.prepareImportedRoot(
                resolvedValue,
                { errorContext },
            )
            return resolvedValue
        })
    })
}

export { importValue as import }
