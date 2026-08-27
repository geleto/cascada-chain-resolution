import * as errorUtils from "./error.js"
import { exportManyValues } from "./export.js"
import * as imports from "./import.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"

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
}

function invokeDataFunction(callable, thisValue, args) {
    return errorUtils.runUserCode(
        () => Reflect.apply(callable, thisValue, args),
    )
}

function getHostMethodCallDescription(
    getMethod,
    thisValue,
    leaseReceiver,
) {
    return {
        admitResult: value => imports.import(value, "run method result"),
        invoke: (args, _invocation, callable) =>
            invokeDataFunction(callable, thisValue, args),
        leaseReceiver,
        prepareInputs: (args, invocation) =>
            exportManyValues(args, invocation),
        getMethod,
    }
}

function methodNotCallableError(method) {
    return errorUtils.validationError(`Method is not callable: ${method}`)
}

// Selection supplies category behavior; this owns the shared call transition
// and its argument and receiver leases.
function invokeCall(method, mutation, args, select, reachReceiver) {
    const invocation = new InvocationContext()
    const result = operationLifecycle.run(
        invocation,
        () => reachReceiver(invokeReceiver),
    )

    if (languageValues.isPromise(result)) {
        invocation.retainArgumentsUntilReceiver(args)
    }
    return operationLifecycle.closeWhenDone(invocation, result)

    function invokeReceiver(receiver, present, context) {
        let selected
        let preparedInputs
        try {
            selected = select(receiver, method, mutation, present, context)
            if (languageValues.isError(selected)) return selected
            preparedInputs = selected.prepareInputs(args, invocation)
            invocation.retainReceiver(selected.leaseReceiver)
        } finally {
            invocation.markReceiverReached()
        }

        return operationLifecycle.continueInternal(
            invocation,
            preparedInputs,
            invokePrepared,
        )

        function invokePrepared(readyInputs) {
            let receiverLeaseContinues = false
            try {
                if (languageValues.isError(readyInputs)) {
                    return readyInputs
                }

                // Application reflection belongs after clean input preparation
                // and before category-specific isolation inside invoke.
                const callable = selected.getMethod
                    ? errorUtils.catchUserCodeFailure(
                        selected.getMethod,
                        failure => failure,
                    )
                    : undefined
                if (languageValues.isError(callable)) return callable

                const callResult = selected.invoke(
                    readyInputs,
                    invocation,
                    callable,
                )
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
    getHostMethodCallDescription,
    invokeCall,
    invokeDataFunction,
    methodNotCallableError,
}
