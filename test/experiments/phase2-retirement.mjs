// Run: node --expose-gc test/experiments/phase2-retirement.mjs
// Compares concrete index/proof implementations against an independent oracle.
// Runtime wiring and public-operation witnesses live in phase2-retirement-runtime.mjs.
import assert from 'node:assert/strict'
import { Ownership } from './phase2-ownership-model.mjs'

function fixture(storage, proof, count) {
    const nodes = Array.from({ length: count }, () => ({}))
    const nodeIndexes = new Map(nodes.map((node, index) => [node, index]))
    const outgoing = nodes.map(() => new Map()), holds = nodes.map(() => 0)
    const ownership = new Ownership(storage, proof)
    const put = (from, key, to) => {
        if (to === undefined) outgoing[from].delete(key)
        else outgoing[from].set(key, to)
        ownership.set(nodes[from], key, to === undefined ? undefined : nodes[to])
    }
    const retain = index => { holds[index]++; ownership.retain(nodes[index]) }
    const release = index => { holds[index]--; ownership.release(nodes[index]) }
    function transition(work) {
        const before = { ...ownership.metrics }
        ownership.transition(work)
        // An identity/parent edge is explored at most once per reverse batch,
        // including downstream candidates exposed by retirement itself.
        assert(ownership.metrics.proofRecords - before.proofRecords <= count)
        assert(ownership.metrics.reverseEdges - before.reverseEdges <=
            outgoing.reduce((total, slots) => total + slots.size, 0))
        assert(ownership.metrics.proofLinks - before.proofLinks <=
            ownership.metrics.reverseEdges - before.reverseEdges)
    }
    function verify() {
        const reached = new Set(), queue = holds.flatMap((n, i) => n ? [i] : [])
        while (queue.length) {
            const i = queue.pop()
            if (reached.has(i)) continue
            reached.add(i)
            queue.push(...outgoing[i].values())
        }
        const expectedParents = nodes.map(() => new Set())
        const expectedPlacements = nodes.map(() => new Set())
        for (const parent of reached) for (const [key, child] of outgoing[parent]) {
            expectedParents[child].add(nodes[parent])
            expectedPlacements[child].add(`${parent}:${key}`)
        }
        for (let i = 0; i < nodes.length; i++) {
            assert.equal(ownership.state(nodes[i]).active, reached.has(i), `liveness of ${i}`)
            assert.deepEqual(new Set(ownership.parents(nodes[i])), expectedParents[i])
            const actualPlacements = [...ownership.placements(nodes[i])].map(([owner, key]) => `${nodeIndexes.get(owner)}:${key}`)
            assert.deepEqual(new Set(actualPlacements), expectedPlacements[i])
        }
    }
    return { nodes, outgoing, holds, ownership, put, retain, release, transition, verify }
}

let graphs = 0, transitions = 0, fourNodeGraphs = 0
for (const storage of ['compact', 'shared']) for (const proof of ['reverse', 'forward']) {
    for (let edges = 0; edges < 512; edges++) for (let roots = 0; roots < 8; roots++) {
        const f = fixture(storage, proof, 3)
        f.transition(() => {
            for (let i = 0; i < 3; i++) {
                // Include zero-edge, never-held activations.
                f.ownership.activate(f.nodes[i])
                if (roots >> i & 1) f.retain(i)
                for (let j = 0; j < 3; j++) if (edges >> (i * 3 + j) & 1) f.put(i, j, j)
            }
        })
        try { f.verify() } catch (error) { console.error({ storage, proof, edges, roots }); throw error }
        graphs++
        f.transition(() => {
            for (let i = 0; i < 3; i++) if (f.holds[i]) f.release(i)
        })
        f.verify()
    }
    // Independent topology covers activation, reactivation, repeated keys,
    // multiple roots, same-value replacement, and grouped ownership transfers.
    let seed = 0x713ad92
    const random = n => {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
        return (seed >>> 0) % n
    }
    for (let history = 0; history < 250; history++) {
        const f = fixture(storage, proof, 10)
        for (let step = 0; step < 60; step++) {
            f.transition(() => {
                for (let part = 0, length = 1 + random(4); part < length; part++) {
                    const from = random(10), action = random(4)
                    if (action === 0) f.retain(from)
                    else if (action === 1 && f.holds[from]) f.release(from)
                    else f.put(from, random(4), action === 2 ? undefined : random(10))
                }
            })
            f.verify(); transitions++
        }
    }
}

