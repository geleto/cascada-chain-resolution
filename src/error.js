let fatalReporter = () => {}
const reportedFatalErrors = new WeakSet()

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

function validationError(message, importContext = undefined) {
    if (!importContext) return new Error(message)
    return new Error(`${message} (imported at: ${String(importContext)})`)
}

function createCycleError(key, importContext) {
    return validationError(
        `Cyclic property "${String(key)}"`,
        importContext,
    )
}

function pathAccessError() {
    return new Error("Cannot access property through missing or primitive value")
}

function errorFromRejection(reason) {
    return reason instanceof Error ? reason : new Error(String(reason))
}

module.exports = {
    createCycleError,
    errorFromRejection,
    pathAccessError,
    reportFatalError,
    setFatalErrorReporter,
    validationError,
}
