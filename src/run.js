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
import { PathOperation } from "./path-operation.js"

function run(chain, path, method, args, operationContext, facts) {
    return internalSteps.runInternalStep(operationContext, () => {
        const operation = new PathOperation(chain, path, operationContext,
            facts.mutationScopeDepth, facts.repair, facts.firstDynamicSegment ?? path.length)
        path = operation.route.path
        args = [...args]
        const mutation = operation.mutation
        let externalAccess
        const result = invocation.invokeMethod(
            operationContext,
            method,
            mutation,
            args,
            context => selectMethodDescription(context, externalAccess),
            invokeWithReceiver => {
                const native = access => {
                    externalAccess = access
                    return invokeWithReceiver(access.identity, true)
                }
                if (!mutation || operation.hasExternalScope) return operation.observe(invokeWithReceiver, native)
                return operation.mutate((scope, state, privateChain, suffix) => {
                    if (suffix.length === 0) return invokeWithReceiver(scope, state.present)
                    const outcome = runMutation(privateChain, suffix, operationContext, invokeWithReceiver)
                    return internalSteps.continueOperation(outcome, operationContext, outcome =>
                        errorUtils.isPoisonError(outcome) || errorUtils.isPoisonError(outcome.mutatedValue)
                            ? outcome : captureMutationResult(privateChain, outcome.result, operationContext))
                })
            },
        )
        return mutation ? operation.finishMutation(result) : operation.finish(result)
    })
}

function runMutation(chain, path, operationContext, invokeWithReceiver) {
    return walkMutationPath(
        chain,
        path,
        operationContext,
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
            return transformProperty(target, operationContext, (receiver, state) =>
                invokeWithReceiver(receiver, state.present))
        },
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

    if (externalAccess) {
        return {
            prepareArguments: () => invocationWork.exportArguments(),
            invoke: args => externalAccess.call(method, args),
        }
    }

    const type = languageValues.typeOf(receiver, invocationWork.operationContext)
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
