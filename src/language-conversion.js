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
        primitive => invocation.invokeHostFunction(
            stringConcat,
            "",
            [primitive],
            operation.operationContext,
            errorUtils.ERROR_KIND.ConversionThrew,
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
                return errorUtils.toPoison(
                    error,
                    operation.operationContext,
                    errorUtils.ERROR_KIND.ConversionThrew,
                )
            }
        },
    )
}

function toPrimitiveValue(value, ancestry, operation) {
    return operationLifecycle.continueInitial(
        operation,
        value,
        resolved => {
            if (arrayViews.isLogicalArray(resolved, operation.operationContext)) {
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
            const type = languageValues.typeOf(resolved, operation.operationContext)
            if (type === languageValues.TYPE_RECORD) {
                return metadata.requireMeta(
                    resolved,
                    operation.operationContext,
                ).admittedPrototype === null
                    ? conversionError(operation.operationContext)
                    : "[object Object]"
            }
            return type === languageValues.TYPE_MANAGED_CLASS
                ? "[object Object]"
                : conversionError(operation.operationContext)
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

function conversionError(operationContext) {
    return errorUtils.validationError(
        "Cannot convert object to primitive value",
        operationContext,
        errorUtils.ERROR_KIND.ConversionThrew,
    )
}

function joinLogicalArray(
    array,
    separator = ",",
    ancestry = undefined,
    operation,
) {
    ancestry ??= { array, parent: undefined }
    const length = arrayViews.logicalArrayLength(array, operation.operationContext)
    if (length === 0) return ""
    const conversions = new Array(length)
    for (let index = 0; index < length; index++) {
        const key = String(index)
        if (!languageProperties.hasLanguageProperty(
            array,
            key,
            operation.operationContext,
        )) {
            conversions[index] = ""
            continue
        }
        conversions[index] = operationLifecycle.continuePrepared(
            operation,
            propertyVersions.resolvePropertyValueAtKey(
                array,
                key,
                operation.operationContext,
            ),
            value => {
                if (value === undefined || value === null) return ""
                return toStringValue(value, ancestry, operation)
            },
        )
    }
    return operationLifecycle.continuePreparedAll(
        operation,
        conversions,
        values => invocation.invokeHostFunction(
            arrayJoin,
            values,
            [separator],
            operation.operationContext,
        ),
    )
}

export {
    joinLogicalArray,
    toIntegerOrInfinity,
    toNumberValue,
    toStringValue,
}
