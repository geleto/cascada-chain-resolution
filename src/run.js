import * as arrayInvocation from "./array-invocation.js"
import * as errorUtils from "./error.js"
import * as internalSteps from "./internal-step.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as managedInvocation from "./managed-invocation.js"
import {
    transformProperty,
    walkMutationPath,
} from "./mutations.js"
import { walkObservationPath } from "./observations.js"

function run(chain, path, method, args, operationContext, facts) {
    return internalSteps.runInternalStep(operationContext, () => {
        chain._assertOperationContext(operationContext)
        const mutationScopeDepth = facts.mutationScopeDepth
        path = [...path]
        args = [...args]
        const mutation = mutationScopeDepth !== undefined

        return invocation.invokeMethod(
            operationContext,
            method,
            mutation,
            args,
            getMethodDescription,
            invokeWithReceiver => mutation
                ? runMutation(chain, path, operationContext, invokeWithReceiver)
                : walkObservationPath(
                    chain,
                    path,
                    operationContext,
                    invokeWithReceiver,
                ),
        )
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
            return transformProperty(
                target,
                operationContext,
                (receiver, mutationContext) => invokeWithReceiver(
                    receiver,
                    mutationContext.present,
                    mutationContext.mustPreserveValue,
                ),
            )
        },
        result => result,
    )
}

function getMethodDescription(invocationContext) {
    const {
        method,
        mutation,
        receiver,
        receiverPresent,
    } = invocationContext
    if (errorUtils.isPoisonError(receiver)) return receiver
    if (!receiverPresent) {
        return errorUtils.validationError(
            "run receiver path does not exist",
            invocationContext.operationContext,
            errorUtils.ERROR_KIND.NullLookup,
        )
    }
    if (method === "constructor") {
        return invocation.methodNotCallableError(
            method,
            invocationContext.operationContext,
        )
    }

    const type = languageValues.typeOf(receiver, invocationContext.operationContext)
    if (type === languageValues.TYPE.Array) {
        return arrayInvocation.getArrayMethodDescription(invocationContext)
    }
    if (
        type === languageValues.TYPE.Record ||
        type === languageValues.TYPE.ManagedClass
    ) {
        return managedInvocation.getManagedMethodDescription(invocationContext)
    }
    if (mutation) {
        return errorUtils.validationError(
            "run receiver does not support mutation",
            invocationContext.operationContext,
            errorUtils.ERROR_KIND.UnsupportedMutation,
        )
    }
    if (type === languageValues.TYPE.String) {
        const callable = getStringMethod(
            method,
            invocationContext.operationContext,
        )
        if (errorUtils.isPoisonError(callable)) return callable
        return invocation.getFunctionMethodDescription(callable, invocationContext)
    }
    return errorUtils.validationError(
        "run receiver does not support methods",
        invocationContext.operationContext,
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
