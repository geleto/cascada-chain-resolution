import { captureIdentity, resolveCapturedIdentities } from "./captured-identity.js"
import * as errorUtils from "./error.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import * as steps from "./internal-step.js"
import * as values from "./language-values.js"
import * as metadata from "./meta.js"
import { walkManagedProperties } from "./managed-traversal.js"
import { captureContainerStructure, defineCopyProperty, orderRecordKeys } from "./placement-structure.js"

// Capture records contain edges, shape and admitted facts, never source containers.
// Inspect every physical representation, even when its identity already has data.
// The caller owns Error collection and the lifetime of successful output.
class ManagedCapture {
    records = new Set()
    identities = new Map()
    roots = []
    visited = new WeakMap()

    constructor(owner, kind, collect) {
        this.owner = owner
        this.kind = kind
        this.collect = collect
    }

    capture(inputs) {
        const { owner } = this
        if (this.records) this.roots.length = inputs.length
        const waits = inputs.map((value, index) => steps.continueGraphTransition(
            value, owner.operationContext,
            resolved => this.walk(resolved, edge => { this.roots[index] = edge }),
            undefined, owner))
        inputs = undefined
        return steps.collectInputs(waits, owner.operationContext, () => undefined, owner)
    }

    inspect = action => {
        const result = errorUtils.catchExternalThrow(action, this.owner.operationContext, this.kind)
        if (errorUtils.isPoisonError(result)) this.collect(result)
        return result
    }

    walk(value, receive) {
        const { owner } = this
        const { operationContext } = owner
        if (errorUtils.isPoisonError(value)) { this.collect(value); return }
        if (operationContext.execution._externalIdentities.has(value)) {
            this.collect(externalCapabilityEscapeError(operationContext))
            return
        }
        if (!values.isTraversable(value, operationContext)) {
            if (this.records) receive(value)
            return
        }
        const identity = captureIdentity(value, operationContext)
        const existing = this.identities?.get(identity)
        if (this.visited.get(value) === identity) {
            if (this.records) receive(existing)
            return
        }
        this.visited.set(value, identity)
        const node = this.records && (existing ?? { entries: new Map(), identity })
        if (node) {
            if (!existing) {
                const { type, admittedPrototype } = metadata.requireMeta(value, operationContext)
                node.type = type
                node.prototype = admittedPrototype
                this.records.add(node)
                this.identities.set(identity, node)
            }
            receive(node)
        }
        try {
            return walkManagedProperties(value, owner, this.inspect,
                (child, key, present = true) => {
                    if (!present) { if (!existing) node?.entries.delete(key); return }
                    return this.walk(child, edge => {
                        if (this.records && !existing) node.entries.set(key, edge)
                    })
                }, keys => {
                    if (!this.records || existing) return
                    for (const key of keys) node.entries.set(key, undefined)
                    node.shape = this.inspect(() => captureContainerStructure(value, keys, operationContext))
                })
        } finally { value = undefined }
    }

    resolve() {
        const { owner } = this
        // Successful output needs shape and equality, independently of the
        // placement/Error frontier. Discarded output waits for neither.
        const waits = []
        for (const node of this.records) if (node.shape.length?.read)
            waits.push(steps.continueGraphTransition(node.shape.length.read(), owner.operationContext,
                length => { node.shape.length = length }, undefined, owner))
        waits.push(steps.continueGraphTransition(resolveCapturedIdentities([...this.records], owner),
            owner.operationContext, identities => { this.identities = identities }, undefined, owner))
        return steps.collectInputs(waits, owner.operationContext, () => undefined, owner)
    }

    discard() {
        for (const node of this.records ?? []) {
            node.shape?.length?.release?.()
            node.entries.clear()
            node.shape = node.prototype = node.copy = undefined
        }
        this.records = this.identities = undefined
        this.roots.length = 0
    }
}

// Allocate every shell before filling edges. Export leaves shells unadmitted;
// native receiver preparation supplies its admission and identity policy.
function assembleCapturedGraph(capture, initializeCopy) {
    for (const node of capture.identities.values()) {
        node.copy = node.shape.length === undefined
            ? Object.create(node.prototype) : new Array(node.shape.length)
        initializeCopy?.(node.copy, node)
    }
    const outputOf = edge => capture.records.has(edge) ? capture.identities.get(edge.identity).copy : edge
    for (const node of capture.identities.values()) {
        for (const key of orderRecordKeys([...node.entries.keys()], node.shape.order))
            defineCopyProperty(node.copy, key, outputOf(node.entries.get(key)))
    }
    return capture.roots.map(outputOf)
}

export { ManagedCapture, assembleCapturedGraph }
