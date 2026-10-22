// Entry history grows around a single placement, not a deep data graph.
import assert from "node:assert/strict"
import { normalizeModuleURL } from "../module-url.js"
import { registerHooks } from "node:module"

let preparations = 0
globalThis.countEntryStructure = () => { preparations++ }
const structureURL = new URL("../../src/placement-structure.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const loaded = next(url, context)
    if (normalizeModuleURL(url) !== normalizeModuleURL(structureURL)) return loaded
    const source = String(loaded.source)
    assert(source.includes("prepare(placement) {"))
    return { ...loaded, source: source.replaceAll("prepare(placement) {",
        "prepare(placement) { globalThis.countEntryStructure();") }
} })
const r = await import("../../src/index.js")
const { verifyRefCounts } = await import("../verify-refcounts.js")
const samples = []

async function history(depth, array, action, outerFirst) {
    const ctx = { execution: new r.Execution(), errorContext: "entry history" }
    const initial = array ? [1] : { base: 1 }
    const key = array ? 4 : "first"
    if (action === "recreate") initial[key] = 7
    const source = new r.Chain(initial, ctx)
    const before = new r.Chain(r.lookupPath(source, [], ctx), ctx)
    const gates = [], results = []
    let inner = source
    preparations = 0
    for (let index = 0; index < depth; index++) {
        const gate = Promise.withResolvers()
        gates.push(gate)
        results.push(r.enter(inner, index ? [] : [key], ctx, true, entered => {
            inner = entered
            return gate.promise
        }))
    }
    const captured = new r.Chain(r.lookupPath(source, [], ctx), ctx)
    const earlier = r.export(captured, [], ctx)
    r.assignPath(source, [array ? 6 : "last"], 9, ctx)
    if (action === "recreate") r.deletePath(inner, [], ctx)
    if (action !== "none") r.assignPath(inner, [], 7, ctx)
    if (action === "create-delete") r.deletePath(inner, [], ctx)
    if (outerFirst) {
        for (const gate of gates) gate.resolve()
        await Promise.all(results)
    } else {
        for (let index = depth - 1; index >= 0; index--) {
            gates[index].resolve()
            await results[index]
        }
    }
    const expected = array ? [1] : { base: 1 }
    if (action !== "none") expected[key] = 7
    if (action === "create-delete") delete expected[key]
    assert.deepEqual(await earlier, expected)
    assert.deepEqual(Object.keys(await earlier), Object.keys(expected))
    expected[array ? 6 : "last"] = 9
    assert.deepEqual(await r.export(source, [], ctx), expected)
    assert.deepEqual(Object.keys(await r.export(source, [], ctx)), Object.keys(expected))
    assert.equal(await r.run(new r.Chain([r.lookupPath(captured, [], ctx)], ctx), [], "includes",
        [r.lookupPath(before, [], ctx)], ctx, {}), action === "none")
    assert.equal(ctx.execution.fatalError, null)
    assert(preparations <= 4 * depth + 8, JSON.stringify({ depth, array, action, outerFirst, preparations }))
    verifyRefCounts(ctx, source._state, before._state, captured._state)
    samples.push({ depth, array, action, outerFirst, preparations })
}

for (const depth of [128, 512, 2048]) for (const array of [false, true])
for (const action of ["none", "write", "recreate", "create-delete"])
for (const outerFirst of [false, true]) await history(depth, array, action, outerFirst)
// Exercise both structural completion and required physical write-through
// beyond the engine stack limit, with a constant-size logical value.
await history(16384, false, "none", false)
await history(16384, true, "write", true)
console.log(JSON.stringify({ histories: samples.length, samples }))
