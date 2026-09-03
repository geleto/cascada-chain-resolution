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
    const getMethod = receiverType === languageValues.TYPE_RECORD
        ? getManagedRecordMethod
        : getManagedClassMethod
    return {
        leaseReceiverThroughResult: !mutation,
        prepareArguments: () =>
            prepareManagedReceiverAndArguments(invocationContext),
        getMethod: prepared => getMethod(
            prepared.receiver,
            invocationContext,
        ),
        invoke(prepared, callable) {
            const workingReceiver = prepareMethodReceiver(
                prepared.receiver,
                invocationContext,
            )
            if (languageValues.isError(workingReceiver)) {
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
    return operationLifecycle.continuePreparedAll(
        invocationContext,
        [
            resolveAndLeaseReceiverGraph(invocationContext),
            invocationContext.exportArguments(),
        ],
        ([preparedReceiver, exportedArgs]) => ({
            receiver: preparedReceiver,
            args: exportedArgs,
        }),
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
    try {
        const readiness = operationLifecycle.resolveInitial(
            invocationContext,
            receiver,
            resolved => {
                preparation.receiver = resolved
                return visit(resolved)
            },
        )
        if (languageValues.isPromise(readiness, invocationContext.operationContext)) {
            unregisterRelease = operationLifecycle.registerRelease(
                invocationContext,
                release,
            )
        }
        return operationLifecycle.continueInternal(
            invocationContext,
            readiness,
            finish,
        )
    } catch (error) {
        unregisterRelease?.()
        release()
        throw error
    }

    function visit(value) {
        if (!operationLifecycle.mayContinue(invocationContext)) return undefined
        if (languageValues.isError(value)) {
            preparation.errors.add(errorUtils.toPoison(
                value,
                invocationContext.operationContext,
                errorUtils.ERROR_KIND.InvalidManagedReceiver,
            ))
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

        const keys = catchFailure(
            () => languageProperties.enumerableLanguageKeys(
                value,
                invocationContext.operationContext,
            ),
        )
        if (keys === undefined) return undefined

        const waits = []
        for (const key of keys) {
            const child = catchFailure(
                () => languageProperties.readLanguageProperty(
                    value,
                    key,
                    invocationContext.operationContext,
                ),
            )
            if (!languageValues.isPromise(child, invocationContext.operationContext)) {
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
                return operationLifecycle.observeFatal(invocationContext, result)
            })
            if (continued) waits.push(continued)
        }
        return combineReadiness(invocationContext, waits)
    }

    function catchFailure(step) {
        return errorUtils.catchUserCodeFailure(
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
    return operationLifecycle.continueInternal(
        invocationContext,
        Promise.all(waits),
        () => undefined,
    )
}

// Common dispatch rejects `constructor` before either managed policy runs.
function getManagedRecordMethod(receiver, invocationContext) {
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

function getManagedClassMethod(receiver, invocationContext) {
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
        !metadata.isPlainObjectPrototype(prototype)
    ) {
        const descriptor = errorUtils.runUserCode(
            () => Object.getOwnPropertyDescriptor(prototype, method),
        )
        if (descriptor) {
            if (!("value" in descriptor)) {
                throw new Error("Managed class prototype accessor changed")
            }
            return typeof descriptor.value === "function"
                ? descriptor.value
                : invocation.methodNotCallableError(
                    method,
                    operationContext,
                )
        }
        prototype = errorUtils.runUserCode(
            () => Object.getPrototypeOf(prototype),
        )
    }
    return invocation.methodNotCallableError(method, operationContext, false)
}

// Observation materialization path-copies only required representation changes.
// Mutation isolation copies complete protected subgraphs before arbitrary writes.
function prepareMethodReceiver(
    receiver,
    invocationContext,
) {
    return errorUtils.catchUserCodeFailure(
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
    if (languageValues.isPromise(source, operationContext)) {
        throw new Error("Prepared managed receiver contains a Promise")
    }
    languageValues.admitValue(source, operationContext)
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
    return imports.importHostResult(
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
    let callFailure
    const result = invocation.invokeHostFunction(
        callable,
        receiver,
        args,
        operationContext,
        errorUtils.ERROR_KIND.UserCallThrew,
        failure => callFailure = failure,
    )
    if (callFailure) {
        return { mutatedValue: callFailure, result: callFailure }
    }
    if (result === receiver) return finishMutation(receiver, receiver, operationContext)

    // A mutation may detach an admitted result while retaining one of its
    // descendants elsewhere in the receiver, so every result identity is shared.
    const admittedResult = imports.importManagedMutationResult(
        result,
        operationContext,
    )
    if (!languageValues.isPromise(admittedResult, operationContext)) {
        return finishMutation(receiver, admittedResult, operationContext)
    }

    return languageValues.continuePromise(
        admittedResult,
        operationContext,
        imported => errorUtils.runFatal(
            operationContext,
            () => finishMutation(receiver, imported, operationContext),
        ),
        reason => ({
            mutatedValue: errorUtils.toPoison(
                reason,
                operationContext,
                errorUtils.ERROR_KIND.UserCallThrew,
            ),
            result: admittedResult,
        }),
    )
}

function finishMutation(receiver, result, operationContext) {
    return validateReceiver(receiver, operationContext) ?? {
        mutatedValue: receiver,
        result,
    }
}

function validateReceiver(receiver, operationContext) {
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
        if (languageValues.isPromise(value, operationContext)) {
            errors.add(
                promiseError ??= errorUtils.validationError(
                    "Managed mutation receiver contains a Promise",
                    operationContext,
                    errorUtils.ERROR_KIND.InvalidManagedReceiver,
                ),
            )
            return
        }
        if (languageValues.isError(value)) {
            errors.add(errorUtils.toPoison(
                value,
                operationContext,
                errorUtils.ERROR_KIND.InvalidManagedReceiver,
            ))
            return
        }
        languageValues.admitValue(value, operationContext)
        if (
            !languageValues.isTraversable(value, operationContext) ||
            visited.has(value)
        ) return
        visited.add(value)
        for (const key of languageProperties.enumerableLanguageKeys(
            value,
            operationContext,
        )) {
            walk(languageProperties.readLanguageProperty(value, key, operationContext))
        }
    }
}

export { getManagedMethodDescription }
