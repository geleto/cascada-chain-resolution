import { captureManagedKeys, walkManagedProperties } from "./managed-traversal.js"
import * as internalSteps from "./internal-step.js"
import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as imports from "./import.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import { capabilityError } from "./external-operation.js"
import { createEmptyContainerCopy } from "./mutations.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"

function getManagedMethodDescription(invocationContext) {
    const { mutation, receiver } = invocationContext
    const receiverType = languageValues.typeOf(receiver, invocationContext.operationContext)
    // Preparation resolves receiver contents but never changes its admitted type.
    const selectMethod = receiverType === languageValues.TYPE.Record
        ? selectManagedRecordMethod
        : selectManagedClassMethod
    return {
        leaseInputsThroughResult: !mutation,
        prepareArguments: () =>
            prepareManagedReceiverAndArguments(invocationContext),
        invoke(prepared) {
            // Selection follows complete preparation and precedes isolation.
            // A rejected selection already carries its required mutation effect.
            const callable = errorUtils.catchExternalThrow(
                () => selectMethod(prepared.receiver, invocationContext),
                invocationContext.operationContext,
                errorUtils.ERROR_KIND.LookupReflectionFailed,
            )
            if (typeof callable !== "function") return callable
            const workingReceiver = prepareMethodReceiver(
                prepared.receiver,
                invocationContext,
            )
            if (errorUtils.isPoisonError(workingReceiver)) {
                return workingReceiver
            }
            return mutation
                ? invokeMutation(
                    callable,
                    workingReceiver,
                    prepared.args,
                    invocationContext.operationContext,
                )
                : invokeObservation(
                    callable,
                    workingReceiver,
                    prepared.args,
                    invocationContext.operationContext,
                )
        },
    }
}

function prepareManagedReceiverAndArguments(invocationContext) {
    return internalSteps.prepareInputs(
        [
            resolveAndLeaseReceiverGraph(invocationContext),
            invocationContext.exportArguments(),
        ],
        invocationContext.operationContext,
        readyValues => {
            const [preparedReceiver, exportedArgs] = readyValues
            return {
                receiver: preparedReceiver,
                args: exportedArgs,
            }
        },
        invocationContext,
    )
}

function resolveAndLeaseReceiverGraph(invocationContext) {
    const { receiver } = invocationContext
    const preparation = {
        errors: new Set(),
        receiver: undefined,
        visited: new WeakSet(),
    }
    let unregisterRelease
    const readiness = internalSteps.consumeValue(
        receiver,
        invocationContext.operationContext,
        errorUtils.ERROR_KIND.OperationInputFailed,
        resolved => {
            preparation.receiver = resolved
            return visit(resolved)
        },
        invocationContext,
    )
    if (languageValues.isPending(readiness, invocationContext.operationContext)) {
        unregisterRelease = operationLifecycle.releaseOnClose(
            invocationContext,
            release,
        )
    }
    return internalSteps.continueOperation(
        readiness,
        invocationContext.operationContext,
        finish,
        undefined,
        invocationContext,
    )

    function visit(value) {
        if (!invocationContext.open) return undefined
        if (invocationContext.operationContext.execution._externalIdentities.has(value)) {
            preparation.errors.add(capabilityError(invocationContext.operationContext))
            return undefined
        }
        if (errorUtils.isPoisonError(value)) {
            preparation.errors.add(value)
            return undefined
        }
        if (
            !languageValues.isTraversable(value, invocationContext.operationContext) ||
            preparation.visited.has(value)
        ) {
            return undefined
        }
        preparation.visited.add(value)
        invocationContext.retainReceiver(value)

        return walkManagedProperties(value, invocationContext, catchFailure, visit)
    }

    function catchFailure(step) {
        return errorUtils.catchExternalThrow(
            step,
            invocationContext.operationContext,
            errorUtils.ERROR_KIND.InvalidManagedReceiver,
            failure => {
                languageValues.admitReadyValue(failure, invocationContext.operationContext)
                preparation.errors.add(failure)
                return undefined
            },
        )
    }

    function finish() {
        const receiver = preparation.receiver
        const errors = preparation.errors
        unregisterRelease?.()
        release()
        return errors.size === 0
            ? receiver
            : errorUtils.combineErrors(
                errors,
                "Managed receiver contains multiple Errors",
            )
    }

    function release() {
        preparation.errors = undefined
        preparation.receiver = undefined
        preparation.visited = undefined
    }
}

