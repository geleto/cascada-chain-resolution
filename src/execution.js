const ignore = () => {}

class Execution {
    #fatalError = null
    #pendingResultRejectors = new Set()
    #reporter

    _metadata = new WeakMap()
    _externalIdentities = new WeakMap()
    _externalActionActive = false

    get fatalError() {
        return this.#fatalError
    }

    constructor(reporter = ignore) {
        if (typeof reporter !== "function") {
            throw new TypeError("Execution reporter must be a function")
        }
        this.#reporter = reporter
    }

    fail(candidate) {
        if (this.#fatalError !== null) return this.#fatalError

        this.#fatalError = candidate
        for (const reject of this.#pendingResultRejectors) reject(candidate)
        this.#pendingResultRejectors.clear()
        const reporter = this.#reporter
        try {
            reporter(candidate)
        } catch {
            // Reporting is notification and cannot replace fatal control flow.
        }
        return candidate
    }

    registerFatalResultRejection(reject) {
        this.#pendingResultRejectors.add(reject)
        return () => this.#pendingResultRejectors.delete(reject)
    }
}

export { Execution }
