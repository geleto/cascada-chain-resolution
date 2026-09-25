import { ArrayView } from "./array-view.js"
import { walkManagedProperties } from "./managed-traversal.js"
import * as internalSteps from "./internal-step.js"
import * as errorUtils from "./error.js"
import * as imports from "./import.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import { createEmptyContainer, defineCopyProperty } from "./placement-structure.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"

function selectManagedMethodDescription(invocationWork) {
    const { mutation, receiver } = invocationWork
    const receiverType = languageValues.typeOf(receiver, invocationWork.operationContext)
    // Preparation resolves receiver contents but never changes its admitted type.
    const selectMethod = receiverType === languageValues.TYPE.Record
        ? selectManagedRecordMethod
        : selectManagedClassMethod
    return {
        leaseInputsThroughResult: !mutation,
        prepareArguments: () =>
            prepareManagedReceiverAndArguments(invocationWork),
        invoke(prepared) {
            // Selection follows complete preparation and precedes isolation.
            // A rejected selection already carries its required mutation effect.
            const callable = errorUtils.catchExternalThrow(
                () => selectMethod(prepared.receiver, invocationWork),
                invocationWork.operationContext,
                errorUtils.ERROR_KIND.LookupReflectionFailed,
            )
            if (typeof callable !== "function") return callable
            const workingReceiver = prepareMethodReceiver(
                prepared.receiver,
                invocationWork,
            )
            if (errorUtils.isPoisonError(workingReceiver)) {
                return workingReceiver
            }
            return mutation
                ? invokeMutation(
                    callable,
                    workingReceiver,
                    prepared.args,
                    invocationWork.operationContext,
                )
                : invokeObservation(
                    callable,
                    workingReceiver,
                    prepared.args,
                    invocationWork.operationContext,
                )
        },
    }
}

function prepareManagedReceiverAndArguments(invocationWork) {
    return internalSteps.prepareInputs(
        [
            resolveAndLeaseReceiverGraph(invocationWork),
            invocationWork.exportArguments(),
        ],
        invocationWork.operationContext,
        readyValues => {
            const [preparedReceiver, exportedArgs] = readyValues
            return {
                receiver: preparedReceiver,
                args: exportedArgs,
            }
        },
        invocationWork,
    )
}

function resolveAndLeaseReceiverGraph(invocationWork) {
    const preparation = {
        errors: new Set(),
        visited: new WeakSet(),
    }
    let unregisterRelease
    const readiness = visit(invocationWork.receiver)
    if (languageValues.isPending(readiness, invocationWork.operationContext)) {
        unregisterRelease = operationLifecycle.releaseOnClose(
            invocationWork,
            release,
        )
    }
    return internalSteps.continueOperation(
        readiness,
        invocationWork.operationContext,
        finish,
        undefined,
        invocationWork,
    )

    function visit(value) {
        if (!invocationWork.open) return undefined
        if (invocationWork.operationContext.execution._externalIdentities.has(value)) {
            preparation.errors.add(externalCapabilityEscapeError(invocationWork.operationContext))
            return undefined
        }
        if (errorUtils.isPoisonError(value)) {
            preparation.errors.add(value)
            return undefined
        }
        if (
            !languageValues.isTraversable(value, invocationWork.operationContext) ||
            preparation.visited.has(value)
        ) {
            return undefined
        }
        preparation.visited.add(value)
        invocationWork.leaseReceiver(value)

        return walkManagedProperties(value, invocationWork, catchFailure, visit)
    }

    function catchFailure(step) {
        return errorUtils.catchExternalThrow(
            step,
            invocationWork.operationContext,
            errorUtils.ERROR_KIND.InvalidManagedReceiver,
            failure => {
                languageValues.admitReadyValue(failure, invocationWork.operationContext)
                preparation.errors.add(failure)
                return undefined
            },
        )
    }

    function finish() {
        const receiver = invocationWork.receiver
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
        preparation.visited = undefined
    }
}

