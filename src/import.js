import * as errorUtils from "./error.js"
import { prepareInput, receiveValue } from "./input-preparations.js"

const IMPORT_POLICY = {
    Context: { kind: errorUtils.ERROR_KIND.ContextValueFailed, imported: true },
    MethodResult: { kind: errorUtils.ERROR_KIND.InvocationFailed, methodResult: true, imported: true },
    ExternalProperty: { kind: errorUtils.ERROR_KIND.ExternalPropertyReadFailed, externalRoot: true, imported: true },
}

function importValue(value, operationContext, delivery) {
    return receiveValue(value, operationContext, IMPORT_POLICY.Context, delivery?.capture)
}

function importMethodResult(value, operationContext, delivery) {
    return receiveValue(value, operationContext, IMPORT_POLICY.MethodResult, delivery?.capture)
}

function importExternalProperty(value, operationContext) {
    return receiveValue(value, operationContext, IMPORT_POLICY.ExternalProperty)
}

function importReadyMethodResult(value, operationContext, failures, receiver) {
    // The direct result is ready. Expose this admission segment's diagnostics
    // to call completion; independently pending descendants have their own lifetime.
    return prepareInput(value, operationContext, {
        ...IMPORT_POLICY.MethodResult,
        receiver,
    }, undefined, failures)
}

export {
    importValue as import,
    importMethodResult,
    importExternalProperty,
    importReadyMethodResult,
}
