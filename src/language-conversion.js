import { captureIdentity } from "./captured-identity.js"
import { ArrayView, isLogicalArray, hasArrayAncestor } from "./array-view.js"
import * as internalSteps from "./internal-step.js"
import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"
import { captureSequence } from "./array-sequence.js"
import { consumeArrayValue } from "./array-layout.js"

const stringConcat = String.prototype.concat
const arrayJoin = Array.prototype.join

function toStringValue(value, ancestry, operation) {
    return internalSteps.continueGraphTransition(
        toPrimitiveValue(value, ancestry, operation),
        operation.operationContext,
        primitive => {
            if (errorUtils.isPoisonError(primitive)) return primitive
            if (typeof primitive === "symbol")
                return conversionError(operation, "Cannot convert a Symbol value to a string")
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
                return conversionError(operation, `Cannot convert ${typeof primitive} to a number`)
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
                return internalSteps.continueGraphTransition(hasArrayAncestor(ancestry, resolved, operation),
                    operation.operationContext, cycle => {
                        try {
                            return cycle ? "" : joinLogicalArray(resolved, ",",
                                { identity: captureIdentity(resolved, operation.operationContext), parent: ancestry }, operation)
                        } finally { resolved = undefined }
                    }, undefined, operation)
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
                    ? conversionError(operation)
                    : "[object Object]"
            }
            return type === languageValues.TYPE.ManagedClass
                ? "[object Object]"
                : conversionError(operation)
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

function conversionError(operation, message = "Cannot convert object to primitive value", cause) {
    return errorUtils.intrinsicValidationError(operation, errorUtils.ERROR_KIND.ScalarConversionFailed, message, cause)
}

function joinLogicalArray(array, separator = ",", ancestry = undefined, operation) {
    ancestry ??= { identity: captureIdentity(array, operation.operationContext), parent: undefined }
    return consumeArrayValue(array, operation, selected => joinArrayText(selected, separator, ancestry, operation), error => error)
}

function joinArrayText(array, separator, ancestry, operation) {
    const operationContext = operation.operationContext
    if (ArrayView.region(array, operationContext)) {
        const capture = errorUtils.catchExternalThrow(() => captureSequence(array, operationContext),
            operationContext, errorUtils.ERROR_KIND.ScalarConversionFailed)
        array = undefined
        if (errorUtils.isPoisonError(capture)) return capture
        return internalSteps.continueGraphTransition(capture.ready, operationContext,
            node => joinLayout(node, separator, ancestry, operation), undefined, operation)
    }
    const shape = errorUtils.catchExternalThrow(
        () => ({ length: ArrayView.captureLength(array, operationContext, operation) }),
        operationContext, errorUtils.ERROR_KIND.ScalarConversionFailed)
    if (errorUtils.isPoisonError(shape)) return shape
    const keys = []
    let conversions = []
    const converted = value => {
        // Failed text still collects every required Error, but its length can
        // no longer affect the result. Do not retain that success-only question.
        if (errorUtils.isPoisonError(value)) shape.length?.release?.()
        return value
    }
    errorUtils.catchExternalThrow(() => {
        for (const key of languageProperties.enumerableLanguageKeyCandidates(array, operationContext)) {
            const conversion = errorUtils.catchExternalThrow(() => {
                const value = propertyVersions.resolvePropertyValueAtKey(array, key, operationContext)
                return internalSteps.continueGraphTransition(value, operationContext, value => {
                    if (errorUtils.isPoisonError(value)) return value
                    return value === undefined || value === null ? "" : toStringValue(value, ancestry, operation)
                }, undefined, operation)
            }, operationContext, errorUtils.ERROR_KIND.ScalarConversionFailed)
            keys.push(key)
            conversions.push(internalSteps.continueGraphTransition(conversion, operationContext, converted, undefined, operation))
        }
    }, operationContext, errorUtils.ERROR_KIND.ScalarConversionFailed, failure => conversions.push(converted(failure)))
    array = undefined
    const result = internalSteps.prepareInputs(conversions, operationContext, values =>
        internalSteps.continueGraphTransition(shape.length?.read ? shape.length.read() : shape.length,
            operationContext, length => {
                const joined = new Array(length)
                for (let index = 0; index < keys.length; index++) {
                    const key = keys[index]
                    if (Number(key) >= joined.length) continue
                    joined[key] = values[index]
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
                return conversionError(operation, "Invalid string length", failure)
            }, undefined, operation), operation)
    conversions = undefined
    return result
}

function joinLayout(node, separator, ancestry, operation) {
    const ctx = operation.operationContext, leaves = new Map(), inputs = [], seen = new Set()
    function capture(part) {
        if (!part.length || seen.has(part)) return
        seen.add(part)
        if (part.left) { capture(part.left); capture(part.right); return }
        const placement = part.placement
        if (!placement) return
        leaves.set(part, inputs.length)
        inputs.push(propertyVersions.resolveVisiblePlacement(placement, ctx, selected => {
            const value = propertyVersions.placementValue(selected)
            return value == null ? "" : toStringValue(value, ancestry, operation)
        }))
    }
    capture(node)
    return internalSteps.prepareInputs(inputs, ctx, values => {
        const rendered = new Map()
        function render(part) {
            if (!part.length) return ""
            if (rendered.has(part)) return rendered.get(part)
            let text
            if (part.left) text = render(part.left) + separator + render(part.right)
            else {
                text = values[leaves.get(part)] ?? ""
                if (part.length > 1 && (text || separator)) text += (separator + text).repeat(part.length - 1)
            }
            rendered.set(part, text)
            return text
        }
        // Only build success text after all conversions. A native size
        // exception therefore cannot hide a required causal Error.
        try { return render(node) }
        catch (reason) {
            if (!(reason instanceof RangeError)) throw reason
            return conversionError(operation, "Invalid string length", reason)
        }
    }, operation)
}

export {
    joinLogicalArray,
    toIntegerOrInfinity,
    toNumberValue,
    toStringValue,
}
