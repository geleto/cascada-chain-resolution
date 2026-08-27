import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as invocation from "./invocation.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import { createEmptyContainerCopy } from "./mutations.js"
import * as propertyVersions from "./property-versions.js"
import * as refcounts from "./refcounts.js"
import * as resolution from "./resolution.js"

// Registered-class methods are trusted synchronous class code. They may
// mutate only their receiver graph and expose state only through language
// properties.
// All registered-class-specific preparation and isolation stays at this boundary.
function selectRegisteredClassCall(
    receiver,
    method,
    mutation,
    mutationContext,
) {
    const callable = findRegisteredClassMethod(receiver, method)
    if (languageValues.isError(callable)) return callable

    // Registered-class invocation prepares and admits its result here,
    // so it deliberately supplies no common admitResult hook.
    return {
        prepareInputs: (args, invocation) => prepareCall(
            receiver,
            args,
            mutation,
            invocation,
            mutationContext?.mustPreserveValue === true,
        ),
        invoke: prepared => mutation
            ? invokeMutation(callable, prepared)
            : invokeObservation(callable, prepared),
    }
}

function findRegisteredClassMethod(receiver, method) {
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
                // Registration rejected accessors; finding one while already
                // selecting this descriptor means the trusted chain changed.
                errorUtils.reportFatalError(
                    new Error("Registered class prototype accessor changed"),
                )
            }
            return typeof descriptor.value === "function"
                ? descriptor.value
                : errorUtils.validationError(
                    `Method is not callable: ${method}`,
                )
        }
        prototype = errorUtils.runUserCode(
            () => Object.getPrototypeOf(prototype),
        )
    }
    return errorUtils.validationError(`Method is not callable: ${method}`)
}

function prepareCall(
    receiver,
    args,
    mutation,
    invocation,
    preserveReceiver,
) {
    return resolution.continueInternalPromisesOrFatal(
        [
            prepareRoot(receiver, invocation.retainReceiver),
            ...args.map(root => prepareRoot(
                root,
                invocation.retainArgument,
            )),
        ],
        finish,
    )

    function finish(preparedRoots) {
        const errors = new Set()
        for (const prepared of preparedRoots) {
            for (const error of prepared.errors) errors.add(error)
        }
        if (errors.size > 0) {
            return errorUtils.combineErrors(
                errors,
                "Registered class call received multiple Errors",
            )
        }
        const roots = preparedRoots.map(prepared => prepared.value)
        return errorUtils.catchUserCodeFailure(
            () => finishPrepared(roots),
            failure => {
                languageValues.admitReadyValue(failure)
                return failure
            },
        )
    }

    function finishPrepared(roots) {
        if (!mutation) {
            const values = materializeAndRemapInputs(roots, new Map())
            return {
                receiver: values[0],
                args: values.slice(1),
            }
        }

        invocation.releaseReceivers()
        const isolated = isolateReceiver(roots[0], preserveReceiver)
        const preparedArgs = materializeAndRemapInputs(
            roots.slice(1),
            isolated.copies,
        )
        return {
            receiver: isolated.value,
            args: preparedArgs,
        }
    }
}

function prepareRoot(root, retain) {
    const visited = new Set()
    const errors = new Set()
    let value
    const readiness = resolution.resolveInitialValueOrPoison(
        root,
        resolved => {
            value = resolved
            return visit(resolved)
        },
    )
    return resolution.continueInternalPromiseOrFatal(
        readiness,
        () => ({ value, errors }),
    )

    function visit(current) {
        if (languageValues.isError(current)) {
            errors.add(current)
            return undefined
        }
        if (!languageValues.isTraversable(current) || visited.has(current)) {
            return undefined
        }
        visited.add(current)
        retain(current)

        const keys = catchPreparationFailure(
            () => languageProperties.enumerableLanguageKeys(current),
        )
        if (keys === undefined) return undefined

        const waits = []
        for (const key of keys) {
            const child = catchPreparationFailure(
                () => languageProperties.readLanguageProperty(current, key),
            )
            if (!languageValues.isPromise(child)) {
                const nested = visit(child)
                if (nested) waits.push(nested)
                continue
            }
            const continued = catchPreparationFailure(
                () => propertyVersions.continuePropertyValue(
                    current,
                    key,
                    child,
                    visit,
                ),
            )
            waits.push(continued)
        }
        return combineReadiness(waits)
    }

    function catchPreparationFailure(fn) {
        return errorUtils.catchUserCodeFailure(
            fn,
            failure => {
                languageValues.admitReadyValue(failure)
                errors.add(failure)
                return undefined
            },
        )
    }
}

function combineReadiness(waits) {
    if (waits.length === 0) return undefined
    if (waits.length === 1) return waits[0]
    return resolution.continueInternalPromisesOrFatal(
        waits,
        () => undefined,
    )
}

