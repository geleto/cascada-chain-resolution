import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { createRandom, randomInteger } from "../native-equivalence-support.js"
import { ready, ChainedThenable, OrderedThenable } from "../ordered-thenable.js"
import { assertGraph } from "../graph-oracle.js"
import { verifyRefCounts } from "../verify-refcounts.js"
import { verifyLiveness } from "../verify-parents.js"

// Immutable imported graphs let the model derive reachability from its own
// adjacency list. Runtime parents, counters, and lease facts are never inputs.
async function checkLifetime(seed, mode, coverage) {
    const ctx = { execution: new r.Execution(), errorContext: { seed, mode } }
    const random = createRandom(seed + 0x711f), array = seed % 2 === 0
    const nodes = Array.from({ length: 8 }, () => array ? [] : {})
    const edges = nodes.map(() => [randomInteger(random, nodes.length), randomInteger(random, nodes.length)])
    nodes.forEach((node, index) => edges[index].forEach((child, key) => node[key] = nodes[child]))
    const roots = nodes.map((_, index) => index)
    const holders = nodes.map(node => new r.Chain(r.import(node, ctx), ctx))
    if (mode !== "bare") for (const holder of holders) assert.equal(r.hasError(holder, [], ctx), false)
    for (let step = 0; step < 24; step++) {
        const slot = randomInteger(random, holders.length)
        // Include a full retirement/re-entry even if random roots keep a cycle alive.
        if (step === 8 || step === 23) {
            for (const holder of holders) r.assignPath(holder, [], null, ctx)
            roots.fill(null)
            coverage.add("lifetime:clear-all")
        } else if (step % 3 === 0) {
            r.assignPath(holders[slot], [], null, ctx)
            roots[slot] = null
            coverage.add("lifetime:release-holder")
        } else {
            const node = randomInteger(random, nodes.length)
            r.assignPath(holders[slot], [], r.import(nodes[node], ctx), ctx)
            roots[slot] = node
            coverage.add("lifetime:cached-reentry")
        }
        if (mode === "observed") for (let i = 0; i < holders.length; i++)
            assertGraph(r.export(holders[i], [], ctx), roots[i] === null ? null : nodes[roots[i]])
        if (mode !== "bare" || step === 23) {
            const expected = new Set()
            const visit = index => {
                if (expected.has(nodes[index])) return
                expected.add(nodes[index])
                for (const child of edges[index]) visit(child)
            }
            for (const root of roots) if (root !== null) visit(root)
            verifyLiveness(ctx, nodes, expected)
            verifyRefCounts(ctx, ...holders.map(holder => holder._state))
        }
    }
    // A suspended export must distinguish an earlier capture from the same
    // physical identity after mutation, while preserving aliases within each.
    const later = Promise.withResolvers(), value = randomInteger(random, 1000)
    const source = new r.Chain({ child: { value } }, ctx)
    const before = r.lookupPath(source, [], ctx)
    const input = new r.Chain({ a: before, b: before, later: later.promise }, ctx)
    const output = r.export(input, [], ctx)
    r.assignPath(input, [], null, ctx)
    if (seed % 2) r.assignPath(source, ["child", "value"], value + 1, ctx)
    else r.enter(source, ["child"], ctx, true, entered => r.assignPath(entered, ["value"], value + 1, ctx))
    const after = r.lookupPath(source, [], ctx)
    later.resolve({ a: after, b: after })
    const result = await output
    const oldValue = { child: { value } }, newValue = { child: { value: value + 1 } }
    assertGraph(result, { a: oldValue, b: oldValue, later: { a: newValue, b: newValue } })
    r.assignPath(source, [], null, ctx)
    await new Promise(setImmediate)
    verifyLiveness(ctx, [before, after], new Set())
    coverage.add(`generation:${seed % 2 ? "assignment" : "entry"}`)
    coverage.add(`lifetime:${array ? "array" : "record"}`)
}

// Two input boundaries receive one identity. Availability changes only when
// preparation runs, never its values, aliases, cycles, or receiving topology.
function graph(array, leaf) {
    const shared = array ? [leaf] : { leaf }
    if (array) shared.push(shared)
    else shared.self = shared
    return shared
}

