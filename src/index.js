import { returnOperationResult, returnExpressionResult, runManagedOperation, runOperation } from "./operation-result.js"
import { Chain, ContextChain } from "./chain.js"
import {
    CompoundPoisonError,
    ERROR_KIND,
    FatalError,
    isFatalError,
    isPoisonError,
    PoisonError,
} from "./error.js"
import { Execution } from "./execution.js"
import { enter as enterCore } from "./enter.js"
import {
    exportPath,
    getErrors as getErrorsCore,
    hasError as hasErrorCore,
    lookupPath as lookupPathCore,
    lookupPathForExpression as lookupPathForExpressionCore,
} from "./observations.js"
import { import as importCore, importMethodResult as importMethodResultCore } from "./import.js"
import {
    assignPath as assignPathCore,
    deletePath as deletePathCore,
} from "./mutate-property.js"
import { run as runCore } from "./run.js"
import { repairPath as repairPathCore } from "./path-operation.js"
import {
    externalState,
    managedState,
    managedStateClass,
} from "./data-declarations.js"

// Public commands share the receiving boundary and its input-release rule.
// Pass inputs directly, without closures retaining the wrapper's source bindings.
function importValue(value, operationContext) {
    return runManagedOperation(operationContext, importCore, [value, operationContext])
}

function lookupPath(chain, path, operationContext, firstDynamicSegment = path.length) {
    return runManagedOperation(operationContext, lookupPathCore, [chain, path, operationContext, firstDynamicSegment])
}

function lookupPathForExpression(chain, path, operationContext, firstDynamicSegment = path.length) {
    return runOperation(operationContext, lookupPathForExpressionCore,
        [chain, path, operationContext, firstDynamicSegment], returnExpressionResult)
}

function importMethodResult(value, operationContext) {
    return runManagedOperation(operationContext, importMethodResultCore, [value, operationContext])
}

function exportValue(chain, path, operationContext, firstDynamicSegment = path.length) {
    return runOperation(operationContext, exportPath, [chain, path, operationContext, firstDynamicSegment])
}

function hasError(chain, path, operationContext, firstDynamicSegment = path.length) {
    return runOperation(operationContext, hasErrorCore, [chain, path, operationContext, firstDynamicSegment])
}

function getErrors(chain, path, operationContext, firstDynamicSegment = path.length) {
    return runOperation(operationContext, getErrorsCore, [chain, path, operationContext, firstDynamicSegment])
}

function run(chain, path, method, args, operationContext, facts) {
    return runManagedOperation(operationContext, runCore, [chain, path, method, args, operationContext, facts])
}

function enter(chain, path, operationContext, entryMutable, onEntered, firstDynamicSegment = path.length) {
    return runManagedOperation(operationContext, enterCore,
        [chain, path, operationContext, entryMutable, onEntered, firstDynamicSegment])
}

function assignPath(
    chain,
    path,
    value,
    operationContext,
    mutationScopeDepth = path.length,
    firstDynamicSegment = path.length,
) {
    return runOperation(operationContext, assignPathCore,
        [chain, path, value, operationContext, mutationScopeDepth, firstDynamicSegment])
}

function deletePath(
    chain,
    path,
    operationContext,
    mutationScopeDepth = path.length,
    firstDynamicSegment = path.length,
) {
    return runOperation(operationContext, deletePathCore,
        [chain, path, operationContext, mutationScopeDepth, firstDynamicSegment])
}

function repairPath(chain, path, operationContext, firstDynamicSegment = path.length) {
    return runOperation(operationContext, repairPathCore, [chain, path, operationContext, firstDynamicSegment])
}

export {
    assignPath,
    Chain,
    CompoundPoisonError,
    ContextChain,
    deletePath,
    enter,
    ERROR_KIND,
    Execution,
    exportValue as export,
    externalState,
    FatalError,
    getErrors,
    hasError,
    importValue as import,
    importMethodResult,
    isFatalError,
    isPoisonError,
    lookupPath,
    lookupPathForExpression,
    managedState,
    managedStateClass,
    PoisonError,
    run,
    repairPath,
    returnOperationResult,
}

export { createPoisonedValue, isPoisonedValue } from "./poisoned-value.js"
export { createPoisonError, validationError, combineErrors, failExecution, runExternalBoundary } from "./error.js"
export { runInternalStep, continueOperation } from "./internal-step.js"
export { isPending } from "./language-values.js"
