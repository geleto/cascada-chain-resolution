import { runReceivingCommand } from "./ownership.js"
import * as errorUtils from "./error.js"
import * as propertyVersions from "./property-versions.js"
import { initializeHolder } from "./parent-placements.js"

class Chain {
    constructor(initialValue, operationContext, contextSetup) {
        runReceivingCommand(operationContext, () => {
            const rootState = initializeHolder({}, operationContext)
            propertyVersions.transferPlacement(
                contextSetup ? propertyVersions.prepareInputPlacement(initialValue, operationContext,
                    errorUtils.ERROR_KIND.ContextValueFailed, contextSetup) : { value: initialValue, present: true },
                rootState,
                "value",
                operationContext,
                undefined,
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
        const setup = { mutationAccessTree }
        super(initialValue, operationContext, setup)
        if (setup.tree !== undefined) this._externalMutationTree = setup.tree
    }
}

export {
    Chain,
    ContextChain,
}
