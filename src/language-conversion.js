import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as propertyVersions from "./property-versions.js"
import * as resolution from "./resolution.js"

const stringConcat = String.prototype.concat

function toStringValue(value, ancestry = undefined) {
    return resolution.continuePreparedValueUnlessPoison(
        toPrimitiveValue(value, ancestry),
        primitive => invocation.invokeDataFunction(
            stringConcat,
            "",
            [primitive],
        ),
    )
}

function toNumberValue(value) {
    return resolution.continuePreparedValueUnlessPoison(
        toPrimitiveValue(value),
        primitive => {
            try {
                return +primitive
            } catch (error) {
                return errorUtils.toPoison(error)
            }
        },
    )
}

function toPrimitiveValue(value, ancestry) {
    return resolution.continueInitialValueUnlessPoison(
        value,
        resolved => {
            if (arrayViews.isLogicalArray(resolved)) {
                if (arrayViews.hasArrayAncestor(ancestry, resolved)) {
                    return ""
                }
                return joinLogicalArray(
                    resolved,
                    ",",
                    { array: resolved, parent: ancestry },
                )
            }
            if (
                resolved === null ||
                (
                    typeof resolved !== "object" &&
                    typeof resolved !== "function"
                )
            ) return resolved
            if (!languageValues.isTracked(resolved)) return conversionError()
            const prototype = errorUtils.runUserCode(
                () => Object.getPrototypeOf(resolved),
            )
            return prototype === null ? conversionError() : "[object Object]"
        },
    )
}

function toIntegerOrInfinity(value) {
    return resolution.continuePreparedValueUnlessPoison(
        toNumberValue(value),
        number => {
            if (Number.isNaN(number) || number === 0) return 0
            if (!Number.isFinite(number)) return number
            return Math.trunc(number)
        },
    )
}

function conversionError() {
    return errorUtils.validationError(
        "Cannot convert object to primitive value",
    )
}

function joinLogicalArray(
    array,
    separator = ",",
    ancestry = undefined,
) {
    ancestry ??= { array, parent: undefined }
    const length = arrayViews.logicalArrayLength(array)
    if (length === 0) return ""
    const conversions = new Array(length)
    for (let index = 0; index < length; index++) {
        const key = String(index)
        if (!languageProperties.hasLanguageProperty(array, key)) {
            conversions[index] = ""
            continue
        }
        conversions[index] = resolution.continuePreparedValueUnlessPoison(
            propertyVersions.resolvePropertyValueAtKey(array, key),
            value => {
                if (value === undefined || value === null) return ""
                return toStringValue(value, ancestry)
            },
        )
    }
    return resolution.continuePreparedValuesUnlessPoison(
        conversions,
        values => invocation.invokeDataFunction(
            Array.prototype.join,
            values,
            [separator],
        ),
    )
}

export {
    joinLogicalArray,
    toIntegerOrInfinity,
    toNumberValue,
    toStringValue,
}
