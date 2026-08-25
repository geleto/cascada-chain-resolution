import * as arrayInvocation from "./array-invocation.js"
import * as errorUtils from "./error.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as registeredClassInvocation from "./registered-class-invocation.js"
import {
    transformProperty,
    walkMutationPath,
} from "./mutations.js"
import { walkObservationPath } from "./observations.js"

function run(chain, path, method, mutation, ...args) {
    return errorUtils.runFatal(() => {
        if (typeof method !== "string") {
            return errorUtils.validationError(
                "run requires a string method name",
            )
        }
        if (mutation !== true && mutation !== false) {
            return errorUtils.validationError(
                "run requires an exact mutation Boolean",
            )
        }

        return invocation.invokeCall(
            method,
            mutation,
            args,
            selectCall,
            invokeReceiver => mutation
                ? runMutation(chain, path, invokeReceiver)
                : walkObservationPath(chain, path, invokeReceiver),
        )
    })
}

function runMutation(chain, path, invokeReceiver) {
    return walkMutationPath(
        chain,
        path,
        target => {
            if (
                target.propertyKind !==
                languageProperties.ORDINARY_PROPERTY
            ) {
                const error = languageProperties.propertyValidationError(
                    target.receiver,
                    "run cannot use an Array or String length property " +
                    "as a mutation receiver",
                )
                target.replaceReceiver(error)
                return error
            }
            return transformProperty(
                target.parent,
                target.key,
                target.attachmentRoot,
                () => undefined,
                (receiver, _prepared, context) => invokeReceiver(
                    receiver,
                    context.present,
                    context,
                ),
            )
        },
        result => result,
    )
}

function selectCall(receiver, method, mutation, present, mutationContext) {
    if (languageValues.isError(receiver)) return receiver
    if (!present) {
        return errorUtils.validationError(
            "run receiver path does not exist",
        )
    }
    if (method === "constructor") {
        return errorUtils.validationError("Constructors are unsupported")
    }

    const type = languageValues.typeOf(receiver)
    if (type === languageValues.TYPE_ARRAY) {
        return arrayInvocation.selectArrayCall(
            receiver,
            method,
            mutation,
            mutationContext,
        )
    }
    if (type === languageValues.TYPE_MANAGED_CLASS) {
        if (languageProperties.hasLanguageProperty(receiver, method)) {
            return errorUtils.validationError(
                `Cannot call ${method} because an own data property ` +
                "with that name hides the method",
            )
        }
        return registeredClassInvocation.selectRegisteredClassCall(
            receiver,
            method,
            mutation,
            mutationContext,
        )
    }
    if (mutation) {
        return errorUtils.validationError(
            "run receiver does not support mutation",
        )
    }
    if (type === languageValues.TYPE_STRING) {
        return invocation.getHostCallDescription(
            receiver,
            method,
            receiver,
            undefined,
        )
    }
    if (type === languageValues.TYPE_RECORD) {
        if (languageProperties.hasLanguageProperty(
            receiver,
            method,
        )) {
            return errorUtils.validationError(
                `Cannot call ${method} because an own data property ` +
                "with that name hides the method",
            )
        }
        return invocation.getHostCallDescription(
            receiver,
            method,
            receiver,
            receiver,
        )
    }
    return errorUtils.validationError(
        "run receiver does not support methods",
    )
}

export { run }
