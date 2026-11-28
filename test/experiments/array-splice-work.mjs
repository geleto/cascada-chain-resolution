import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"
import { instrumentRuntime } from "../runtime-transform.js"

const timing = process.argv.includes("--timing")
let phase
globalThis.__spliceWork = key => { if (phase) phase[key]++ }
const count = (anchor, name) => [anchor, anchor + "\n        globalThis.__spliceWork(" + JSON.stringify(name) + ")"]
const loaded = !timing && instrumentRuntime([
    ["array-remap.js", [count("function buffer(size, dense) {", "buffers"),
        count("function createArrayFromRemap(remap, operationContext) {", "remaps"),
        count("const i = Number(key), segment = i < storage.prefix ? storage : storage.tail", "physical")]],
    ["array-layout.js", [count("function span(length, placement) {", "spans"),
        count("function branch(left, right) {", "branches"),
        count("const placement = readArrayPlacement(array, key, ctx, inspect)", "captures")]],
    ["parent-placements.js", [
        ["if (!incoming) meta.incomingParents = { source, key }",
            "if (!incoming) { globalThis.__spliceWork('links'); meta.incomingParents = { source, key } }"],
        ["keys.add(key)", "if (!keys.has(key)) globalThis.__spliceWork('links'); keys.add(key)"],
        ["keys.delete(key)", "if (keys.delete(key)) globalThis.__spliceWork('unlinks')"],
        ["if (incoming.source === source && incoming.key === key) delete meta.incomingParents",
            "if (incoming.source === source && incoming.key === key) { globalThis.__spliceWork('unlinks'); delete meta.incomingParents }"],
    ]],
])
const r = await import("../../src/index.js")
const mutation = { mutationScopeDepth: 0 }
const counters = () => ({ physical: 0, buffers: 0, captures: 0, spans: 0, branches: 0, remaps: 0, links: 0, unlinks: 0 })
async function sample(n, mode, kind, deferred, managed = false) {
    const ctx = { execution: new r.Execution(), errorContext: "middle splice work" }
    const value = i => managed ? { i } : i
    const model = [value(-3), value(-2), value(-1)], controls = [], pushes = [], lengths = []
    let chain = new r.Chain(structuredClone(model), ctx, mode)
    if (kind === "indexed") {
        chain = new r.Chain(r.run(chain, [], "toSpliced", [1, 0, value(-4)], ctx, {}), ctx, mode)
        model.splice(1, 0, value(-4))
    }
    const at = kind === "endpoint" ? 0 : 1, count = kind === "shrinking" ? 3 : 1
    // Construct the matched native answers and payloads before the timed region.
    const inputs = Array.from({ length: n }, (_, i) => {
        const pair = [value(2 * i), value(2 * i + 1)]
        lengths.push(model.push(...structuredClone(pair)))
        model.splice(at, count)
        return pair
    })
    const issued = phase = counters(), start = performance.now()
    for (const pair of inputs) {
        const control = deferred && Promise.withResolvers()
        if (control) controls.push(control)
        pushes.push(r.run(chain, [], "push", pair, ctx, mutation))
        r.run(chain, [], "splice", [at, control ? control.promise : count], ctx, mutation)
    }
    const settled = phase = counters()
    for (const control of controls) control.resolve(count)
    const actual = await Promise.all(pushes)
    const snapshot = await r.lookupPath(chain, ["length"], ctx)
    const ms = performance.now() - start
    phase = undefined
    assert.deepEqual(actual, lengths)
    assert.equal(snapshot, model.length)
    assert.deepEqual(await r.export(chain, [], ctx), model)
    return { issued, settled, ms }
}

if (timing) {
    for (const n of [40, 80, 160]) {
        await sample(n, r.CHAIN_MODE.Complete, "middle", false)
        const times = []
        for (let i = 0; i < 9; ++i) times.push((await sample(n, r.CHAIN_MODE.Complete, "middle", false)).ms)
        times.sort((a, b) => a - b)
        console.log(JSON.stringify({ n, medianMs: times[4], samples: times.length }))
    }
} else {
    for (const n of [40, 80, 160]) for (const mode of Object.values(r.CHAIN_MODE))
        for (const [kind, deferred, managed] of [
            ["middle", false, false], ["shrinking", false, false], ["endpoint", false, false],
            ["middle", true, false], ["indexed", false, false], ["middle", false, true],
        ]) {
            const { issued, settled } = await sample(n, mode, kind, deferred, managed)
            console.log(JSON.stringify({ n, mode, kind, deferred, managed, issued, settled }))
        }
    loaded("splice storage and established relationships")
}
