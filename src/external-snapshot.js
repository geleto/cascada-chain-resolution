import { ArrayView, isArrayIndex } from "./array-view.js"
import * as errors from "./error.js"
import * as properties from "./language-properties.js"
import * as metadata from "./meta.js"
import { capturePlacement } from "./property-versions.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import { createIdentity, captureIdentity, copyIdentity, groupCapturedIdentities } from "./captured-identity.js"
import { CapturedGraph, assembleCapturedGraph } from "./captured-graph.js"
import { continueGraphTransition } from "./internal-step.js"
import { isPending } from "./language-values.js"
import { releaseOnClose } from "./operation-lifecycle.js"
import { initializePlacements } from "./parent-placements.js"
import { mayBeThenable, readCallableThen } from "./thenable-subscription.js"

// Data capture is ready-only. Managed copies preserve undecided aliases through
// captured cells; complete native output resolves them after source access ends.
function captureExternalValue(value, owner, admit = true) {
    const { operationContext } = owner
    const visited = new Map()
    const failures = new Set()
    const leaves = new Map()
    const capture = new CapturedGraph(owner)
    try {
        const result = walk(value)
        if (capture.records) capture.roots.push(result)
        // Later conflicting native work must not wait for managed identity.
        owner.completeExternalEffect()
        if (failures.size) {
            capture.discard()
            return errors.combineErrors(failures)
        }
        if (admit) for (const [leaf, facts] of leaves)
            metadata.getOrCreateMeta(leaf, operationContext, facts.type, facts.admittedPrototype)
        return capture
    } catch (failure) { capture.discard(); throw failure }
    finally { visited.clear(); leaves.clear(); failures.clear(); value = undefined }

    function collect(failure) {
        failures.add(failure)
        capture.discard()
        leaves.clear()
        return failure
    }

    function inspect(action) {
        return errors.catchExternalThrow(action, operationContext,
            errors.ERROR_KIND.ExternalPropertyReadFailed, collect)
    }

    function native(action) {
        return inspect(() => errors.runExternalAction(operationContext, action))
    }

    function isPlainPrototype(prototype) {
        return inspect(() => metadata.isPlainObjectPrototype(prototype,
            action => errors.runExternalAction(operationContext, action)))
    }

    function invalid(message) {
        return collect(errors.validationError(message, operationContext,
            errors.ERROR_KIND.InvalidExternalSnapshot))
    }

    function walk(source) {
        try {
            if (errors.isFatalError(source)) throw source
            if (errors.isPoisonError(source)) return collect(source)
            if (!metadata.isObjectLike(source)) return source
            if (typeof source === "function") {
                if (admit && capture.records && !metadata.metaOf(source, operationContext)) leaves.set(source, { type: metadata.TYPE.Function })
                return source
            }
            if (operationContext.execution._externalIdentities.has(source))
                return collect(externalCapabilityEscapeError(operationContext))
            if (visited.has(source)) return visited.get(source)
            visited.set(source, undefined)
            const meta = metadata.metaOf(source, operationContext)
            const facts = meta ?? inspect(() => metadata.inspectAdmissionMetaFacts(source, operationContext))
            if (errors.isPoisonError(facts)) return facts
            const managed = metadata.isTraversableType(meta?.type)
            const array = facts.type === metadata.TYPE.Array
            const prototype = array ? Array.prototype : facts.admittedPrototype

            // Never invoke then, including when it could deliver synchronously.
            // Logical managed placements override stale physical host values.
            const then = managed
                ? inspect(() => captureSnapshotPlacement(source, "then", operationContext).value)
                : mayBeThenable(source, operationContext) ? inspect(() => readCallableThen(source, operationContext)) : undefined
            if (errors.isPoisonError(then)) collect(then)
            if (typeof then === "function") {
                invalid("External snapshots cannot contain thenables")
                if (!managed) return undefined
            }
            if (!metadata.isTraversableType(facts.type)) {
                if (admit && capture.records && !meta) leaves.set(source, facts)
                visited.set(source, source)
                return source
            }
            // Admitted managed sources have a fixed category and safe, stable
            // prototype; only new host sources need those probes here.
            if (!managed && !array && !errors.isPoisonError(prototype)) inspectPrototype(prototype)

            const length = array ? (managed
                ? inspect(() => captureSnapshotPlacement(source, "length", operationContext).value)
                : native(() => source.length)) : undefined
            if (errors.isPoisonError(length)) collect(length)
            else if (array && (!Number.isInteger(length) || length < 0 || length > 0xffffffff))
                invalid("External snapshot Array has an invalid length")
            const type = facts.type
            const node = capture.records ? {
                identity: managed ? captureIdentity(source, operationContext) : createIdentity(),
                type, prototype, shape: { length }, entries: new Map(),
            } : undefined
            visited.set(source, node)
            if (node) capture.records.add(node)
            const keys = managed
                ? inspect(() => properties.enumerableLanguageKeyCandidates(source, operationContext))
                : native(() => Reflect.ownKeys(source))
            if (errors.isPoisonError(keys)) return keys
            for (const key of keys) {
                if (typeof key !== "string" || (array && !isArrayIndex(key))) continue
                let child
                if (managed) {
                    const placement = inspect(() => capturePlacement(source, key, operationContext))
                    if (placement.present !== true) continue
                    if (placement.sourceVersion?.pendingPresence) {
                        invalid("External snapshots require settled property presence")
                        continue
                    }
                    child = placement.value
                } else {
                    const descriptor = native(() => Object.getOwnPropertyDescriptor(source, key))
                    if (errors.isPoisonError(descriptor) || !descriptor?.enumerable || !("value" in descriptor)) continue
                    child = descriptor.value
                }
                const copied = walk(child)
                if (capture.records) node.entries.set(key, copied)
            }
            return node
        } finally { source = undefined }
    }

    function inspectPrototype(prototype) {
        let current = prototype
        try {
            for (; current !== null;) {
                const plain = isPlainPrototype(current)
                if (plain === true || errors.isPoisonError(plain)) return
                const descriptor = native(() => Object.getOwnPropertyDescriptor(current, "then"))
                if (errors.isPoisonError(descriptor)) return
                if (descriptor && (!("value" in descriptor) || typeof descriptor.value === "function"))
                    invalid("External snapshot prototype contains an unsafe then property")
                current = native(() => Object.getPrototypeOf(current))
                if (errors.isPoisonError(current)) return
            }
        } finally { prototype = current = undefined }
    }
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
        errors.ERROR_KIND.InvalidExternalSnapshot) } : placement
}

export { captureSnapshotPlacement, captureExternalValue, assembleExternalSnapshot, snapshotExternalValue }
