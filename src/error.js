const externalThrows = new WeakMap()
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor

const ERROR_KIND = Object.freeze({
    ChainValueFailed: "ChainValueFailed",
    ContextValueFailed: "ContextValueFailed",
    AssignmentValueFailed: "AssignmentValueFailed",
    OperationInputFailed: "OperationInputFailed",
    PathSegmentFailed: "PathSegmentFailed",
    InvalidPathSegment: "InvalidPathSegment",
    ThenAccessFailed: "ThenAccessFailed",
    ThenInvocationFailed: "ThenInvocationFailed",
    ImportReflectionFailed: "ImportReflectionFailed",
    NullLookup: "NullLookup",
    ScalarLookup: "ScalarLookup",
    LookupReflectionFailed: "LookupReflectionFailed",
    InvalidExpressionValue: "InvalidExpressionValue",
    QueryReflectionFailed: "QueryReflectionFailed",
    MissingFunction: "MissingFunction",
    NotAFunction: "NotAFunction",
    InvocationFailed: "InvocationFailed",
    ControlledCallbackFailed: "ControlledCallbackFailed",
    InvalidCallbackResult: "InvalidCallbackResult",
    ScalarConversionFailed: "ScalarConversionFailed",
    UnsupportedMutation: "UnsupportedMutation",
    ExportReflectionFailed: "ExportReflectionFailed",
    PropertyMutationFailed: "PropertyMutationFailed",
    PropertyValidation: "PropertyValidation",
    InvalidManagedReceiver: "InvalidManagedReceiver",
    InvalidArrayLength: "InvalidArrayLength",
    InvalidArrayOperation: "InvalidArrayOperation",
    ExternalLocationConflict: "ExternalLocationConflict",
    ExternalPropertyReadFailed: "ExternalPropertyReadFailed",
    ExternalPropertyWriteFailed: "ExternalPropertyWriteFailed",
    ExternalPropertyDeleteFailed: "ExternalPropertyDeleteFailed",
    InvalidExternalContainment: "InvalidExternalContainment",
    ExternalCapabilityEscape: "ExternalCapabilityEscape",
    InvalidExternalSnapshot: "InvalidExternalSnapshot",
    ExternalRepairFailed: "ExternalRepairFailed",
    DivideByZero: "DivideByZero",
    ImportBindingMissing: "ImportBindingMissing",
    IncompatibleOperands: "IncompatibleOperands",
    InvalidConcurrentLimit: "InvalidConcurrentLimit",
    InvalidTextValue: "InvalidTextValue",
    IteratorFailed: "IteratorFailed",
    LoadFailed: "LoadFailed",
    NaNResult: "NaNResult",
    NotDestructurable: "NotDestructurable",
    NotIterable: "NotIterable",
    UnknownVariable: "UnknownVariable",
    Multiple: "Multiple",
})

class PoisonError extends Error {
    constructor(message, errorContext, kind, options) {
        super(message, options)
        this.name = "PoisonError"
        this.errorContext = errorContext
        this.kind = kind
    }
}

class CompoundPoisonError extends PoisonError {
    constructor(leaves, message) {
        const kind = leaves.every(error => error.kind === leaves[0].kind)
            ? leaves[0].kind
            : ERROR_KIND.Multiple
        super(message, leaves[0].errorContext, kind)
        this.name = "CompoundPoisonError"
        this.errors = Object.freeze(leaves)
    }
}

class FatalError extends Error {
    constructor(cause, errorContext) {
        super(
            errorMessage(cause, "Cascada execution failed with a non-Error value"),
            { cause },
        )
        this.name = "FatalError"
        this.errorContext = errorContext
    }
}

function isPoisonError(error) {
    return Error.isError(error) && error instanceof PoisonError
}
function isFatalError(error) {
    return Error.isError(error) && error instanceof FatalError
}

function createFatalError(reason, errorContext) {
    return isFatalError(reason)
        ? reason
        : Object.freeze(new FatalError(reason, errorContext))
}

function failExecution(operationContext, reason) {
    throw operationContext.execution.fail(
        createFatalError(reason, operationContext.errorContext),
    )
}

// Entry and continuation callers select live work before this shared envelope.
// It classifies escaping defects; it does not repeat their routing/lifetime checks.
function runWithFatalGuard(operationContext, work, value) {
    try {
        if (operationContext.execution._externalActionActive) {
            throw new Error(
                "Cascada execution cannot be re-entered from external code",
            )
        }
        return work(value)
    } catch (reason) {
        failExecution(
            operationContext,
            externalThrows.has(reason) ? externalThrows.get(reason) : reason,
        )
    }
}

