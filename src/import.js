import * as errorUtils from "./error.js"
import * as internalSteps from "./internal-step.js"
import { processImportSegment } from "./import-processing.js"

const IMPORT_POLICY = {
    Context: { kind: errorUtils.ERROR_KIND.ContextValueFailed },
    MethodResult: { kind: errorUtils.ERROR_KIND.InvocationFailed, methodResult: true },
    ExternalProperty: { kind: errorUtils.ERROR_KIND.ExternalPropertyReadFailed, externalRoot: true },
}

function importValue(value, operationContext) {
    return importData(value, operationContext, IMPORT_POLICY.Context)
}

function importMethodResult(value, operationContext) {
    return importData(value, operationContext, IMPORT_POLICY.MethodResult)
}

function importExternalProperty(value, operationContext) {
    return importData(value, operationContext, IMPORT_POLICY.ExternalProperty)
}

function importReadyMethodResult(value, operationContext, failures, receiver) {
    // The direct result is ready. Expose this admission segment's diagnostics
    // to call completion; independently pending descendants have their own lifetime.
    return processImportSegment(value, operationContext, {
        ...IMPORT_POLICY.MethodResult,
        receiver,
    }, undefined, failures)
}

function importContext(value, operationContext, externalMutationTreeSetup) {
    return importData(
        value,
        operationContext,
        IMPORT_POLICY.Context,
        externalMutationTreeSetup,
    )
}

function importData(
    value,
    operationContext,
    policy,
    externalMutationTreeSetup,
) {
    return internalSteps.runInternalStep(operationContext, () => {
        try {
            return internalSteps.continueOperation(
                value,
                operationContext,
                root => processImportSegment(
                    root,
                    operationContext,
                    policy,
                    // Thenable delivery supplies a different root, even when ready.
                    root === value ? externalMutationTreeSetup : undefined,
                ),
                reason => errorUtils.createPoisonError(reason, operationContext, policy.kind),
            )
        } finally {
            // Deferred import needs neither the original root nor discovery inputs.
            value = externalMutationTreeSetup = undefined
        }
    })
}

export {
    importValue as import,
    importContext,
    importMethodResult,
    importExternalProperty,
    importReadyMethodResult,
}
