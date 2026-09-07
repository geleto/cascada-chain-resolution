import { prepareInputs } from "./input-collection.js"
import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as imports from "./import.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import { createEmptyContainerCopy } from "./mutations.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"
import * as refcounts from "./refcounts.js"

function getManagedMethodDescription(invocationContext) {
    const { mutation, receiver } = invocationContext
    const receiverType = languageValues.typeOf(receiver, invocationContext.operationContext)
    // Preparation resolves receiver contents but never changes its admitted type.
    const selectMethod = receiverType === languageValues.TYPE_RECORD
        ? selectManagedRecordMethod
        : selectManagedClassMethod
    return {
        leaseReceiverThroughResult: !mutation,
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
    return prepareInputs(
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
    const readiness = languageValues.consumeValue(
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
    return operationLifecycle.continueOperation(
        readiness,
        invocationContext.operationContext,
        finish,
        undefined,
        invocationContext,
    )

    function visit(value) {
        if (!invocationContext.open) return undefined
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

        const keys = []
        catchFailure(() => {
            for (const key of languageProperties.languageKeyCandidates(
                value,
                invocationContext.operationContext,
            )) {
                const present = catchFailure(() => languageProperties.hasLanguageProperty(
                    value,
                    key,
                    invocationContext.operationContext,
                ))
                if (present === true) keys.push(key)
            }
        })

        const waits = []
        for (const key of keys) {
            const child = catchFailure(
                () => languageProperties.readLanguageProperty(
                    value,
                    key,
                    invocationContext.operationContext,
                ),
            )
            if (!languageValues.isPending(child, invocationContext.operationContext)) {
                const nested = visit(child)
                if (nested) waits.push(nested)
                continue
            }
            const continued = catchFailure(() => {
                const result = propertyVersions.continuePropertyValue(
                    value,
                    key,
                    child,
                    invocationContext.operationContext,
                    visit,
                )
                return result
            })
            if (continued) waits.push(continued)
        }
        return combineReadiness(invocationContext, waits)
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

function combineReadiness(invocationContext, waits) {
    if (waits.length === 0) return undefined
    if (waits.length === 1) return waits[0]
    return operationLifecycle.continueOperation(
        Promise.all(waits),
        invocationContext.operationContext,
        () => undefined,
        undefined,
        invocationContext,
    )
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
        !errorUtils.runHostAction(operationContext, () =>
            metadata.isPlainObjectPrototype(prototype),
        )
    ) {
        const descriptor = errorUtils.runHostAction(
            operationContext,
            () => Object.getOwnPropertyDescriptor(prototype, method),
        )
        if (descriptor) {
            if (!("value" in descriptor)) {
                const failure = errorUtils.validationError(
                    "Managed class prototype accessor changed",
                    operationContext,
                    errorUtils.ERROR_KIND.InvalidManagedReceiver,
                )
                return invocationContext.mutation
                    ? { mutatedValue: receiver, result: failure }
                    : failure
            }
            return typeof descriptor.value === "function"
                ? descriptor.value
                : invocation.methodNotCallableError(
                    method,
                    operationContext,
                )
        }
        prototype = errorUtils.runHostAction(
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
            return isolateMutationReceiver(
                receiver,
                invocationContext,
            )
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
                propertyVersions.getPromiseMirror(source, key, operationContext) !==
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

function isolateMutationReceiver(receiver, invocationContext) {
    const { operationContext } = invocationContext
    const copies = new Map()
    const placements = new Map()
    const visited = new Set()
    let value = receiver
    visit(receiver, undefined, undefined)
    for (const [source, destination] of copies) {
        for (const placement of placements.get(source) ?? []) {
            reconnect(placement, destination)
        }
    }
    return value

    function visit(source, parent, key) {
        if (!languageValues.isTraversable(source, operationContext)) return

        const placement = { parent, key }
        let sourcePlacements = placements.get(source)
        if (!sourcePlacements) {
            sourcePlacements = []
            placements.set(source, sourcePlacements)
        }
        sourcePlacements.push(placement)

        if (copies.has(source) || visited.has(source)) return
        visited.add(source)
        if (
            (parent === undefined && invocationContext.preserveReceiver) ||
            requiresIsolation(source, operationContext)
        ) {
            copyCompleteGraph(source, operationContext, copies)
            return
        }

        for (const key of languageProperties.enumerableLanguageKeys(
            source,
            operationContext,
        )) {
            visit(
                languageProperties.readLanguageProperty(source, key, operationContext),
                source,
                key,
            )
            if (copies.has(source)) return
        }
    }

    function reconnect(placement, destination) {
        if (placement.parent === undefined) {
            value = destination
            return
        }
        if (copies.has(placement.parent)) return
        if (languageProperties.propertyMutationRequiresCopy(
            placement.parent,
            placement.key,
            operationContext,
        )) {
            copyCompleteGraph(placement.parent, operationContext, copies)
            return
        }
        propertyVersions.assignProperty(
            placement.parent,
            placement.key,
            destination,
            operationContext,
        )
    }
}

function requiresIsolation(value, operationContext) {
    return metadata.requiresCopyOnWrite(value, operationContext) ||
        refcounts.getRefCounter(value, operationContext) !== undefined ||
        propertyVersions.hasPromiseMirrors(value, operationContext) ||
        arrayViews.requiresArrayMaterialization(value, operationContext)
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
        invocation.invokeHostFunction(
            callable,
            receiver,
            args,
            operationContext,
        ),
        operationContext,
    )
}

function invokeMutation(callable, receiver, args, operationContext) {
    const result = invocation.invokeHostFunction(
        callable,
        receiver,
        args,
        operationContext,
    )
    return operationLifecycle.continueOperation(
        result,
        operationContext,
        complete,
        failed,
    )

    function failed(reason) {
        const failure = errorUtils.createPoisonError(
            reason,
            operationContext,
            errorUtils.ERROR_KIND.HostCallFailed,
        )
        return { mutatedValue: failure, result: failure }
    }

    function complete(value) {
        if (Error.isError(value)) return failed(value)
        // Direct host failure poisons the receiver. Importing an independent
        // result can fail separately after the host has completed its mutation.
        const imported =
            value === receiver
                ? receiver
                : imports.importManagedMutationMethodResult(
                      value,
                      operationContext,
                  )
        return finishMutation(receiver, imported, operationContext)
    }
}

function finishMutation(receiver, result, operationContext) {
    const failure = validateReceiver(receiver, operationContext)
    if (failure) {
        result = errorUtils.isPoisonError(result)
            ? errorUtils.combineErrors([failure, result], "Managed mutation failed")
            : failure
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
        const keys = []
        inspect(() => {
            for (const key of languageProperties.languageKeyCandidates(
                value,
                operationContext,
            )) {
                const present = inspect(() => languageProperties.hasLanguageProperty(
                    value,
                    key,
                    operationContext,
                ))
                if (present === true) keys.push(key)
            }
        })
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
            const descriptor = errorUtils.runHostAction(operationContext, () =>
                Object.getOwnPropertyDescriptor(current, "then"),
            )
            if (descriptor) return !("value" in descriptor) || typeof descriptor.value === "function"
            current = errorUtils.runHostAction(operationContext, () => Object.getPrototypeOf(current),
            )
        }
        return false
    }
}

export { getManagedMethodDescription }
