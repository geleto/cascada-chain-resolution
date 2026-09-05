import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import { prepareImportedData } from "./import-preparation.js"

const CONTEXT_IMPORT_POLICY = {
    valueKind: errorUtils.ERROR_KIND.ContextValueError,
    rejectionKind: errorUtils.ERROR_KIND.ContextValueRejected,
}

const HOST_RESULT_IMPORT_POLICY = {
    valueKind: errorUtils.ERROR_KIND.UserCallThrew,
    rejectionKind: errorUtils.ERROR_KIND.UserCallThrew,
}

const MANAGED_MUTATION_RESULT_IMPORT_POLICY = {
    ...HOST_RESULT_IMPORT_POLICY,
    shareAdmittedGraph: true,
}

function importValue(value, operationContext) {
    return importData(value, operationContext, CONTEXT_IMPORT_POLICY)
}

// Unlike ordinary import, revisit and share admitted managed descendants.
function importManagedMutationResult(value, operationContext) {
    return importData(
        value,
        operationContext,
        MANAGED_MUTATION_RESULT_IMPORT_POLICY,
    )
}

function importHostResult(value, operationContext) {
    return importData(value, operationContext, HOST_RESULT_IMPORT_POLICY)
}

function importContext(value, operationContext, externalMutationTreeSetup) {
    return importData(
        value,
        operationContext,
        CONTEXT_IMPORT_POLICY,
        externalMutationTreeSetup,
    )
}

function importData(
    value,
    operationContext,
    importPolicy,
    externalMutationTreeSetup = undefined,
) {
    return errorUtils.runOrFailExecution(operationContext, () => {
        // Discovery belongs only to work completed in the issuing segment.
        // Later root fulfillment starts ordinary import without tree authority.
        try {
            return languageValues.consumeValue(
                value,
                operationContext,
                root => errorUtils.runOrFailExecution(operationContext, () =>
                    prepareImportedData(root, operationContext, importPolicy, externalMutationTreeSetup)),
                reason => {
                    throw errorUtils.runOrFailExecution(operationContext, () => {
                        const failure = errorUtils.toPoison(reason, operationContext, importPolicy.rejectionKind)
                        if (errorUtils.isFatalError(failure)) throw failure
                        return failure
                    })
                },
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
    importHostResult,
    importManagedMutationResult,
    importValue as import,
}