// Only this exact-action producer creates the private escape marker. The owning
// operation supplies classification after shared graph helpers unwind.
function runExternalAction(operationContext, action) {
    const execution = operationContext.execution
    const previousExternalActionActive = execution._externalActionActive
    let result
    let failure
    let failed = false
    execution._externalActionActive = true
    try {
        result = action()
    } catch (reason) {
        failed = true
        failure = reason
    } finally {
        execution._externalActionActive = previousExternalActionActive
    }
    const fatal = execution.fatalError
    if (fatal !== null) throw fatal
    if (!failed) return result
    if (isFatalError(failure)) failExecution(operationContext, failure)
    const marker = {}
    externalThrows.set(marker, failure)
    throw marker
}

// Consume only runExternalAction's private escape marker. An ordinary internal throw
// passes through unchanged to the fatal guard, even when it is a PoisonError.
function catchExternalThrow(
    work,
    operationContext,
    kind,
    onFailure = value => value,
) {
    let failure
    try {
        return work()
    } catch (reason) {
        if (!externalThrows.has(reason)) throw reason
        failure = externalThrows.get(reason)
    }
    // Contextualization and the owning transition's failure effect are outside
    // recovery. A defect in either must escape to the fatal envelope.
    return onFailure(createPoisonError(failure, operationContext, kind))
}

// A complete language-result boundary also contextualizes returned native Errors.
// Shared reflection helpers instead use the producer/consumer split above.
function runExternalBoundary(operationContext, kind, action) {
    const value = catchExternalThrow(
        () => runExternalAction(operationContext, action),
        operationContext,
        kind,
    )
    return Error.isError(value)
        ? createPoisonError(value, operationContext, kind)
        : value
}

function createPoisonError(reason, operationContext, kind) {
    if (isFatalError(reason)) failExecution(operationContext, reason)
    if (isPoisonError(reason)) return reason
    return Object.freeze(
        new PoisonError(
            errorMessage(reason, "External action failed with a non-Error value"),
            operationContext.errorContext,
            kind,
            { cause: reason },
        ),
    )
}

function validationError(message, operationContext, kind) {
    return Object.freeze(
        new PoisonError(
            message,
            operationContext.errorContext,
            kind,
        ),
    )
}

function declarationValidationError(message) {
    return new TypeError(message)
}

function pathAccessError(value, operationContext) {
    return validationError(
        "Cannot access property through missing or primitive value",
        operationContext,
        value === null || value === undefined
            ? ERROR_KIND.NullLookup
            : ERROR_KIND.ScalarLookup,
    )
}

// Every CompoundPoisonError already contains leaves, so one-level expansion is
// sufficient for both compound construction and Error queries.
function flattenAndDeduplicateErrors(errors) {
    const distinct = []
    const causes = new Map()
    for (const error of errors) {
        if (!isPoisonError(error))
            throw new TypeError("Error collection requires poison")
        if (error instanceof CompoundPoisonError) {
            for (const leaf of error.errors) addLeaf(leaf)
        } else {
            addLeaf(error)
        }
    }
    return distinct

    function addLeaf(error) {
        const cause = Object.hasOwn(error, "cause") ? error.cause : error
        let sources = causes.get(cause)
        if (!sources) causes.set(cause, (sources = new Map()))
        let kinds = sources.get(error.errorContext)
        if (!kinds) sources.set(error.errorContext, (kinds = new Set()))
        if (kinds.has(error.kind)) return
        kinds.add(error.kind)
        distinct.push(error)
    }
}

function combineErrors(errors, message) {
    const leaves = flattenAndDeduplicateErrors(errors)
    if (leaves.length === 0)
        throw new TypeError("Error combination requires at least one poison")
    return leaves.length === 1
        ? leaves[0]
        : Object.freeze(new CompoundPoisonError(leaves, message))
}

function errorMessage(reason, objectFallback) {
    if (Error.isError(reason)) {
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
    CompoundPoisonError,
    ERROR_KIND,
    FatalError,
    PoisonError,
    catchExternalThrow,
    combineErrors,
    createPoisonError,
    failExecution,
    declarationValidationError,
    flattenAndDeduplicateErrors,
    isFatalError,
    isPoisonError,
    pathAccessError,
    runExternalAction,
    runExternalBoundary,
    runWithFatalGuard,
    validationError,
}