// Common dispatch rejects `constructor` before either managed policy runs.
function selectManagedRecordMethod(receiver, invocationWork) {
    const { value: callable, present } = languageProperties.readLanguagePlacement(
        receiver,
        invocationWork.method,
        invocationWork.operationContext,
    )
    return typeof callable === "function"
        ? callable
        : invocation.methodNotCallableError(
            invocationWork.method,
            invocationWork.operationContext,
            present,
        )
}

function selectManagedClassMethod(receiver, invocationWork) {
    const { method, operationContext } = invocationWork
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
function prepareMethodReceiver(receiver, invocationWork) {
    return errorUtils.catchExternalThrow(
        () => {
            if (!invocationWork.mutation) {
                return materializeObservationReceiver(receiver, invocationWork)
            }
            invocationWork.releaseReceiverLeases()
            return copyCompleteGraph(receiver, invocationWork.operationContext)
        },
        invocationWork.operationContext,
        errorUtils.ERROR_KIND.InvalidManagedReceiver,
        failure => {
            languageValues.admitReadyValue(failure, invocationWork.operationContext)
            return failure
        },
    )
}

function materializeObservationReceiver(receiver, invocationWork) {
    const { operationContext } = invocationWork
    const parents = new Map()
    const needed = new Set()
    const queue = []
    visit(receiver)
    for (let index = 0; index < queue.length; index++) {
        for (const parent of parents.get(queue[index]) ?? []) {
            requireCopy(parent)
        }
    }
    if (!needed.has(receiver)) return receiver

    // Both modes use one graph copier. An observation seeds unchanged nodes
    // with their own identity; mutation starts with an empty identity map.
    const copies = new Map()
    for (const source of parents.keys()) if (!needed.has(source)) copies.set(source, source)
    return copyCompleteGraph(receiver, operationContext, copies)

    function visit(source) {
        if (
            !languageValues.isTraversable(source, operationContext) ||
            parents.has(source)
        ) return
        parents.set(source, new Set())
        if (ArrayView.requiresMaterialization(source, operationContext)) {
            requireCopy(source)
        }
        if (metadata.metaOf(source, operationContext)?.recordOrder) {
            const logical = languageProperties.enumerableLanguageKeys(source, operationContext)
            const keys = new Set(logical)
            const physical = errorUtils.runExternalAction(operationContext, () => Object.keys(source))
                .filter(key => keys.has(key))
            if (physical.length !== logical.length || physical.some((key, index) => key !== logical[index])) requireCopy(source)
        }
        for (const key of languageProperties.enumerableLanguageKeyCandidates(
            source,
            operationContext,
        )) {
            const { value: child, present } = languageProperties.readLanguagePlacement(source, key, operationContext)
            // Once copying is required, only logical children matter.
            if (!needed.has(source) && propertyVersions.getPlacementVersion(source, key, operationContext)) {
                const descriptor = languageProperties.getLanguagePlacementDescriptor(source, key, operationContext)
                if (present ? !descriptor || !Object.is(descriptor.value, child) : descriptor) requireCopy(source)
            }
            if (!present || !languageValues.isTraversable(child, operationContext)) continue
            visit(child)
            parents.get(child).add(source)
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
    const destination = createEmptyContainer(source, operationContext)
    const { type, admittedPrototype } = metadata.requireMeta(source, operationContext)
    languageValues.admitReadyValue(destination, operationContext, type, admittedPrototype)
    copies.set(source, destination)
    for (const key of languageProperties.enumerableLanguageKeys(
        source,
        operationContext,
    )) {
        defineCopyProperty(
            destination,
            key,
            copyCompleteGraph(
                languageProperties.readLanguageProperty(source, key, operationContext),
                operationContext,
                copies,
            ),
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
        const keys = languageProperties.enumerableLanguageKeys(value, operationContext, 0, undefined, inspect)
        for (const key of keys) {
            // Validation must inspect leased data without consuming it.
            const child = inspect(() => propertyVersions.capturePlacement(value, key, operationContext).value)
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

export { selectManagedMethodDescription }
