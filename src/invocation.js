import * as errorUtils from "./error.js"
import * as imports from "./import.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import { exportArgument } from "./observations.js"
import * as resolution from "./resolution.js"

function invokeDataFunction(callable, thisValue, args) {
    return errorUtils.runUserCode(
        () => Reflect.apply(callable, thisValue, args),
    )
}

function findPropertyDescriptor(object, key) {
    // Walking a host prototype chain can invoke Proxy reflection traps.
    let owner = object
    while (owner !== null) {
        const descriptor = errorUtils.runUserCode(
            () => Object.getOwnPropertyDescriptor(owner, key),
        )
        if (descriptor) return { descriptor, owner }
        owner = errorUtils.runUserCode(
            () => Object.getPrototypeOf(owner),
        )
    }
    return undefined
}

function prepareHostArguments(args, retainSource) {
    return resolution.continuePreparedValuesUnlessPoison(
        args.map(value => exportArgument(value, retainSource)),
        values => values,
    )
}

function getHostCallDescription(
    methodTarget,
    method,
    thisValue,
    leaseReceiver,
) {
    const callable = errorUtils.runUserCode(
        () => methodTarget[method],
    )
    if (languageValues.isError(callable)) return callable
    if (typeof callable !== "function") {
        return errorUtils.validationError(
            `Method is not callable: ${method}`,
        )
    }
    return {
        admitResult: value => imports.import(value, "run method result"),
        invoke: args => invokeDataFunction(callable, thisValue, args),
        leaseReceiver,
        prepareArguments: prepareHostArguments,
    }
}

// Selection supplies category behavior; this owns the shared call transition
// and its input and receiver leases.
function invokeCall(method, mutation, args, select, reachReceiver) {
    const inputLeases = new Map()
    let inputsReleased = false
    let receiverReached = false
    let result
    try {
        result = reachReceiver(invokeReceiver)
    } catch (error) {
        releaseInputs()
        throw error
    }

    if (!languageValues.isPromise(result)) {
        releaseInputs()
        return result
    }
    if (!receiverReached) {
        for (const value of args) retainInput(value)
    }
    if (!inputsReleased) {
        resolution.observeResultPromise(
            result,
            releaseInputs,
            releaseInputs,
        )
    }
    return result

    function invokeReceiver(receiver, present, context) {
        receiverReached = true
        const selected = errorUtils.catchUserCodeFailure(
            () => select(receiver, method, mutation, present, context),
            failure => failure,
        )
        const selectionError = languageValues.isError(selected)
            ? selected
            : undefined
        const preparedArguments = selectionError
            ? resolution.continuePreparedValuesUnlessPoison(
                [
                    selectionError,
                    ...args.map(value => exportArgument(value, retainInput)),
                ],
                () => undefined,
            )
            : selected.prepareArguments(args, retainInput)
        const releaseReceiver = metadata.acquireReadLease(
            selectionError ? undefined : selected.leaseReceiver,
        )
        if (languageValues.isPromise(preparedArguments)) {
            resolution.observeResultPromise(
                preparedArguments,
                () => {},
                releaseReceiver,
            )
        }

        return resolution.continueInternalPromiseOrFatal(
            preparedArguments,
            invokePrepared,
        )

        function invokePrepared(readyArguments) {
            let pendingHostResult = false
            try {
                if (languageValues.isError(readyArguments)) {
                    return readyArguments
                }

                const callResult = selected.invoke(readyArguments)
                if (!selected.admitResult) return callResult
                if (!languageValues.isPromise(callResult)) {
                    return selected.admitResult(callResult)
                }
                const observed = resolution.observeResultPromise(
                    callResult,
                    value => {
                        try {
                            selected.admitResult(value)
                        } finally {
                            releaseReceiver()
                        }
                    },
                    releaseReceiver,
                )
                pendingHostResult = true
                return observed
            } finally {
                releaseInputs()
                if (!pendingHostResult) releaseReceiver()
            }
        }
    }

    function retainInput(value) {
        if (inputsReleased) return value
        languageValues.admitValue(value)
        if (
            languageValues.isTraversable(value) &&
            !inputLeases.has(value)
        ) {
            inputLeases.set(value, metadata.acquireReadLease(value))
        }
        return value
    }

    function releaseInputs() {
        if (inputsReleased) return
        inputsReleased = true
        for (const release of inputLeases.values()) release()
        inputLeases.clear()
    }
}

export {
    findPropertyDescriptor,
    getHostCallDescription,
    invokeCall,
    invokeDataFunction,
}
