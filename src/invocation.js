import { markPromiseHandled } from "./thenable-subscription.js"
import * as errorUtils from "./error.js"
import { exportManyValues } from "./export.js"
import * as imports from "./import.js"
import * as internalSteps from "./internal-step.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"

class InvocationWork extends operationLifecycle.OperationOwner {
    receiverReached = false
    #argumentsAwaitingReceiverLeases
    #argumentLeases
    #receiverLeases

    constructor(operationContext, method, mutation, args) {
        super(operationContext)
        this.method = method
        this.mutation = mutation
        this.args = args
        this.#argumentsAwaitingReceiverLeases = createLeaseLedger(operationContext)
        this.#argumentLeases = createLeaseLedger(operationContext)
        this.#receiverLeases = createLeaseLedger(operationContext)
        this.leaseArgument = this.#argumentLeases.acquire
        this.leaseReceiver = this.#receiverLeases.acquire
        this.releaseArgumentLeases = this.#argumentLeases.release
        this.releaseReceiverLeases = this.#receiverLeases.release
    }

    setReceiver(receiver, present) {
        this.receiverReached = true
        this.receiver = receiver
        this.receiverPresent = present
    }

    exportArguments() {
        return exportManyValues(this.args, this)
    }

    leaseArgumentsUntilReceiverReached() {
        for (const value of this.args) {
            const protection = internalSteps.continueOperation(
                value,
                this.operationContext,
                resolved => {
                    if (Error.isError(resolved)) return undefined
                    languageValues.admitReadyValue(resolved, this.operationContext)
                    this.#argumentsAwaitingReceiverLeases.acquire(resolved)
                },
                () => undefined,
                this,
            )
            markPromiseHandled(protection, this.operationContext)
        }
    }

    releaseArgumentLeasesAwaitingReceiver() {
        this.#argumentsAwaitingReceiverLeases.release()
    }

    release() {
        this.#argumentsAwaitingReceiverLeases.release()
        this.releaseArgumentLeases()
        this.releaseReceiverLeases()
        this.args = undefined
        this.receiver = undefined
    }
}

function invokeFunction(
    callable,
    thisValue,
    args,
    operationContext,
    kind = errorUtils.ERROR_KIND.InvocationFailed,
) {
    return errorUtils.runExternalBoundary(operationContext, kind, () => Reflect.apply(callable, thisValue, args),
    )
}

function selectFunctionMethodDescription(callable, invocationWork) {
    return {
        leaseInputsThroughResult: true,
        invoke: args => imports.importMethodResult(
            invokeFunction(callable, invocationWork.receiver, args, invocationWork.operationContext),
            invocationWork.operationContext,
        ),
        prepareArguments: () => invocationWork.exportArguments(),
    }
}

function methodNotCallableError(method, operationContext, present = true) {
    return errorUtils.validationError(
        `Method is not callable: ${method}`,
        operationContext,
        present
            ? errorUtils.ERROR_KIND.NotAFunction
            : errorUtils.ERROR_KIND.MissingFunction,
    )
}

// The method description supplies category behavior; this owns the shared call transition
// and its argument and receiver leases.
function invokeMethod(
    operationContext,
    method,
    mutation,
    args,
    selectMethodDescription,
    accessReceiver,
) {
    const invocationWork = new InvocationWork(
        operationContext,
        method,
        mutation,
        args,
    )
    const result = accessReceiver(invokeWithReceiver)

    if (
        !invocationWork.receiverReached &&
        languageValues.isPending(result, operationContext)
    ) {
        invocationWork.leaseArgumentsUntilReceiverReached()
    }
    return internalSteps.continueOperation(
        result,
        operationContext,
        finish,
        reason => {
            if (!errorUtils.isPoisonError(reason)) throw reason
            return finish(reason)
        },
    )

    function finish(value) {
        if (mutation && !errorUtils.isPoisonError(value)) {
            // Receiver publication can finish before an independently returned
            // value. That value still owns invocation work until delivery.
            value.result = internalSteps.continueOperation(value.result, operationContext, close)
            return value
        }
        return close(value)
    }

    function close(value) {
        // Call completion releases the same resources on success and language failure.
        invocationWork.close()
        return value
    }

    function invokeWithReceiver(receiver, present) {
        invocationWork.setReceiver(receiver, present)
        const methodDescription = selectMethodDescription(invocationWork)
        if (errorUtils.isPoisonError(methodDescription)) {
            invocationWork.releaseArgumentLeasesAwaitingReceiver()
            return methodDescription
        }
        const preparedArguments = methodDescription.prepareArguments()
        invocationWork.leaseReceiver(methodDescription.receiverToLease)
        invocationWork.releaseArgumentLeasesAwaitingReceiver()

        return internalSteps.continueOperation(
            preparedArguments,
            invocationWork.operationContext,
            invokePrepared,
            undefined,
            invocationWork,
        )

        function invokePrepared(readyArguments) {
            let result = readyArguments
            if (!errorUtils.isPoisonError(readyArguments)) {
                result = methodDescription.invoke(readyArguments)
            }
            const pendingInputUse = methodDescription.leaseInputsThroughResult &&
                languageValues.isPending(result, operationContext)
            if (!pendingInputUse) {
                invocationWork.releaseArgumentLeases()
                invocationWork.releaseReceiverLeases()
            }
            return result
        }
    }
}

function createLeaseLedger(operationContext) {
    const values = new Set()
    let closed = false
    return { acquire, release }

    function acquire(value) {
        if (closed || values.has(value)) return value
        const leased = internalSteps.consumeValue(
            value,
            operationContext,
            errorUtils.ERROR_KIND.OperationInputFailed,
            ready => {
                if (!closed && !values.has(ready) && metadata.incrementReadLease(ready, operationContext)) values.add(ready)
                return ready
            },
        )
        if (!languageValues.isPending(leased, operationContext)) return leased
        markPromiseHandled(leased, operationContext)
        return value
    }

    function release() {
        if (closed) return
        closed = true
        for (const value of values) {
            metadata.decrementReadLease(value, operationContext)
        }
        values.clear()
    }
}

export {
    createLeaseLedger,
    selectFunctionMethodDescription,
    invokeMethod,
    invokeFunction,
    methodNotCallableError,
}
