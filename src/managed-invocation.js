import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import { exportManyValues } from "./export.js"
import * as imports from "./import.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import { createEmptyContainerCopy } from "./mutations.js"
import * as operationLifecycle from "./operation-lifecycle.js"
import * as propertyVersions from "./property-versions.js"
import * as refcounts from "./refcounts.js"

function selectManagedCall(
    receiver,
    method,
    mutation,
    mutationContext,
) {
    const receiverType = languageValues.typeOf(receiver)
    // Preparation resolves receiver contents but never changes its admitted type.
    const getMethod = receiverType === languageValues.TYPE_RECORD
        ? getManagedRecordMethod
        : getManagedClassMethod
    return {
        leaseReceiverThroughResult: !mutation,
        prepareInputs: (args, operation) => prepareManagedInputs(
            receiver,
            args,
            operation,
        ),
        getMethod: prepared => getMethod(prepared.receiver, method),
        invoke(prepared, operation, callable) {
            const workingReceiver = prepareMethodReceiver(
                prepared.receiver,
                mutation,
                operation,
                mutationContext?.mustPreserveValue === true,
            )
            if (languageValues.isError(workingReceiver)) {
                return workingReceiver
            }
            return mutation
                ? invokeMutation(callable, workingReceiver, prepared.args)
                : invokeObservation(callable, workingReceiver, prepared.args)
        },
    }
}

function prepareManagedInputs(receiver, args, operation) {
    return operationLifecycle.continuePreparedAll(
        operation,
        [
            resolveAndLeaseReceiverGraph(receiver, operation),
            exportManyValues(args, operation),
        ],
        ([preparedReceiver, exportedArgs]) => ({
            receiver: preparedReceiver,
            args: exportedArgs,
        }),
    )
}

