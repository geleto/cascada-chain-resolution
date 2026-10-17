import { createMutationOutcome } from "./mutations.js"
import { ManagedCapture, assembleCapturedGraph } from "./managed-capture.js"
import * as internalSteps from "./internal-step.js"
import * as errorUtils from "./error.js"
import * as imports from "./import.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"
import { initializePlacements } from "./parent-placements.js"
import { readCallableThen } from "./thenable-subscription.js"

function selectManagedMethodDescription(invocationWork) {
    const { mutation } = invocationWork
    const receiverType = languageValues.typeOf(invocationWork.receiver, invocationWork.operationContext)
    // Preparation resolves receiver contents but never changes its admitted type.
    const selectMethod = receiverType === languageValues.TYPE.Record
        ? selectManagedRecordMethod
        : selectManagedClassMethod
    return {
        receiverToLease: invocationWork.receiver,
        prepareArguments: () =>
            prepareManagedReceiverAndArguments(invocationWork),
        invoke(prepared) {
            try {
                // Selection follows complete preparation and precedes isolation.
                // A rejected selection already carries its required mutation effect.
                const callable = errorUtils.catchExternalThrow(
                    () => selectMethod(prepared.capture.identities.get(prepared.capture.roots[0].identity), invocationWork),
                    invocationWork.operationContext,
                    errorUtils.ERROR_KIND.LookupReflectionFailed,
                )
                if (typeof callable !== "function") return callable
                const workingReceiver = assembleCapturedGraph(prepared.capture, (copy, node) => {
                    languageValues.admitReadyValue(copy, invocationWork.operationContext, node.type, node.prototype)
                    if (!mutation) metadata.requireMeta(copy, invocationWork.operationContext).generation = node.identity
                })[0]
                return mutation
                    ? invokeMutation(
                        callable,
                        workingReceiver,
                        prepared.args,
                        invocationWork.operationContext,
                        invocationWork,
                    )
                    : invokeObservation(
                        callable,
                        workingReceiver,
                        prepared.args,
                        invocationWork.operationContext,
                        invocationWork,
                    )
            } finally { prepared.release() }
        },
    }
}

function prepareManagedReceiverAndArguments(work) {
    const { operationContext } = work
    work.prepareArgumentFrontier()
    const errors = new Set()
    const capture = new ManagedCapture(work, errorUtils.ERROR_KIND.InvalidManagedReceiver, collect)
    const argumentsCapture = new ManagedCapture(work, errorUtils.ERROR_KIND.ExportReflectionFailed, collect)
    work.discardPreparedOutput = discardOutput
    let unregister
    const receiverReady = capture.capture([work.receiver])
    work.releaseReceiverLeases()
    const argumentsReady = argumentsCapture.capture(work.args)
    work.releaseArgumentLeases()
    // Finish both required Error frontiers before either identity partition.
    // Their separate capture domains preserve the receiver/argument boundary.
    const readiness = internalSteps.collectInputs([receiverReady, argumentsReady], operationContext, () => {
        if (errors.size) {
            const failure = errorUtils.combineErrors(errors, "Operation received multiple Errors")
            release()
            return failure
        }
        return internalSteps.collectInputs([capture.resolve(), argumentsCapture.resolve()], operationContext, () => {
            const args = assembleCapturedGraph(argumentsCapture)
            argumentsCapture.discard()
            return { capture, args, release }
        }, work)
    }, work)
    if (languageValues.isPending(readiness, operationContext))
        unregister = operationLifecycle.releaseOnClose(work, release)
    return readiness

    function collect(failure) {
        errors.add(failure)
        work.preparationFailed()
    }

    function discardOutput() {
        capture.discard()
        argumentsCapture.discard()
    }

    function release() {
        unregister?.()
        unregister = undefined
        discardOutput()
        errors.clear()
        work.discardPreparedOutput = undefined
    }
}

// Common dispatch rejects `constructor` before either managed policy runs.
function selectManagedRecordMethod({ entries }, invocationWork) {
    const callable = entries.get(invocationWork.method)
    return typeof callable === "function"
        ? callable
        : invocation.methodNotCallableError(
            invocationWork.method,
            invocationWork.operationContext,
            entries.has(invocationWork.method),
        )
}

