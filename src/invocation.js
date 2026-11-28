import { markPromiseHandled } from "./thenable-subscription.js"
import * as errorUtils from "./error.js"
import { exportManyValues } from "./export.js"
import * as imports from "./import.js"
import * as internalSteps from "./internal-step.js"
import * as languageValues from "./language-values.js"
import { createLeaseLedger, releaseDetached } from "./ownership.js"
import { PathOperation } from "./path-operation.js"
import { CHAIN_MODE } from "./chain.js"
import { receiveValue } from "./input-preparations.js"
import { resultEvidence } from "./error-evidence.js"

// One preparation is shared by receiver discovery and selected dispatch. The
// invocation retains it until capture; a pending delivery then has its own
// bounded handoff, including when a payload has outlived the invocation.
class ArgumentInput {
    open = true
    retained = true
    pendingDelivery = true

    constructor(operationContext) {
        this.leases = createLeaseLedger(operationContext)
    }

    prepare(value, operationContext) {
        const result = receiveValue(value, operationContext,
            { kind: errorUtils.ERROR_KIND.OperationInputFailed }, this.leases.acquire, this)
        if (languageValues.isPending(result, operationContext)) {
            const delivered = () => queueMicrotask(() => releaseDetached(operationContext, () => {
                this.pendingDelivery = false
                if (!this.retained) this.close()
            }))
            // Reception already normalized host rejection. This lifetime
            // observer also guards payloads retained without immediate consumption.
            markPromiseHandled(internalSteps.continueGraphTransition(result, operationContext, delivered), operationContext)
        } else this.pendingDelivery = false
        return result
    }

    release() {
        this.retained = false
        if (!this.pendingDelivery) this.close()
    }

    close() {
        this.retained = false
        this.open = false
        this.leases.release()
    }
}

class InvocationWork extends PathOperation {
    receiverReached = false
    get resultEvidence() { return resultEvidence(this.delivery) }
    get scopeEvidence() {
        if (this.mode === CHAIN_MODE.Complete && (this.method === "fill" || this.method === "copyWithin"))
            return this.resultEvidence
    }
    get receiverOwnsFailure() { return this.controlledArray && this.mode !== CHAIN_MODE.Complete }
    #inputs
    #receiverLeases
    #outputLeases

    constructor(chain, path, operationContext, facts, method, args) {
        super(chain, path, operationContext, facts.mutationScopeDepth, facts.repair, facts.firstDynamicSegment ?? path.length,
            path.length, false, method === "push")
        this.appendOnly = chain._appendOnly
        this.missingOutput = facts.missingOutput
        this.method = method
        this.args = args
        args = undefined
        this.#receiverLeases = createLeaseLedger(operationContext)
        this.#outputLeases = createLeaseLedger(operationContext)
        this.retainOutput = this.#outputLeases.acquire
        this.leaseReceiver = this.#receiverLeases.acquire
        this.releaseReceiverLeases = () => {
            this.#receiverLeases.release()
            this.releaseCapturedReceiver?.()
            this.releaseCapturedReceiver = undefined
            this.receiver = undefined
            this.receiverCapture?.discard()
            this.receiverCapture = undefined
        }
    }

    setReceiver(receiver, present) {
        this.receiverReached = true
        this.receiver = receiver
        this.receiverPresent = present
    }

    exportArguments() {
        this.prepareArgumentFrontier()
        const exported = exportManyValues(this.args, this)
        this.releaseArgumentLeases()
        return exported
    }

    prepareArgument(index, args = this.args) {
        if (index >= args.length) return undefined
        const inputs = this.#inputs ??= []
        if (!inputs[index]) {
            const input = inputs[index] = new ArgumentInput(this.operationContext)
            args[index] = input.prepare(args[index], this.operationContext)
        }
        return args[index]
    }

    prepareArgumentFrontier(count = this.args.length, args = this.args) {
        count = Math.min(count, args.length)
        this.discardArgumentsFrom(count)
        for (let index = 0; index < count; index++) this.prepareArgument(index, args)
    }

    discardArgumentsFrom(first) {
        const inputs = this.#inputs
        if (!inputs || first >= inputs.length) return
        for (let index = first; index < inputs.length; index++) inputs[index]?.close()
        inputs.length = first
    }

