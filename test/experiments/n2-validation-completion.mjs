// Executable completion model. Production preparation does not use this code.
// node test/experiments/n2-validation-completion.mjs
import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { captureIdentity, inheritIdentity, compareIdentities, IdentityPublication } from "../../src/captured-identity.js"

const PENDING = 0, UNCHANGED = 1, CHANGED = 2

class Verdict {
    constructor() {
        this.state = PENDING
        this.sealed = false
        this.changed = false
        this.children = new Set()
        this.parents = new Set()
    }
    depend(child) {
        assert.equal(this.state, PENDING)
        assert(!this.sealed)
        if (child.state === CHANGED) this.changed = true
        else if (child.state === PENDING) {
            const link = { parent: this, child }
            this.children.add(link)
            child.parents.add(link)
        }
    }
    finish(changed = false) {
        this.sealed = true
        this.changed ||= changed
        const work = [this]
        for (let i = 0; i < work.length; i++) {
            const item = work[i]
            work[i] = undefined
            if (item.state !== PENDING || !item.sealed || (!item.changed && item.children.size)) continue
            item.state = item.changed ? CHANGED : UNCHANGED
            for (const link of item.children) {
                link.child.parents.delete(link)
                link.parent = link.child = undefined
            }
            item.children.clear()
            for (const link of item.parents) {
                const parent = link.parent
                parent.children.delete(link)
                parent.changed ||= item.changed
                link.parent = link.child = undefined
                work.push(parent)
            }
            item.parents.clear()
            item.publication?.finish(item.changed)
            item.publication = undefined
        }
    }
}

// Only ready edges captured within this segment participate in cycle grouping.
function segment(edges) {
    const order = new Map(), low = new Map(), active = new Set(), stack = []
    const groups = [], byNode = new Map()
    let next = 0
    function visit(node) {
        order.set(node, next)
        low.set(node, next++)
        active.add(node)
        stack.push(node)
        for (const child of edges[node]) {
            if (!order.has(child)) { visit(child); low.set(node, Math.min(low.get(node), low.get(child))) }
            else if (active.has(child)) low.set(node, Math.min(low.get(node), order.get(child)))
        }
        if (low.get(node) !== order.get(node)) return
        const group = new Verdict()
        groups.push(group)
        let member
        do {
            member = stack.pop()
            active.delete(member)
            byNode.set(member, group)
        } while (member !== node)
    }
    for (let node = 0; node < edges.length; node++) if (!order.has(node)) visit(node)
    for (let node = 0; node < edges.length; node++) for (const child of edges[node])
        if (byNode.get(node) !== byNode.get(child)) byNode.get(node).depend(byNode.get(child))
    return { groups, byNode }
}

let cases = 0
for (let graph = 0; graph < 512; graph++) {
    const edges = Array.from({ length: 3 }, (_, node) =>
        [0, 1, 2].filter(child => graph & (1 << (node * 3 + child))))
    const reach = edges.map((_, start) => {
        const seen = new Set([start]), work = [start]
        for (let i = 0; i < work.length; i++) for (const child of edges[work[i]])
            if (!seen.has(child)) { seen.add(child); work.push(child) }
        return seen
    })
    for (let observations = 0; observations < 27; observations++) {
        const outcomes = [0, 1, 2].map(i => Math.floor(observations / 3 ** i) % 3)
        for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
            const { groups, byNode } = segment(edges)
            const leaves = outcomes.map(() => new Verdict())
            for (let node = 0; node < 3; node++) byNode.get(node).depend(leaves[node])
            for (const group of groups) group.finish()
            for (const node of order) if (outcomes[node] !== PENDING) leaves[node].finish(outcomes[node] === CHANGED)
            for (let node = 0; node < 3; node++) {
                const expected = [...reach[node]].some(i => outcomes[i] === CHANGED) ? CHANGED :
                    [...reach[node]].some(i => outcomes[i] === PENDING) ? PENDING : UNCHANGED
                assert.equal(byNode.get(node).state, expected)
                if (expected !== PENDING) assert.equal(byNode.get(node).children.size + byNode.get(node).parents.size, 0)
            }
            cases++
        }
    }
}

