import { captureIdentity } from "./captured-identity.js"
import { ArrayView, isLogicalArray, hasArrayAncestor } from "./array-view.js"
import { finishContainerCopy } from "./placement-structure.js"
import * as internalSteps from "./internal-step.js"
import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"

const stringConcat = String.prototype.concat
const arrayJoin = Array.prototype.join

function toStringValue(value, ancestry, operation) {
    return internalSteps.continueGraphTransition(
        toPrimitiveValue(value, ancestry, operation),
        operation.operationContext,
        primitive => {
            if (errorUtils.isPoisonError(primitive)) return primitive
            if (typeof primitive === "symbol")
                return conversionError(operation.operationContext, "Cannot convert a Symbol value to a string")
            // Logical conversion leaves only primitives; no host coercion remains.
            return Reflect.apply(stringConcat, "", [primitive])
        },
        undefined,
        operation,
    )
}

function toNumberValue(value, operation) {
    return internalSteps.continueGraphTransition(
        toPrimitiveValue(value, undefined, operation),
        operation.operationContext,
        primitive => {
            if (errorUtils.isPoisonError(primitive)) return primitive

            if (typeof primitive === "symbol" || typeof primitive === "bigint")
                return conversionError(operation.operationContext, `Cannot convert ${typeof primitive} to a number`)
            return +primitive
        },
        undefined,
        operation,
    )
}

function toPrimitiveValue(value, ancestry, operation) {
    // Call inputs and selected graph values have already crossed reception.
    // Their internal availability cannot introduce another recoverable rejection.
    return internalSteps.continueGraphTransition(
        value,
        operation.operationContext,
        resolved => {
            if (errorUtils.isPoisonError(resolved)) return resolved

            if (isLogicalArray(resolved, operation.operationContext)) {
                if (hasArrayAncestor(ancestry, resolved, operation.operationContext)) {
                    return ""
                }
                return joinLogicalArray(
                    resolved,
                    ",",
                    { identity: captureIdentity(resolved, operation.operationContext), parent: ancestry },
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
        undefined,
        operation,
    )
}

function toIntegerOrInfinity(value, operation) {
    return internalSteps.continueGraphTransition(
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

function conversionError(operationContext, message = "Cannot convert object to primitive value") {
    return errorUtils.validationError(
        message,
        operationContext,
        errorUtils.ERROR_KIND.ScalarConversionFailed,
    )
}

function joinLogicalArray(array, separator = ",", ancestry = undefined, operation) {
    ancestry ??= { identity: captureIdentity(array, operation.operationContext), parent: undefined }
    const operationContext = operation.operationContext
    const shape = errorUtils.catchExternalThrow(
        () => ({ length: ArrayView.captureLength(array, operationContext, operation) }),
        operationContext, errorUtils.ERROR_KIND.ScalarConversionFailed)
    if (errorUtils.isPoisonError(shape)) return shape
    const keys = [], conversions = []
    errorUtils.catchExternalThrow(() => {
        for (const key of languageProperties.enumerableLanguageKeyCandidates(array, operationContext)) {
            const conversion = errorUtils.catchExternalThrow(() => {
                const placement = propertyVersions.getPropertyPlacement(array, key, operationContext)
                if (!placement) return undefined
                return internalSteps.continueGraphTransition(placement.resolveValue(), operationContext, value => {
                    if (errorUtils.isPoisonError(value)) return value
                    return value === undefined || value === null ? "" : toStringValue(value, ancestry, operation)
                }, undefined, operation)
            }, operationContext, errorUtils.ERROR_KIND.ScalarConversionFailed)
            keys.push(key)
            conversions.push(conversion)
        }
    }, operationContext, errorUtils.ERROR_KIND.ScalarConversionFailed, failure => conversions.push(failure))
    array = undefined
    return internalSteps.prepareInputs(conversions, operationContext, values => {
        const joined = []
        finishContainerCopy(joined, shape)
        for (let index = 0; index < keys.length; index++) {
            const key = keys[index]
            if (Number(key) >= joined.length) continue
            const value = values[index]
            joined[key] = value
        }
        // Entries and separator are converted strings; no host code remains.
        // No standard API exposes the engine's string-size limit. The native
        // join's only expected exception here is a string-size RangeError.
        let failure
        try {
            return Reflect.apply(arrayJoin, joined, [separator])
        } catch (reason) {
            failure = reason
        }
        if (!(failure instanceof RangeError)) throw failure
        return errorUtils.createPoisonError(failure, operationContext, errorUtils.ERROR_KIND.ScalarConversionFailed)
    }, operation)
}

export {
    joinLogicalArray,
    toIntegerOrInfinity,
    toNumberValue,
    toStringValue,
}
