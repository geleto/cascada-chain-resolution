import { markPromiseHandled } from "./thenable-subscription.js"
import * as errorUtils from "./error.js"
import { exportManyValues } from "./export.js"
import * as imports from "./import.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"

class InvocationContext extends operationLifecycle.OperationOwner {
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
        this.retainArgument = this.#argumentLeases.retain
        this.retainReceiver = this.#receiverLeases.retain
        this.releaseArguments = this.#argumentLeases.release
        this.releaseReceivers = this.#receiverLeases.release
    }

    setReceiver(receiver, present, preserve = false) {
        this.receiverReached = true
        this.receiver = receiver
        this.receiverPresent = present
        this.preserveReceiver = preserve
    }

    exportArguments() {
        return exportManyValues(this.args, this)
    }

    retainArgumentsUntilReceiverReached() {
        for (const value of this.args) {
            const protection = operationLifecycle.continueOperation(
                value,
                this.operationContext,
                resolved => {
                    if (Error.isError(resolved)) return undefined
                    languageValues.admitReadyValue(resolved, this.operationContext)
                    this.#argumentsAwaitingReceiverLeases.retain(resolved)
                },
                () => undefined,
                this,
            )
            markPromiseHandled(protection, this.operationContext)
        }
    }

    releaseArgumentsAwaitingReceiver() {
        this.#argumentsAwaitingReceiverLeases.release()
    }

    release() {
        this.#argumentsAwaitingReceiverLeases.release()
        this.releaseArguments()
        this.releaseReceivers()
        this.args = undefined
        this.receiver = undefined
    }
}

function invokeHostFunction(
    callable,
    thisValue,
    args,
    operationContext,
    kind = errorUtils.ERROR_KIND.HostCallFailed,
) {
    return errorUtils.runHostBoundary(operationContext, kind, () => Reflect.apply(callable, thisValue, args),
    )
}

function getHostMethodDescription(callable, invocationContext) {
    return {
        admitMethodResult: value => imports.importMethodResult(
            value,
            invocationContext.operationContext,
        ),
        invoke: args => invokeHostFunction(
            callable,
            invocationContext.receiver,
            args,
            invocationContext.operationContext,
        ),
        prepareArguments: () => invocationContext.exportArguments(),
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
    getMethodDescription,
    accessReceiver,
) {
    const invocationContext = new InvocationContext(
        operationContext,
        method,
        mutation,
        args,
    )
    const result = accessReceiver(invokeWithReceiver)

    if (
        !invocationContext.receiverReached &&
        languageValues.isPending(result, operationContext)
    ) {
        invocationContext.retainArgumentsUntilReceiverReached()
    }
    return operationLifecycle.continueOperation(
        result,
        operationContext,
        finish,
        reason => {
            if (!errorUtils.isPoisonError(reason)) throw reason
            return finish(reason)
        },
    )

    function finish(value) {
        // Call completion releases the same resources on success and language failure.
        operationLifecycle.close(invocationContext)
        return value
    }

    function invokeWithReceiver(receiver, present, preserveReceiver = false) {
        invocationContext.setReceiver(receiver, present, preserveReceiver)
        const methodDescription = getMethodDescription(invocationContext)
        if (errorUtils.isPoisonError(methodDescription)) {
            invocationContext.releaseArgumentsAwaitingReceiver()
            return methodDescription
        }
        const preparedArguments = methodDescription.prepareArguments()
        invocationContext.retainReceiver(methodDescription.receiverToLease)
        invocationContext.releaseArgumentsAwaitingReceiver()

        return operationLifecycle.continueOperation(
            preparedArguments,
            invocationContext.operationContext,
            invokePrepared,
            undefined,
            invocationContext,
        )

        function invokePrepared(readyArguments) {
            let receiverLeaseContinues = false
            let result = readyArguments
            if (!errorUtils.isPoisonError(readyArguments)) {
                result = methodDescription.invoke(readyArguments)
                if (
                    methodDescription.leaseReceiverThroughResult &&
                    languageValues.isPending(result, operationContext)
                ) {
                    receiverLeaseContinues = true
                }
                if (methodDescription.admitMethodResult) {
                    result = methodDescription.admitMethodResult(result)
                    if (languageValues.isPending(result, operationContext)) {
                        receiverLeaseContinues = true
                    }
                }
            }
            invocationContext.releaseArguments()
            if (!receiverLeaseContinues) invocationContext.releaseReceivers()
            return result
        }
    }
}

function createLeaseLedger(operationContext) {
    const values = new Set()
    let closed = false
    return { retain, release }

    function retain(value) {
        if (closed || values.has(value)) return value
        const retained = languageValues.consumeValue(
            value,
            operationContext,
            errorUtils.ERROR_KIND.OperationInputFailed,
            ready => {
                if (!closed && !values.has(ready) && metadata.incrementReadLease(ready, operationContext)) values.add(ready)
                return ready
            },
        )
        if (!languageValues.isPending(retained, operationContext)) return retained
        markPromiseHandled(retained, operationContext)
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
    getHostMethodDescription,
    invokeMethod,
    invokeHostFunction,
    methodNotCallableError,
}
