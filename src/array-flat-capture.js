import { captureIdentity, compareIdentities } from "./captured-identity.js"
import { isLogicalArray } from "./array-view.js"
import { createRemap } from "./array-remap.js"
import { createLeaseLedger } from "./ownership.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import * as steps from "./internal-step.js"
import * as values from "./language-values.js"
import * as errors from "./error.js"
import { placementPresent } from "./property-versions.js"

const UNREAD = 0, PRESENCE_PENDING = 1, PRESENCE_READY = 2, VALUE_PENDING = 3, VALUE_READY = 4, VALUE_CLOSED = 5

// One physical representation has one placement capture. Depth requests only
// extend which captured roots must be classified. Available discovery is FIFO,
// so short ready paths establish their larger depth budget before longer paths.
class FlatCapture {
    sources = new WeakMap()
    nodes = []
    queue = []
    waiting = 0
    draining = false
    failed = false
    failureReleased = false
    finished = false

    constructor(work, inspect) { this.work = work; this.inspect = inspect }

    start(array, depth) {
        this.unlimited = depth === Infinity
        this.root = this.receive(array, depth)
        this.drain()
        if (this.finished) return this.root
        this.completion = Promise.withResolvers()
        return this.completion.promise
    }

    receive(array, depth, ancestry) {
        let node = this.sources.get(array)
        if (!node) {
            node = { source: array, depth, ancestry, parts: undefined,
                identity: depth === Infinity ? captureIdentity(array, this.work.operationContext) : undefined }
            this.sources.set(array, node)
            this.nodes.push(node)
            this.enqueue(node)
        } else {
            if (depth === Infinity) for (let current = ancestry; current; current = current.parent)
                if (current.node === node) { this.discard(); break }
            this.request(node, depth)
        }
        return node
    }

    request(node, depth) {
        if (depth <= node.depth) return
        node.depth = depth
        this.enqueue(node)
    }

    enqueue(node) {
        if (node.queued) return
        node.queued = true
        this.queue.push(node)
    }

    follow(result, callback) {
        const { work } = this
        const transition = steps.continueGraphTransition(result, work.operationContext, callback, undefined, work)
        if (!values.isPending(transition, work.operationContext)) return
        this.waiting++
        markPromiseHandled(steps.continueGraphTransition(transition, work.operationContext, () => {
            this.waiting--
            this.drain()
        }, undefined, work), work.operationContext)
    }

    drain() {
        if (this.draining || this.finished || !this.work.open) return
        this.draining = true
        try {
            for (let index = 0; index < this.queue.length; index++) {
                const node = this.queue[index]
                this.queue[index] = undefined
                node.queued = false
                if (!node.parts) {
                    if (!node.initializing) this.initialize(node)
                } else this.extend(node)
            }
            this.queue.length = 0
            // Finish available source captures before failure drops the receiver
            // lease. Pending identity checks retain their own unread-source use.
            if (this.failed && !this.failureReleased) {
                this.failureReleased = true
                this.work.preparationFailed()
            }
            if (!this.waiting) {
                for (const node of this.nodes) {
                    node.parts = node.parts.filter(record => record.present)
                    node.ancestry = undefined
                    node.parents = undefined
                    for (const record of node.parts) record.input = undefined
                }
                this.finished = true
                this.completion?.resolve(this.root)
            }
        } finally { this.draining = false }
    }

    initialize(node) {
        node.initializing = true
        const { work } = this
        const ancestor = node.depth === Infinity
            ? findFlatAncestor(node.ancestry, node.identity, work) : undefined
        if (values.isPending(ancestor, work.operationContext)) {
            node.lease = createLeaseLedger(work.operationContext)
            node.lease.acquire(node.source)
        }
        this.follow(ancestor, found => {
            try {
                if (found) {
                    this.discard()
                    node.parts = found.parts
                } else {
                    let array = node.source
                    const captured = this.inspect(() => {
                        try {
                            const source = createRemap(array, work.operationContext, 0, undefined, this.inspect)
                            const records = []
                            node.parts = records
                            for (const key of Object.keys(source)) {
                                const placement = source[key]
                                if (errors.isPoisonError(placement)) {
                                    this.discard()
                                    records.push({ error: placement, present: true, state: VALUE_READY })
                                } else records.push({ input: placement,
                                    placement: this.failed ? undefined : placement, state: UNREAD })
                            }
                            return records
                        } finally { array = undefined }
                    })
                    if (errors.isPoisonError(captured)) {
                        this.discard()
                        node.parts = [{ error: captured, present: true, state: VALUE_READY }]
                    } else node.parts = captured
                }
                node.pendingParts = node.parts.length
            } finally {
                node.source = undefined
                node.lease?.release()
                node.lease = undefined
            }
            this.enqueue(node)
        })
    }