function resolveAndLeaseReceiverGraph(receiver, operation) {
    const preparation = {
        errors: new Set(),
        receiver: undefined,
        visited: new WeakSet(),
    }
    let unregisterRelease
    try {
        const readiness = operationLifecycle.resolveInitial(
            operation,
            receiver,
            resolved => {
                preparation.receiver = resolved
                return visit(resolved)
            },
        )
        if (languageValues.isPromise(readiness)) {
            unregisterRelease = operationLifecycle.registerRelease(
                operation,
                release,
            )
        }
        return operationLifecycle.continueInternal(
            operation,
            readiness,
            finish,
        )
    } catch (error) {
        unregisterRelease?.()
        release()
        throw error
    }

    function visit(value) {
        if (!operationLifecycle.mayContinue(operation)) return undefined
        if (languageValues.isError(value)) {
            preparation.errors.add(value)
            return undefined
        }
        if (
            !languageValues.isTraversable(value) ||
            preparation.visited.has(value)
        ) {
            return undefined
        }
        preparation.visited.add(value)
        operation.retainReceiver(value)

        const keys = catchFailure(
            () => languageProperties.enumerableLanguageKeys(value),
        )
        if (keys === undefined) return undefined

        const waits = []
        for (const key of keys) {
            const child = catchFailure(
                () => languageProperties.readLanguageProperty(value, key),
            )
            if (!languageValues.isPromise(child)) {
                const nested = visit(child)
                if (nested) waits.push(nested)
                continue
            }
            const continued = catchFailure(() => {
                const result = propertyVersions.continuePropertyValue(
                    value,
                    key,
                    child,
                    visit,
                )
                return operationLifecycle.observeFatal(operation, result)
            })
            if (continued) waits.push(continued)
        }
        return combineReadiness(operation, waits)
    }

    function catchFailure(step) {
        return errorUtils.catchUserCodeFailure(
            step,
            failure => {
                languageValues.admitReadyValue(failure)
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

function combineReadiness(operation, waits) {
    if (waits.length === 0) return undefined
    if (waits.length === 1) return waits[0]
    return operationLifecycle.continueInternal(
        operation,
        Promise.all(waits),
        () => undefined,
    )
}

// Common dispatch rejects `constructor` before either managed policy runs.
function getManagedRecordMethod(receiver, method) {
    const callable = languageProperties.readLanguageProperty(receiver, method)
    return typeof callable === "function"
        ? callable
        : invocation.methodNotCallableError(method)
}

function getManagedClassMethod(receiver, method) {
    if (languageProperties.hasLanguageProperty(receiver, method)) {
        return errorUtils.validationError(
            `Cannot call ${method} because an own data property ` +
            "with that name hides the method",
        )
    }
    let prototype = metadata.requireMeta(receiver).admittedPrototype
    while (
        prototype !== null &&
        !metadata.isPlainObjectPrototype(prototype)
    ) {
        const descriptor = errorUtils.runUserCode(
            () => Object.getOwnPropertyDescriptor(prototype, method),
        )
        if (descriptor) {
            if (!("value" in descriptor)) {
                errorUtils.reportFatalError(
                    new Error("Managed class prototype accessor changed"),
                )
            }
            return typeof descriptor.value === "function"
                ? descriptor.value
                : invocation.methodNotCallableError(method)
        }
        prototype = errorUtils.runUserCode(
            () => Object.getPrototypeOf(prototype),
        )
    }
    return invocation.methodNotCallableError(method)
}

// Observation materialization path-copies only required representation changes.
// Mutation isolation copies complete protected subgraphs before arbitrary writes.
function prepareMethodReceiver(
    receiver,
    mutation,
    operation,
    preserveReceiver,
) {
    return errorUtils.catchUserCodeFailure(
        () => {
            if (!mutation) return materializeObservationReceiver(receiver)
            operation.releaseReceivers()
            return isolateMutationReceiver(receiver, preserveReceiver)
        },
        failure => {
            languageValues.admitReadyValue(failure)
            return failure
        },
    )
}

function materializeObservationReceiver(receiver) {
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
        copies.set(source, createEmptyContainerCopy(source))
    }
    for (const source of needed) {
        const destination = copies.get(source)
        for (const key of languageProperties.enumerableLanguageKeys(source)) {
            const value = languageProperties.readLanguageProperty(source, key)
            const copied = copies.get(value) ?? value
            languageProperties.writeLanguageProperty(destination, key, copied)
        }
    }
    return copies.get(receiver)

    function visit(source) {
        if (!languageValues.isTraversable(source) || reached.has(source)) return
        reached.add(source)
        if (arrayViews.requiresArrayMaterialization(source)) {
            requireCopy(source)
        }
        for (const key of languageProperties.enumerableLanguageKeys(source)) {
            const child = languageProperties.readLanguageProperty(source, key)
            if (propertyVersions.getPromiseMirror(source, key) !== undefined) {
                const descriptor = languageProperties
                    .getLanguagePropertyDescriptor(source, key)
                if (!Object.is(descriptor?.value, child)) requireCopy(source)
            }
            if (!languageValues.isTraversable(child)) continue
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

function isolateMutationReceiver(receiver, preserveReceiver) {
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
        if (!languageValues.isTraversable(source)) return

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
            (parent === undefined && preserveReceiver) ||
            requiresIsolation(source)
        ) {
            copyCompleteGraph(source, copies)
            return
        }

        for (const key of languageProperties.enumerableLanguageKeys(source)) {
            visit(
                languageProperties.readLanguageProperty(source, key),
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
        )) {
            copyCompleteGraph(placement.parent, copies)
            return
        }
        propertyVersions.assignProperty(
            placement.parent,
            placement.key,
            destination,
        )
    }
}

function requiresIsolation(value) {
    return metadata.requiresCopyOnWrite(value) ||
        refcounts.getRefCounter(value) !== undefined ||
        propertyVersions.hasPromiseMirrors(value) ||
        arrayViews.requiresArrayMaterialization(value)
}

function copyCompleteGraph(source, copies = new Map()) {
    if (languageValues.isPromise(source)) {
        errorUtils.reportFatalError(
            new Error("Prepared managed receiver contains a Promise"),
        )
    }
    languageValues.admitValue(source)
    if (!languageValues.isTraversable(source)) return source

    const existing = copies.get(source)
    if (existing) return existing
    const destination = createEmptyContainerCopy(source)
    copies.set(source, destination)
    for (const key of languageProperties.enumerableLanguageKeys(source)) {
        languageProperties.writeLanguageProperty(
            destination,
            key,
            copyCompleteGraph(
                languageProperties.readLanguageProperty(source, key),
                copies,
            ),
        )
    }
    return destination
}

function invokeObservation(callable, receiver, args) {
    return imports.import(
        invocation.invokeDataFunction(callable, receiver, args),
        "managed method result",
    )
}

function invokeMutation(callable, receiver, args) {
    const result = invocation.invokeDataFunction(callable, receiver, args)
    if (result === receiver) return finishMutation(receiver, receiver)

    // A mutation may detach an admitted result while retaining one of its
    // descendants elsewhere in the receiver, so every result identity is shared.
    const admittedResult = imports.importManagedMutationResult(
        result,
        "managed mutation result",
    )
    if (!languageValues.isPromise(admittedResult)) {
        return finishMutation(receiver, admittedResult)
    }

    return languageValues.continuePromise(
        admittedResult,
        imported => errorUtils.runFatal(
            () => finishMutation(receiver, imported),
        ),
        reason => ({
            mutatedValue: errorUtils.toPoison(reason),
            result: admittedResult,
        }),
    )
}

function finishMutation(receiver, result) {
    return validateReceiver(receiver) ?? {
        mutatedValue: receiver,
        result,
    }
}

function validateReceiver(receiver) {
    const visited = new Set()
    const errors = new Set()
    let promiseError
    walk(receiver)
    return errors.size === 0
        ? undefined
        : errorUtils.combineErrors(
            errors,
            "Managed mutation produced invalid state",
        )

    function walk(value) {
        if (languageValues.isPromise(value)) {
            errors.add(
                promiseError ??= errorUtils.validationError(
                    "Managed mutation receiver contains a Promise",
                ),
            )
            return
        }
        if (languageValues.isError(value)) {
            errors.add(value)
            return
        }
        languageValues.admitValue(value)
        if (!languageValues.isTraversable(value) || visited.has(value)) return
        visited.add(value)
        for (const key of languageProperties.enumerableLanguageKeys(value)) {
            walk(languageProperties.readLanguageProperty(value, key))
        }
    }
}

export { selectManagedCall }
