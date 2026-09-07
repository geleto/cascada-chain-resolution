import { commitFatal } from "./execution.js"

const ERROR_TOKEN = Symbol("Kernel Error construction")
const poisonErrors = new WeakSet()
const fatalErrors = new WeakSet()
const hostFailures = new WeakMap()
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
const MISSING_OPERATION_CONTEXT = Object.freeze({
    operation: "runtime entry",
    problem: "missing operation context or execution binding",
})

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
    QueryReflectionFailed: "QueryReflectionFailed",
    MissingFunction: "MissingFunction",
    NotAFunction: "NotAFunction",
    HostCallFailed: "HostCallFailed",
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
    constructor(token, message, errorContext, kind, options) {
        if (token !== ERROR_TOKEN)
            throw new TypeError("PoisonError cannot be constructed directly")
        super(message, options)
        this.name = "PoisonError"
        this.errorContext = errorContext
        this.kind = kind
        poisonErrors.add(this)
    }
}

class CompoundPoisonError extends PoisonError {
    constructor(token, errors, message) {
        if (token !== ERROR_TOKEN)
            throw new TypeError(
                "CompoundPoisonError cannot be constructed directly",
            )
        const kind = errors.every(error => error.kind === errors[0].kind)
            ? errors[0].kind
            : ERROR_KIND.Multiple
        super(token, message, errors[0].errorContext, kind)
        this.name = "CompoundPoisonError"
        this.errors = Object.freeze([...errors])
    }
}

class FatalError extends Error {
    constructor(token, cause, errorContext) {
        if (token !== ERROR_TOKEN)
            throw new TypeError("FatalError cannot be constructed directly")
        super(
            errorMessage(cause, "Cascada execution failed with a non-Error value"),
            { cause },
        )
        this.name = "FatalError"
        this.errorContext = errorContext
        fatalErrors.add(this)
    }
}

Object.defineProperty(FatalError.prototype, "then", { value: undefined })
Object.freeze(FatalError.prototype)
// Poison prototypes receive their final then method and freeze in Phase 9D-B.

function isPoisonError(error) {
    return poisonErrors.has(error)
}
function isFatalError(error) {
    return fatalErrors.has(error)
}

function createFatalError(reason, errorContext) {
    return isFatalError(reason)
        ? reason
        : Object.freeze(new FatalError(ERROR_TOKEN, reason, errorContext))
}

function failExecution(operationContext, reason) {
    throw commitFatal(
        operationContext.execution,
        createFatalError(reason, operationContext.errorContext),
    )
}

let hostCodeDepth = 0

// Conservative probes use this guard with their own exact catch and outcome.
function enterHostCode() {
    hostCodeDepth++
}
function leaveHostCode() {
    hostCodeDepth--
}
function assertOutsideHostCode() {
    if (hostCodeDepth > 0)
        throw new Error("Cascada cannot be re-entered from supported host code")
}

function runInternalStep(operationContext, work, value) {
    // One check covers Chain construction and the trusted integration entry.
    // A source-only context is a plausible integration mistake at this boundary.
    // Diagnose missing routing, without inspecting source data or inventing an execution.
    const execution = operationContext?.execution
    if (execution === undefined || execution === null) {
        throw createFatalError(
            new TypeError("Operation context with an execution is required"),
            MISSING_OPERATION_CONTEXT,
        )
    }
    const fatal = execution.fatalError
    if (fatal !== null) throw fatal
    return runWithFatalGuard(operationContext, work, value)
}

// Entry and continuation callers select live work before this shared envelope.
// It classifies escaping defects; it does not repeat their routing/lifetime checks.
function runWithFatalGuard(operationContext, work, value) {
    try {
        assertOutsideHostCode()
        return work(value)
    } catch (reason) {
        failExecution(
            operationContext,
            hostFailures.has(reason) ? hostFailures.get(reason) : reason,
        )
    }
}

// Only this exact-action producer creates the private escape marker. The owning
// operation supplies classification after shared graph helpers unwind.
function runHostAction(operationContext, action) {
    let result
    let failure
    let failed = false
    enterHostCode()
    try {
        result = action()
    } catch (reason) {
        failed = true
        failure = reason
    } finally {
        leaveHostCode()
    }
    const fatal = operationContext.execution.fatalError
    if (fatal !== null) throw fatal
    if (!failed) return result
    if (isFatalError(failure)) failExecution(operationContext, failure)
    const marker = {}
    hostFailures.set(marker, failure)
    throw marker
}

// Consume only runHostAction's private escape marker. An ordinary internal throw
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
        if (!hostFailures.has(reason)) throw reason
        failure = hostFailures.get(reason)
    }
    // Contextualization and the owning transition's failure effect are outside
    // recovery. A defect in either must escape to the fatal envelope.
    return onFailure(createPoisonError(failure, operationContext, kind))
}

// A complete language-result boundary also contextualizes returned native Errors.
// Shared reflection helpers instead use the producer/consumer split above.
function runHostBoundary(operationContext, kind, action) {
    const value = catchExternalThrow(
        () => runHostAction(operationContext, action),
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
            ERROR_TOKEN,
            errorMessage(reason, "Host action failed with a non-Error value"),
            operationContext.errorContext,
            kind,
            { cause: reason },
        ),
    )
}

function validationError(message, operationContext, kind) {
    return Object.freeze(
        new PoisonError(
            ERROR_TOKEN,
            message,
            operationContext.errorContext,
            kind,
        ),
    )
}

function hostValidationError(message) {
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

// One operation-local equivalence rule serves every complete Error collector.
function collectErrors(errors) {
    const distinct = []
    const causes = new Map()
    for (const error of errors) add(error)
    return distinct

    function add(error) {
        if (!isPoisonError(error))
            throw new TypeError("Error collection requires poison")
        if (error instanceof CompoundPoisonError) {
            for (const child of error.errors) add(child)
            return
        }
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
    const distinct = collectErrors(errors)
    if (distinct.length === 0)
        throw new TypeError("Error combination requires at least one poison")
    return distinct.length === 1
        ? distinct[0]
        : Object.freeze(new CompoundPoisonError(ERROR_TOKEN, distinct, message))
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
    assertOutsideHostCode,
    catchExternalThrow,
    collectErrors,
    combineErrors,
    createPoisonError,
    enterHostCode,
    failExecution,
    hostValidationError,
    isFatalError,
    isPoisonError,
    leaveHostCode,
    pathAccessError,
    runHostAction,
    runHostBoundary,
    runInternalStep,
    runWithFatalGuard,
    validationError,
}