    extend(node) {
        const { work } = this
        for (const record of node.parts) {
            if (node.depth > 0 && record.state < VALUE_PENDING) {
                record.state = VALUE_PENDING
                const result = this.inspect(() => steps.continueGraphTransition(record.input.resolveValue(),
                    work.operationContext, value => {
                        record.present = record.input.present !== false
                        if (record.present && isLogicalArray(value, work.operationContext)) {
                            record.child = this.receive(value, node.depth - 1,
                                { node, identity: node.identity, parent: node.ancestry })
                            // An edge can close a cycle between independently
                            // pending branches, outside either first ancestry.
                            if (node.depth === Infinity && !this.failed && reaches(record.child, node)) this.discard()
                        }
                        return undefined
                    }, undefined, work))
                this.follow(result, failure => {
                    record.input = undefined
                    record.state = VALUE_READY
                    if (errors.isPoisonError(failure)) this.fail(record, failure)
                    else this.closePart(record, node)
                })
            } else if (record.state === UNREAD) {
                record.state = PRESENCE_PENDING
                const result = this.inspect(() => record.input.resolvePresence())
                this.follow(result, placement => {
                    if (errors.isPoisonError(placement)) this.fail(record, placement)
                    else {
                        record.present = placementPresent(placement)
                        if (record.state === PRESENCE_PENDING) record.state = PRESENCE_READY
                        if (this.root.depth <= 1) record.input = undefined
                    }
                })
            } else if (record.child) this.request(record.child, node.depth - 1)
        }
        this.closeNode(node)
    }

    fail(record, failure) {
        this.discard()
        record.error = failure
        record.present = true
        record.input = undefined
        record.state = VALUE_READY
    }

    closePart(record, node) {
        if (!this.unlimited || this.failed || record.state === VALUE_CLOSED) return
        if (record.child && !record.child.complete) {
            (record.child.parents ??= []).push({ record, node })
            return
        }
        record.state = VALUE_CLOSED
        node.pendingParts--
        this.closeNode(node)
    }

    closeNode(node) {
        if (!this.unlimited || this.failed || node.pendingParts || node.complete) return
        const pending = [node]
        while (pending.length) {
            const current = pending.pop()
            current.complete = true
            for (const { record, node: parent } of current.parents ?? []) {
                record.state = VALUE_CLOSED
                if (--parent.pendingParts === 0) pending.push(parent)
            }
            current.parents = undefined
        }
    }

    discard = () => {
        if (this.failed && this.work.open) return
        this.failed = true
        for (const node of this.nodes) {
            for (const record of node.parts ?? []) {
                record.placement = undefined
                // With a root depth of at most one, no later alias can request
                // a positive depth at a presence-only node.
                if (this.root.depth <= 1 && record.state === PRESENCE_READY) record.input = undefined
            }
            if (!this.work.open) {
                node.source = undefined
                node.lease?.release()
                for (const record of node.parts ?? []) record.input = undefined
            }
        }
        if (!this.work.open) this.release()
    }

    release() {
        this.nodes.length = this.queue.length = 0
        this.root = this.sources = this.completion = undefined
    }
}

function reaches(source, target) {
    const visited = new Set(), pending = [source]
    while (pending.length) {
        const node = pending.pop()
        if (node === target) return true
        if (node.complete) continue
        if (visited.has(node)) continue
        visited.add(node)
        for (const { child } of node.parts ?? []) if (child) pending.push(child)
    }
    return false
}

function findFlatAncestor(ancestry, identity, work) {
    for (let current = ancestry; current; current = current.parent) {
        const same = compareIdentities(current.identity, identity, work)
        if (values.isPending(same, work.operationContext))
            return steps.continueGraphTransition(same, work.operationContext,
                same => same ? current.node : findFlatAncestor(current.parent, identity, work), undefined, work)
        if (same) return current.node
    }
}

export { FlatCapture, findFlatAncestor }
