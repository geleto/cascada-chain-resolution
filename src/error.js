const CONTEXTLESS_ERROR_CONTEXT = Symbol("contextless Error source")
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor

const ERROR_KIND = Object.freeze({
    AsyncCallback: "AsyncCallback",
    AssignmentValueError: "AssignmentValueError",
    AssignmentValueRejected: "AssignmentValueRejected",
    ChainValueError: "ChainValueError",
    ChainValueRejected: "ChainValueRejected",
    ContextValueError: "ContextValueError",
    ContextValueRejected: "ContextValueRejected",
    ConversionThrew: "ConversionThrew",
    DivideByZero: "DivideByZero",
    ExportThrew: "ExportThrew",
    ExportValueError: "ExportValueError",
    ImportBindingMissing: "ImportBindingMissing",
    ImportThrew: "ImportThrew",
    IncompatibleOperands: "IncompatibleOperands",
    InvalidArrayLength: "InvalidArrayLength",
    InvalidArrayOperation: "InvalidArrayOperation",
    InvalidCallbackResult: "InvalidCallbackResult",
    InvalidConcurrentLimit: "InvalidConcurrentLimit",
    InvalidImportValue: "InvalidImportValue",
    InvalidManagedReceiver: "InvalidManagedReceiver",
    InvalidPathSegment: "InvalidPathSegment",
    InvalidTextValue: "InvalidTextValue",
    IteratorThrew: "IteratorThrew",
    LoadFailed: "LoadFailed",
    LookupThrew: "LookupThrew",
    MissingFunction: "MissingFunction",
    Multiple: "Multiple",
    NaNResult: "NaNResult",
    NotAFunction: "NotAFunction",
    NotDestructurable: "NotDestructurable",
    NotIterable: "NotIterable",
    NullLookup: "NullLookup",
    OperationInputError: "OperationInputError",
    OperationInputRejected: "OperationInputRejected",
    PropertyMutationThrew: "PropertyMutationThrew",
    PropertyValidation: "PropertyValidation",
    ScalarLookup: "ScalarLookup",
    ThenAccessThrew: "ThenAccessThrew",
    ThenInvocationThrew: "ThenInvocationThrew",
    UnknownVariable: "UnknownVariable",
    UserCallThrew: "UserCallThrew",
    UnsupportedMutation: "UnsupportedMutation",
})

class CascadaError extends Error {
    constructor(message, errorContext, options = undefined) {
        if (errorContext === undefined) {
            throw new TypeError("Cascada Errors require source context")
        }
        super(message, options)
        this.errorContext = errorContext
    }
}

class PoisonError extends CascadaError {
    constructor(message, errorContext, kind, options = undefined) {
        if (typeof kind !== "string" || !kind) {
            throw new TypeError("Poison Errors require a failure kind")
        }
        super(message, errorContext, options)
        this.name = "PoisonError"
        this.kind = kind
    }
}

class CompoundPoisonError extends PoisonError {
    constructor(errors, message) {
        const kinds = [...new Set(errors.map(error => error.kind))]
        super(
            message,
            errors[0].errorContext,
            kinds.length === 1 ? kinds[0] : ERROR_KIND.Multiple,
        )
        this.name = "CompoundPoisonError"
        this.errors = errors
        this.kinds = kinds
    }
}

class RuntimeError extends CascadaError {
    #reported = false

    constructor(cause, errorContext) {
        super(
            errorMessage(cause, "Cascada runtime failed with a non-Error value"),
            errorContext,
            { cause },
        )
        this.name = "RuntimeError"
    }

    report(reporter) {
        if (!this.#reported) {
            this.#reported = true
            try {
                reporter(this)
            } catch {
                // Reporting must never replace the fatal error being thrown.
            }
        }
        throw this
    }
}

class UserCodeFailure extends Error {
    constructor(error) {
        super("Supported user code failed")
        this.error = error
    }
}

let fatalReporter = () => {}
let userCodeDepth = 0

function reportFatalError(error) {
    const failure = Error.isError(error) && error instanceof RuntimeError
        ? error
        : new RuntimeError(error, CONTEXTLESS_ERROR_CONTEXT)
    return failure.report(fatalReporter)
}

function setFatalErrorReporter(reporter = () => {}) {
    fatalReporter = reporter
}

function runFatal(operationContext, fn, value = undefined) {
    if (
        operationContext?.execution === undefined ||
        operationContext.errorContext === undefined
    ) {
        return reportFatalError(new RuntimeError(
            new TypeError("Operation context requires execution and errorContext"),
            CONTEXTLESS_ERROR_CONTEXT,
        ))
    }
    return runFatalWork(operationContext.errorContext, fn, value)
}

