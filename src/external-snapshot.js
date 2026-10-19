import { ArrayView, isLogicalArray, isArrayIndex } from "./array-view.js"
import * as errors from "./error.js"
import * as properties from "./language-properties.js"
import * as metadata from "./meta.js"
import { capturePlacement } from "./property-versions.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import { createIdentity, captureIdentity } from "./captured-identity.js"
import { ManagedCapture, assembleCapturedGraph } from "./managed-capture.js"
import { continueGraphTransition } from "./internal-step.js"
import { isPending } from "./language-values.js"
import { releaseOnClose } from "./operation-lifecycle.js"
import { initializePlacements } from "./parent-placements.js"
import { readCallableThen } from "./thenable-subscription.js"

// Data capture is ready-only. Identity grouping may finish later, after native
// source access and its reservation have ended. Only final copies are admitted.
function snapshotExternalValue(value, owner, admit = true) {
    const { operationContext } = owner
    const visited = new Map()
    const failures = new Set()
    const functions = new Set()
    const capture = new ManagedCapture(owner, errors.ERROR_KIND.ExternalPropertyReadFailed, collect)
    let unregister
    try {
        const result = walk(value)
        if (capture.records) capture.roots.push(result)
    } catch (failure) { release(); throw failure }
    finally { visited.clear(); value = undefined }
    // Later conflicting native work must not wait for a managed identity
    // decision: that earlier managed work can itself need the native resource.
    owner.completeExternalEffect()
    if (failures.size) {
        const failure = errors.combineErrors(failures, "External property snapshot failed")
        release()
        return failure
    }
    const result = continueGraphTransition(capture.resolve(), operationContext, finish, undefined, owner)
    if (isPending(result, operationContext)) unregister = releaseOnClose(owner, release)
    return result

    function finish() {
        try {
            const [result] = assembleCapturedGraph(capture, admit ? (copy, node) =>
                metadata.getOrCreateMeta(copy, operationContext, node.type, node.prototype) : undefined)
            if (admit) {
                for (const fn of functions) metadata.getOrCreateMeta(fn, operationContext, metadata.TYPE.Function)
                for (const node of capture.identities.values()) initializePlacements(node.copy, operationContext)
            }
            return result
        } finally { release() }
    }

    function release() {
        unregister?.()
        unregister = undefined
        capture.discard()
        functions.clear()
        failures.clear()
    }

    function collect(failure) {
        failures.add(failure)
        capture.discard()
        functions.clear()
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
            if (Error.isError(source)) return collect(errors.createPoisonError(
                source, operationContext, errors.ERROR_KIND.ExternalPropertyReadFailed))
            if (!metadata.isObjectLike(source)) return source
            if (typeof source === "function") {
                if (capture.records && !metadata.metaOf(source, operationContext)) functions.add(source)
                return source
            }
            if (operationContext.execution._externalIdentities.has(source))
                return collect(externalCapabilityEscapeError(operationContext))
            if (visited.has(source)) return visited.get(source)
            visited.set(source, undefined)
            const meta = metadata.metaOf(source, operationContext)
            const managed = metadata.isTraversableType(meta?.type)
            const array = managed ? meta.type === metadata.TYPE.Array : native(() => Array.isArray(source))
            if (errors.isPoisonError(array)) return array
            const prototype = managed && !array ? meta.admittedPrototype :
                array ? Array.prototype : native(() => Object.getPrototypeOf(source))

            // Never invoke then, including when it could deliver synchronously.
            // Logical managed placements override stale physical host values.
            const then = managed
                ? inspect(() => readManagedProperty(source, "then", operationContext))
                : inspect(() => readCallableThen(source, operationContext))
            if (errors.isPoisonError(then)) collect(then)
            if (typeof then === "function") {
                invalid("External snapshots cannot contain thenables")
                if (!managed) return undefined
            }
            // Admitted managed sources have a fixed category and safe, stable
            // prototype; only new host sources need those probes here.
            if (!managed && !array && !errors.isPoisonError(prototype)) inspectPrototype(prototype)

            const length = array ? (managed
                ? inspect(() => readManagedProperty(source, "length", operationContext))
                : native(() => source.length)) : undefined
            if (errors.isPoisonError(length)) collect(length)
            else if (array && (!Number.isInteger(length) || length < 0 || length > 0xffffffff))
                invalid("External snapshot Array has an invalid length")
            const plain = !managed && !array && !errors.isPoisonError(prototype) &&
                (prototype === null || isPlainPrototype(prototype))
            const type = managed ? meta.type : array ? metadata.TYPE.Array : plain === true ? metadata.TYPE.Record : metadata.TYPE.ManagedClass
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
                    if (errors.isPoisonError(descriptor) || !descriptor?.enumerable) continue
                    child = native(() => source[key])
                }
                const copied = walk(child)
                if (capture.records) node.entries.set(key, copied)
            }
            return node
        } finally { source = undefined }
    }

    function inspectPrototype(prototype) {
        for (let current = prototype; current !== null;) {
            const plain = isPlainPrototype(current)
            if (plain === true || errors.isPoisonError(plain)) return
            const descriptor = native(() => Object.getOwnPropertyDescriptor(current, "then"))
            if (errors.isPoisonError(descriptor)) return
            if (descriptor && (!("value" in descriptor) || typeof descriptor.value === "function"))
                invalid("External snapshot prototype contains an unsafe then property")
            current = native(() => Object.getPrototypeOf(current))
            if (errors.isPoisonError(current)) return
        }
    }
}

// Snapshot reads must not normalize source storage or subscribe to a gate.
function readManagedProperty(owner, key, operationContext) {
    if (key === "length" && isLogicalArray(owner, operationContext)) {
        const length = ArrayView.readyLength(owner, operationContext)
        return length === undefined ? errors.validationError(
            "External snapshots require settled Array length", operationContext,
            errors.ERROR_KIND.InvalidExternalSnapshot) : length
    }
    return capturePlacement(owner, key, operationContext).value
}

export { readManagedProperty, snapshotExternalValue }
