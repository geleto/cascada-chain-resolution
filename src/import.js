import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import { prepareImportedData } from "./import-preparation.js"

const IMPORT_POLICY = {
    Context: {
        valueKind: errorUtils.ERROR_KIND.ContextValueError,
        rejectionKind: errorUtils.ERROR_KIND.ContextValueRejected,
    },
    MethodResult: {
        valueKind: errorUtils.ERROR_KIND.UserCallThrew,
        rejectionKind: errorUtils.ERROR_KIND.UserCallThrew,
    },
    ManagedMutationMethodResult: {
        valueKind: errorUtils.ERROR_KIND.UserCallThrew,
        rejectionKind: errorUtils.ERROR_KIND.UserCallThrew,
        retainAdmittedDescendants: true,
    },
}

function importValue(value, operationContext) {
    return importData(value, operationContext, IMPORT_POLICY.Context)
}

// Unlike ordinary import, revisit and retain admitted managed descendants.
function importManagedMutationMethodResult(value, operationContext) {
    return importData(
        value,
        operationContext,
        IMPORT_POLICY.ManagedMutationMethodResult,
    )
}

function importMethodResult(value, operationContext) {
    return importData(value, operationContext, IMPORT_POLICY.MethodResult)
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
    importPolicy,
    externalMutationTreeSetup = undefined,
) {
    return errorUtils.runInternalStep(operationContext, () => {
        // Discovery belongs only to work completed in the issuing segment.
        // Later root fulfillment starts ordinary import without tree authority.
        try {
            return languageValues.thenValue(
                value,
                root => errorUtils.runInternalStep(operationContext, () =>
                    prepareImportedData(root, operationContext, importPolicy, externalMutationTreeSetup)),
                reason => {
                    throw errorUtils.runInternalStep(operationContext, () => {
                        const failure = errorUtils.toPoison(reason, operationContext, importPolicy.rejectionKind)
                        if (errorUtils.isFatalError(failure)) throw failure
                        return failure
                    })
                },
                operationContext,
            )
        } catch (failure) {
            if (failure instanceof errorUtils.PoisonError) return failure
            throw failure
        } finally {
            externalMutationTreeSetup = undefined
        }
    })
}

export {
    importContext,
    importMethodResult,
    importManagedMutationMethodResult,
    importValue as import,
}