function input(shared, nested, before, after, drain) {
    const value = {}
    for (let i = 0; i < before; i++) value[`before${i}`] = nested ? { shared } : shared
    value.drain = drain
    for (let i = 0; i < after; i++) value[`after${i}`] = shared
    return value
}

const seeds = Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 16)
const coverage = new Set()
const jointCoverage = new Set()
const boundaries = ["import", "chain", "assignment", "method-result"]
const deliveries = ["ready", "synchronous", "native", "ordered"]
const modes = ["bare", "verified", "observed"]
let programs = 0, runs = 0, jointPrograms = 0, seededPrograms = 0

async function checkReception({ seed, boundary, array, nested, early, delivery, before, after, leafValue }, joint) {
    programs++
    if (joint) jointPrograms++
    else seededPrograms++
    for (const mode of modes) {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const trigger = new ChainedThenable()
        const leaf = delivery === "ordered" ? new OrderedThenable() : Promise.withResolvers()
        // This ready thenable calls the newly registered callback directly. The
        // trigger's older queued delivery is a separate preparation interaction.
        const available = delivery === "ready" ? leafValue : delivery === "synchronous" ? ready(leafValue) :
            delivery === "ordered" ? leaf : leaf.promise
        const shared = graph(array, available)
        const earlier = r.import(trigger, ctx), drain = trigger.then(() => "drained")
        trigger.resolve(shared)
        if (early) await earlier
        const value = input(shared, nested, before, after, drain)
        const expected = input(graph(array, leafValue), nested, before, after, "drained")
        try {
            const received = boundary === "import" ? r.import(value, ctx) :
                boundary === "method-result" ? r.importMethodResult(value, ctx) : value
            const chain = new r.Chain(boundary === "assignment" ? null : received, ctx)
            if (boundary === "assignment") r.assignPath(chain, [], received, ctx)
            if (mode !== "bare") verifyRefCounts(ctx, chain._state, shared)
            if (mode === "observed") r.lookupPath(chain, ["after0"], ctx)
            const exported = r.export(chain, [], ctx)
            leaf.resolve(leafValue)
            assertGraph(await exported, expected)
            await earlier
            verifyRefCounts(ctx, chain._state, shared)
            assert.equal(ctx.execution.fatalError, null)
        } catch (cause) {
            throw new Error(`seed=${seed}, boundary=${boundary}, array=${array}, nested=${nested}, early=${early}, delivery=${delivery}, mode=${mode}`, { cause })
        }
        for (const key of [`boundary:${boundary}`, `array:${array}`, `nested:${nested}`,
            `preparation:${early ? "already prepared" : "fresh"}`, `delivery:${delivery}`, `harness:${mode}`]) coverage.add(key)
        if (joint) jointCoverage.add(`${boundary}:${early ? "already prepared" : "fresh"}:${delivery}:${array ? "array" : "record"}:${nested ? "nested" : "direct"}`)
        runs++
    }
}

// Cover the complete bounded interaction regardless of how many random seeds
// are requested. Marginal counters alone cannot show that these cases ran.
for (const boundary of boundaries) for (const early of [false, true]) for (const delivery of deliveries)
    for (const array of [false, true]) for (const nested of [false, true]) {
        await checkReception({ seed: "joint", boundary, array, nested, early, delivery,
            before: 2, after: 2, leafValue: 7 }, true)
    }

for (let seed = 0; seed < seeds; seed++) {
    for (const mode of modes) {
        try { await checkLifetime(seed, mode, coverage) }
        catch (cause) { throw new Error(`lifetime seed=${seed}, mode=${mode}`, { cause }) }
    }
    const random = createRandom(seed + 0x19fa)
    const nested = seed % 2 === 0, early = Math.floor(seed / 2) % 2 === 0
    const delivery = ["ready", "native", "ordered"][seed % 3]
    const before = 1 + randomInteger(random, 3), after = 1 + randomInteger(random, 3)
    const leafValue = 1 + randomInteger(random, 1000)
    for (const boundary of boundaries) for (const array of [false, true])
        await checkReception({ seed, boundary, array, nested, early, delivery, before, after, leafValue }, false)
}
console.log(JSON.stringify({ programs, runs, jointPrograms, seededPrograms, lifetimePrograms: seeds,
    lifetimeRuns: seeds * 3, jointCoverage: [...jointCoverage].sort(), coverage: [...coverage].sort() }))
