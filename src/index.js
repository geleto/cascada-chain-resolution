import { Chain, ContextChain } from "./chain.js"
import {
    CascadaError,
    CompoundPoisonError,
    ERROR_KIND,
    FatalError,
    isFatalError,
    PoisonError,
} from "./error.js"
import { registerFatalResultRejection, Execution } from "./execution.js"
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
import * as languageValues from "./language-values.js"
import { markPromiseHandled } from "./resolution.js"
import {
    externalState,
    managedState,
    managedStateClass,
} from "./state-declarations.js"

function returnOperationResult(operationContext, result) {
    if (
        Error.isError(result) ||
        !languageValues.isPending(result, operationContext)
    ) return result

    const execution = operationContext.execution
    const {
        promise: exposedResult,
        resolve,
        reject,
    } = Promise.withResolvers()
    const unregister = registerFatalResultRejection(execution, reject)
    const settle = (settlement, value) => {
        unregister()
        settlement(value)
    }
    const bridge = languageValues.thenValue(
        result,
        value => settle(resolve, value),
        reason => settle(reject, reason),
        operationContext,
    )
    markPromiseHandled(bridge)
    return exposedResult
}

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
    CascadaError,
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
    lookupPath,
    managedState,
    managedStateClass,
    PoisonError,
    run,
}
