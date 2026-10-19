import * as metadata from "./meta.js"
import { releaseOnClose } from "./operation-lifecycle.js"
import { collectInputs, continueGraphTransition } from "./internal-step.js"
import { markPromiseHandled } from "./thenable-subscription.js"

const PENDING = 0, SETTLED = 1, FORWARD = 2
const createIdentity = () => {
    const cell = { state: SETTLED }
    cell.lineage = cell
    return cell
}

// All object identities use source-free keys, including exact opaque leaves.
// Comparison therefore never reflects on a host object to recognize a token.
function captureIdentity(value, operationContext) {
    if (!metadata.isObjectLike(value)) return value
    const meta = Error.isError(value)
        ? metadata.getOrCreateMeta(value, operationContext, metadata.TYPE.Error)
        : metadata.requireMeta(value, operationContext)
    return meta.generation ??= createIdentity()
}

function inheritIdentity(source, copy, operationContext) {
    metadata.requireMeta(copy, operationContext).generation = captureIdentity(source, operationContext)
}

function identityRoot(identity) {
    if (identity === null || typeof identity !== "object") return identity
    let root = identity
    while (root.state === FORWARD) root = root.into
    while (identity.state === FORWARD) {
        const next = identity.into
        identity.into = root
        identity = next
    }
    return root
}

function finishIdentity(cell, target, work) {
    const from = identityRoot(cell)
    if (target === undefined) {
        from.state = SETTLED
        from.size = undefined
        for (const query of from.queries ?? []) work.push(query)
        from.queries = undefined
        return
    }
    const to = identityRoot(target)
    if (from === to) return
    const winner = to.state === SETTLED || to.size >= from.size ? to : from
    const loser = winner === from ? to : from
    if (winner.state === PENDING) winner.size += loser.size
    loser.state = FORWARD
    loser.into = winner
    loser.size = undefined
    const moving = loser.queries
    loser.queries = undefined
    for (const query of moving ?? []) {
        if (query.left === loser) query.left = winner
        if (query.right === loser) query.right = winner
        if (query.left === query.right || winner.state === SETTLED) work.push(query)
        else (winner.queries ??= new Set()).add(query)
    }
    moving?.clear()
}

// A finite mutation path captures each affected occurrence. Before suspension
// replace source metadata with source-free predecessor/future pairs. Completion
// never revisits a container or overwrites a later command's generation.
class IdentityPublication {
    constructor(operationContext, enclosing) {
        this.operationContext = operationContext
        this.enclosing = enclosing
        this.captures = []
        this.pending = false
        this.closed = false
        this.published = false
        this.remaining = 0
        if (enclosing) enclosing.remaining++
    }
    capture(value) {
        const meta = metadata.requireMeta(value, this.operationContext)
        if (this.pending) this.reserve(meta)
        else this.captures.push(meta)
    }
    reserve(meta) {
        const before = meta.generation ??= createIdentity()
        const after = meta.generation = { state: PENDING, size: 1, lineage: before.lineage }
        this.captures.push({ before, after })
    }
    suspend() {
        if (this.pending) return
        this.pending = true
        const captures = this.captures
        this.captures = []
        for (const meta of captures) this.reserve(meta)
        captures.length = 0
    }
    // Adopt a private outcome only after the destination has committed it.
    // Each unfinished outcome transfers to one enclosing publication.
    record(published) {
        if (this.published || published === false) return
        if (published === true) { this.published = true; return }
        if (!published.captures) { this.published ||= published.published; return }
        this.remaining++
        published.enclosing = this
    }
    // Source availability contributes here; committed outcomes need no Promise bridge.
    addPending(presence) {
        this.remaining++
        const completion = continueGraphTransition(presence, this.operationContext, present => {
            this.remaining--
            this.published ||= present
            this.complete()
        })
        markPromiseHandled(completion, this.operationContext)
    }
    finish(published) {
        if (this.closed) return
        if (published !== undefined) this.record(published)
        this.closed = true
        if (this.remaining && !this.published) this.suspend()
        this.complete()
    }
    outcome() {
        return this.captures ? this : this.published
    }
    // A child registers on issuance, before its enclosing entry can close.
    // Completed children leave only an effect bit and an unfinished count.
    // Drain nested completion synchronously, without a chain of join Promises.
    complete() {
        const work = []
        let current = this
        while (current?.closed && current.captures && (current.published || current.remaining === 0)) {
            for (const capture of current.captures) {
                if (current.pending) finishIdentity(capture.after, current.published ? undefined : capture.before, work)
                // Ready successors allocate a key only when actually captured.
                else if (current.published) capture.generation = undefined
            }
            current.captures.length = 0
            const parent = current.enclosing
            current.captures = current.enclosing = current.operationContext = undefined
            if (parent) {
                parent.remaining--
                parent.published ||= current.published
            }
            current = parent
        }
        for (let index = 0; index < work.length; index++) {
            const query = work[index]
            work[index] = undefined
            query.resume()
        }
    }
}

