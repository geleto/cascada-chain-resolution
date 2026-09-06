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
            const protection = languageValues.thenValue(
                value,
                resolved => errorUtils.runInternalStep(this.operationContext, () => {
                    if (!this.open) return undefined
                    languageValues.admitReadyValue(resolved, this.operationContext)
                    this.#argumentsAwaitingReceiverLeases.retain(resolved)
                }),
                // Rejection reveals no identity. Selected input preparation
                // owns its interpretation if the receiver is later reached.
                () => undefined,
                this.operationContext,
            )
            resolution.markPromiseHandled(protection)
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
// traversal and input readiness separate from the produced method result.
class WrappedMethodResult {
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
    return operationLifecycle.closeWhenDone(invocationContext, result)

    function invokeWithReceiver(receiver, present, preserveReceiver = false) {
        invocationContext.setReceiver(receiver, present, preserveReceiver)
        const methodDescription = getMethodDescription(invocationContext)
        if (languageValues.isError(methodDescription)) {
            invocationContext.releaseArgumentsAwaitingReceiver()
            return methodDescription
        }
        const preparedArguments = methodDescription.prepareArguments()
        invocationContext.retainReceiver(methodDescription.receiverToLease)
        invocationContext.releaseArgumentsAwaitingReceiver()

        const preparedResult = operationLifecycle.continueInternalResultOrFatal(
            invocationContext,
            preparedArguments,
            readyArguments => new WrappedMethodResult(
                invokePrepared(readyArguments),
            ),
        )
        return unwrapMethodResult(preparedResult)

        function invokePrepared(readyArguments) {
            let receiverLeaseContinues = false
            let result = readyArguments
            if (!languageValues.isError(readyArguments)) {
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
                if (languageValues.isError(callable)) {
                    result = callable
                } else {
                    result = methodDescription.invoke(
                        readyArguments,
                        callable,
                    )
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
            }
            invocationContext.releaseArguments()
            if (!receiverLeaseContinues) invocationContext.releaseReceivers()
            return result
        }
    }

    function unwrapMethodResult(result) {
        return resolution.continueInternalResultOrFatal(
            result,
            operationContext,
            resolved => resolved instanceof WrappedMethodResult
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
        const retained = resolution.continueInitialValue(value, operationContext, ready => {
            if (!closed && !values.has(ready) && metadata.incrementReadLease(ready, operationContext)) values.add(ready)
            return ready
        })
        if (!languageValues.isPending(retained, operationContext)) return retained
        resolution.markPromiseHandled(retained)
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