// A delivery attaches its new segment before closing its discovery obligation.
const oldTask = new Verdict(), parent = new Verdict(), futureInput = new Verdict()
parent.depend(oldTask)
parent.finish()
const late = segment([[1], [0]])
late.byNode.get(0).depend(futureInput)
oldTask.depend(late.byNode.get(0))
for (const group of late.groups) group.finish()
oldTask.finish()
assert.equal(parent.state, PENDING)
futureInput.finish()
assert.equal(parent.state, UNCHANGED)

// Completion and release can be history-sized even around a tiny value.
const history = Array.from({ length: 20000 }, () => new Verdict())
for (let i = 1; i < history.length; i++) { history[i - 1].depend(history[i]); history[i - 1].finish() }
history.at(-1).finish()
assert(history.every(v => v.state === UNCHANGED && v.parents.size === 0 && v.children.size === 0))
const early = new Verdict(), never = new Verdict(), changed = new Verdict()
early.depend(never)
early.depend(changed)
early.finish()
changed.finish(true)
assert.equal(early.state, CHANGED)
assert.equal(never.parents.size, 0)

// Reuse Phase 3 keys: a common verdict never merges distinct source identities.
const ctx = { execution: new r.Execution(), errorContext: "N2 completion model" }
const sources = [r.import({}, ctx), r.import({}, ctx)]
const copies = [r.import({}, ctx), r.import({}, ctx)]
const predecessor = new IdentityPublication(ctx)
predecessor.capture(sources[0])
predecessor.suspend()
const group = new Verdict()
group.publication = new IdentityPublication(ctx)
for (let i = 0; i < 2; i++) {
    inheritIdentity(sources[i], copies[i], ctx)
    group.publication.capture(copies[i])
}
group.publication.suspend()
const owner = { operationContext: ctx, open: true }
const comparisons = sources.map((source, i) => compareIdentities(captureIdentity(source, ctx), captureIdentity(copies[i], ctx), owner))
group.finish()
assert.deepEqual(await Promise.all(comparisons), [true, true])
assert.equal(predecessor.closed, false)
assert.equal(compareIdentities(captureIdentity(copies[0], ctx), captureIdentity(copies[1], ctx), owner), false)
predecessor.finish(false)

// The original root/left-cycle/right example keeps the right identity, even
// when left decides the root's changed verdict before right delivers.
const branches = segment([[1, 2], [1], []])
const branchSources = [r.import({}, ctx), r.import({}, ctx), r.import({}, ctx)]
const branchCopies = [r.import({}, ctx), r.import({}, ctx), r.import({}, ctx)]
for (let i = 0; i < 3; i++) {
    const verdict = branches.byNode.get(i)
    verdict.publication ??= new IdentityPublication(ctx)
    inheritIdentity(branchSources[i], branchCopies[i], ctx)
    verdict.publication.capture(branchCopies[i])
}
const left = new Verdict(), right = new Verdict()
branches.byNode.get(1).depend(left)
branches.byNode.get(2).depend(right)
for (const verdict of branches.groups) { verdict.publication.suspend(); verdict.finish() }
left.finish(true)
for (const i of [0, 1]) assert.equal(compareIdentities(captureIdentity(branchSources[i], ctx), captureIdentity(branchCopies[i], ctx), owner), false)
assert.equal(branches.byNode.get(2).state, PENDING)
right.finish()
assert.equal(compareIdentities(captureIdentity(branchSources[2], ctx), captureIdentity(branchCopies[2], ctx), owner), true)
console.log(JSON.stringify({ graphCases: cases, historyDepth: history.length, lateDiscovery: "passed", earlyRelease: "passed", phase3Keys: "passed", branchIdentities: "passed" }))
