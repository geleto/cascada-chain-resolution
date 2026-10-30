import { resolveCapturedIdentities } from "./captured-identity.js"
import * as steps from "./internal-step.js"
import { defineCopyProperty, orderRecordKeys } from "./placement-structure.js"

// Source-free output shared by managed capture and ready-only external snapshots.
// Producers own traversal and Error collection; discard ends only output work.
class CapturedGraph {
    records = new Set()
    roots = []

    constructor(owner) {
        this.owner = owner
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

export { CapturedGraph, assembleCapturedGraph }
