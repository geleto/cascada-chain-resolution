import * as errorUtils from "./error.js"
import { importContext } from "./import.js"
import * as internalSteps from "./internal-step.js"
import * as languageValues from "./language-values.js"
import * as propertyVersions from "./property-versions.js"

class Chain {
    constructor(
        initialValue,
        operationContext,
        entryMutable = undefined,
        externalMutationTree = undefined,
    ) {
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
            // Entry-only tri-state: absent on ordinary Chains, false for a
            // read-only entry, and true for a mutable entry.
            if (entryMutable !== undefined) {
                this._entryMutable = entryMutable
            }
            if (externalMutationTree !== undefined) {
                this._externalMutationTree = externalMutationTree
            }
        })
    }

    _assertOpen() {
        if (!this._state || this._closed === true) {
            throw new Error("Cannot use a closed Chain")
        }
    }

    _assertOperationContext(operationContext) {
        this._assertOpen()
        if (operationContext.execution !== this._execution) {
            throw new Error("Operation context execution does not match Chain")
        }
    }

    _closeEntry() {
        this._assertOpen()
        if (this._entryMutable === undefined) {
            throw new Error("Cannot close a Chain outside enter")
        }
        this._closed = true
    }
}

class ContextChain extends Chain {
    constructor(
        initialValue,
        operationContext,
        mutationAccessTree = undefined,
    ) {
        // Establish the canonical context before import commits its locations.
        super(undefined, operationContext)
        internalSteps.runInternalStep(operationContext, () => {
            const setup = mutationAccessTree === undefined
                ? undefined : { context: this, mutationAccessTree }
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
