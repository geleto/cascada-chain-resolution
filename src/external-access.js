import * as externalTree from "./external-mutation-tree.js"
import * as errors from "./error.js"
import * as imports from "./import.js"
import * as steps from "./internal-step.js"
import * as properties from "./language-properties.js"
import * as metadata from "./meta.js"
import { exportManyValues, exportValue } from "./export.js"
import { externalCapabilityEscapeError, validateExternalAccess } from "./external-operation.js"
import { readManagedProperty, snapshotExternalValue } from "./external-snapshot.js"

class ExternalAccess {
    constructor(identity, path, boundary, operation) {
        this.identity = identity
        this.path = path
        this.boundary = boundary
        this.operation = operation
        this.operationContext = operation.operationContext
    }

    // Metadata-only operations consume path keys without reading native state.
    validatePath() {
        for (const segment of this.path) {
            const key = properties.normalizePathSegment(segment, this.operationContext)
            if (errors.isPoisonError(key)) return key
        }
    }

    read(forExport = false) {
        const value = this.walkPrefix(this.path.length)
        if (errors.isPoisonError(value)) return value
        return this.consumeResult(value, errors.ERROR_KIND.ExternalPropertyReadFailed,
            ready => {
                if (errors.isPoisonError(ready)) return ready
                if (this.operationContext.execution._externalIdentities.has(ready))
                    return externalCapabilityEscapeError(this.operationContext)
                if (this.boundary) return snapshotExternalValue(ready, this.operationContext, !forExport)
                const imported = imports.importExternalProperty(ready, this.operationContext)
                return forExport ? exportValue(imported, this.operation) : imported
            })
    }

    call(method, args) {
        const receiver = this.selectReceiver(this.path.length, errors.ERROR_KIND.InvocationFailed)
        if (errors.isPoisonError(receiver)) return receiver
        const callable = this.native(errors.ERROR_KIND.InvocationFailed, () => receiver?.[method])
        if (errors.isPoisonError(callable)) return callable
        if (typeof callable !== "function") return errors.validationError(
            "External method is not callable", this.operationContext, errors.ERROR_KIND.InvocationFailed)
        const result = this.native(errors.ERROR_KIND.InvocationFailed, () => Reflect.apply(callable, receiver, args))
        return this.consumeResult(result, errors.ERROR_KIND.InvocationFailed, ready => {
            if (errors.isPoisonError(ready)) return ready
            const failures = this.operation.mutation ? { capabilityErrors: new Set() } : undefined
            const imported = imports.importReadyMethodResult(ready, this.operationContext,
                failures, this.boundary ? receiver : undefined)
            return this.operation.mutation ? {
                mutatedValue: failures.capabilityErrors.size ? errors.combineErrors(failures.capabilityErrors, "External capability escaped") : receiver,
                result: imported,
            } : imported
        })
    }

    write(value) {
        return steps.continueOperation(exportManyValues([value], this.operation), this.operationContext, prepared => {
            if (errors.isPoisonError(prepared)) return prepared
            return this.changeProperty(false, prepared[0])
        })
    }

    delete() { return this.changeProperty(true) }

    changeProperty(deleting, value) {
        const receiver = this.selectReceiver(this.path.length - 1, errors.ERROR_KIND.UnsupportedMutation)
        if (errors.isPoisonError(receiver)) return receiver
        const key = properties.normalizePathSegment(this.path.at(-1), this.operationContext)
        if (errors.isPoisonError(key)) return key
        if (externalTree.findBranch(this.boundary, this.path)) return properties.propertyValidationError(
            "Registered external locations cannot be replaced or deleted", this.operationContext)
        const kind = deleting ? errors.ERROR_KIND.ExternalPropertyDeleteFailed : errors.ERROR_KIND.ExternalPropertyWriteFailed
        const branch = !deleting && key === "length" && externalTree.findBranch(this.boundary, this.path.slice(0, -1))
        if (branch) {
            // Let the native intrinsic convert and validate once, before it can
            // remove bindings. Write the resulting length without re-coercion.
            const length = this.native(kind, () => {
                if (!Array.isArray(receiver) || !Object.getOwnPropertyDescriptor(receiver, "length").writable)
                    return undefined
                const array = []
                array.length = value
                return array.length
            })
            if (errors.isPoisonError(length)) return length
            if (length !== undefined) {
                if (externalTree.truncatesLocations(branch, length)) return properties.propertyValidationError(
                    "Array length cannot remove a fixed external namespace", this.operationContext)
                value = length
            }
        }
        const changed = this.native(kind, () => deleting
            ? Reflect.deleteProperty(receiver, key) : Reflect.set(receiver, key, value))
        if (errors.isPoisonError(changed)) return changed
        return changed ? { mutatedValue: this.identity, result: undefined } : errors.validationError(
            deleting ? "External property deletion was refused" : "External property assignment was refused",
            this.operationContext, kind)
    }

