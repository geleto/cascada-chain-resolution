import * as arrays from "./array-view.js"
import * as errors from "./error.js"
import * as properties from "./language-properties.js"
import * as metadata from "./meta.js"
import { capabilityError } from "./external-operation.js"

// External snapshots are ready-only transactions. Sources keep their admission
// and logical storage; only a completely successful output graph is admitted.
function snapshotExternalValue(value, operationContext, admit = true) {
    const visited = new Map()
    const failures = new Set()
    let copies = []
    const result = walk(value)
    if (failures.size) return errors.combineErrors(failures, "External property snapshot failed")
    // Graph lookup adopts the completed copies. Native export transfers those
    // same independent copies without admission or a second copying pass.
    if (admit) for (const [copy, type, prototype] of copies)
        metadata.getOrCreateMeta(copy, operationContext, type, prototype)
    return result

    function collect(failure) {
        failures.add(failure)
        if (copies) for (const source of visited.keys()) visited.set(source, undefined)
        copies = undefined
        return failure
    }

    function inspect(action) {
        return errors.catchExternalThrow(action, operationContext,
            errors.ERROR_KIND.ExternalPropertyReadFailed, collect)
    }

    function native(action) {
        return inspect(() => errors.runExternalAction(operationContext, action))
    }

    function invalid(message) {
        return collect(errors.validationError(message, operationContext,
            errors.ERROR_KIND.InvalidExternalSnapshot))
    }

    function walk(source) {
        if (Error.isError(source)) return collect(errors.createPoisonError(
            source, operationContext, errors.ERROR_KIND.ExternalPropertyReadFailed))
        if (!metadata.isObjectLike(source)) return source
        if (typeof source === "function") {
            if (copies && !metadata.metaOf(source, operationContext))
                copies.push([source, metadata.TYPE.Function])
            return source
        }
        if (operationContext.execution._externalIdentities.has(source))
            return collect(capabilityError(operationContext))
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
            : native(() => source.then)
        if (errors.isPoisonError(then)) collect(then)
        if (typeof then === "function") {
            invalid("External snapshots cannot contain thenables")
            if (!managed) return undefined
        }
        if (!array && !errors.isPoisonError(prototype)) inspectPrototype(prototype)

        const length = array ? (managed
            ? inspect(() => arrays.logicalArrayLength(source, operationContext))
            : native(() => source.length)) : undefined
        if (array && !errors.isPoisonError(length) && (!Number.isInteger(length) || length < 0 || length > 0xffffffff))
            invalid("External snapshot Array has an invalid length")
        const plain = !array && !errors.isPoisonError(prototype) &&
            native(() => prototype === null || metadata.isPlainObjectPrototype(prototype))
        const type = array ? metadata.TYPE.Array : plain === true ? metadata.TYPE.Record : metadata.TYPE.ManagedClass
        const copy = copies ? array ? new Array(length) : Object.create(prototype) : undefined
        visited.set(source, copy)
        if (copies) copies.push([copy, type, prototype])
        const keys = managed
            ? inspect(() => [...properties.enumerableLanguageKeyCandidates(source, operationContext)])
            : native(() => Reflect.ownKeys(source))
        if (errors.isPoisonError(keys)) return keys
        for (const key of keys) {
            if (typeof key !== "string" || (array && !arrays.isArrayIndex(key))) continue
            let child
            if (managed) {
                const present = inspect(() => properties.hasLanguageProperty(source, key, operationContext))
                if (present !== true) continue
                child = inspect(() => readManagedProperty(source, key, operationContext))
            } else {
                const descriptor = native(() => Object.getOwnPropertyDescriptor(source, key))
                if (errors.isPoisonError(descriptor) || !descriptor?.enumerable) continue
                child = native(() => source[key])
            }
            const copied = walk(child)
            if (copies) Object.defineProperty(copy, key, {
                value: copied, enumerable: true, writable: true, configurable: true,
            })
        }
        return copy
    }

    function inspectPrototype(prototype) {
        for (let current = prototype; current !== null;) {
            const plain = native(() => metadata.isPlainObjectPrototype(current))
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
    if (key === "length" && arrays.isLogicalArray(owner, operationContext))
        return arrays.logicalArrayLength(owner, operationContext)
    const version = metadata.metaOf(owner, operationContext)?.placementVersions?.[key]
    return version ? version.value : properties.getLanguagePlacementDescriptor(owner, key, operationContext)?.value
}

export { readManagedProperty, snapshotExternalValue }
