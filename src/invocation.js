import * as errorUtils from "./error.js"
import { exportManyValues } from "./export.js"
import * as imports from "./import.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"

class InvocationContext {
    open = true
    #selectionArgumentLeases
    #argumentLeases
    #receiverLeases

    constructor(operationContext) {
        this.operationContext = operationContext
        this.#selectionArgumentLeases = createLeaseLedger(operationContext)
        this.#argumentLeases = createLeaseLedger(operationContext)
        this.#receiverLeases = createLeaseLedger(operationContext)
        this.retainArgument = this.#argumentLeases.retain
        this.retainReceiver = this.#receiverLeases.retain
        this.releaseArguments = this.#argumentLeases.release
        this.releaseReceivers = this.#receiverLeases.release
    }

    retainArgumentsUntilReceiverReached(args) {
        for (const value of args) {
            if (!languageValues.isPromise(value, this.operationContext)) {
                this.#selectionArgumentLeases.retain(value)
                continue
            }
            const protection = languageValues.continuePromise(
                value,
                this.operationContext,
                resolved => operationLifecycle.run(
                    this,
                    () => this.#selectionArgumentLeases.retain(resolved),
                ),
                // Rejection reveals no identity to protect. Input preparation
                // consumes it only if receiver selection eventually reaches it.
                () => undefined,
            )
            operationLifecycle.observeFatal(this, protection)
        }
    }

    releaseSelectionArguments() {
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

// Internal continuations may adopt a returned Promise. Boxing keeps receiver
// traversal and input readiness separate from the method's public result.
class WrappedInvocationResult {
    constructor(value) {
        this.value = value
    }
}

function invokeDataFunction(callable, thisValue, args) {
    return errorUtils.runUserCode(
        () => Reflect.apply(callable, thisValue, args),
    )
}

function getHostMethodDescription(callable, thisValue) {
    return {
        admitResult: (value, invocationContext) => imports.import(
            value,
            invocationContext.operationContext,
        ),
        invoke: args => invokeDataFunction(callable, thisValue, args),
        prepareInputs: (args, invocationContext) =>
            exportManyValues(args, invocationContext),
    }
}

function methodNotCallableError(method) {
    return errorUtils.validationError(`Method is not callable: ${method}`)
}

// Selection supplies category behavior; this owns the shared call transition
// and its argument and receiver leases.
function invokeCall(
    operationContext,
    method,
    mutation,
    args,
    getMethodDescription,
    reachReceiver,
) {
    const invocationContext = new InvocationContext(operationContext)
    let receiverReached = false
    const reached = operationLifecycle.run(
        invocationContext,
        () => reachReceiver(invokeWithReceiver),
    )

    if (!receiverReached && languageValues.isPromise(reached, operationContext)) {
        invocationContext.retainArgumentsUntilReceiverReached(args)
    }
    return operationLifecycle.closeWhenDone(invocationContext, reached)

    function invokeWithReceiver(receiver, present, mutationContext) {
        receiverReached = true
        let methodDescription
        let preparedInputs
        try {
            methodDescription = getMethodDescription(
                receiver,
                method,
                mutation,
                present,
                mutationContext,
                invocationContext,
            )
            if (languageValues.isError(methodDescription)) {
                return methodDescription
            }
            preparedInputs = methodDescription.prepareInputs(
                args,
                invocationContext,
            )
            invocationContext.retainReceiver(methodDescription.leaseReceiver)
        } finally {
            invocationContext.releaseSelectionArguments()
        }

        const preparedResult = operationLifecycle.continueInternal(
            invocationContext,
            preparedInputs,
            readyInputs => new WrappedInvocationResult(
                invokePrepared(readyInputs),
            ),
        )
        return unwrapInvocationResult(preparedResult)

        function invokePrepared(readyInputs) {
            let receiverLeaseContinues = false
            try {
                if (languageValues.isError(readyInputs)) {
                    return readyInputs
                }

                // Application reflection belongs after clean input preparation
                // and before category-specific isolation inside invoke.
                const callable = methodDescription.getMethod
                    ? errorUtils.catchUserCodeFailure(
                        () => methodDescription.getMethod(readyInputs),
                        failure => failure,
                    )
                    : undefined
                if (languageValues.isError(callable)) return callable

                const callResult = methodDescription.invoke(
                    readyInputs,
                    invocationContext,
                    callable,
                )
                if (
                    methodDescription.leaseReceiverThroughResult &&
                    languageValues.isPromise(callResult, operationContext)
                ) {
                    receiverLeaseContinues = true
                }
                if (!methodDescription.admitResult) return callResult

                const admittedResult = methodDescription.admitResult(
                    callResult,
                    invocationContext,
                )
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
        return languageValues.continuePromise(
            result,
            operationContext,
            resolved => resolved instanceof WrappedInvocationResult
                ? resolved.value
                : resolved,
            errorUtils.reportFatalError,
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
    invokeCall,
    invokeDataFunction,
    methodNotCallableError,
}
