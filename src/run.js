import * as arrayInvocation from "./array-invocation.js"
import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as imports from "./import.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import {
    transformProperty,
    walkMutationPath,
} from "./mutations.js"
import {
    walkObservationPath,
} from "./observations.js"
import * as resolution from "./resolution.js"

function run(chain, path, method, mutateArray, ...args) {
    if (typeof method !== "string") {
        return errorUtils.validationError(
            "run requires a string method name",
        )
    }
    if (mutateArray !== true && mutateArray !== false) {
        return errorUtils.validationError(
            "run requires an exact mutateArray Boolean",
        )
    }
    if (method === "constructor") {
        return errorUtils.validationError(
            "Constructors are unsupported",
        )
    }
    if (mutateArray && !arrayInvocation.isArrayMutator(method)) {
        return errorUtils.validationError(
            "Array mutation supports only Array mutators",
        )
    }

    return errorUtils.runFatal(() => mutateArray
        ? runMutation(chain, path, method, args)
        : runObservation(chain, path, method, args))
}

function runObservation(chain, path, method, args) {
    return walkObservationPath(
        chain,
        path,
        (targetValue, present) => {
            if (!present) {
                return errorUtils.validationError(
                    "run receiver path does not exist",
                )
            }
            if (languageValues.isError(targetValue)) return targetValue

            return invokeSelectedMethod(targetValue)
        },
    )

    function finishObservation(leaseValue, operationResult, admitResult) {
        if (!languageValues.isPromise(operationResult)) {
            return admitResult(operationResult)
        }
        if (!languageValues.isTracked(leaseValue)) {
            return resolution.resolveOperationResultOrFatal(
                operationResult,
                admitResult,
            )
        }

        metadata.updateReadLease(leaseValue, 1)
        return resolution.resolveOperationResultOrFatal(
            operationResult,
            value => {
                metadata.updateReadLease(leaseValue, -1)
                return admitResult(value)
            },
            () => metadata.updateReadLease(leaseValue, -1),
        )
    }

    function invokeSelectedMethod(targetValue) {
        const isArray = arrayViews.isLogicalArray(targetValue)
        if (isArray && arrayInvocation.isArrayMutator(method)) {
            return invokeIntrinsicArray(targetValue)
        }

        const tracked = languageValues.isTracked(targetValue)
        if (
            tracked &&
            languageProperties.hasLanguageProperty(targetValue, method)
        ) {
            return errorUtils.validationError(
                `Language property shadows method: ${method}`,
            )
        }

        if (
            !isArray &&
            typeof targetValue !== "string" &&
            !tracked
        ) {
            return errorUtils.validationError(
                "run receiver does not support methods",
            )
        }
        const methodTarget = isArray
            ? arrayViews.backingOf(targetValue)
            : targetValue
        if (isArray) {
            const entry = invocation.findPropertyDescriptor(
                methodTarget,
                method,
            )
            if (languageValues.isError(entry)) return entry
            if (
                entry &&
                (
                    entry.descriptor.value === Array.prototype[method] ||
                    (
                        // Recognize the base Array prototype across realms.
                        Array.isArray(entry.owner) &&
                        languageValues.isPlainObjectPrototype(
                            Object.getPrototypeOf(entry.owner),
                        )
                    )
                )
            ) {
                if (!arrayInvocation.isArrayMethod(method)) {
                    return errorUtils.validationError(
                        `Unsupported Array method: ${method}`,
                    )
                }
                return invokeIntrinsicArray(targetValue)
            }
        }

        let callable
        try {
            callable = methodTarget[method]
        } catch (error) {
            return errorUtils.toPoison(error)
        }
        if (typeof callable !== "function") {
            return errorUtils.validationError(
                `Method is not callable: ${method}`,
            )
        }
        return invokeOrdinaryMethod(targetValue, callable)
    }

    function invokeIntrinsicArray(targetValue) {
        return finishObservation(
            targetValue,
            arrayInvocation.invokeArrayObservationMethod(
                targetValue,
                method,
                args,
            ),
            keepResult,
        )
    }

    function invokeOrdinaryMethod(targetValue, callable) {
        const receiver = arrayViews.requiresArrayMaterialization(targetValue)
            ? arrayRemaps.createArrayFromRemap(
                arrayRemaps.createRemap(targetValue),
                undefined,
                false,
            )
            : targetValue
        const leaseValue = receiver === targetValue
            ? targetValue
            : undefined
        return finishObservation(
            leaseValue,
            invocation.invokeObservationMethodWithExportedArgs(
                callable,
                receiver,
                args,
            ),
            importOrdinaryResult,
        )
    }

    function keepResult(value) {
        return value
    }

    function importOrdinaryResult(value) {
        if (languageValues.isTracked(value)) {
            imports.import(value, "run method result")
        }
        return value
    }
}

function runMutation(chain, path, method, args) {
    let result
    return walkMutationPath(
        chain,
        path,
        target => {
            if (
                target.propertyKind !==
                languageProperties.ORDINARY_PROPERTY
            ) {
                return languageProperties.propertyValidationError(
                    target.receiver,
                    "Array mutation receiver is not an Array",
                )
            }
            result = transformProperty(
                target.parent,
                target.key,
                target.attachmentRoot,
                prepareMutationArguments,
                invokeMutation,
            )
        },
        pathError => pathError ?? result,
    )

    function prepareMutationArguments({ present, rawValue }) {
        if (!present) return undefined
        if (
            !languageValues.isPromise(rawValue) &&
            !arrayViews.isLogicalArray(rawValue)
        ) return undefined
        return arrayInvocation.prepareArrayMethodArguments(method, args)
    }

    function invokeMutation(
        thisValue,
        preparedArguments,
        {
            present,
            mustPreserveValue,
        },
    ) {
        if (!present) {
            const error = errorUtils.validationError(
                "Array mutation receiver path does not exist",
            )
            return { mutatedValue: error, result: error }
        }
        if (languageValues.isError(thisValue)) {
            return { mutatedValue: thisValue, result: thisValue }
        }
        if (!arrayViews.isLogicalArray(thisValue)) {
            const error = errorUtils.validationError(
                "Array mutation receiver is not an Array",
            )
            return { mutatedValue: error, result: error }
        }
        const sourceSurvives = mustPreserveValue ||
            arrayViews.requiresArrayMaterialization(thisValue)

        return arrayInvocation.invokeArrayMutationMethod(
            thisValue,
            method,
            preparedArguments,
            sourceSurvives,
        )
    }
}

export { run }
