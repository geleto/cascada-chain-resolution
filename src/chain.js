import * as errorUtils from "./error.js"

const hasOwn = Object.prototype.hasOwnProperty

class Chain {
    constructor(initialValue, mutates = true) {
        if (mutates !== true && mutates !== false) {
            errorUtils.reportFatalError(
                new TypeError("Chain requires an exact mutates Boolean"),
            )
        }
        this._state = {
            value: initialValue,
            mutates,
        }
    }

    // Check issuance once, at the public operation boundary. Continuations
    // registered before closure keep their captured mirror positions.
    assertState() {
        const state = this._state
        const mutates = state?.mutates
        if (
            !state ||
            !hasOwn.call(state, "mutates") ||
            (mutates !== true && mutates !== false)
        ) {
            errorUtils.reportFatalError(
                new Error("Cannot use a closed Chain"),
            )
        }
    }

    close() {
        this.assertState()
        delete this._state.mutates
    }
}

export { Chain }