// All four-node directed topologies and root subsets for the selected proof.
// Alternate edge and candidate order so neither happens to supply the proof.
for (let edges = 0; edges < 65536; edges++) for (let roots = 0; roots < 16; roots++) {
    const f = fixture('compact', 'reverse', 4)
    const candidateOrder = roots & 1 ? [3, 2, 1, 0] : [0, 1, 2, 3]
    const edgeOrder = edges & 1 ? [3, 2, 1, 0] : [0, 1, 2, 3]
    f.transition(() => {
        for (const i of candidateOrder) {
            f.ownership.activate(f.nodes[i])
            if (roots >> i & 1) f.retain(i)
        }
        for (const i of edgeOrder) for (const j of edgeOrder)
            if (edges >> (i * 4 + j) & 1) f.put(i, j, j)
    })
    try { f.verify() } catch (error) { console.error({ edges, roots }); throw error }
    fourNodeGraphs++
}

// Semantic dependency labels do not change liveness: recovery and backing are
// conditional outgoing edges, never independent roots.
for (const storage of ['compact', 'shared']) {
    const f = fixture(storage, 'reverse', 5)
    f.transition(() => {
        f.retain(0); f.retain(4)
        f.put(0, 'root', 1)
        f.put(1, 'backing', 2)
        f.put(2, 'physical-self', 1)
        f.put(2, 'physical-child', 3)
        f.put(3, 'recovery-baseline', 2)
        f.put(1, 'surviving-child', 4)
    })
    f.transition(() => f.put(0, 'root', undefined))
    f.verify()
    assert.deepEqual(f.nodes.map(n => f.ownership.state(n).active), [true, false, false, false, true])
}

const costs = []
for (const proof of ['reverse', 'forward']) {
    for (const shape of ['deep-parent', 'wide-child']) {
        const f = fixture('compact', proof, 502)
        f.transition(() => {
            f.retain(0)
            if (shape === 'deep-parent') for (let i = 0; i < 501; i++) f.put(i, 0, i + 1)
            else { f.put(0, 0, 1); for (let i = 2; i < 502; i++) f.put(1, i, i) }
        })
        Object.keys(f.ownership.metrics).forEach(key => f.ownership.metrics[key] = 0)
        const target = shape === 'deep-parent' ? 501 : 1
        for (let i = 0; i < 100; i++) {
            f.transition(() => f.retain(target))
            f.transition(() => f.release(target))
        }
        f.verify()
        costs.push({ proof, shape, ...f.ownership.metrics })
    }
}

// One release batch visits its common ancestor region once, even when hundreds
// of candidates independently refer to its end.
const batch = fixture('compact', 'reverse', 301)
batch.transition(() => {
    batch.retain(0)
    for (let i = 0; i < 100; i++) batch.put(i, 'next', i + 1)
    for (let i = 101; i < 301; i++) { batch.put(100, i, i); batch.retain(i) }
})
batch.ownership.metrics.reverse = 0
batch.transition(() => { for (let i = 101; i < 301; i++) batch.release(i) })
batch.verify()
assert.equal(batch.ownership.metrics.reverse, 300)

// An explored dead branch must not become live just because a later parent
// roots the candidate. A back-edge to that candidate changes the proof.
for (const cycleReachesCandidate of [false, true]) {
    const f = fixture('compact', 'reverse', 4)
    f.transition(() => {
        f.retain(0); f.retain(1); f.retain(3)
        f.put(1, 'cycle', 2); f.put(2, 'cycle', 1)
        f.put(1, 'child', 3)
        if (cycleReachesCandidate) f.put(3, 'back', 1)
        f.put(0, 'later-parent', 3)
    })
    f.transition(() => { f.release(3); f.release(1) })
    f.verify()
    assert.equal(f.ownership.state(f.nodes[1]).active, cycleReachesCandidate)
    assert.equal(f.ownership.state(f.nodes[3]).active, true)
    f.transition(() => f.release(0))
    f.verify()
}