    selectReceiver(depth, kind) {
        const blocker = this.operation.externalBlocker()
        if (blocker) return blocker
        if (depth < 0) return errors.validationError(
            "A registered external binding cannot be replaced or deleted", this.operationContext,
            errors.ERROR_KIND.PropertyValidation)
        const receiver = this.walkPrefix(depth, kind)
        if (errors.isPoisonError(receiver)) return receiver
        if (metadata.isTraversableType(metadata.metaOf(receiver, this.operationContext)?.type))
            return errors.validationError(
                "External operations cannot use an admitted managed receiver", this.operationContext, kind)
        return this.requireReady(receiver) ?? receiver
    }

    walkPrefix(depth, receiverErrorKind) {
        let value = this.identity
        let node = this.boundary
        for (let index = 0; index < depth; index++) {
            if (errors.isPoisonError(value)) return value
            const known = this.operationContext.execution._externalIdentities.has(value)
            if ((known || node?.[externalTree.TREE_NODE].identity) && value !== this.identity) {
                const failure = validateExternalAccess(value, node?.[externalTree.TREE_NODE].identity ? node : undefined, this.operationContext)
                if (failure) return failure
            }
            const fromManagedProperty = metadata.isTraversableType(metadata.metaOf(value, this.operationContext)?.type)
            if (fromManagedProperty && this.operation.mutation) return errors.validationError(
                "External mutation cannot cross managed storage", this.operationContext, receiverErrorKind)
            const failure = this.requireReady(value, fromManagedProperty)
            if (failure) return failure
            const key = properties.normalizePathSegment(this.path[index], this.operationContext)
            if (errors.isPoisonError(key)) return key
            node = node?.[key]
            if (fromManagedProperty) value = errors.catchExternalThrow(
                () => readManagedProperty(value, key, this.operationContext), this.operationContext,
                errors.ERROR_KIND.ExternalPropertyReadFailed)
            else value = this.native(errors.ERROR_KIND.ExternalPropertyReadFailed, () => value[key])
            if (fromManagedProperty) {
                const failure = this.requireReady(value, true)
                if (failure) return failure
            }
        }
        if (errors.isPoisonError(value)) return value
        if (node?.[externalTree.TREE_NODE].identity || this.operationContext.execution._externalIdentities.has(value)) {
            const failure = validateExternalAccess(value, node?.[externalTree.TREE_NODE].identity ? node : undefined, this.operationContext)
            if (failure) return failure
        }
        return value
    }

    native(kind, action) { return errors.runExternalBoundary(this.operationContext, kind, action) }
    // Availability precedes admission: mutable-property sources are copied,
    // while call results and observation-only properties have their own imports.
    consumeResult(value, kind, onValue) {
        const accept = value => onValue(Error.isError(value)
            ? errors.createPoisonError(value, this.operationContext, kind) : value)
        return steps.continueOperation(value, this.operationContext, accept,
            reason => accept(errors.createPoisonError(reason, this.operationContext, kind)))
    }
    requireReady(value, managed = false) {
        if (value === null || typeof value !== "object" || Error.isError(value) || metadata.metaOf(value, this.operationContext)) return undefined
        const then = this.native(errors.ERROR_KIND.ExternalPropertyReadFailed, () => value.then)
        if (errors.isPoisonError(then)) return then
        if (typeof then === "function") return managed ? this.invalidSnapshotError() : this.pathPromiseError()
    }
    pathPromiseError() {
        return errors.validationError("Native paths require ready intermediate values", this.operationContext,
            errors.ERROR_KIND.ExternalPropertyReadFailed)
    }
    invalidSnapshotError() {
        return errors.validationError("External snapshots require ready managed properties", this.operationContext,
            errors.ERROR_KIND.InvalidExternalSnapshot)
    }
}

export { ExternalAccess }
