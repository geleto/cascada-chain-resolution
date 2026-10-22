import { createMutationOutcome } from "./mutations.js"
import { ManagedCapture } from "./managed-capture.js"
import { assembleCapturedGraph } from "./captured-graph.js"
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
import { mayBeThenable, readCallableThen } from "./thenable-subscription.js"
import { externalCapabilityEscapeError } from "./external-operation.js"

function selectManagedMethodDescription(invocationWork) {
    const { mutation } = invocationWork
    const preserveIdentity = !invocationWork.receiverCapture
    return {
        receiverToLease: invocationWork.receiver,
        prepareArguments: () =>
            prepareManagedReceiverAndArguments(invocationWork),
        invoke(prepared) {
            try {
                const workingReceiver = assembleCapturedGraph(prepared.capture, (copy, node) => {
                    languageValues.admitReadyValue(copy, invocationWork.operationContext, node.type, node.prototype)
                    if (!mutation && preserveIdentity) metadata.requireMeta(copy, invocationWork.operationContext).generation = node.identity
                })[0]
                return mutation
                    ? invokeMutation(
                        prepared.callable,
                        workingReceiver,
                        prepared.args,
                        invocationWork.operationContext,
                        invocationWork,
                    )
                    : invokeObservation(
                        prepared.callable,
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
    const capture = work.receiverCapture ?? new ManagedCapture(work, errorUtils.ERROR_KIND.InvalidManagedReceiver, collect)
    const argumentsCapture = new ManagedCapture(work, errorUtils.ERROR_KIND.ExportReflectionFailed, collect)
    work.discardPreparedOutput = discardOutput
    let unregister, prepared
    const receiverReady = work.receiverCapture ? undefined : capture.capture([work.receiver])
    work.receiverCapture = undefined
    work.releaseReceiverLeases()
    const argumentsReady = argumentsCapture.capture(work.args)
    work.releaseArgumentLeases()
    // Selection needs complete data/Error capture, but no output alias partition.
    // Rejected calls allocate no exported arguments or working receiver.
    const readiness = internalSteps.collectInputs([receiverReady, argumentsReady], operationContext, () => {
        if (errors.size) {
            const failure = errorUtils.combineErrors(errors)
            release()
            return failure
        }
        const root = capture.roots[0]
        const selectMethod = root.type === languageValues.TYPE.Record
            ? selectManagedRecordMethod : selectManagedClassMethod
        const callable = errorUtils.catchExternalThrow(
            () => selectMethod(root, work), operationContext, errorUtils.ERROR_KIND.LookupReflectionFailed)
        if (typeof callable !== "function") { release(); return callable }
        prepared = { capture, callable, release }
        return internalSteps.collectInputs([capture.resolve(), argumentsCapture.resolve()], operationContext, () => {
            prepared.args = assembleCapturedGraph(argumentsCapture)
            argumentsCapture.discard()
            return prepared
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
        if (prepared) prepared.callable = prepared.args = undefined
        prepared = undefined
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
    try {
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
    } finally { prototype = undefined }
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
    let result
    try {
        result = invocation.invokeFunction(callable, receiver, args, operationContext)
    } finally { callable = args = undefined }
    // Both settlement lanes finish through one terminal handler.
    return internalSteps.continueGraphTransition(
        result,
        operationContext,
        complete,
        reason => complete(errorUtils.createPoisonError(
            reason,
            operationContext,
            errorUtils.ERROR_KIND.InvocationFailed,
        )),
    )

    function complete(value) {
        try {
            if (errorUtils.isPoisonError(value)) {
                const failure = errorUtils.createPoisonError(
                    value,
                    operationContext,
                    errorUtils.ERROR_KIND.InvocationFailed,
                )
                return { mutatedValue: failure, result: failure }
            }
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
                ? errorUtils.combineErrors([receiverFailure, ...failures.errors]) : imported
            return outcome
        } finally {
            // Spent captures must not outlive this call through an unformatted Error.
            receiver = work = value = undefined
        }
    }
}

function validateReceiver(receiver, operationContext) {
    const errors = new Set()
    // Presence marks inspection. Fresh admissions and topology commit together
    // only after the complete receiver passes validation.
    const entries = new Map()
    try {
        walk(receiver)
        if (!errors.size) {
            for (const [owner, entry] of entries) if (entry?.facts) {
                // Newly stored native data may also be a retained exported argument.
                // Existing private receiver shells keep their ordinary ownership.
                metadata.getOrCreateMeta(owner, operationContext,
                    entry.facts.type, entry.facts.admittedPrototype).imported = true
            }
            for (const [owner, entry] of entries) if (entry?.placements)
                initializePlacements(owner, operationContext, entry.placements)
        }
        return errors.size === 0
            ? undefined
            : errorUtils.combineErrors(errors)
    } finally {
        errors.clear()
        entries.clear()
    }

    function walk(value) {
        try {
            if (errorUtils.isFatalError(value)) throw value
            if (errorUtils.isPoisonError(value)) {
                errors.add(
                    errorUtils.createPoisonError(
                        value,
                        operationContext,
                        errorUtils.ERROR_KIND.InvalidManagedReceiver,
                    ),
                )
                return
            }
            if (!metadata.isObjectLike(value) || entries.has(value)) return
            entries.set(value, undefined)
            // Preparation admitted no registered identity; any reached here was
            // introduced by this call and cannot become reusable receiver state.
            if (operationContext.execution._externalIdentities.has(value)) {
                errors.add(externalCapabilityEscapeError(operationContext))
                return
            }
            const meta = metadata.metaOf(value, operationContext)
            if (meta && !metadata.isTraversableType(meta.type)) return
            if (mayBeThenable(value, operationContext)) {
                // Preserve native Error and admitted-category precedence while
                // recognizing new stored thenables without subscribing.
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
            const facts = meta ?? inspect(() => metadata.inspectAdmissionMetaFacts(value, operationContext))
            if (errorUtils.isPoisonError(facts)) return
            const placements = metadata.isTraversableType(facts.type) && !meta?.placementsInitialized ? [] : undefined
            if (!meta || placements) entries.set(value, { facts: meta ? undefined : facts, placements })
            if (!metadata.isTraversableType(facts.type)) return
            const keys = []
            inspect(() => {
                for (const key of languageProperties.enumerableLanguageKeyCandidates(value, operationContext, 0, undefined, facts.type)) keys.push(key)
            })
            for (const key of keys) {
                // Validation must inspect leased data without consuming it.
                const placement = inspect(() => propertyVersions.capturePlacement(value, key, operationContext))
                if (placement.present !== true) continue
                const child = placement.value
                const failure = languageProperties.validatePropertyValue(key, child, operationContext,
                    errorUtils.ERROR_KIND.InvalidManagedReceiver)
                if (failure) errors.add(failure)
                walk(child)
                placements?.push([key, child])
            }
        } finally { value = undefined }
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
