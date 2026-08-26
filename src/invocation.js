import * as errorUtils from "./error.js"
import { exportManyValues } from "./export.js"
import * as imports from "./import.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
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
        prepareInputs: exportManyValues,
    }
}

// Selection supplies category behavior; this owns the shared call transition
// and its argument and receiver leases.
function invokeCall(method, mutation, args, select, reachReceiver) {
    const selectionArgumentLeases = createLeaseLedger()
    const callArgumentLeases = createLeaseLedger()
    const receiverLeases = createLeaseLedger()
    let receiverReached = false
    let result
    try {
        result = reachReceiver(invokeReceiver)
    } catch (error) {
        closeLeases()
        throw error
    }

    if (!languageValues.isPromise(result)) {
        closeLeases()
        return result
    }
    if (!receiverReached) {
        for (const value of args) selectionArgumentLeases.retain(value)
    }
    resolution.observeResultPromise(result, closeLeases)
    return result

    function invokeReceiver(receiver, present, context) {
        receiverReached = true
        let selected
        let preparedInputs
        try {
            selected = errorUtils.catchUserCodeFailure(
                () => select(receiver, method, mutation, present, context),
                failure => failure,
            )
            const selectionError = languageValues.isError(selected)
                ? selected
                : undefined
            preparedInputs = selectionError
                ? exportManyValues([selectionError, ...args])
                : selected.prepareInputs(
                    args,
                    callArgumentLeases.retain,
                    receiverLeases.retain,
                    receiverLeases.release,
                )
            if (!selectionError) {
                receiverLeases.retain(selected.leaseReceiver)
            }
        } finally {
            selectionArgumentLeases.release()
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

                const admittedResult = selected.admitResult(callResult)
                if (languageValues.isPromise(admittedResult)) {
                    pendingHostResult = true
                }
                return admittedResult
            } finally {
                callArgumentLeases.release()
                if (!pendingHostResult) receiverLeases.release()
            }
        }
    }

    function closeLeases() {
        selectionArgumentLeases.release()
        callArgumentLeases.release()
        receiverLeases.release()
    }
}

function createLeaseLedger() {
    const values = new Set()
    let closed = false
    return { retain, release }

    function retain(value) {
        if (closed || values.has(value)) return value
        languageValues.admitValue(value)
        if (
            !languageValues.isPromise(value) &&
            metadata.incrementReadLease(value)
        ) values.add(value)
        return value
    }

    function release() {
        if (closed) return
        closed = true
        for (const value of values) metadata.decrementReadLease(value)
        values.clear()
    }
}

export {
    findPropertyDescriptor,
    getHostCallDescription,
    invokeCall,
    invokeDataFunction,
}
