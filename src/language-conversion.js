import { captureArrayLength } from "./array-length.js"
import { finishContainerCopy } from "./placement-structure.js"
import * as internalSteps from "./internal-step.js"
import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"

const stringConcat = String.prototype.concat
const arrayJoin = Array.prototype.join

function toStringValue(value, ancestry, operation) {
    return internalSteps.continueOperation(
        toPrimitiveValue(value, ancestry, operation),
        operation.operationContext,
        primitive => {
            if (errorUtils.isPoisonError(primitive)) return primitive
            return invocation.invokeFunction(
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
    return internalSteps.continueOperation(
        toPrimitiveValue(value, undefined, operation),
        operation.operationContext,
        primitive => {
            if (errorUtils.isPoisonError(primitive)) return primitive

            return errorUtils.runExternalBoundary(
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
    return internalSteps.consumeValue(
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
            if (type === languageValues.TYPE.Record) {
                return metadata.requireMeta(
                    resolved,
                    operation.operationContext,
                ).admittedPrototype === null
                    ? conversionError(operation.operationContext)
                    : "[object Object]"
            }
            return type === languageValues.TYPE.ManagedClass
                ? "[object Object]"
                : conversionError(operation.operationContext)
        },
        operation,
    )
}

function toIntegerOrInfinity(value, operation) {
    return internalSteps.continueOperation(
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

function joinLogicalArray(array, separator = ",", ancestry = undefined, operation) {
    ancestry ??= { array, parent: undefined }
    const operationContext = operation.operationContext
    const shape = errorUtils.catchExternalThrow(
        () => ({ length: captureArrayLength(array, operationContext, operation) }),
        operationContext, errorUtils.ERROR_KIND.ScalarConversionFailed)
    if (errorUtils.isPoisonError(shape)) return shape
    const keys = [], conversions = []
    errorUtils.catchExternalThrow(() => {
        for (const key of languageProperties.enumerableLanguageKeyCandidates(array, operationContext)) {
            const conversion = errorUtils.catchExternalThrow(() => {
                const placement = propertyVersions.getPropertyPlacement(array, key, operationContext)
                if (!placement) return undefined
                return internalSteps.continueOperation(placement.resolveValue(), operationContext, value => {
                    if (errorUtils.isPoisonError(value)) return value
                    return value === undefined || value === null ? "" : toStringValue(value, ancestry, operation)
                }, undefined, operation)
            }, operationContext, errorUtils.ERROR_KIND.ScalarConversionFailed)
            keys.push(key)
            conversions.push(conversion)
        }
    }, operationContext, errorUtils.ERROR_KIND.ScalarConversionFailed, failure => conversions.push(failure))
    return internalSteps.prepareInputs(conversions, operationContext, values => {
        const joined = []
        for (let index = 0; index < keys.length; index++) joined[keys[index]] = values[index]
        finishContainerCopy(joined, shape)
        return invocation.invokeFunction(arrayJoin, joined, [separator], operationContext)
    }, operation)
}

export {
    joinLogicalArray,
    toIntegerOrInfinity,
    toNumberValue,
    toStringValue,
}
