import { ArrayView, isArrayIndex } from "./array-view.js"
import * as errors from "./error.js"
import * as properties from "./language-properties.js"
import * as metadata from "./meta.js"
import { capturePlacement } from "./property-versions.js"
import { copyIdentity, groupCapturedIdentities } from "./captured-identity.js"
import { ManagedCapture, assembleCapturedGraph } from "./managed-capture.js"
import { continueGraphTransition } from "./internal-step.js"
import { isPending } from "./language-values.js"
import { releaseOnClose } from "./operation-lifecycle.js"
import { initializePlacements } from "./parent-placements.js"
import { mayBeThenable, readCallableThen } from "./thenable-subscription.js"

// The snapshot reader validates ready-only data; graph construction, aliases,
// cycle bounds and output disposal use the same capture as managed consumers.
class SnapshotCapture extends ManagedCapture {
    leaves = new Map()
    failures = new Set()

    constructor(owner, admit) {
        super(owner, errors.ERROR_KIND.ExternalPropertyReadFailed, error => this.failed(error))
        this.admit = admit
    }

    failed(failure) {
        this.failures.add(failure)
        this.discard()
        this.leaves.clear()
        return failure
    }

    invalid(message) {
        return this.failed(errors.validationError(message, this.owner.operationContext,
            errors.ERROR_KIND.InvalidExternalSnapshot))
    }

    native(action) {
        return this.inspect(() => errors.runExternalAction(this.owner.operationContext, action))
    }

    describe(source, meta) {
        const { operationContext } = this.owner
        let facts, prototype
        // Failed raw classification is consumed once within this snapshot too.
        if (!metadata.isTraversableType(meta?.type)) this.visited.set(source, undefined)
        try {
            if (errors.isFatalError(source)) throw source
            if (typeof source === "function") facts = meta ?? { type: metadata.TYPE.Function }
            else facts = meta ?? this.inspect(() => metadata.inspectAdmissionMetaFacts(source, operationContext))
            if (errors.isPoisonError(facts)) return facts
            const managed = metadata.isTraversableType(meta?.type)
            const array = facts.type === metadata.TYPE.Array
            prototype = array ? Array.prototype : facts.admittedPrototype
            // Never invoke then, including when it could deliver synchronously.
            // Logical managed placements override stale physical host values.
            const then = typeof source === "function" ? undefined : managed
                ? this.inspect(() => captureSnapshotPlacement(source, "then", operationContext).value)
                : mayBeThenable(source, operationContext) ? this.inspect(() => readCallableThen(source, operationContext)) : undefined
            if (errors.isPoisonError(then)) this.failed(then)
            if (typeof then === "function") {
                this.invalid("External snapshots cannot contain thenables")
                if (!managed) return undefined
            }
            if (!metadata.isTraversableType(facts.type)) {
                if (this.admit && this.records && !meta) this.leaves.set(source, facts)
                return facts
            }
            if (!managed && !array && !errors.isPoisonError(prototype)) this.inspectPrototype(prototype)
            const length = array ? (managed
                ? this.inspect(() => captureSnapshotPlacement(source, "length", operationContext).value)
                : this.native(() => source.length)) : undefined
            if (errors.isPoisonError(length)) this.failed(length)
            else if (array && (!Number.isInteger(length) || length < 0 || length > 0xffffffff))
                this.invalid("External snapshot Array has an invalid length")
            return { type: facts.type, admittedPrototype: prototype, length, managed }
        } finally { source = meta = facts = prototype = undefined }
    }

    keys(source, facts) {
        try {
            if (facts.managed) return properties.enumerableLanguageKeyCandidates(source, this.owner.operationContext)
            return errors.runExternalAction(this.owner.operationContext, () => Reflect.ownKeys(source)).filter(
                key => typeof key === "string" && (facts.type !== metadata.TYPE.Array || isArrayIndex(key)))
        } finally { source = facts = undefined }
    }