function selectManagedClassMethod({ prototype, entries }, invocationWork) {
    const { method, operationContext } = invocationWork
    if (entries.has(method)) {
        return errorUtils.validationError(
            `Cannot call ${method} because an own data property ` +
            "with that name hides the method",
            operationContext,
            errorUtils.ERROR_KIND.NotAFunction,
        )
    }
    while (
        prototype !== null &&
        !metadata.isPlainObjectPrototype(prototype, action =>
            errorUtils.runExternalAction(operationContext, action))
    ) {
        const descriptor = errorUtils.runExternalAction(
            operationContext,
            () => Object.getOwnPropertyDescriptor(prototype, method),
        )
        if (descriptor) {
            if (!("value" in descriptor)) {
                return errorUtils.validationError(
                    "Managed class methods must be data properties",
                    operationContext,
                    errorUtils.ERROR_KIND.InvalidManagedReceiver,
                )
            }
            return typeof descriptor.value === "function"
                ? descriptor.value
                : invocation.methodNotCallableError(
                    method,
                    operationContext,
                )
        }
        prototype = errorUtils.runExternalAction(
            operationContext,
            () => Object.getPrototypeOf(prototype),
        )
    }
    return invocation.methodNotCallableError(method, operationContext, false)
}

function invokeObservation(callable, receiver, args, operationContext, work) {
    return imports.importMethodResult(
        invocation.invokeFunction(
            callable,
            receiver,
            args,
            operationContext,
        ),
        operationContext,
        { capture: work.retainOutput },
    )
}

function invokeMutation(callable, receiver, args, operationContext, work) {
    const result = invocation.invokeFunction(
        callable,
        receiver,
        args,
        operationContext,
    )
    return internalSteps.continueGraphTransition(
        result,
        operationContext,
        complete,
        failed,
    )

    function failed(reason) {
        const failure = errorUtils.createPoisonError(
            reason,
            operationContext,
            errorUtils.ERROR_KIND.InvocationFailed,
        )
        return { mutatedValue: failure, result: failure }
    }

    function complete(value) {
        if (Error.isError(value)) return failed(value)
        // Direct method failure poisons the receiver. Importing an independent
        // result can fail separately after the method has completed its mutation.
        const failures = { errors: new Set() }
        const receiverFailure = validateReceiver(receiver, operationContext)
        const outcome = createMutationOutcome(receiverFailure ?? receiver, undefined, operationContext)
        const imported =
            value === receiver
                ? receiver
                : imports.importReadyMethodResult(
                      value,
                      operationContext,
                      failures,
                  )
        work.retainOutput(imported)
        outcome.result = receiverFailure
            ? errorUtils.combineErrors([receiverFailure, ...failures.errors], "Managed mutation failed") : imported
        return outcome
    }
}

function validateReceiver(receiver, operationContext) {
    const visited = new Set()
    const errors = new Set()
    const entries = new Map()
    walk(receiver)
    if (!errors.size) for (const [owner, placements] of entries) initializePlacements(owner, operationContext, placements)
    return errors.size === 0
        ? undefined
        : errorUtils.combineErrors(
            errors,
            "Managed mutation produced invalid state",
        )

    function walk(value) {
        if (Error.isError(value)) {
            errors.add(
                errorUtils.createPoisonError(
                    value,
                    operationContext,
                    errorUtils.ERROR_KIND.InvalidManagedReceiver,
                ),
            )
            return
        }
        if (value === null || typeof value !== "object" || visited.has(value)) return
        visited.add(value)
        const meta = metadata.metaOf(value, operationContext)
        if (meta && !metadata.isTraversableType(meta.type)) return
        if (!meta) {
            // Recognize new stored thenables without subscribing. Admitted
            // values keep their category; native surface stability is a host contract.
            const thenable = inspect(() => readCallableThen(value, operationContext))
            if (errorUtils.isPoisonError(thenable)) return
            if (thenable) {
                errors.add(errorUtils.validationError(
                    "Managed mutation receiver contains a Promise or thenable",
                    operationContext,
                    errorUtils.ERROR_KIND.InvalidManagedReceiver,
                ))
                return
            }
        }
        languageValues.admitReadyValue(value, operationContext)
        if (!languageValues.isTraversable(value, operationContext)) return
        const placements = metadata.metaOf(value, operationContext).placementsInitialized ? undefined : []
        if (placements) entries.set(value, placements)
        const keys = languageProperties.enumerableLanguageKeys(value, operationContext, 0, undefined, inspect)
        for (const key of keys) {
            // Validation must inspect leased data without consuming it.
            const child = inspect(() => propertyVersions.capturePlacement(value, key, operationContext).value)
            const failure = languageProperties.validatePropertyValue(key, child, operationContext,
                errorUtils.ERROR_KIND.InvalidManagedReceiver)
            if (failure) errors.add(failure)
            walk(child)
            placements?.push([key, child])
        }
    }

    function inspect(action) {
        const result = errorUtils.catchExternalThrow(
            action,
            operationContext,
            errorUtils.ERROR_KIND.InvalidManagedReceiver,
        )
        if (errorUtils.isPoisonError(result)) errors.add(result)
        return result
    }
}

export { selectManagedMethodDescription }
