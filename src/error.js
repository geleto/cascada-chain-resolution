let fatalReporter = () => {}
const reportedFatalErrors = new WeakSet()

function isObjectLike(value) {
    return value !== null && (typeof value === "object" || typeof value === "function")
}

function reportFatalError(error) {
    if (!isObjectLike(error) || !reportedFatalErrors.has(error)) {
        if (isObjectLike(error)) reportedFatalErrors.add(error)
        try {
            fatalReporter(error)
        } catch {
            // Reporting must never replace the fatal error being thrown.
        }
    }
    throw error
}

function setFatalErrorReporter(reporter = () => {}) {
    if (typeof reporter !== "function") {
        reportFatalError(new TypeError("fatal reporter must be a function"))
    }
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
