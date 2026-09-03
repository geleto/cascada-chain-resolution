import * as errorUtils from "./error.js"
import { importContext } from "./import.js"
import * as languageValues from "./language-values.js"
import * as propertyVersions from "./property-versions.js"

class Chain {
    constructor(
        initialValue,
        operationContext,
        entryMutable = undefined,
        externalMutationTree = undefined,
    ) {
        errorUtils.runFatal(operationContext, () => {
            initialValue = languageValues.valueWithOrigin(
                initialValue,
                operationContext,
                errorUtils.ERROR_KIND.ChainValueError,
                errorUtils.ERROR_KIND.ChainValueRejected,
            )
            languageValues.admitValue(initialValue, operationContext)
            const rootState = { value: initialValue }
            languageValues.admitReadyValue(
                rootState,
                operationContext,
                languageValues.TYPE_RECORD,
                Object.prototype,
            )
            if (languageValues.isPromise(initialValue, operationContext)) {
                propertyVersions.getOrCreatePromiseMirror(
                    rootState,
                    "value",
                    initialValue,
                    operationContext,
                )
            }
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
        scopeMutationPaths = [],
        propertyMutationPaths = [],
    ) {
        const externalMutationTreeSetup = {
            scopeMutationPaths,
            propertyMutationPaths,
        }
        const importedValue = importContext(
            initialValue,
            operationContext,
            externalMutationTreeSetup,
        )
        super(
            importedValue,
            operationContext,
            undefined,
            externalMutationTreeSetup.externalMutationTree,
        )
    }
}

export {
    Chain,
    ContextChain,
}
