import * as arrayInvocation from "./array-invocation.js"
import * as errorUtils from "./error.js"
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
    return errorUtils.runFatal(operationContext, () => {
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
                    target.receiver,
                    "run cannot use an Array or String length property " +
                    "as a mutation receiver",
                    operationContext,
                )
                target.replaceReceiver(error)
                return error
            }
            return transformProperty(
                target.parent,
                target.key,
                target.attachmentRoot,
                operationContext,
                () => undefined,
                (receiver, _prepared, mutationContext) => invokeWithReceiver(
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
    if (languageValues.isError(receiver)) return receiver
    if (!receiverPresent) {
        return errorUtils.validationError(
            "run receiver path does not exist",
        )
    }
    if (method === "constructor") {
        return invocation.methodNotCallableError(method)
    }

    const type = languageValues.typeOf(receiver, invocationContext.operationContext)
    if (type === languageValues.TYPE_ARRAY) {
        return arrayInvocation.getArrayMethodDescription(invocationContext)
    }
    if (
        type === languageValues.TYPE_RECORD ||
        type === languageValues.TYPE_MANAGED_CLASS
    ) {
        return managedInvocation.getManagedMethodDescription(invocationContext)
    }
    if (mutation) {
        return errorUtils.validationError(
            "run receiver does not support mutation",
        )
    }
    if (type === languageValues.TYPE_STRING) {
        const callable = getStringMethod(method)
        if (languageValues.isError(callable)) return callable
        return invocation.getHostMethodDescription(callable, invocationContext)
    }
    return errorUtils.validationError(
        "run receiver does not support methods",
    )
}

function getStringMethod(method) {
    const descriptor = Object.getOwnPropertyDescriptor(
        String.prototype,
        method,
    ) ?? Object.getOwnPropertyDescriptor(Object.prototype, method)
    return descriptor &&
        "value" in descriptor &&
        typeof descriptor.value === "function"
        ? descriptor.value
        : invocation.methodNotCallableError(method)
}

export { run }
