import * as errorUtils from "./error.js"
import { exportManyValues } from "./export.js"
import * as imports from "./import.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as resolution from "./resolution.js"

class InvocationContext {
    #selectionArgumentLeases = createLeaseLedger()
    #argumentLeases = createLeaseLedger()
    #receiverLeases = createLeaseLedger()
    open = true
    retainArgument = this.#argumentLeases.retain
    retainReceiver = this.#receiverLeases.retain
    releaseArguments = this.#argumentLeases.release
    releaseReceivers = this.#receiverLeases.release

    retainArgumentsUntilReceiver(args) {
        for (const value of args) this.#selectionArgumentLeases.retain(value)
    }

    markReceiverReached() {
        this.#selectionArgumentLeases.release()
    }

    close() {
        if (!this.open) return
        this.open = false
        this.#selectionArgumentLeases.release()
        this.releaseArguments()
        this.releaseReceivers()
    }

    continueInitial(result, onReady) {
        return this.watch(resolution.continueInitialValueUnlessPoison(
            result,
            onReady,
            () => this.open,
        ))
    }

    continueInternal(result, onReady) {
        return this.#continueWhileOpen(
            result,
            onReady,
            resolution.continueInternalPromiseOrFatal,
        )
    }

    continueInternalAll(result, onReady) {
        return this.#continueWhileOpen(
            result,
            onReady,
            resolution.continueInternalPromisesOrFatal,
        )
    }

    continuePrepared(result, onReady) {
        return this.#continueWhileOpen(
            result,
            onReady,
            resolution.continuePreparedValueUnlessPoison,
        )
    }

    continuePreparedAll(result, onReady) {
        return this.#continueWhileOpen(
            result,
            onReady,
            resolution.continuePreparedValuesUnlessPoison,
        )
    }

    watch(result) {
        if (languageValues.isPromise(result)) {
            // Close at the originating async layer, before a fatal rejection
            // reaches aggregates that may still have runnable siblings.
            resolution.observeResultPromise(
                result,
                () => {},
                () => this.close(),
            )
        }
        return result
    }

    #continueWhileOpen(result, onReady, continueResult) {
        return this.watch(continueResult(
            result,
            value => this.open ? onReady(value) : undefined,
        ))
    }
}

function invokeDataFunction(callable, thisValue, args) {
    return errorUtils.runUserCode(
        () => Reflect.apply(callable, thisValue, args),
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
        prepareInputs: exportManyValues,
    }
}

// Selection supplies category behavior; this owns the shared call transition
// and its argument and receiver leases.
function invokeCall(method, mutation, args, select, reachReceiver) {
    const invocation = new InvocationContext()
    let result
    try {
        result = reachReceiver(invokeReceiver)
    } catch (error) {
        invocation.close()
        throw error
    }

    if (!languageValues.isPromise(result)) {
        invocation.close()
        return result
    }
    invocation.retainArgumentsUntilReceiver(args)
    resolution.observeResultPromise(result, () => invocation.close())
    return result

    function invokeReceiver(receiver, present, context) {
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
                : selected.prepareInputs(args, invocation)
            if (!selectionError) {
                invocation.retainReceiver(selected.leaseReceiver)
            }
        } finally {
            invocation.markReceiverReached()
        }

        return resolution.continueInternalPromiseOrFatal(
            preparedInputs,
            invokePrepared,
        )

        function invokePrepared(readyInputs) {
            let receiverLeaseContinues = false
            try {
                if (!invocation.open) return undefined
                if (languageValues.isError(readyInputs)) {
                    return readyInputs
                }

                const callResult = selected.invoke(readyInputs, invocation)
                if (
                    selected.leaseReceiverThroughResult &&
                    languageValues.isPromise(callResult)
                ) {
                    receiverLeaseContinues = true
                }
                if (!selected.admitResult) return callResult

                const admittedResult = selected.admitResult(callResult)
                if (languageValues.isPromise(admittedResult)) {
                    receiverLeaseContinues = true
                }
                return admittedResult
            } finally {
                invocation.releaseArguments()
                if (!receiverLeaseContinues) invocation.releaseReceivers()
            }
        }
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
    getHostCallDescription,
    invokeCall,
    invokeDataFunction,
}
