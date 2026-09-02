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

        return invocation.invokeCall(
            operationContext,
            method,
            mutation,
            args,
            getMethodDescription,
            invokeReceiver => mutation
                ? runMutation(chain, path, operationContext, invokeReceiver)
                : walkObservationPath(
                    chain,
                    path,
                    operationContext,
                    invokeReceiver,
                ),
        )
    })
}

function runMutation(chain, path, operationContext, invokeReceiver) {
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
                (receiver, _prepared, mutationContext) => invokeReceiver(
                    receiver,
                    mutationContext.present,
                    mutationContext,
                ),
            )
        },
        result => result,
    )
}

function getMethodDescription(
    receiver,
    method,
    mutation,
    present,
    mutationContext,
    invocationContext,
) {
    if (languageValues.isError(receiver)) return receiver
    if (!present) {
        return errorUtils.validationError(
            "run receiver path does not exist",
        )
    }
    if (method === "constructor") {
        return invocation.methodNotCallableError(method)
    }

    const type = languageValues.typeOf(receiver, invocationContext.operationContext)
    if (type === languageValues.TYPE_ARRAY) {
        return arrayInvocation.getArrayMethodDescription(
            receiver,
            method,
            mutation,
            mutationContext,
            invocationContext,
        )
    }
    if (
        type === languageValues.TYPE_RECORD ||
        type === languageValues.TYPE_MANAGED_CLASS
    ) {
        return managedInvocation.getManagedMethodDescription(
            receiver,
            method,
            mutation,
            mutationContext,
            invocationContext,
        )
    }
    if (mutation) {
        return errorUtils.validationError(
            "run receiver does not support mutation",
        )
    }
    if (type === languageValues.TYPE_STRING) {
        const callable = getStringMethod(method)
        if (languageValues.isError(callable)) return callable
        return invocation.getHostMethodDescription(
            callable,
            receiver,
        )
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
