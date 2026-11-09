import { captureIdentity, createIdentity, resolveCapturedIdentities } from "./captured-identity.js"
import * as errorUtils from "./error.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import * as steps from "./internal-step.js"
import * as values from "./language-values.js"
import * as metadata from "./meta.js"
import * as properties from "./language-properties.js"
import { observePromiseVersion, placementValue, placementPresent } from "./property-versions.js"
import { captureContainerStructure, defineCopyProperty, orderRecordKeys } from "./placement-structure.js"

// Capture records contain edges, shape and admitted facts, never source containers.
// Inspect every physical representation, even when its identity already has data.
// The caller owns Error collection and the lifetime of successful output.
class ManagedCapture {
    records = new Set()
    roots = []
    identities = new Map()
    visited = new WeakMap()

    constructor(owner, kind, collect) {
        this.owner = owner
        this.kind = kind
        this.collect = collect
    }

    capture(inputs) {
        const { owner } = this
        if (this.records) this.roots.length = inputs.length
        const waits = []
        for (let index = 0; index < inputs.length; index++) waits.push(steps.continueGraphTransition(
            inputs[index], owner.operationContext,
            resolved => this.walk(resolved, edge => { this.roots[index] = edge }),
            undefined, owner))
        return steps.collectInputs(waits, owner.operationContext, () => undefined, owner)
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
            node.identity = node.shape = node.prototype = node.copy = undefined
        }
        this.records = this.identities = undefined
        this.roots.length = 0
    }

    inspect(action) {
        const result = errorUtils.catchExternalThrow(action, this.owner.operationContext, this.kind)
        if (errorUtils.isPoisonError(result)) this.collect(result)
        return result
    }

    describe(value, meta) { return meta }

    keys(value) {
        try { return properties.enumerableLanguageKeyCandidates(value, this.owner.operationContext) }
        finally { value = undefined }
    }

    shape(value, keys) {
        try { return captureContainerStructure(value, keys, this.owner.operationContext) }
        finally { value = undefined }
    }

    placement(value, key) {
        try { return properties.readLanguagePlacement(value, key, this.owner.operationContext) }
        finally { value = undefined }
    }

    consume(placement, visit) {
        const { owner } = this
        const { operationContext } = owner
        const value = placementValue(placement)
        return values.isPending(value, operationContext)
            ? observePromiseVersion(placement.value, placement.sourceVersion, operationContext,
                (value, version) => visit(value, placementPresent(version)), owner)
            : visit(value)
    }

    walk(value, receive) {
        const { owner } = this
        const { operationContext } = owner
        let meta, facts
        try {
            if (errorUtils.isPoisonError(value)) { this.collect(value); return }
            if (typeof value !== "function" && operationContext.execution._externalIdentities.has(value)) {
                this.collect(externalCapabilityEscapeError(operationContext))
                return
            }
            if (!metadata.isObjectLike(value)) {
                if (this.records) receive(value)
                return
            }
            meta = metadata.metaOf(value, operationContext)
            let identity = metadata.isTraversableType(meta?.type)
                ? captureIdentity(value, operationContext) : this.visited.get(value)
            const existing = this.identities?.get(identity)
            if (this.visited.has(value) && this.visited.get(value) === identity) {
                if (this.records) receive(existing ?? value)
                return
            }
            if (identity !== undefined) this.visited.set(value, identity)
            facts = this.describe(value, meta)
            if (errorUtils.isPoisonError(facts)) return
            if (!metadata.isTraversableType(facts?.type)) {
                if (this.records) receive(value)
                return
            }
            if (identity === undefined) this.visited.set(value, identity = createIdentity())
            const node = this.records && (existing ?? { entries: new Map(), identity })
            if (node) {
                if (!existing) {
                    const { type, admittedPrototype } = facts
                    node.type = type
                    node.prototype = admittedPrototype
                    this.records.add(node)
                    this.identities.set(identity, node)
                }
                receive(node)
            }
            const keys = []
            this.inspect(() => {
                for (const key of this.keys(value, facts)) keys.push(key)
            })
            if (this.records && !existing) {
                for (const key of keys) node.entries.set(key, undefined)
                node.shape = this.inspect(() => this.shape(value, keys, facts))
            }
            const visit = (child, key, present = true) => {
                if (!present) { if (!existing) node?.entries.delete(key); return }
                return this.walk(child, edge => {
                    if (this.records && !existing) node.entries.set(key, edge)
                })
            }
            // Consume each placement once, in source order, before joining
            // pending children. Failed inspections still leave siblings to visit.
            const waits = []
            for (const key of keys) {
                const placement = this.inspect(() => this.placement(value, key, facts))
                if (!placementPresent(placement)) { visit(undefined, key, false); continue }
                const readiness = this.consume(placement, (child, present) => visit(child, key, present))
                if (values.isPending(readiness, operationContext)) waits.push(readiness)
            }
            if (waits.length) return waits.length === 1 ? waits[0] : Promise.all(waits)
        } finally { value = meta = facts = undefined }
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
