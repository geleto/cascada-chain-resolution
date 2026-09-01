import * as errorUtils from "./error.js"
import { Execution } from "./execution.js"
import { importContext } from "./import.js"
import * as languageValues from "./language-values.js"

class Chain {
    constructor(
        initialValue,
        execution = new Execution(),
        entryMutable = undefined,
        externalMutationTree = undefined,
    ) {
        languageValues.admitValue(initialValue)
        const state = { value: initialValue }
        languageValues.admitReadyValue(
            state,
            languageValues.TYPE_RECORD,
            Object.prototype,
        )
        this._state = state
        this._execution = execution
        // Entry-only tri-state: absent on ordinary Chains, false for a
        // read-only entry, and true for a mutable entry.
        if (entryMutable !== undefined) {
            this._entryMutable = entryMutable
        }
        if (externalMutationTree !== undefined) {
            this._externalMutationTree = externalMutationTree
        }
    }

    _assertOpen() {
        if (!this._state || this._closed === true) {
            errorUtils.reportFatalError(
                new Error("Cannot use a closed Chain"),
            )
        }
    }

    get execution() {
        this._assertOpen()
        return this._execution
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
        errorContext,
        execution = new Execution(),
        scopeMutationPaths = [],
        propertyMutationPaths = [],
    ) {
        const externalTreeSetup = {
            execution,
            scopeMutationPaths,
            propertyMutationPaths,
        }
        const imported = importContext(
            initialValue,
            errorContext,
            externalTreeSetup,
        )
        super(
            imported,
            execution,
            undefined,
            externalTreeSetup.externalMutationTree,
        )
    }
}

export {
    Chain,
    ContextChain,
}
