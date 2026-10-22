import { captureIdentity } from "./captured-identity.js"
import { CapturedGraph } from "./captured-graph.js"
import * as errorUtils from "./error.js"
import { externalCapabilityEscapeError } from "./external-operation.js"
import * as steps from "./internal-step.js"
import * as values from "./language-values.js"
import * as metadata from "./meta.js"
import * as properties from "./language-properties.js"
import { observePromiseVersion } from "./property-versions.js"
import { captureContainerStructure } from "./placement-structure.js"

// Capture records contain edges, shape and admitted facts, never source containers.
// Inspect every physical representation, even when its identity already has data.
// The caller owns Error collection and the lifetime of successful output.
class ManagedCapture extends CapturedGraph {
    identities = new Map()
    visited = new WeakMap()

    constructor(owner, kind, collect) {
        super(owner)
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

    inspect(action) {
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
            const keys = []
            this.inspect(() => {
                for (const key of properties.enumerableLanguageKeyCandidates(value, operationContext)) keys.push(key)
            })
            if (this.records && !existing) {
                for (const key of keys) node.entries.set(key, undefined)
                node.shape = this.inspect(() => captureContainerStructure(value, keys, operationContext))
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
                const placement = this.inspect(() => properties.readLanguagePlacement(value, key, operationContext))
                if (placement.present !== true) { visit(undefined, key, false); continue }
                const child = placement.value
                const readiness = values.isPending(child, operationContext)
                    ? observePromiseVersion(child, placement.sourceVersion, operationContext,
                        (resolved, version) => visit(resolved, key, version.present !== false), owner)
                    : visit(child, key)
                if (values.isPending(readiness, operationContext)) waits.push(readiness)
            }
            value = undefined
            if (waits.length) return waits.length === 1 ? waits[0] : Promise.all(waits)
        } finally { value = undefined }
    }
}

export { ManagedCapture }
