import "./init.js"
import * as arrayInvocation from "./array-invocation.js"
import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as helpers from "./helpers.js"
import * as imports from "./import.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import {
    transformProperty,
    walkMutationPath,
} from "./mutations.js"
import {
    exportArgument,
    walkObservationPath,
} from "./observations.js"
import * as resolution from "./resolution.js"
import * as refcounts from "./refcounts.js"

const STANDARD_STRING_METHODS = new Map(
    Object.getOwnPropertyNames(String.prototype)
        .map(method => [method, String.prototype[method]])
        .filter(([, callable]) => typeof callable === "function"),
)

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

    return helpers.runFatal(() => mutateArray
        ? runMutation(chain, path, method, args)
        : runObservation(chain, path, method, args))
}

function runObservation(chain, path, method, args) {
    return walkObservationPath(
        chain,
        path,
        (targetValue, importBoundary, present) => {
            if (!present) {
                return errorUtils.validationError(
                    "run receiver path does not exist",
                )
            }
            if (languageValues.isError(targetValue)) return targetValue

            const callable = getOrdinaryMethod(targetValue)
            if (languageValues.isError(callable)) return callable
            const argumentError = args.find(languageValues.isError)
            if (argumentError) return argumentError

            const thisValue =
                callable !== undefined &&
                arrayViews.requiresArrayMaterialization(targetValue)
                    ? arrayRemaps.createArrayFromRemap(
                        arrayRemaps.createInitialRemap(targetValue),
                        targetValue,
                    )
                    : targetValue

            const operationResult = callable === undefined
                ? arrayInvocation.invokeArrayObservationMethod(
                    targetValue,
                    method,
                    args,
                    importBoundary,
                )
                : invokeOrdinaryMethod(thisValue, callable)

            return finishObservation(
                thisValue === targetValue ? targetValue : undefined,
                operationResult,
                callable !== undefined &&
                    (
                        typeof targetValue !== "string" ||
                        STANDARD_STRING_METHODS.get(method) !== callable
                    ),
            )
        },
    )

    function invokeOrdinaryMethod(thisValue, callable) {
        return resolution.continueOperationsUnlessPoison(
            args.map(exportArgument),
            preparedArgs => resolution.resolveInitialValueOrPoison(
                helpers.invokeDataFunctionOrPoison(
                    callable,
                    thisValue,
                    preparedArgs,
                ),
            ),
        )
    }

    function finishObservation(
        leaseValue,
        operationResult,
        importNativeCallResult,
    ) {
        const admit = value => {
            if (!languageValues.isTracked(value)) return value
            if (importNativeCallResult) {
                imports.import(value, "run method result")
            }
            refcounts.buildRefIndex(value)
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
            !tracked &&
            typeof targetValue !== "function"
        ) {
            return errorUtils.validationError(
                "run receiver does not support methods",
            )
        }
        const methodTarget = isArray
            ? arrayViews.backingOf(targetValue)
            : targetValue
        if (isArray) {
            const entry = helpers.findPropertyDescriptor(methodTarget, method)
            if (languageValues.isError(entry)) return entry
            if (
                entry &&
                (
                    entry.descriptor.value === Array.prototype[method] ||
                    (
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
        (parent, key, importBoundary, attachmentPath) => {
            result = transformProperty(
                parent,
                key,
                importBoundary,
                attachmentPath,
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
            importBoundary,
            attachmentPath,
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
            attachmentPath !== undefined ||
            metadata.requiresCopyOnWrite(thisValue) ||
            arrayViews.requiresArrayMaterialization(thisValue)

        return arrayInvocation.invokeArrayMutationMethod(
            thisValue,
            method,
            preparedArguments,
            importBoundary,
            replaceReceiver,
        )
    }
}

export { run }
