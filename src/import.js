import * as errorUtils from "./error.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as propertyVersions from "./property-versions.js"

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
    return errorUtils.runFatal(operationContext, () => {
        if (!languageValues.isPromise(value, operationContext)) {
            return prepareRoot(value, externalMutationTreeSetup)
        }
        return languageValues.continuePromise(
            value,
            operationContext,
            resolvedValue => errorUtils.runFatal(
                operationContext,
                prepareRoot,
                resolvedValue,
            ),
            reason => {
                throw errorUtils.toPoison(
                    reason,
                    operationContext,
                    importPolicy.rejectionKind,
                )
            },
        )

        function prepareRoot(root, treeSetup = undefined) {
            if (errorUtils.isFatalError(root)) throw root
            if (Error.isError(root)) {
                return errorUtils.toPoison(
                    root,
                    operationContext,
                    importPolicy.valueKind,
                )
            }
            if (!metadata.isObjectLike(root)) return root
            return propertyVersions.prepareImportedValue(
                root,
                operationContext,
                importPolicy,
                treeSetup,
            )
        }
    })
}

export {
    importContext,
    importHostResult,
    importManagedMutationResult,
    importValue as import,
}