function runContextlessFatal(fn, value = undefined) {
    return runFatalWork(CONTEXTLESS_ERROR_CONTEXT, fn, value)
}

function runFatalWork(errorContext, fn, value) {
    try {
        if (userCodeDepth > 0) {
            throw new Error("Cascada cannot be re-entered from supported user code")
        }
        return fn(value)
    } catch (error) {
        const userFailure = Error.isError(error) &&
            error instanceof UserCodeFailure
        if (userFailure) {
            // Contextless configuration preserves the raw host failure. At an
            // operation boundary, an uncaught signal means its owner failed to
            // classify supported user code and is therefore a runtime bug.
            if (errorContext === CONTEXTLESS_ERROR_CONTEXT) {
                return error.error
            }
        }
        const failure = Error.isError(error) && error instanceof RuntimeError
            ? error
            : new RuntimeError(
                userFailure ? error.error : error,
                errorContext,
            )
        return reportFatalError(failure)
    }
}

// Reflection hooks, controlled callbacks, and host calls are supported user
// code. The nearest semantic boundary converts this private raw-failure signal.
function runUserCode(fn) {
    userCodeDepth++
    try {
        return fn()
    } catch (error) {
        if (Error.isError(error) && (
            error instanceof RuntimeError ||
            error instanceof UserCodeFailure
        )) {
            throw error
        }
        throw new UserCodeFailure(error)
    } finally {
        userCodeDepth--
    }
}

function isFatalError(error) {
    return Error.isError(error) && error instanceof RuntimeError
}

function catchUserCodeFailure(fn, operationContext, kind, onFailure = value => value) {
    return catchRawUserCodeFailure(
        fn,
        error => onFailure(toPoison(error, operationContext, kind)),
    )
}

function catchRawUserCodeFailure(fn, onFailure) {
    try {
        return fn()
    } catch (error) {
        if (!Error.isError(error) || !(error instanceof UserCodeFailure)) throw error
        return onFailure(error.error)
    }
}

function validationError(message, operationContext, kind) {
    return new PoisonError(message, operationContext.errorContext, kind)
}

function hostValidationError(message) {
    return new Error(message)
}

function pathAccessError(value, operationContext) {
    const kind = value === null || value === undefined
        ? ERROR_KIND.NullLookup
        : ERROR_KIND.ScalarLookup
    return validationError(
        "Cannot access property through missing or primitive value",
        operationContext,
        kind,
    )
}

function combineErrors(errors, message) {
    const distinct = []
    const causes = new Set()
    for (const error of flattenErrors(errors)) {
        const cause = error.cause ?? error
        if (causes.has(cause)) continue
        causes.add(cause)
        distinct.push(error)
    }
    if (distinct.length < 2) return distinct[0]
    return new CompoundPoisonError(distinct, message)
}

function* flattenErrors(errors) {
    for (const error of errors) {
        if (error instanceof CompoundPoisonError) yield* error.errors
        else yield error
    }
}

function toPoison(reason, operationContext, kind) {
    const isError = Error.isError(reason)
    if (isError && (
        reason instanceof RuntimeError ||
        reason instanceof PoisonError
    )) return reason
    return new PoisonError(
        errorMessage(reason, "User code failed with a non-Error value"),
        operationContext.errorContext,
        kind,
        { cause: reason },
    )
}

function errorMessage(reason, objectFallback) {
    if (Error.isError(reason)) {
        // Reading through a descriptor cannot invoke a host `message` getter.
        const descriptor = getOwnPropertyDescriptor(reason, "message")
        return descriptor && "value" in descriptor &&
            typeof descriptor.value === "string"
            ? descriptor.value
            : objectFallback
    }
    return reason === null || (
        typeof reason !== "object" &&
        typeof reason !== "function"
    )
        ? String(reason)
        : objectFallback
}

export {
    CascadaError,
    CompoundPoisonError,
    CONTEXTLESS_ERROR_CONTEXT,
    ERROR_KIND,
    PoisonError,
    RuntimeError,
    catchRawUserCodeFailure,
    catchUserCodeFailure,
    combineErrors,
    hostValidationError,
    isFatalError,
    pathAccessError,
    reportFatalError,
    runContextlessFatal,
    runFatal,
    runUserCode,
    setFatalErrorReporter,
    toPoison,
    validationError,
}
