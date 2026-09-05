import { commitFatal } from "./execution.js"

const CONTEXTLESS_ERROR_CONTEXT = Symbol("contextless Error source")
const FATAL_ERROR_TOKEN = Symbol("FatalError construction")
const fatalErrors = new WeakSet()
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

class FatalError extends Error {
    constructor(token, cause, errorContext) {
        if (token !== FATAL_ERROR_TOKEN) {
            throw new TypeError("FatalError cannot be constructed directly")
        }
        super(
            errorMessage(cause, "Cascada execution failed with a non-Error value"),
            { cause },
        )
        this.name = "FatalError"
        this.errorContext = errorContext
        fatalErrors.add(this)
        Object.freeze(this)
    }
}

Object.defineProperty(FatalError.prototype, "then", { value: undefined })
Object.freeze(FatalError.prototype)

class UserCodeFailure extends Error {
    constructor(error) {
        super("Supported user code failed")
        this.error = error
    }
}

let userCodeDepth = 0

function createFatalError(reason, errorContext) {
    return isFatalError(reason)
        ? reason
        : new FatalError(FATAL_ERROR_TOKEN, reason, errorContext)
}

function failExecution(operationContext, reason) {
    const candidate = createFatalError(reason, operationContext.errorContext)
    throw commitFatal(operationContext.execution, candidate)
}

function runOrFailExecution(operationContext, fn, value = undefined) {
    if (
        operationContext?.execution === undefined ||
        operationContext.errorContext === undefined
    ) {
        return runContextlessFatal(() => {
            throw new TypeError("Operation context requires execution and errorContext")
        })
    }
    const fatalError = operationContext.execution.fatalError
    if (fatalError !== null) throw fatalError

    try {
        if (userCodeDepth > 0) {
            throw new Error("Cascada cannot be re-entered from supported user code")
        }
        return fn(value)
    } catch (error) {
        const userFailure = Error.isError(error) &&
            error instanceof UserCodeFailure
        return failExecution(
            operationContext,
            userFailure ? error.error : error,
        )
    }
}

function runContextlessFatal(fn, value = undefined) {
    try {
        if (userCodeDepth > 0) {
            throw new Error("Cascada cannot be re-entered from supported user code")
        }
        return fn(value)
    } catch (error) {
        if (Error.isError(error) && error instanceof UserCodeFailure) {
            // Declaration probes keep their transitional validation behavior
            // until Phase 9D-A gives those local catches their final shape.
            return error.error
        }
        throw createFatalError(error, CONTEXTLESS_ERROR_CONTEXT)
    }
}

// Reflection hooks, controlled callbacks, and host calls are supported user
// code. The nearest semantic boundary converts this private raw-failure signal.
function runUserCode(fn) {
    userCodeDepth++
    try {
        return fn()
    } catch (error) {
        if (isFatalError(error) || (
            Error.isError(error) && error instanceof UserCodeFailure
        )) {
            throw error
        }
        throw new UserCodeFailure(error)
    } finally {
        userCodeDepth--
    }
}

function isFatalError(error) {
    return Error.isError(error) && fatalErrors.has(error)
}

function catchUserCodeFailure(fn, operationContext, kind, onFailure = value => value) {
    try {
        const result = fn()
        const fatalError = operationContext.execution.fatalError
        if (fatalError !== null) throw fatalError
        return result
    } catch (error) {
        const fatalError = operationContext.execution.fatalError
        if (fatalError !== null) throw fatalError
        if (!Error.isError(error) || !(error instanceof UserCodeFailure)) throw error
        return onFailure(toPoison(error.error, operationContext, kind))
    }
}

function catchRawUserCodeFailure(fn, onFailure, operationContext = undefined) {
    try {
        const result = fn()
        const fatalError = operationContext?.execution.fatalError
        if (fatalError) throw fatalError
        return result
    } catch (error) {
        const fatalError = operationContext?.execution.fatalError
        if (fatalError) throw fatalError
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
    if (isError && (isFatalError(reason) || reason instanceof PoisonError)) {
        return reason
    }
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
    FatalError,
    PoisonError,
    catchRawUserCodeFailure,
    catchUserCodeFailure,
    combineErrors,
    failExecution,
    hostValidationError,
    isFatalError,
    pathAccessError,
    runContextlessFatal,
    runOrFailExecution,
    runUserCode,
    toPoison,
    validationError,
}
