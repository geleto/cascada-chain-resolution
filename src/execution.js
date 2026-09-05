const ignore = () => {}
const states = new WeakMap()

function getFatalError() {
    return states.get(this).fatalError
}

class Execution {
    _metadata = new WeakMap()
    _externalIdentities = new WeakMap()

    constructor(reporter = ignore) {
        if (typeof reporter !== "function") {
            throw new TypeError("Execution reporter must be a function")
        }
        states.set(this, {
            fatalError: null,
            pendingResultRejectors: new Set(),
            reporter,
        })
        // Keep the authoritative query visible even if host code replaces the
        // instance prototype, and prevent an own property from shadowing it.
        Object.defineProperty(this, "fatalError", { get: getFatalError })
    }
}

function commitFatal(execution, candidate) {
    const state = states.get(execution)
    if (state.fatalError !== null) return state.fatalError

    state.fatalError = candidate
    for (const reject of state.pendingResultRejectors) reject(candidate)
    state.pendingResultRejectors.clear()
    const reporter = state.reporter
    try {
        reporter(candidate)
    } catch {
        // Reporting is notification and cannot replace fatal control flow.
    }
    return candidate
}

function registerFatalResultRejection(execution, reject) {
    const pending = states.get(execution).pendingResultRejectors
    pending.add(reject)
    return () => pending.delete(reject)
}

export {
    commitFatal,
    Execution,
    registerFatalResultRejection,
}
