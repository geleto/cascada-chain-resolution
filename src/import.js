import * as errorUtils from "./error.js"
import * as internalSteps from "./internal-step.js"
import { prepareImportedData } from "./import-preparation.js"

const IMPORT_POLICY = {
    Context: { kind: errorUtils.ERROR_KIND.ContextValueFailed },
    MethodResult: { kind: errorUtils.ERROR_KIND.InvocationFailed },
    ManagedMutationMethodResult: {
        kind: errorUtils.ERROR_KIND.InvocationFailed,
        retainAdmittedDescendants: true,
    },
}

function importValue(value, operationContext) {
    return importData(value, operationContext, IMPORT_POLICY.Context)
}

function importMethodResult(value, operationContext) {
    return importData(value, operationContext, IMPORT_POLICY.MethodResult)
}

function importManagedMutationMethodResult(value, operationContext) {
    return importData(
        value,
        operationContext,
        IMPORT_POLICY.ManagedMutationMethodResult,
    )
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
                root => prepareImportedData(
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
    importManagedMutationMethodResult,
}
