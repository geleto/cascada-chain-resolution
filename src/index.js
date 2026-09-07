import { returnOperationResult } from "./operation-result.js"
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
} from "./observations.js"
import { import as importCore } from "./import.js"
import {
    assignPath as assignPathCore,
    deletePath as deletePathCore,
} from "./mutations.js"
import { run as runCore } from "./run.js"
import {
    externalState,
    managedState,
    managedStateClass,
} from "./data-declarations.js"

function importValue(value, operationContext) {
    const result = importCore(value, operationContext)
    return returnOperationResult(operationContext, result)
}

function lookupPath(chain, path, operationContext) {
    const result = lookupPathCore(chain, path, operationContext)
    return returnOperationResult(operationContext, result)
}

function exportValue(chain, path, operationContext) {
    const result = exportPath(chain, path, operationContext)
    return returnOperationResult(operationContext, result)
}

function hasError(chain, path, operationContext) {
    const result = hasErrorCore(chain, path, operationContext)
    return returnOperationResult(operationContext, result)
}

function getErrors(chain, path, operationContext) {
    const result = getErrorsCore(chain, path, operationContext)
    return returnOperationResult(operationContext, result)
}

function run(chain, path, method, args, operationContext, facts) {
    const result = runCore(chain, path, method, args, operationContext, facts)
    return returnOperationResult(operationContext, result)
}

function enter(chain, path, operationContext, entryMutable, onEntered) {
    const result = enterCore(
        chain,
        path,
        operationContext,
        entryMutable,
        onEntered,
    )
    return returnOperationResult(operationContext, result)
}

function assignPath(
    chain,
    path,
    value,
    operationContext,
    mutationScopeDepth = path.length,
) {
    const result = assignPathCore(
        chain,
        path,
        value,
        operationContext,
        mutationScopeDepth,
    )
    return returnOperationResult(operationContext, result)
}

function deletePath(
    chain,
    path,
    operationContext,
    mutationScopeDepth = path.length,
) {
    const result = deletePathCore(
        chain,
        path,
        operationContext,
        mutationScopeDepth,
    )
    return returnOperationResult(operationContext, result)
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
    isFatalError,
    isPoisonError,
    lookupPath,
    managedState,
    managedStateClass,
    PoisonError,
    run,
}
