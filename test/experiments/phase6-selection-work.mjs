// Strict work/lifetime witnesses for the isolated dependency representation.
// The original pairwise predecessor prototype fails the first linear bound.
import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { continueGraphTransition } from "../../src/internal-step.js"
import { ReservationKernel } from "./phase6-reservations.mjs"

function setup() {
    const ctx = { execution: new r.Execution(), errorContext: {} }
    const chain = new r.ContextChain({ api: r.externalState({}), other: r.externalState({}) }, ctx, { api: {}, other: {} })
    const kernel = new ReservationKernel(chain._externalMutationTree, ctx)
    return { ctx, kernel }
}

function members(index) {
    const pending = [index?.root]
    let count = 0
    while (pending.length) {
        const node = pending.pop()
        if (!node) continue
        count++
        assert(Math.abs((node.left?.height ?? 0) - (node.right?.height ?? 0)) <= 1)
        pending.push(node.left, node.right)
    }
    return count
}

function cleared(work) {
    assert.equal(work.predecessors, undefined)
    assert.equal(work.completion, undefined)
    assert.equal(work.node, undefined)
    assert.equal(work.kernel, undefined)
    assert.equal(work.group, undefined)
}

function drained(kernel, groups) {
    assert.equal(kernel.pending(), undefined)
    assert.equal(kernel.counts.liveWaits, 0)
    for (const group of groups) {
        assert.equal(group.active, 0)
        assert.equal(group.memberships, undefined)
        assert.equal(group.kernel, undefined)
        assert.equal(group.node, undefined)
        assert.equal(group.indexes, undefined)
        assert.equal(group.unknown, undefined)
        assert.equal(group.selectionWaiters, undefined)
        assert.equal(group.scopedWaits, undefined)
    }
}

const samples = []
for (const mutation of [false, true]) for (const size of [16, 64, 256, 1024, 4096]) {
    const { kernel } = setup()
    const selections = Array.from({ length: size }, () => kernel.selection(kernel.root, mutation))
    const groups = new Set(selections.map(work => work.group))
    const retained = selections.reduce((total, selection) => total + selection.predecessors.size, 0)
    assert(retained <= size * 8, "unresolved selection must not retain a pairwise command-history graph")
    assert.equal(groups.size, 1)
    assert.equal(members(selections[0].group.unknown), size)
    for (let index = size - 1; index >= 0; index--) selections[index].select(undefined)
    for (const work of selections) cleared(work)
    drained(kernel, groups)
    assert(kernel.counts.indexSteps < size * Math.log2(size) * 16)
    samples.push({ scenario: "no-effects", mutation, size, retained, ...kernel.counts })
}

for (const size of [16, 64, 256, 1024, 4096]) {
    const { kernel } = setup()
    const first = kernel.selection(kernel.root, true)
    const group = first.group
    for (let index = 0; index < size; index++) {
        const work = kernel.selection(kernel.root, true)
        work.select(undefined)
        cleared(work)
        assert.equal(group.active, 1)
        assert.equal(members(group.unknown), 1)
        assert.equal(members(group.selectionWaiters), 0)
        assert.equal(group.indexes.get(kernel.root), undefined)
    }
    assert(kernel.counts.indexSteps < size * 8)
    first.select(undefined)
    drained(kernel, [group])
    samples.push({ scenario: "finished-history-behind-unknown", size, ...kernel.counts })
}

for (const size of [16, 64, 256, 1024, 4096]) {
    const { kernel, ctx } = setup()
    const selections = Array.from({ length: size }, () => kernel.selection(kernel.root, true))
    const group = selections[0].group
    const completion = kernel.pending()
    for (let index = size - 1; index > 0; index--) {
        selections[index].select(kernel.root.api)
        selections[index].complete()
    }
    assert.equal(members(group.unknown), 1)
    assert.equal(members(group.selectionWaiters), size)
    selections[0].select(kernel.root.api)
    assert.equal(members(group.unknown), 0)
    assert.equal(members(group.selectionWaiters), 0)
    // Selected effects remain pending; unrelated work is nevertheless ready.
    const sibling = kernel.reserve(kernel.root.other, true)
    assert.equal(sibling.readiness, undefined)
    sibling.complete()
    selections[0].complete()
    await continueGraphTransition(completion, ctx, () => {})
    for (const work of selections) cleared(work)
    drained(kernel, [group])
    assert(kernel.counts.indexSteps < size * Math.log2(size) * 64)
    assert(kernel.counts.conditional <= size * 2)
    samples.push({ scenario: "reverse-selected-effects", size, ...kernel.counts })
}

for (const size of [16, 64, 256, 1024]) {
    const { kernel, ctx } = setup()
    const selections = [], readers = [], groups = new Set(), holds = []
    for (let index = 0; index < size; index++) {
        const selection = kernel.selection(kernel.root, true)
        const reader = kernel.reserve(kernel.root.api, false)
        selections.push(selection)
        readers.push(reader)
        groups.add(selection.group)
        groups.add(reader.group)
        holds.push(continueGraphTransition(reader.readiness, ctx, () => {}))
    }
    const retained = selections.reduce((sum, work) => sum + work.predecessors.size, 0)
    assert(retained <= size * 3, "fixed readers must also share captured history")
    assert.equal(groups.size, 2)
    for (const selection of selections) selection.select(undefined)
    await Promise.all(holds)
    for (const reader of readers) reader.complete()
    for (const work of [...selections, ...readers]) cleared(work)
    drained(kernel, groups)
    assert(kernel.counts.indexSteps < size * Math.log2(size) * 64)
    samples.push({ scenario: "interleaved-fixed-readers", size, retained, ...kernel.counts })
}

for (const size of [16, 64, 256, 1024]) {
    const { kernel, ctx } = setup()
    const other = kernel.selection(kernel.root, true)
    const group = other.group
    other.select(kernel.root.other)
    for (let index = 0; index < size; index++) {
        const api = kernel.selection(kernel.root, true)
        api.select(kernel.root.api)
        const reader = kernel.reserve(kernel.root.api, false)
        const result = continueGraphTransition(reader.readiness, ctx, () => reader.complete())
        api.complete()
        await result
        assert.equal(group.scopedWaits.get(kernel.root.api), undefined)
        assert.equal(kernel.counts.liveWaits, 0)
        assert.equal(group.active, 1)
    }
    assert.equal(kernel.counts.peakWaits, 1)
    assert(kernel.counts.indexSteps < size * 100)
    other.complete()
    drained(kernel, [group])
    samples.push({ scenario: "finished-waits-with-live-sibling", size, ...kernel.counts })
}

console.log(JSON.stringify({ accepted: true, samples }))
