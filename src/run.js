import * as arrayInvocation from "./array-invocation.js"
import * as errorUtils from "./error.js"
import * as internalSteps from "./internal-step.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as managedInvocation from "./managed-invocation.js"
import {
    captureMutationResult,
    transformProperty,
    walkMutationPath,
} from "./mutations.js"

function run(chain, path, method, args, operationContext, facts, delivery) {
    const operation = new invocation.InvocationWork(chain, path, operationContext, facts, method, [...args])
    path = args = undefined
    const mutation = operation.mutation
    const result = invocation.invokeMethod(
        operation,
        selectMethodDescription,
        (invokeWithReceiver, beforeWait) => {
            const invokeMutation = (receiver, state) => {
                operation.preserveReceiverBaseline = state.preserveBaseline
                return invokeWithReceiver(receiver, state.present)
            }
            operation.beforeWait = beforeWait
            const native = access => access.selectReceiver(access.end,
                errorUtils.ERROR_KIND.InvocationFailed, invokeWithReceiver)
            if (!mutation || operation.route.externalScope) return operation.observe(invokeWithReceiver, native)
            return operation.mutate((scope, state, working, start) => {
                if (start === operation.route.path.length) return invokeMutation(scope, state)
                const outcome = runMutation(working, start, operation, invokeMutation)
                return internalSteps.continueGraphTransition(outcome, operationContext, outcome =>
                    errorUtils.isPoisonError(outcome) || errorUtils.isPoisonError(outcome.mutatedValue)
                        ? outcome : captureMutationResult(working, outcome.result, operationContext))
            })
        },
        delivery,
    )
    return mutation ? operation.finishMutation(result) : operation.finish(result)
}

function runMutation(scope, start, operation, invokeMutation) {
    const { operationContext } = operation
    return walkMutationPath(
        scope.holder,
        operation,
        target => {
            if (
                target.propertyKind !==
                languageProperties.ORDINARY_PROPERTY
            ) {
                const error = languageProperties.propertyValidationError(
                    "run cannot use an Array or String length property " +
                    "as a mutation receiver",
                    operationContext,
                )
                target.replaceReceiver(error)
                return error
            }
            return transformProperty(target, operationContext, invokeMutation)
        }, { start, publication: scope.publication },
    )
}

function selectMethodDescription(invocationWork, externalAccess) {
    const {
        method,
        mutation,
        receiver,
        receiverPresent,
    } = invocationWork
    if (errorUtils.isPoisonError(receiver)) return receiver
    if (!receiverPresent) {
        return errorUtils.validationError(
            "run receiver path does not exist",
            invocationWork.operationContext,
            errorUtils.ERROR_KIND.NullLookup,
        )
    }
    if (method === "constructor") {
        return invocation.methodNotCallableError(
            method,
            invocationWork.operationContext,
        )
    }

    const type = invocationWork.receiverCapture?.roots[0].type ??
        languageValues.typeOf(receiver, invocationWork.operationContext)
    if (externalAccess && type === languageValues.TYPE.External) {
        return {
            prepareArguments: () => invocationWork.exportArguments(),
            invoke: args => externalAccess.call(invocationWork.receiver, method, args, invocationWork.retainOutput),
        }
    }

    if (type === languageValues.TYPE.Array) {
        return arrayInvocation.selectArrayMethodDescription(invocationWork)
    }
    if (
        type === languageValues.TYPE.Record ||
        type === languageValues.TYPE.ManagedClass
    ) {
        return managedInvocation.selectManagedMethodDescription(invocationWork)
    }
    if (mutation) {
        return errorUtils.validationError(
            "run receiver does not support mutation",
            invocationWork.operationContext,
            errorUtils.ERROR_KIND.UnsupportedMutation,
        )
    }
    if (type === languageValues.TYPE.String) {
        const callable = getStringMethod(
            method,
            invocationWork.operationContext,
        )
        if (errorUtils.isPoisonError(callable)) return callable
        return invocation.selectFunctionMethodDescription(callable, invocationWork)
    }
    return errorUtils.validationError(
        "run receiver does not support methods",
        invocationWork.operationContext,
        errorUtils.ERROR_KIND.NotAFunction,
    )
}

function getStringMethod(method, operationContext) {
    const descriptor = Object.getOwnPropertyDescriptor(
        String.prototype,
        method,
    ) ?? Object.getOwnPropertyDescriptor(Object.prototype, method)
    if (!descriptor) {
        return invocation.methodNotCallableError(method, operationContext, false)
    }
    return "value" in descriptor && typeof descriptor.value === "function"
        ? descriptor.value
        : invocation.methodNotCallableError(method, operationContext)
}

export { run }
