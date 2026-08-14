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
        prepareInputs: prepareHostArguments,
    }
}

// Selection supplies category behavior; this owns the shared call transition
// and its input and receiver leases.
function invokeCall(method, mutation, args, select, reachReceiver) {
    const argumentLeaseValues = []
    const receiverLeaseValues = []
    const releaseArgumentLeases = () => releaseLeases(argumentLeaseValues)
    const releaseReceiverLeases = () => releaseLeases(receiverLeaseValues)
    let receiverReached = false
    let result
    try {
        result = reachReceiver(invokeReceiver)
    } catch (error) {
        releaseArgumentLeases()
        releaseReceiverLeases()
        throw error
    }

    if (!languageValues.isPromise(result)) {
        releaseArgumentLeases()
        releaseReceiverLeases()
        return result
    }
    if (!receiverReached) {
        for (const value of args) retainInput(value)
    }
    if (argumentLeaseValues.length > 0) {
        resolution.observeResultPromise(
            result,
            releaseArgumentLeases,
            releaseArgumentLeases,
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
        // Every category receives input retention. Categories that prepare a
        // receiver graph may also use its retention and early-release hooks.
        const preparedInputs = selectionError
            ? resolution.continuePreparedValuesUnlessPoison(
                [
                    selectionError,
                    ...args.map(value => exportArgument(value, retainInput)),
                ],
                () => undefined,
            )
            : selected.prepareInputs(
                args,
                retainInput,
                retainReceiver,
                releaseReceiverLeases,
            )
        if (!selectionError) retainReceiver(selected.leaseReceiver)
        if (languageValues.isPromise(preparedInputs)) {
            resolution.observeResultPromise(
                preparedInputs,
                () => {},
                releaseReceiverLeases,
            )
        }

        return resolution.continueInternalPromiseOrFatal(
            preparedInputs,
            invokePrepared,
        )

        function invokePrepared(readyInputs) {
            let pendingHostResult = false
            try {
                if (languageValues.isError(readyInputs)) {
                    return readyInputs
                }

                const callResult = selected.invoke(readyInputs)
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
                            releaseReceiverLeases()
                        }
                    },
                    releaseReceiverLeases,
                )
                pendingHostResult = true
                return observed
            } finally {
                releaseArgumentLeases()
                if (!pendingHostResult) releaseReceiverLeases()
            }
        }
    }

    function retainInput(value) {
        return retain(value, argumentLeaseValues, languageValues.isTraversable)
    }

    function retainReceiver(value) {
        return retain(value, receiverLeaseValues, metadata.isObjectLike)
    }

    function retain(value, leases, shouldLease) {
        languageValues.admitValue(value)
        if (shouldLease(value)) {
            metadata.incrementReadLease(value)
            leases.push(value)
        }
        return value
    }

    function releaseLeases(leases) {
        while (leases.length > 0) {
            metadata.decrementReadLease(leases.pop())
        }
    }
}

export {
    findPropertyDescriptor,
    getHostCallDescription,
    invokeCall,
    invokeDataFunction,
}