    shape(source, keys, facts) { return { length: facts.length } }

    placement(source, key, facts) {
        try {
            if (facts.managed) return captureSnapshotPlacement(source, key, this.owner.operationContext)
            const descriptor = errors.runExternalAction(this.owner.operationContext,
                () => Object.getOwnPropertyDescriptor(source, key))
            return descriptor?.enumerable && "value" in descriptor
                ? { present: true, value: descriptor.value } : { present: false }
        } finally { source = undefined }
    }

    consume(placement, visit) { return visit(placement.value) }

    inspectPrototype(prototype) {
        const { operationContext } = this.owner
        try {
            this.inspect(() => metadata.inspectManagedPrototype(prototype,
                action => errors.runExternalAction(operationContext, action), () => {
                    this.invalid("External snapshot prototype contains an unsafe then property")
                }))
        } finally { prototype = undefined }
    }
}

// Data capture is ready-only. Managed copies preserve undecided aliases through
// captured cells; complete native output resolves them after source access ends.
function captureExternalValue(value, owner, admit = true) {
    const { operationContext } = owner
    const capture = new SnapshotCapture(owner, admit)
    try {
        capture.walk(value, result => { capture.roots[0] = result })
        // Later conflicting native work must not wait for managed identity.
        owner.completeExternalEffect()
        if (capture.failures.size) return errors.combineErrors(capture.failures)
        if (admit) for (const [leaf, facts] of capture.leaves)
            metadata.getOrCreateMeta(leaf, operationContext, facts.type, facts.admittedPrototype)
        return capture
    } catch (failure) { capture.discard(); throw failure }
    finally { capture.leaves.clear(); capture.failures.clear(); value = undefined }
}

function snapshotExternalValue(value, owner, admit = true) {
    const capture = captureExternalValue(value, owner, admit)
    return errors.isPoisonError(capture) ? capture : assembleExternalSnapshot(capture, admit)
}

function assembleExternalSnapshot(capture, admit = true) {
    const { owner } = capture
    const { operationContext } = owner
    let unregister, domains = admit ? new Map() : undefined
    if (admit) capture.identities = groupCapturedIdentities(capture.records)
    const result = continueGraphTransition(admit ? undefined : capture.resolve(), operationContext, () => {
        try {
            const [value] = assembleCapturedGraph(capture, admit ? (copy, node) => {
                metadata.getOrCreateMeta(copy, operationContext, node.type, node.prototype).generation =
                    copyIdentity(node.identity, domains)
            } : undefined)
            if (admit) for (const node of capture.identities.values()) initializePlacements(node.copy, operationContext)
            return value
        } finally { release() }
    }, undefined, owner)
    if (isPending(result, operationContext)) unregister = releaseOnClose(owner, release)
    return result

    function release() {
        unregister?.()
        unregister = domains = undefined
        capture.discard()
    }
}

// Snapshot reads must not normalize source storage or subscribe to a gate.
function captureSnapshotPlacement(owner, key, operationContext, type = metadata.metaOf(owner, operationContext)?.type) {
    if (type === metadata.TYPE.Array) {
        if (key === "length") {
            const length = ArrayView.readyLength(owner, operationContext)
            return { present: true, value: length === undefined ? errors.validationError(
                "External snapshots require settled Array length", operationContext,
                errors.ERROR_KIND.InvalidExternalSnapshot) : length }
        }
        if (!isArrayIndex(key)) return { value: undefined, present: false }
    }
    const placement = capturePlacement(owner, key, operationContext)
    return placement.sourceVersion?.pendingPresence ? { present: true, value: errors.validationError(
        "External snapshots require settled property presence", operationContext,
        errors.ERROR_KIND.InvalidExternalSnapshot) } : { ...placement,
            value: placement.ownFailure ?? placement.value, present: Boolean(placement.ownFailure) || placement.present }
}

export { captureSnapshotPlacement, captureExternalValue, assembleExternalSnapshot, snapshotExternalValue }
