import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import * as resolution from "./resolution.js"

const stringConcat = String.prototype.concat
const arrayJoin = Array.prototype.join

function toStringValue(value, ancestry = undefined, operation = undefined) {
    return continueConversion(
        toPrimitiveValue(value, ancestry, operation),
        operation,
        primitive => invocation.invokeDataFunction(
            stringConcat,
            "",
            [primitive],
        ),
    )
}

function toNumberValue(value, operation = undefined) {
    return continueConversion(
        toPrimitiveValue(value, undefined, operation),
        operation,
        primitive => {
            try {
                return +primitive
            } catch (error) {
                return errorUtils.toPoison(error)
            }
        },
    )
}

function toPrimitiveValue(value, ancestry, operation) {
    const continuation = resolution.continueInitialValueUnlessPoison(
        value,
        resolved => {
            if (operation?.open === false) return undefined
            if (arrayViews.isLogicalArray(resolved)) {
                if (arrayViews.hasArrayAncestor(ancestry, resolved)) {
                    return ""
                }
                return joinLogicalArray(
                    resolved,
                    ",",
                    { array: resolved, parent: ancestry },
                    operation,
                )
            }
            if (
                resolved === null ||
                (
                    typeof resolved !== "object" &&
                    typeof resolved !== "function"
                )
            ) return resolved
            const type = languageValues.typeOf(resolved)
            if (type === languageValues.TYPE_RECORD) {
                return metadata.requireMeta(resolved).admittedPrototype === null
                    ? conversionError()
                    : "[object Object]"
            }
            return type === languageValues.TYPE_MANAGED_CLASS
                ? "[object Object]"
                : conversionError()
        },
    )
    return operation?.watch(continuation) ?? continuation
}

function toIntegerOrInfinity(value, operation = undefined) {
    return continueConversion(
        toNumberValue(value, operation),
        operation,
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
    operation = undefined,
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
        conversions[index] = continueConversion(
            propertyVersions.resolvePropertyValueAtKey(array, key),
            operation,
            value => {
                if (value === undefined || value === null) return ""
                return toStringValue(value, ancestry, operation)
            },
        )
    }
    const continuation = resolution.continuePreparedValuesUnlessPoison(
        conversions,
        values => operation?.open === false
            ? undefined
            : invocation.invokeDataFunction(
                arrayJoin,
                values,
                [separator],
            ),
    )
    return operation?.watch(continuation) ?? continuation
}

function continueConversion(result, operation, onReady) {
    const continuation = resolution.continuePreparedValueUnlessPoison(
        result,
        value => operation?.open === false ? undefined : onReady(value),
    )
    return operation?.watch(continuation) ?? continuation
}

export {
    joinLogicalArray,
    toIntegerOrInfinity,
    toNumberValue,
    toStringValue,
}
