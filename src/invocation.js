import * as errorUtils from "./error.js"
import { exportManyValues } from "./export.js"
import * as imports from "./import.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as resolution from "./resolution.js"

class InvocationContext {
    open = true
    receiverReached = false
    #argumentsAwaitingReceiverLeases
    #argumentLeases
    #receiverLeases

    constructor(operationContext, method, mutation, args) {
        this.operationContext = operationContext
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
            if (!languageValues.isPromise(value, this.operationContext)) {
                this.#argumentsAwaitingReceiverLeases.retain(value)
                continue
            }
            const protection = languageValues.continuePromise(
                value,
                this.operationContext,
                resolved => operationLifecycle.run(
                    this,
                    () => this.#argumentsAwaitingReceiverLeases.retain(resolved),
                ),
                // Rejection reveals no identity to protect. Input preparation
                // consumes it only if receiver resolution reaches invocation.
                () => undefined,
            )
            operationLifecycle.observeFatal(this, protection)
        }
    }

    releaseArgumentsAwaitingReceiver() {
        this.#argumentsAwaitingReceiverLeases.release()
    }

    close() {
        if (!this.open) return
        this.open = false
        this.#argumentsAwaitingReceiverLeases.release()
        this.releaseArguments()
        this.releaseReceivers()
        this.args = undefined
        this.receiver = undefined
    }
}

// Internal continuations may adopt a returned Promise. Boxing keeps receiver
// traversal and input readiness separate from the method's public result.
class WrappedInvocationResult {
    constructor(value) {
        this.value = value
    }
}

function invokeHostFunction(
    callable,
    thisValue,
    args,
    operationContext,
    kind = errorUtils.ERROR_KIND.UserCallThrew,
    onFailure = value => value,
) {
    return errorUtils.catchUserCodeFailure(
        () => errorUtils.runUserCode(
            () => Reflect.apply(callable, thisValue, args),
        ),
        operationContext,
        kind,
        onFailure,
    )
}

function getHostMethodDescription(callable, invocationContext) {
    return {
        admitResult: value => imports.importHostResult(
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
    const result = operationLifecycle.run(
        invocationContext,
        () => accessReceiver(invokeWithReceiver),
    )

    if (
        !invocationContext.receiverReached &&
        languageValues.isPromise(result, operationContext)
    ) {
        invocationContext.retainArgumentsUntilReceiverReached()
    }
    return operationLifecycle.closeWhenDone(invocationContext, result)

    function invokeWithReceiver(receiver, present, preserveReceiver = false) {
        invocationContext.setReceiver(receiver, present, preserveReceiver)
        let methodDescription
        let preparedArguments
        try {
            methodDescription = getMethodDescription(invocationContext)
            if (languageValues.isError(methodDescription)) {
                return methodDescription
            }
            preparedArguments = methodDescription.prepareArguments()
            invocationContext.retainReceiver(methodDescription.receiverToLease)
        } finally {
            invocationContext.releaseArgumentsAwaitingReceiver()
        }

        const preparedResult = operationLifecycle.continueInternal(
            invocationContext,
            preparedArguments,
            readyArguments => new WrappedInvocationResult(
                invokePrepared(readyArguments),
            ),
        )
        return unwrapInvocationResult(preparedResult)

        function invokePrepared(readyArguments) {
            let receiverLeaseContinues = false
            try {
                if (languageValues.isError(readyArguments)) {
                    return readyArguments
                }

                // Application reflection belongs after clean input preparation
                // and before category-specific isolation inside invoke.
                const callable = methodDescription.getMethod
                    ? errorUtils.catchUserCodeFailure(
                        () => methodDescription.getMethod(readyArguments),
                        operationContext,
                        errorUtils.ERROR_KIND.LookupThrew,
                        failure => failure,
                    )
                    : undefined
                if (languageValues.isError(callable)) return callable

                const callResult = methodDescription.invoke(
                    readyArguments,
                    callable,
                )
                if (
                    methodDescription.leaseReceiverThroughResult &&
                    languageValues.isPromise(callResult, operationContext)
                ) {
                    receiverLeaseContinues = true
                }
                if (!methodDescription.admitResult) return callResult

                const admittedResult = methodDescription.admitResult(callResult)
                if (languageValues.isPromise(admittedResult, operationContext)) {
                    receiverLeaseContinues = true
                }
                return admittedResult
            } finally {
                invocationContext.releaseArguments()
                if (!receiverLeaseContinues) invocationContext.releaseReceivers()
            }
        }
    }

    function unwrapInvocationResult(result) {
        if (!languageValues.isPromise(result, operationContext)) {
            return result instanceof WrappedInvocationResult
                ? result.value
                : result
        }
        return resolution.continueInternalPromiseOrFatal(
            result,
            operationContext,
            resolved => resolved instanceof WrappedInvocationResult
                ? resolved.value
                : resolved,
        )
    }
}

function createLeaseLedger(operationContext) {
    const values = new Set()
    let closed = false
    return { retain, release }

    function retain(value) {
        if (closed || values.has(value)) return value
        languageValues.admitValue(value, operationContext)
        if (
            !languageValues.isPromise(value, operationContext) &&
            metadata.incrementReadLease(value, operationContext)
        ) values.add(value)
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
