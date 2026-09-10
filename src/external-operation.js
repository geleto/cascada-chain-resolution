import * as errors from "./error.js"
import { EXTERNAL_BOUNDARY } from "./external-mutation-tree.js"
import { continueOperation, runInternalStep } from "./internal-step.js"

function locationFailure(operationContext) {
    return errors.validationError(
        "External access requires its registered context location",
        operationContext,
        errors.ERROR_KIND.ExternalLocationConflict,
    )
}

// An absent registration permits observation-only access. A conflicting
// registration remains a failure even though its tree leaf has no authority.
function validateExternalAccess(identity, boundary, operationContext) {
    return runInternalStep(operationContext, () => {
        const entry = operationContext.execution._externalIdentities.get(identity)
        if (boundary && entry !== boundary[EXTERNAL_BOUNDARY]) {
            throw new Error("External identity changed at its fixed context location")
        }
        if (boundary) return validateExternalBinding(boundary)
        if (!entry) return null
        if (errors.isPoisonError(entry.binding)) return entry.binding
        return locationFailure(operationContext)
    })
}

// A committed entry binds this location or holds its permanent conflict poison.
function validateExternalBinding(boundary) {
    const { binding } = boundary[EXTERNAL_BOUNDARY]
    return binding === boundary ? null : binding
}

// Observations wait for the preceding mutation, never for each other.
// The next mutation seals this group and waits for all its observations.
// Keep an empty group joinable until sealing; its Promise carries no poison.
class ReadGroup {
    pending = 0
    sealed = false
    constructor() {
        const { promise, resolve } = Promise.withResolvers()
        this.promise = promise
        this.resolve = resolve
    }
    finish() {
        this.pending--
        this.complete()
    }
    seal() {
        this.sealed = true
        this.complete()
    }
    complete() {
        if (!this.sealed || this.pending !== 0) return
        this.resolve()
        this.resolve = undefined
    }
}

function reservePhase(entry, exclusive) {
    const cursor = entry.phase ??= {
        exclusive: Promise.resolve(null),
        readers: undefined,
    }
    const predecessor = cursor.exclusive
    if (!exclusive) {
        const readers = cursor.readers ??= new ReadGroup()
        readers.pending++
        // Observation failures belong to their result. Completion only drains
        // the group, ignoring failure so it cannot change phase poison.
        return { predecessor, complete: () => readers.finish() }
    }

    const { promise, resolve } = Promise.withResolvers()
    const readers = cursor.readers
    cursor.exclusive = promise
    cursor.readers = undefined
    readers?.seal()
    return {
        predecessor,
        drain: readers?.promise,
        complete: resolve,
    }
}

class ExternalOperationContext {
    // The caller has selected one static boundary and passed earlier managed
    // gates. Reserve before waiting for predecessors, inputs, or native keys.
    static reserve(operationContext, boundary, exclusive = false, repair = false) {
        return runInternalStep(operationContext, () => {
            const failure = validateExternalBinding(boundary)
            return failure ?? new ExternalOperationContext(
                operationContext, boundary, exclusive || repair, repair,
            )
        })
    }

    constructor(operationContext, boundary, exclusive, repair) {
        this.operationContext = operationContext
        this.boundary = boundary
        this.repair = repair
        const { predecessor, drain, complete } = reservePhase(boundary[EXTERNAL_BOUNDARY], exclusive)
        this.completePhase = complete
        // The successor is already installed. Every reader in the captured group
        // waits for this predecessor, so waiting for predecessor then drain is sufficient.
        // Ordinary continuations preserve FIFO even for settled native Promises.
        this.ready = continueOperation(predecessor, operationContext, poison =>
            continueOperation(drain, operationContext, () => {
                this.predecessorPoison = poison
            }),
        )
    }

    // Call after readiness and again before host access if preparation waited.
    prepare() {
        return runInternalStep(this.operationContext, () =>
            validateExternalBinding(this.boundary) ??
            (this.repair ? null : this.predecessorPoison),
        )
    }

    complete(failure = null) {
        return runInternalStep(this.operationContext, () => {
            if (errors.isFatalError(failure)) throw failure
            if (!this.completePhase) return
            // A binding conflict cannot change phase poison. A blocked mutation
            // forwards its exact predecessor; repair replaces it deliberately.
            const poison = errors.isPoisonError(this.boundary[EXTERNAL_BOUNDARY].binding)
                ? this.predecessorPoison
                : this.repair ? failure : this.predecessorPoison ?? failure
            this.completePhase(poison)
            this.completePhase = undefined
            this.boundary = undefined
            this.predecessorPoison = undefined
            this.ready = undefined
        })
    }
}

export { ExternalOperationContext, validateExternalAccess, validateExternalBinding }
