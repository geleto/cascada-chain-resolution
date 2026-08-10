let fatalReporter = () => {}
const reportedFatalErrors = new WeakSet()
let userCodeDepth = 0

class UserCodeFailure {
    constructor(error) {
        this.error = error
    }
}

function reportFatalError(error) {
    const isObjectLike = error !== null &&
        (typeof error === "object" || typeof error === "function")
    if (!isObjectLike || !reportedFatalErrors.has(error)) {
        if (isObjectLike) reportedFatalErrors.add(error)
        try {
            fatalReporter(error)
        } catch {
            // Reporting must never replace the fatal error being thrown.
        }
    }
    throw error
}

function setFatalErrorReporter(reporter = () => {}) {
    fatalReporter = reporter
}

function runFatal(fn, value = undefined) {
    if (userCodeDepth > 0) {
        reportFatalError(
            new Error("Cascada cannot be re-entered from supported user code"),
        )
    }
    try {
        return fn(value)
    } catch (error) {
        if (error instanceof UserCodeFailure) return error.error
        return reportFatalError(error)
    }
}

// Reflection hooks, controlled callbacks, and host calls are supported user
// code. Their failures are language data, but a fatal raised inside them must
// keep crossing the boundary unchanged. The depth covers callbacks and
// coercions performed synchronously by a host call, so public re-entry from
// anywhere in that dynamic extent is rejected by runFatal.
function runUserCode(fn) {
    userCodeDepth++
    try {
        return fn()
    } catch (error) {
        if (isFatalError(error)) throw error
        if (error instanceof UserCodeFailure) throw error
        throw new UserCodeFailure(toPoison(error))
    } finally {
        userCodeDepth--
    }
}

function isFatalError(error) {
    return error !== null &&
        (typeof error === "object" || typeof error === "function") &&
        reportedFatalErrors.has(error)
}

// Recover only the private signal from an exact user-code boundary. Every
// ordinary throw keeps crossing toward the fatal boundary.
function recoverUserCodeFailure(fn, recover) {
    try {
        return fn()
    } catch (error) {
        if (!(error instanceof UserCodeFailure)) throw error
        return recover(error.error)
    }
}

function validationError(message, errorContext = undefined) {
    if (!errorContext) return new Error(message)
    return new Error(`${message} (imported at: ${String(errorContext)})`)
}

function pathAccessError() {
    return new Error("Cannot access property through missing or primitive value")
}

function toPoison(reason) {
    if (Error.isError(reason)) return reason
    const type = typeof reason
    const message = reason === null ||
        (type !== "object" && type !== "function")
        ? String(reason)
        : "User code failed with a non-Error value"
    return new Error(message, { cause: reason })
}

export {
    pathAccessError,
    recoverUserCodeFailure,
    reportFatalError,
    runFatal,
    runUserCode,
    setFatalErrorReporter,
    toPoison,
    validationError,
}