function compareIdentities(left, right, owner, sameValueZero = false) {
    left = identityRoot(left)
    right = identityRoot(right)
    if (left === right || (sameValueZero && Object.is(left, right))) return true
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false
    // A no-op can only forward to its predecessor. Unrelated lineages cannot
    // merge, regardless of how their unfinished publications settle.
    if (left.lineage !== right.lineage) return false
    if (left?.state !== PENDING && right?.state !== PENDING) return false
    return waitIdentities(left, right, owner)
}

// Assembly needs a fixed equality partition, not every publication outcome.
// A lineage represented by just one key already has its final partition.
// Group only the completed capture; no source walk or history search is needed.
function resolveCapturedIdentities(nodes, owner) {
    const anchors = new Map(), representatives = new Set(), waits = []
    for (const node of nodes) {
        node.identity = identityRoot(node.identity)
        if (representatives.has(node.identity)) continue
        representatives.add(node.identity)
        const first = anchors.get(node.identity.lineage)
        if (!first) anchors.set(node.identity.lineage, node.identity)
        else if (node.identity !== first) waits.push(compareIdentities(first, node.identity, owner))
    }
    // Equal comparisons can finish by merging while their common predecessor
    // is still pending. A false same-lineage comparison settles both endpoints.
    // Thus one anchor per lineage suffices to fix the whole partition.
    return collectInputs(waits, owner.operationContext, () => {
        const canonical = new Map()
        for (const node of nodes) {
            node.identity = identityRoot(node.identity)
            if (!canonical.has(node.identity)) canonical.set(node.identity, node)
        }
        return canonical
    }, owner)
}

function waitIdentities(left, right, owner) {
    const { promise, resolve } = Promise.withResolvers()
    let unregister
    const query = {
        left, right,
        detach() {
            this.left?.queries?.delete(this)
            this.right?.queries?.delete(this)
        },
        close() {
            this.detach()
            unregister?.()
            unregister = undefined
            this.left = this.right = undefined
        },
        resume() {
            if (this.left === undefined && this.right === undefined) return
            this.detach()
            if (owner.operationContext.execution.fatalError || !owner.open) return this.close()
            this.left = identityRoot(this.left)
            this.right = identityRoot(this.right)
            if (this.left === this.right || (this.left?.state !== PENDING && this.right?.state !== PENDING)) {
                const result = this.left === this.right
                this.close()
                resolve(result)
            } else {
                for (const root of [this.left, this.right])
                    if (root?.state === PENDING) (root.queries ??= new Set()).add(this)
            }
        },
    }
    unregister = releaseOnClose(owner, () => query.close())
    query.resume()
    return promise
}

// Logical equality never suppresses another representation's fallible reads.
function visitRepresentation(value, identity, visited) {
    if (visited.get(value) === identity) return false
    visited.set(value, identity)
    return true
}

export { createIdentity, captureIdentity, inheritIdentity, compareIdentities, resolveCapturedIdentities,
    IdentityPublication, visitRepresentation }
