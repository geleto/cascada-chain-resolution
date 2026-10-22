import * as externalTree from "./external-mutation-tree.js"
import * as errors from "./error.js"
import * as imports from "./import.js"
import * as steps from "./internal-step.js"
import * as properties from "./language-properties.js"
import * as metadata from "./meta.js"
import { exportValue } from "./export.js"
import { externalCapabilityEscapeError, validateExternalAccess } from "./external-operation.js"
import { captureExternalValue, snapshotExternalValue } from "./external-snapshot.js"
import { readCallableThen } from "./thenable-subscription.js"
import { walkObservationValue } from "./path-operation.js"

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

    read(forExport = false, capture = value => value) {
        return this.readValue(ready => {
            if (this.boundary) return steps.continueGraphTransition(
                snapshotExternalValue(ready, this.operation, !forExport), this.operationContext,
                capture, undefined, this.operation)
            const imported = imports.importExternalProperty(ready, this.operationContext)
            return forExport ? exportValue(imported, this.operation) : capture(imported)
        })
    }

    // Resolve the selected value without consuming its interior. Expression
    // extraction can reject a container before import or snapshot preparation.
    readValue(onValue) {
        const value = this.walkPrefix(this.path.length)
        if (errors.isPoisonError(value)) return value
        return this.consumeResult(value, errors.ERROR_KIND.ExternalPropertyReadFailed,
            ready => {
                if (errors.isPoisonError(ready)) return ready
                if (this.operationContext.execution._externalIdentities.has(ready))
                    return externalCapabilityEscapeError(this.operationContext)
                return onValue(ready)
            })
    }

    call(receiver, method, args, capture) {
        const blocker = this.operation.externalBlocker()
        if (blocker) {
            receiver = args = undefined
            return this.operation.mutation ? { mutatedValue: undefined, result: blocker } : blocker
        }
        const failure = this.validateIdentity(receiver, externalTree.findBranch(this.boundary, this.path))
        if (failure) { receiver = args = undefined; return failure }
        let callable
        const invoke = () => {
            try {
                callable = this.native(errors.ERROR_KIND.InvocationFailed, () => receiver?.[method])
                if (errors.isPoisonError(callable)) return callable
                if (typeof callable !== "function") return errors.validationError(
                    "External method is not callable", this.operationContext, errors.ERROR_KIND.InvocationFailed)
                return this.native(errors.ERROR_KIND.InvocationFailed, () => Reflect.apply(callable, receiver, args))
            } finally { callable = args = undefined }
        }
        const result = invoke()
        return this.consumeResult(result, errors.ERROR_KIND.InvocationFailed, ready => {
            try {
                if (errors.isPoisonError(ready)) return ready
                // Native completion owns the receiver effect. Rejecting its
                // independent result never retroactively poisons that effect.
                const imported = imports.importReadyMethodResult(ready, this.operationContext,
                    undefined, this.boundary ? receiver : undefined)
                capture(imported)
                return this.operation.mutation ? {
                    mutatedValue: receiver,
                    result: imported,
                } : imported
            } finally { receiver = undefined }
        })
    }

    write(value) {
        // Issuance already captured and exported the input, before native waits.
        return errors.isPoisonError(value) ? value : this.changeProperty(false, value)
    }

    delete() { return this.changeProperty(true) }

    changeProperty(deleting, value) {
        let receiver
        try {
            const blocker = this.operation.externalBlocker()
            if (blocker) return { mutatedValue: undefined, result: blocker }
            receiver = this.selectReceiver(this.path.length - 1, errors.ERROR_KIND.UnsupportedMutation)
            if (errors.isPoisonError(receiver)) return receiver
            const key = properties.normalizePathSegment(this.path.at(-1), this.operationContext)
            if (errors.isPoisonError(key)) return key
            if (externalTree.findBranch(this.boundary, this.path)) return properties.propertyValidationError(
                "Registered external locations cannot be replaced or deleted", this.operationContext)
            const kind = deleting ? errors.ERROR_KIND.ExternalPropertyDeleteFailed : errors.ERROR_KIND.ExternalPropertyWriteFailed
            const branch = !deleting && key === "length" && externalTree.findBranch(this.boundary, this.path.slice(0, -1))
            if (branch) {
                const array = this.native(kind, () => Array.isArray(receiver))
                if (errors.isPoisonError(array)) return array
                const descriptor = array ? this.native(kind, () => Object.getOwnPropertyDescriptor(receiver, "length")) : undefined
                if (errors.isPoisonError(descriptor)) return descriptor
                // Let the native intrinsic convert and validate once, before it can
                // remove bindings. Write the resulting length without re-coercion.
                const length = descriptor?.writable ? this.native(kind, () => {
                    const array = []
                    array.length = value
                    return array.length
                }) : undefined
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
        } finally { receiver = value = undefined }
    }

    selectReceiver(depth, kind, onSelected = value => value) {
        if (depth < 0) return errors.validationError(
            "A registered external binding cannot be replaced or deleted", this.operationContext,
            errors.ERROR_KIND.PropertyValidation)
        return this.walkPrefix(depth, kind, (ready, present, access) => {
            try {
                if (errors.isPoisonError(ready)) return onSelected(ready, present)
                const facts = this.boundary && this.factsOf(ready)
                if (errors.isPoisonError(facts)) return onSelected(facts, present)
                let prepared
                if (metadata.isTraversableType(facts?.type)) {
                    if (this.operation.mutation) return onSelected(this.managedMutationError(kind), present)
                    const capture = captureExternalValue(ready, this.operation)
                    return errors.isPoisonError(capture) ? onSelected(capture, present) :
                        onSelected(undefined, present, undefined, capture)
                } else {
                    // Admission establishes newly selected native receivers;
                    // borrowed managed values use the same receiving boundary.
                    prepared = imports.importExternalProperty(ready, this.operationContext)
                }
                if (!metadata.isObjectLike(ready) ||
                    metadata.isTraversableType(metadata.metaOf(prepared, this.operationContext)?.type)) access = undefined
                // A captured language receiver no longer reads native state.
                // Release that reservation before its arguments can suspend.
                if (!access && !this.operation.mutation) this.operation.completeExternalEffect()
                return steps.continueGraphTransition(prepared, this.operationContext,
                    value => onSelected(value, present, access), undefined, this.operation)
            } finally { ready = undefined }
        })
    }

    walkPrefix(depth, receiverErrorKind, onResolved = value => value) {
        const walk = (value, index, node) => {
            try {
                for (; index < depth; index++) {
                    if (errors.isPoisonError(value)) return value
                    const accessFailure = this.validateIdentity(value, node)
                    if (accessFailure) return accessFailure
                    const failure = this.requireReady(value)
                    if (failure) return failure
                    // Borrowed read-only data can enter through common import
                    // immediately. Mutable sources stay private to snapshot
                    // capture, so classification must not admit them in place.
                    if (!this.boundary) {
                        value = imports.importExternalProperty(value, this.operationContext)
                        if (errors.isPoisonError(value)) return value
                    }
                    const facts = this.boundary ? this.factsOf(value) : metadata.metaOf(value, this.operationContext)
                    if (errors.isPoisonError(facts)) return facts
                    const managed = metadata.isTraversableType(facts?.type)
                    if (managed && this.operation.mutation) return this.managedMutationError(receiverErrorKind)
                    if (managed) {
                        return walkObservationValue(value, this.path.slice(index, depth),
                            this.operationContext, onResolved, undefined, errors.ERROR_KIND.ExternalPropertyReadFailed, {
                                owner: this.operation,
                                snapshot: Boolean(this.boundary), type: facts.type,
                                onExternal: (value, suffix) => walk(value, depth - suffix.length, undefined),
                            })
                    }
                    const key = properties.normalizePathSegment(this.path[index], this.operationContext)
                    if (errors.isPoisonError(key)) return key
                    node = node?.[key]
                    value = this.native(errors.ERROR_KIND.ExternalPropertyReadFailed, () => value[key])
                }
                return onResolved(errors.isPoisonError(value) ? value : this.validateIdentity(value, node) ??
                    (receiverErrorKind ? this.requireReady(value) : undefined) ?? value, true, this)
            } finally { value = node = undefined }
        }
        return walk(this.identity, 0, this.boundary)
    }

    factsOf(value) {
        try {
            return metadata.isObjectLike(value) ?
                metadata.metaOf(value, this.operationContext) ?? errors.catchExternalThrow(
                    () => metadata.inspectAdmissionMetaFacts(value, this.operationContext),
                    this.operationContext, errors.ERROR_KIND.ExternalPropertyReadFailed) : undefined
        } finally { value = undefined }
    }

    managedMutationError(kind) {
        return errors.validationError("External mutation cannot cross managed storage", this.operationContext, kind)
    }

    validateIdentity(value, node) {
        if (node?.[externalTree.TREE_NODE].identity || this.operationContext.execution._externalIdentities.has(value)) {
            return validateExternalAccess(value, node?.[externalTree.TREE_NODE].identity ? node : undefined, this.operationContext)
        }
    }

    native(kind, action) { return errors.runExternalBoundary(this.operationContext, kind, action) }
    // Availability precedes admission: mutable-property sources are copied,
    // while call results and observation-only properties have their own imports.
    consumeResult(value, kind, onValue) {
        return steps.continueGraphTransition(value, this.operationContext, onValue,
            reason => onValue(errors.createPoisonError(reason, this.operationContext, kind)))
    }
    requireReady(value) {
        try {
            if (value === null || typeof value !== "object" || Error.isError(value) || metadata.metaOf(value, this.operationContext)) return undefined
            const thenable = errors.catchExternalThrow(
                () => readCallableThen(value, this.operationContext),
                this.operationContext,
                errors.ERROR_KIND.ExternalPropertyReadFailed,
            )
            if (errors.isPoisonError(thenable)) return thenable
            if (thenable) return this.pathPromiseError()
        } finally { value = undefined }
    }

    pathPromiseError() {
        return errors.validationError("Native paths require ready intermediate values", this.operationContext,
            errors.ERROR_KIND.ExternalPropertyReadFailed)
    }
}

export { ExternalAccess }
