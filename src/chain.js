import * as errorUtils from "./error.js"
import { importContext } from "./import.js"
import * as internalSteps from "./internal-step.js"
import * as languageValues from "./language-values.js"
import * as propertyVersions from "./property-versions.js"

class Chain {
    constructor(initialValue, operationContext) {
        internalSteps.runInternalStep(operationContext, () => {
            const rootState = {}
            languageValues.admitReadyValue(
                rootState, operationContext, languageValues.TYPE.Record, Object.prototype,
            )
            propertyVersions.assignProperty(
                rootState,
                "value",
                initialValue,
                operationContext,
                false,
                errorUtils.ERROR_KIND.ChainValueFailed,
            )
            this._state = rootState
            this._execution = operationContext.execution
        })
    }

    _assertOperationContext(operationContext) {
        if (this._closed) {
            throw new Error("Cannot use a closed Chain")
        }
        if (operationContext.execution !== this._execution) {
            throw new Error("Operation context execution does not match Chain")
        }
    }
}

class ContextChain extends Chain {
    constructor(
        initialValue,
        operationContext,
        mutationAccessTree = undefined,
    ) {
        super(undefined, operationContext)
        internalSteps.runInternalStep(operationContext, () => {
            const setup = mutationAccessTree === undefined
                ? undefined : { mutationAccessTree }
            const importedValue = importContext(initialValue, operationContext, setup)
            if (setup?.tree !== undefined) this._externalMutationTree = setup.tree
            propertyVersions.assignProperty(
                this._state, "value", importedValue, operationContext,
                false, errorUtils.ERROR_KIND.ChainValueFailed,
            )
        })
    }
}

export {
    Chain,
    ContextChain,
}
