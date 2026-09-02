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
            languageValues.admitValue(initialValue, operationContext)
            const state = { value: initialValue }
            languageValues.admitReadyValue(
                state,
                operationContext,
                languageValues.TYPE_RECORD,
                Object.prototype,
            )
            if (languageValues.isPromise(initialValue, operationContext)) {
                propertyVersions.getOrCreatePromiseMirror(
                    state,
                    "value",
                    initialValue,
                    operationContext,
                )
            }
            this._state = state
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
            errorUtils.reportFatalError(
                new Error("Cannot use a closed Chain"),
            )
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
            errorUtils.reportFatalError(
                new Error("Cannot close a Chain outside enter"),
            )
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
        const externalTreeSetup = {
            scopeMutationPaths,
            propertyMutationPaths,
        }
        const imported = importContext(
            initialValue,
            operationContext,
            externalTreeSetup,
        )
        super(
            imported,
            operationContext,
            undefined,
            externalTreeSetup.externalMutationTree,
        )
    }
}

export {
    Chain,
    ContextChain,
}
