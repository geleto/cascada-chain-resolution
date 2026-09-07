import * as errorUtils from "./error.js"
import { continueOperation } from "./operation-lifecycle.js"
import { prepareImportedData } from "./import-preparation.js"

const CONTEXT_IMPORT = { kind: errorUtils.ERROR_KIND.ContextValueFailed }
const METHOD_RESULT = { kind: errorUtils.ERROR_KIND.HostCallFailed }
const MUTATION_RESULT = {
    kind: errorUtils.ERROR_KIND.HostCallFailed,
    retainAdmittedDescendants: true,
}

function importValue(value, operationContext) {
    return importData(value, operationContext, CONTEXT_IMPORT)
}

function importMethodResult(value, operationContext) {
    return importData(value, operationContext, METHOD_RESULT)
}

function importManagedMutationMethodResult(value, operationContext) {
    return importData(value, operationContext, MUTATION_RESULT)
}

function importContext(value, operationContext, externalMutationTreeSetup) {
    return importData(
        value,
        operationContext,
        CONTEXT_IMPORT,
        externalMutationTreeSetup,
    )
}

function importData(
    value,
    operationContext,
    policy,
    externalMutationTreeSetup,
) {
    return errorUtils.runInternalStep(operationContext, () => {
        try {
            return continueOperation(
                value,
                operationContext,
                root =>
                    prepareImportedData(
                        root,
                        operationContext,
                        policy,
                        externalMutationTreeSetup,
                    ),
                reason =>
                    errorUtils.createPoisonError(
                        reason,
                        operationContext,
                        policy.kind,
                    ),
            )
        } finally {
            // Tree discovery belongs only to the issuing segment.
            externalMutationTreeSetup = undefined
        }
    })
}

export {
    importValue as import,
    importContext,
    importMethodResult,
    importManagedMutationMethodResult,
}
