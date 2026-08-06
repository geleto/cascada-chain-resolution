import * as errorUtils from "./error.js"

const hasOwn = Object.prototype.hasOwnProperty

class Chain {
    constructor(initialValue, mutates = true) {
        if (mutates !== true && mutates !== false) {
            errorUtils.reportFatalError(
                new TypeError("Chain requires an exact mutates Boolean"),
            )
        }
        this._state = { value: initialValue }
        this._mutates = mutates
    }

    // Validate and return the issuance mode at the public operation boundary.
    // Continuations registered before closure keep their captured positions.
    assertState() {
        const state = this._state
        const mutates = this._mutates
        if (
            !state ||
            !hasOwn.call(this, "_mutates") ||
            (mutates !== true && mutates !== false)
        ) {
            errorUtils.reportFatalError(
                new Error("Cannot use a closed Chain"),
            )
        }
        return mutates
    }

    close() {
        this.assertState()
        delete this._mutates
    }
}

export { Chain }
