import { prepareInputs } from "./input-collection.js"
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
    return operationLifecycle.continueOperation(
        toPrimitiveValue(value, ancestry, operation),
        operation.operationContext,
        primitive => {
            if (errorUtils.isPoisonError(primitive)) return primitive
            return invocation.invokeHostFunction(
                stringConcat,
                "",
                [primitive],
                operation.operationContext,
                errorUtils.ERROR_KIND.ScalarConversionFailed,
            )
        },
        undefined,
        operation,
    )
}

function toNumberValue(value, operation) {
    return operationLifecycle.continueOperation(
        toPrimitiveValue(value, undefined, operation),
        operation.operationContext,
        primitive => {
            if (errorUtils.isPoisonError(primitive)) return primitive

            return errorUtils.runHostBoundary(
                operation.operationContext,
                errorUtils.ERROR_KIND.ScalarConversionFailed,
                () => +primitive,
            )
        },
        undefined,
        operation,
    )
}

function toPrimitiveValue(value, ancestry, operation) {
    return languageValues.consumeValue(
        value,
        operation.operationContext,
        errorUtils.ERROR_KIND.OperationInputFailed,
        resolved => {
            if (errorUtils.isPoisonError(resolved)) return resolved

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
        operation,
    )
}

function toIntegerOrInfinity(value, operation) {
    return operationLifecycle.continueOperation(
        toNumberValue(value, operation),
        operation.operationContext,
        number => {
            if (errorUtils.isPoisonError(number)) return number

            if (Number.isNaN(number) || number === 0) return 0
            if (!Number.isFinite(number)) return number
            return Math.trunc(number)
        },
        undefined,
        operation,
    )
}

function conversionError(operationContext) {
    return errorUtils.validationError(
        "Cannot convert object to primitive value",
        operationContext,
        errorUtils.ERROR_KIND.ScalarConversionFailed,
    )
}

function joinLogicalArray(
    array,
    separator = ",",
    ancestry = undefined,
    operation,
) {
    ancestry ??= { array, parent: undefined }
    const operationContext = operation.operationContext
    const length = errorUtils.catchExternalThrow(
        () => arrayViews.logicalArrayLength(array, operationContext),
        operationContext,
        errorUtils.ERROR_KIND.ScalarConversionFailed,
    )
    if (errorUtils.isPoisonError(length)) return length
    const conversions = new Array(length)
    for (let index = 0; index < length; index++) {
        conversions[index] = errorUtils.catchExternalThrow(
            () => {
                const key = String(index)
                if (
                    !languageProperties.hasLanguageProperty(
                        array,
                        key,
                        operationContext,
                    )
                )
                    return ""
                return operationLifecycle.continueOperation(
                    propertyVersions.resolvePropertyValueAtKey(
                        array,
                        key,
                        operationContext,
                    ),
                    operationContext,
                    value => {
                        if (errorUtils.isPoisonError(value)) return value
                        return value === undefined || value === null
                            ? ""
                            : toStringValue(value, ancestry, operation)
                    },
                    undefined,
                    operation,
                )
            },
            operationContext,
            errorUtils.ERROR_KIND.ScalarConversionFailed,
        )
    }
    return prepareInputs(
        conversions,
        operationContext,
        values =>
            invocation.invokeHostFunction(
                arrayJoin,
                values,
                [separator],
                operationContext,
            ),
        operation,
    )
}

export {
    joinLogicalArray,
    toIntegerOrInfinity,
    toNumberValue,
    toStringValue,
}
