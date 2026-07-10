let fatalReporter = () => {}
const reportedErrors = new WeakSet()

function isObjectLike(value) {
    return value !== null && (typeof value === "object" || typeof value === "function")
}

function reportFatalError(error) {
    if (!isObjectLike(error) || !reportedErrors.has(error)) {
        if (isObjectLike(error)) reportedErrors.add(error)
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
    if (importContext === undefined) return new Error(message)
    return new Error(`${message} (imported at: ${String(importContext)})`)
}

function forbiddenKeyError(importContext = undefined) {
    return validationError("Cannot use __proto__ as a key", importContext)
}

function errorFromRejection(reason) {
    return reason instanceof Error ? reason : new Error(String(reason))
}

module.exports = {
    errorFromRejection,
    forbiddenKeyError,
    reportFatalError,
    setFatalErrorReporter,
    validationError,
}
