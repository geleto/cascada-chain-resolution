import * as errorUtils from "./error.js"
import * as internalSteps from "./internal-step.js"
import { prepareInput, receiveValue } from "./input-preparations.js"

const IMPORT_POLICY = {
    Context: { kind: errorUtils.ERROR_KIND.ContextValueFailed, imported: true },
    MethodResult: { kind: errorUtils.ERROR_KIND.InvocationFailed, methodResult: true, imported: true },
    ExternalProperty: { kind: errorUtils.ERROR_KIND.ExternalPropertyReadFailed, externalRoot: true, imported: true },
}

function importValue(value, operationContext, delivery) {
    return importData(value, operationContext, IMPORT_POLICY.Context, delivery)
}

function importMethodResult(value, operationContext, delivery) {
    return importData(value, operationContext, IMPORT_POLICY.MethodResult, delivery)
}

function importExternalProperty(value, operationContext) {
    return importData(value, operationContext, IMPORT_POLICY.ExternalProperty)
}

function importReadyMethodResult(value, operationContext, failures, receiver) {
    // The direct result is ready. Expose this admission segment's diagnostics
    // to call completion; independently pending descendants have their own lifetime.
    return prepareInput(value, operationContext, {
        ...IMPORT_POLICY.MethodResult,
        receiver,
    }, undefined, failures)
}

function importData(value, operationContext, policy, delivery) {
    return internalSteps.runInternalStep(operationContext, () =>
        receiveValue(value, operationContext, policy, delivery?.capture))
}

export {
    importValue as import,
    importMethodResult,
    importExternalProperty,
    importReadyMethodResult,
}