function materializeAndRemapInputs(values, remaps) {
    // Propagate copy demand backward so only paths to a logical/physical
    // mismatch or receiver remap are rebuilt.
    const parents = new Map()
    const reached = new Set()
    const needed = new Set()
    const queue = []
    for (const value of values) visit(value)
    for (let index = 0; index < queue.length; index++) {
        for (const parent of parents.get(queue[index]) ?? []) {
            requireCopy(parent)
        }
    }

    const materialized = []
    for (const source of needed) {
        if (remaps.has(source)) continue
        const destination = createEmptyContainerCopy(source)
        remaps.set(source, destination)
        materialized.push([source, destination])
    }
    for (const [source, destination] of materialized) {
        for (const key of languageProperties.enumerableLanguageKeys(source)) {
            const value = languageProperties.readLanguageProperty(source, key)
            languageProperties.writeLanguageProperty(
                destination,
                key,
                remaps.get(value) ?? value,
            )
        }
    }
    return values.map(value => remaps.get(value) ?? value)

    function visit(source) {
        if (!languageValues.isTraversable(source) || reached.has(source)) return
        reached.add(source)
        if (remaps.has(source)) requireCopy(source)
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

function isolateReceiver(receiver, preserveReceiver) {
    // Keep every reached placement: a later complete copy can close a cycle
    // or reach an earlier alias that must be reconnected to the same copy.
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
    return { value, copies }

    function visit(source, parent, key) {
        if (!languageValues.isTraversable(source)) return

        const placement = { parent, key }
        let sourcePlacements = placements.get(source)
        if (!sourcePlacements) {
            sourcePlacements = []
            placements.set(source, sourcePlacements)
        }
        sourcePlacements.push(placement)

        if (copies.has(source)) return
        if (visited.has(source)) return
        visited.add(source)

        if (
            (parent === undefined && preserveReceiver) ||
            requiresIsolation(source)
        ) {
            const copied = copyCompleteGraph(source, copies)
            if (copied.promiseFound) {
                errorUtils.reportFatalError(
                    new Error(
                        "Prepared registered class receiver contains a Promise",
                    ),
                )
            }
            return
        }

        for (const key of languageProperties.enumerableLanguageKeys(source)) {
            const child = languageProperties.readLanguageProperty(source, key)
            visit(child, source, key)
            if (copies.has(source)) return
        }
    }

    function reconnect(placement, destination) {
        if (placement.parent === undefined) {
            value = destination
        } else if (!copies.has(placement.parent)) {
            propertyVersions.assignProperty(
                placement.parent,
                placement.key,
                destination,
            )
        }
    }
}

function requiresIsolation(value) {
    return metadata.requiresCopyOnWrite(value) ||
        refcounts.getRefCounter(value) !== undefined ||
        propertyVersions.hasPromiseMirrors(value) ||
        arrayViews.requiresArrayMaterialization(value)
}

function copyCompleteGraph(root, copies) {
    let promiseFound = false
    const value = copy(root)
    return { value, promiseFound }

    function copy(source) {
        if (languageValues.isPromise(source)) {
            promiseFound = true
            return undefined
        }
        languageValues.admitValue(source)
        if (!languageValues.isTraversable(source)) return source

        copies ??= new Map()
        const existing = copies.get(source)
        if (existing) return existing
        const destination = createEmptyContainerCopy(source)
        copies.set(source, destination)
        for (const key of languageProperties.enumerableLanguageKeys(source)) {
            const value = languageProperties.readLanguageProperty(source, key)
            languageProperties.writeLanguageProperty(
                destination,
                key,
                copy(value),
            )
            if (promiseFound) break
        }
        return destination
    }
}

function invokeObservation(callable, prepared) {
    const result = invocation.invokeDataFunction(
        callable,
        prepared.receiver,
        prepared.args,
    )
    return prepareResult(result)
}

function invokeMutation(callable, prepared) {
    const result = invocation.invokeDataFunction(
        callable,
        prepared.receiver,
        prepared.args,
    )
    const returnsReceiver = result === prepared.receiver
    const receiverFailure = finalizeReceiver(prepared.receiver)
    if (receiverFailure) return receiverFailure
    return {
        mutatedValue: prepared.receiver,
        result: returnsReceiver
            ? prepared.receiver
            : prepareResult(result),
    }
}

function finalizeReceiver(receiver) {
    const visited = new Set()
    const errors = new Set()
    let promiseFailure
    walk(receiver)
    if (promiseFailure) errors.add(promiseFailure)
    return errors.size === 0
        ? undefined
        : errorUtils.combineErrors(
            errors,
            "Registered class mutation produced invalid state",
        )

    function walk(value) {
        if (languageValues.isPromise(value)) {
            promiseFailure ??= errorUtils.validationError(
                "Registered class mutation receiver contains a Promise",
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

        // Argument leases are the usual source; any other active lease also
        // conservatively requires ordinary COW protection after publication.
        if (metadata.hasReadLease(value)) {
            metadata.markShared(value)
        }
        for (const key of languageProperties.enumerableLanguageKeys(value)) {
            walk(languageProperties.readLanguageProperty(value, key))
        }
    }
}

function prepareResult(result) {
    return errorUtils.catchUserCodeFailure(
        () => {
            const copied = copyCompleteGraph(result)
            return copied.promiseFound
                ? errorUtils.validationError(
                    "Registered class method result cannot contain a Promise",
                )
                : copied.value
        },
        failure => {
            languageValues.admitReadyValue(failure)
            return failure
        },
    )
}

export { selectRegisteredClassCall }
