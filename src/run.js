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

            const callable = getOrdinaryMethod(targetValue)
            if (languageValues.isError(callable)) return callable

            const thisValue =
                callable !== undefined &&
                arrayViews.requiresArrayMaterialization(targetValue)
                    ? arrayRemaps.createArrayFromRemap(
                        arrayRemaps.createInitialRemap(targetValue),
                        undefined,
                        false,
                    )
                    : targetValue
            const operationResult = callable === undefined
                ? arrayInvocation.invokeArrayObservationMethod(
                    targetValue,
                    method,
                    args,
                )
                : invocation.invokeObservationMethodWithExportedArgs(
                    callable,
                    thisValue,
                    args,
                )

            return finishObservation(
                thisValue === targetValue ? targetValue : undefined,
                operationResult,
                callable !== undefined,
            )
        },
    )

    function finishObservation(
        leaseValue,
        operationResult,
        importResult,
    ) {
        const admit = value => {
            if (!languageValues.isTracked(value)) return value
            if (importResult) {
                imports.import(value, "run method result")
            }
            return value
        }
        if (!languageValues.isPromise(operationResult)) {
            return admit(operationResult)
        }
        if (!languageValues.isTracked(leaseValue)) {
            return resolution.resolveOperationResultOrFatal(
                operationResult,
                admit,
            )
        }

        metadata.updateReadLease(leaseValue, 1)
        return resolution.resolveOperationResultOrFatal(
            operationResult,
            value => {
                metadata.updateReadLease(leaseValue, -1)
                return admit(value)
            },
            () => metadata.updateReadLease(leaseValue, -1),
        )
    }

    function getOrdinaryMethod(targetValue) {
        const isArray = arrayViews.isLogicalArray(targetValue)
        // Undefined selects controlled intrinsic Array dispatch.
        if (isArray && arrayInvocation.isArrayMutator(method)) return

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
                return
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
        return callable
    }
}

function runMutation(chain, path, method, args) {
    let result
    return walkMutationPath(
        chain,
        path,
        (parent, key, attachmentRoot, virtualLength) => {
            if (virtualLength) {
                result = errorUtils.validationError(
                    "Array mutation receiver is not an Array",
                )
                return
            }
            result = transformProperty(
                parent,
                key,
                attachmentRoot,
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
            attachmentRoot,
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
        const replaceReceiver =
            attachmentRoot !== undefined ||
            metadata.requiresCopyOnWrite(thisValue) ||
            arrayViews.requiresArrayMaterialization(thisValue)

        return arrayInvocation.invokeArrayMutationMethod(
            thisValue,
            method,
            preparedArguments,
            replaceReceiver,
        )
    }
}

export { run }
