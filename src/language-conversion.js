import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"

const stringConcat = String.prototype.concat
const arrayJoin = Array.prototype.join

function toStringValue(value, ancestry, operation) {
    return operationLifecycle.continuePrepared(
        operation,
        toPrimitiveValue(value, ancestry, operation),
        primitive => invocation.invokeDataFunction(
            stringConcat,
            "",
            [primitive],
        ),
    )
}

function toNumberValue(value, operation) {
    return operationLifecycle.continuePrepared(
        operation,
        toPrimitiveValue(value, undefined, operation),
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
    return operationLifecycle.continueInitial(
        operation,
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
}

function toIntegerOrInfinity(value, operation) {
    return operationLifecycle.continuePrepared(
        operation,
        toNumberValue(value, operation),
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
    operation,
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
        conversions[index] = operationLifecycle.continuePrepared(
            operation,
            propertyVersions.resolvePropertyValueAtKey(array, key),
            value => {
                if (value === undefined || value === null) return ""
                return toStringValue(value, ancestry, operation)
            },
        )
    }
    return operationLifecycle.continuePreparedAll(
        operation,
        conversions,
        values => invocation.invokeDataFunction(
            arrayJoin,
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
