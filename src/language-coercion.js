import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as helpers from "./helpers.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as propertyCaptures from "./property-capture.js"
import * as resolution from "./resolution.js"

const stringConcat = String.prototype.concat

function toStringValue(value, ancestry = undefined) {
    return resolution.continueOperationUnlessPoison(
        resolvePrimitive(value, ancestry),
        primitive => helpers.invokeDataFunctionOrPoison(
            stringConcat,
            "",
            [primitive],
        ),
    )
}

function toNumberValue(value) {
    return resolution.continueOperationUnlessPoison(
        resolvePrimitive(value),
        primitive => {
            try {
                return +primitive
            } catch (error) {
                return errorUtils.toPoison(error)
            }
        },
    )
}

function resolvePrimitive(value, ancestry) {
    return resolution.continueInitialValueUnlessPoison(
        value,
        resolved => {
            if (arrayViews.isLogicalArray(resolved)) {
                for (let current = ancestry; current; current = current.parent) {
                    if (current.array === resolved) return ""
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
            return !languageValues.isTracked(resolved) ||
                Object.getPrototypeOf(resolved) === null
                ? conversionError()
                : "[object Object]"
        },
    )
}

function toIntegerOrInfinity(value) {
    return resolution.continueOperationUnlessPoison(
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
    const length = arrayViews.logicalArrayLength(array)
    if (length === 0) return ""
    const conversions = new Array(length)
    for (let index = 0; index < length; index++) {
        const key = String(index)
        if (!languageProperties.hasLanguageProperty(array, key)) {
            conversions[index] = ""
            continue
        }
        conversions[index] =
            resolution.continueOperationUnlessPoison(
            propertyCaptures.resolveAt(array, key),
            value => {
                if (value === undefined || value === null) return ""
                return toStringValue(value, ancestry)
            },
        )
    }
    return resolution.continueOperationsUnlessPoison(
        conversions,
        values => helpers.invokeDataFunctionOrPoison(
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
