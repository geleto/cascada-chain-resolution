const ignore = () => {}
const states = new WeakMap()

class Execution {
    _metadata = new WeakMap()
    _externalIdentities = new WeakMap()

    get fatalError() {
        return states.get(this).fatalError
    }

    constructor(reporter = ignore) {
        if (typeof reporter !== "function") {
            throw new TypeError("Execution reporter must be a function")
        }
        states.set(this, {
            fatalError: null,
            pendingResultRejectors: new Set(),
            reporter,
        })
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