// Common dispatch rejects `constructor` before either managed policy runs.
function selectManagedRecordMethod(receiver, invocationContext) {
    const present = languageProperties.hasLanguageProperty(
        receiver,
        invocationContext.method,
        invocationContext.operationContext,
    )
    const callable = languageProperties.readLanguageProperty(
        receiver,
        invocationContext.method,
        invocationContext.operationContext,
    )
    return typeof callable === "function"
        ? callable
        : invocation.methodNotCallableError(
            invocationContext.method,
            invocationContext.operationContext,
            present,
        )
}

function selectManagedClassMethod(receiver, invocationContext) {
    const { method, operationContext } = invocationContext
    if (languageProperties.hasLanguageProperty(receiver, method, operationContext)) {
        return errorUtils.validationError(
            `Cannot call ${method} because an own data property ` +
            "with that name hides the method",
            operationContext,
            errorUtils.ERROR_KIND.NotAFunction,
        )
    }
    let prototype = metadata.requireMeta(
        receiver,
        operationContext,
    ).admittedPrototype
    while (
        prototype !== null &&
        !errorUtils.runExternalAction(operationContext, () =>
            metadata.isPlainObjectPrototype(prototype),
        )
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

// Observation materialization path-copies only required representation changes.
// Mutation isolation copies complete protected subgraphs before arbitrary writes.
function prepareMethodReceiver(receiver, invocationContext) {
    return errorUtils.catchExternalThrow(
        () => {
            if (!invocationContext.mutation) {
                return materializeObservationReceiver(receiver, invocationContext)
            }
            invocationContext.releaseReceivers()
            return copyCompleteGraph(receiver, invocationContext.operationContext)
        },
        invocationContext.operationContext,
        errorUtils.ERROR_KIND.InvalidManagedReceiver,
        failure => {
            languageValues.admitReadyValue(failure, invocationContext.operationContext)
            return failure
        },
    )
}

function materializeObservationReceiver(receiver, invocationContext) {
    const { operationContext } = invocationContext
    const parents = new Map()
    const reached = new Set()
    const needed = new Set()
    const queue = []
    visit(receiver)
    for (let index = 0; index < queue.length; index++) {
        for (const parent of parents.get(queue[index]) ?? []) {
            requireCopy(parent)
        }
    }
    if (!needed.has(receiver)) return receiver

    const copies = new Map()
    for (const source of needed) {
        copies.set(source, createEmptyContainerCopy(source, operationContext))
    }
    for (const source of needed) {
        const destination = copies.get(source)
        for (const key of languageProperties.enumerableLanguageKeys(
            source,
            operationContext,
        )) {
            const value = languageProperties.readLanguageProperty(
                source,
                key,
                operationContext,
            )
            const copied = copies.get(value) ?? value
            languageProperties.writeLanguageProperty(
                destination,
                key,
                copied,
                operationContext,
            )
        }
    }
    return copies.get(receiver)

    function visit(source) {
        if (
            !languageValues.isTraversable(source, operationContext) ||
            reached.has(source)
        ) return
        reached.add(source)
        if (arrayViews.requiresArrayMaterialization(source, operationContext)) {
            requireCopy(source)
        }
        for (const key of languageProperties.enumerableLanguageKeys(
            source,
            operationContext,
        )) {
            const child = languageProperties.readLanguageProperty(
                source,
                key,
                operationContext,
            )
            if (
                propertyVersions.getPlacementVersion(source, key, operationContext) !==
                undefined
            ) {
                const descriptor = languageProperties
                    .getLanguagePropertyDescriptor(source, key, operationContext)
                if (!Object.is(descriptor?.value, child)) requireCopy(source)
            }
            if (!languageValues.isTraversable(child, operationContext)) continue
            let childParents = parents.get(child)
            if (!childParents) {
                childParents = new Set()
                parents.set(child, childParents)
            }
            childParents.add(source)
            visit(child)
        }
    }

    function requireCopy(value) {
        if (needed.has(value)) return
        needed.add(value)
        queue.push(value)
    }
}

function copyCompleteGraph(source, operationContext, copies = new Map()) {
    if (languageValues.isPending(source, operationContext)) {
        throw new Error("Prepared managed receiver contains a Promise")
    }
    languageValues.admitReadyValue(source, operationContext)
    if (!languageValues.isTraversable(source, operationContext)) return source

    const existing = copies.get(source)
    if (existing) return existing
    const destination = createEmptyContainerCopy(source, operationContext)
    copies.set(source, destination)
    for (const key of languageProperties.enumerableLanguageKeys(
        source,
        operationContext,
    )) {
        languageProperties.writeLanguageProperty(
            destination,
            key,
            copyCompleteGraph(
                languageProperties.readLanguageProperty(source, key, operationContext),
                operationContext,
                copies,
            ),
            operationContext,
        )
    }
    return destination
}

function invokeObservation(callable, receiver, args, operationContext) {
    return imports.importMethodResult(
        invocation.invokeFunction(
            callable,
            receiver,
            args,
            operationContext,
        ),
        operationContext,
    )
}

function invokeMutation(callable, receiver, args, operationContext) {
    const result = invocation.invokeFunction(
        callable,
        receiver,
        args,
        operationContext,
    )
    return internalSteps.continueOperation(
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
        const imported =
            value === receiver
                ? receiver
                : imports.importReadyMethodResult(
                      value,
                      operationContext,
                      failures,
                  )
        return finishMutation(receiver, imported, failures.errors, operationContext)
    }
}

function finishMutation(receiver, result, resultErrors, operationContext) {
    const failure = validateReceiver(receiver, operationContext)
    if (failure) {
        result = errorUtils.combineErrors([failure, ...resultErrors], "Managed mutation failed")
    }
    return {
        mutatedValue: failure ?? receiver,
        result,
    }
}

function validateReceiver(receiver, operationContext) {
    const visited = new Set()
    const errors = new Set()
    let unsafeThenError
    walk(receiver)
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
        const unsafeThen = inspect(() => hasUnsafeNativeThen(value))
        if (errorUtils.isPoisonError(unsafeThen)) {
            // Known managed structure still contributes its placement Errors.
            // An unknown identity cannot be admitted after an unreadable probe.
            if (!meta) return
        } else if (unsafeThen) {
            errors.add(unsafeThenError ??= errorUtils.validationError(
                "Managed mutation receiver contains an unsafe then property",
                operationContext,
                errorUtils.ERROR_KIND.InvalidManagedReceiver,
            ))
            // An unadmitted thenable is invalid availability, not graph data.
            // An admitted managed receiver still contributes its other Errors.
            if (!meta) return
        }
        languageValues.admitReadyValue(value, operationContext)
        if (!languageValues.isTraversable(value, operationContext)) return
        const keys = captureManagedKeys(value, operationContext, inspect)
        for (const key of keys) {
            // Validation must inspect retained data without consuming it.
            const version = metadata.metaOf(value, operationContext).placementVersions?.[key]
            const child = version ? version.value : inspect(() =>
                languageProperties.getLanguagePlacementDescriptor(
                    value,
                    key,
                    operationContext,
                )?.value,
            )
            walk(child)
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

    function hasUnsafeNativeThen(value) {
        for (let current = value; current !== null;) {
            const descriptor = errorUtils.runExternalAction(operationContext, () =>
                Object.getOwnPropertyDescriptor(current, "then"),
            )
            if (descriptor) return !("value" in descriptor) || typeof descriptor.value === "function"
            current = errorUtils.runExternalAction(operationContext, () => Object.getPrototypeOf(current),
            )
        }
        return false
    }
}

export { getManagedMethodDescription }