const fanIn = []
for (const width of [100, 1000, 10000]) {
    const f = fixture('compact', 'reverse', width + 3), child = width + 2
    f.transition(() => {
        f.retain(0); f.retain(child); f.put(0, 'root', 1)
        for (let row = 2; row < child; row++) {
            f.put(1, row, row)
            f.put(row, 'child', child)
        }
    })
    for (const key of Object.keys(f.ownership.metrics)) f.ownership.metrics[key] = 0
    f.transition(() => f.release(child))
    f.verify()
    const { reverse: nodes, reverseEdges: edges, proofRecords, proofLinks } = f.ownership.metrics
    assert.deepEqual({ nodes, edges, proofRecords, proofLinks },
        { nodes: 3, edges: 3, proofRecords: 4, proofLinks: 3 })
    // Separate commands cannot reuse stale proofs after a parent disappears.
    for (let iteration = 0; iteration < 10; iteration++) {
        f.transition(() => f.put(1, iteration + 2, undefined))
        f.transition(() => f.retain(child))
        const before = { ...f.ownership.metrics }
        f.transition(() => f.release(child))
        assert.equal(f.ownership.metrics.reverse - before.reverse, 3)
        assert.equal(f.ownership.metrics.reverseEdges - before.reverseEdges, 3)
        f.verify()
    }
    fanIn.push({ width, nodes, edges, proofRecords, proofLinks, repeatedReleases: 10 })
    f.transition(() => f.put(0, 'root', undefined))
    f.verify()
    assert.equal(f.ownership.state(f.nodes[child]).active, false)
}

const lateRoot = []
for (const width of [100, 1000]) {
    const f = fixture('compact', 'reverse', width + 3), child = width + 2
    f.transition(() => {
        f.retain(0); f.retain(child); f.put(0, 'root', 1)
        for (let row = 2; row < child; row++) {
            f.retain(row)
            f.put(row, 'child', child)
        }
        f.put(1, 'last-parent', child - 1)
    })
    for (const key of Object.keys(f.ownership.metrics)) f.ownership.metrics[key] = 0
    f.transition(() => {
        f.release(child)
        for (let row = 2; row < child; row++) f.release(row)
    })
    f.verify()
    assert.equal(f.ownership.metrics.reverse, width + 2)
    assert.equal(f.ownership.metrics.reverseEdges, width + 2)
    assert.equal(f.ownership.metrics.retired, width - 1)
    lateRoot.push({ width, ...f.ownership.metrics })
}

// A failed search through shared ancestors retires the group once; downstream
// candidates cannot repeat that proof or retain the removed cycle.
const deadBatch = fixture('compact', 'reverse', 301)
deadBatch.transition(() => {
    deadBatch.retain(0)
    for (let i = 0; i < 100; i++) deadBatch.put(i, 'next', i + 1)
    deadBatch.put(100, 'cycle', 0)
    for (let i = 101; i < 301; i++) { deadBatch.put(100, i, i); deadBatch.retain(i) }
})
for (const key of Object.keys(deadBatch.ownership.metrics)) deadBatch.ownership.metrics[key] = 0
deadBatch.transition(() => {
    for (let i = 101; i < 301; i++) deadBatch.release(i)
    deadBatch.release(0)
})
deadBatch.verify()
assert.equal(deadBatch.ownership.metrics.reverse, 301)
// The first leaf proves the cycle dead. Retiring it removes the other leaves'
// incoming edges before their searches, so they need no further parent walk.
assert.equal(deadBatch.ownership.metrics.reverseEdges, 102)
assert.equal(deadBatch.ownership.metrics.retired, 301)

const memory = []
if (global.gc) for (const storage of ['compact', 'shared']) {
    for (const shape of ['single-parent', 'repeated-child']) {
        const samples = []
        for (let sample = 0; sample < 3; sample++) {
            const nodes = Array.from({ length: 12001 }, () => ({}))
            await new Promise(setImmediate); global.gc()
            const before = process.memoryUsage().heapUsed
            const graph = new Ownership(storage)
            graph.transition(() => {
                graph.retain(nodes[0])
                for (let i = 1; i < nodes.length; i++) graph.set(nodes[0], i,
                    nodes[shape === 'single-parent' ? i : 1])
            })
            await new Promise(setImmediate); global.gc()
            samples.push(process.memoryUsage().heapUsed - before)
            assert.equal(graph.state(nodes[0]).outgoing.size, 12000)
        }
        memory.push({ storage, shape, medianBytes: samples.sort((a, b) => a - b)[1] })
    }
}
console.log(JSON.stringify({ graphs, fourNodeGraphs, transitions, seed: '0x713ad92',
    sharedRegionBatchVisits:300, deadBatch: deadBatch.ownership.metrics, fanIn, lateRoot, costs, memory,
    scope: 'Concrete index/proof prototypes and oracle; not production ownership or COW.' }, null, 2))
