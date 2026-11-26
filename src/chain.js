import { runReceivingCommand } from "./ownership.js"
import * as errorUtils from "./error.js"
import * as propertyVersions from "./property-versions.js"
import { initializeHolder } from "./parent-placements.js"

const CHAIN_MODE = Object.freeze({ Complete: 0, Sequential: 1, Unordered: 2 })

function initializeChain(holder, placement, operationContext, mode, kind) {
    const root = initializeHolder({}, operationContext)
    propertyVersions.transferPlacement(placement, root, "value", operationContext, undefined, kind)
    holder._state = root
    holder._execution = operationContext.execution
    holder._mode = mode
    return holder
}

function chainFromPlacement(placement, operationContext, mode) {
    return initializeChain(Object.create(Chain.prototype), placement, operationContext, mode)
}

// Keep the constructor's implicit receiver out of retained diagnostic frames.
function constructChain(holder, initialValue, operationContext, mode, setup) {
    try {
        runReceivingCommand(operationContext, () => {
            const placement = setup ? propertyVersions.prepareInputPlacement(initialValue, operationContext,
                errorUtils.ERROR_KIND.ContextValueFailed, setup) : { value: initialValue, present: true }
            initializeChain(holder, placement, operationContext, mode, errorUtils.ERROR_KIND.ChainValueFailed)
            if (setup?.tree !== undefined) holder._externalMutationTree = setup.tree
        })
        return holder
    } finally { holder = initialValue = setup = undefined }
}

class Chain {
    constructor(initialValue, operationContext, mode = CHAIN_MODE.Unordered) {
        try { return constructChain(Object.create(new.target.prototype), initialValue, operationContext, mode) }
        finally { initialValue = undefined }
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
        mode = CHAIN_MODE.Unordered,
    ) {
        try { return constructChain(Object.create(new.target.prototype), initialValue, operationContext, mode, { mutationAccessTree }) }
        finally { initialValue = mutationAccessTree = undefined }
    }
}

export {
    Chain,
    ContextChain,
    chainFromPlacement,
    CHAIN_MODE,
}