    leaseArgumentsUntilReceiverReached() {
        if (!this.receiverReached && !this.#inputs) this.prepareArgumentFrontier()
    }

    releaseArgumentLeases() {
        for (const input of this.#inputs ?? []) input?.release()
    }

    releaseArgument(index) {
        this.#inputs?.[index]?.release()
    }

    takeArgument(index, args) {
        const value = this.prepareArgument(index, args)
        this.argumentInput(index, true)?.release()
        return value
    }

    argumentInput(index, transfer = false) {
        const input = this.#inputs?.[index]
        if (input && transfer) this.#inputs[index] = undefined
        return input
    }

    preparationFailed() {
        this.releaseReceiverLeases()
        this.discardPreparedOutput?.()
    }

    discardArgument(index) {
        this.#inputs?.[index]?.close()
    }

    transferInputs = value => {
        this.releaseReceiverLeases()
        if (!errorUtils.isPoisonError(value)) {
            this.releaseArgumentLeases()
            this.#inputs = undefined
        }
        return value
    }

    releaseInvocation() {
        this.preserveReceiverBaseline = undefined
        this.discardPreparedOutput?.()
        this.discardPreparedOutput = undefined
        for (const input of this.#inputs ?? []) input?.close()
        this.#inputs = undefined
        this.releaseReceiverLeases()
        this.#outputLeases.release()
        this.args = undefined
        this.receiver = undefined
    }

    release() {
        this.releaseInvocation()
        super.release()
    }
}

function invokeFunction(
    callable,
    thisValue,
    args,
    operationContext,
    kind = errorUtils.ERROR_KIND.InvocationFailed,
) {
    try {
        return errorUtils.runExternalBoundary(operationContext, kind, () => Reflect.apply(callable, thisValue, args))
    } finally { callable = thisValue = args = undefined }
}

function selectFunctionMethodDescription(callable, invocationWork) {
    return {
        invoke: args => imports.importMethodResult(
            invokeFunction(callable, invocationWork.receiver, args, invocationWork.operationContext),
            invocationWork.operationContext,
            { capture: invocationWork.retainOutput },
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
    invocationWork,
    selectMethodDescription,
    accessReceiver,
    delivery,
) {
    const { operationContext, mutation } = invocationWork
    // Arguments may borrow the receiver or an ancestor. Protect them before
    // the mutation walk decides which path containers it can change in place.
    if (mutation) invocationWork.prepareArgumentFrontier()
    const result = accessReceiver(invokeWithReceiver, () => invocationWork.leaseArgumentsUntilReceiverReached())

    if (
        !invocationWork.receiverReached &&
        languageValues.isPending(result, operationContext)
    ) {
        invocationWork.leaseArgumentsUntilReceiverReached()
    }
    // Host failures already fulfill with poison. An internal rejection, even
    // with poison, must use the common fatal guard rather than completion.
    return internalSteps.continueGraphTransition(result, operationContext, finish)

    function finish(value) {
        if (mutation && !errorUtils.isPoisonError(value)) {
            // Receiver publication can finish before an independently returned
            // value. That value still owns invocation work until delivery.
            value.result = internalSteps.continueGraphTransition(value.result, operationContext, close)
            return value
        }
        return close(value)
    }

    function close(value) {
        // Call completion releases the same resources on success and language failure.
        delivery?.capture(value)
        invocationWork.releaseInvocation()
        return value
    }

    function invokeWithReceiver(receiver, present, externalAccess, capture) {
        invocationWork.setReceiver(receiver, present)
        invocationWork.receiverCapture = capture
        const methodDescription = selectMethodDescription(invocationWork, externalAccess)
        if (errorUtils.isPoisonError(methodDescription)) {
            return methodDescription
        }
        invocationWork.leaseReceiver(methodDescription.receiverToLease)
        methodDescription.receiverToLease = undefined
        const preparedArguments = methodDescription.prepareArguments()
        invocationWork.args = undefined

        return internalSteps.continueGraphTransition(
            preparedArguments,
            invocationWork.operationContext,
            invokePrepared,
            undefined,
            invocationWork,
        )

        function invokePrepared(readyArguments) {
            let result = readyArguments
            if (!errorUtils.isPoisonError(readyArguments)) {
                try { result = methodDescription.invoke(readyArguments) }
                finally { invocationWork.preserveReceiverBaseline = undefined }
            }
            const pendingInputUse = methodDescription.leaseInputsThroughResult &&
                languageValues.isPending(result, operationContext)
            if (!pendingInputUse) {
                invocationWork.releaseArgumentLeases()
                // Array mutation publication still needs the receiver for a
                // no-write result or to inherit its logical identity.
                if (!mutation || !invocationWork.controlledArray) invocationWork.releaseReceiverLeases()
            }
            // This callback belongs to work, so pending input transfer retains
            // neither this invocation's prepared arguments nor its description.
            return internalSteps.continueGraphTransition(result, operationContext,
                invocationWork.transferInputs)
        }
    }
}

export {
    InvocationWork,
    selectFunctionMethodDescription,
    invokeMethod,
    invokeFunction,
    methodNotCallableError,
}
