import assert from "node:assert/strict"
import { instrumentRuntime } from "../runtime-transform.js"

let frames = 0, parts = 0, products = 0
globalThis.__flatFrame = () => { if (process.env.CASCADA_FLAT_NOOP_COUNTER !== "1") frames++ }
globalThis.__flatPart = () => { if (process.env.CASCADA_FLAT_NOOP_COUNTER !== "1") parts++ }
globalThis.__flatProduct = () => { if (process.env.CASCADA_FLAT_NOOP_COUNTER !== "1") products++ }
const verify = instrumentRuntime(new Map([
    ["array-flat.js", [
        ["function frame(node, remaining) {", "$& globalThis.__flatFrame();"],
        ["function acyclicCount(node, remaining) {", "$& globalThis.__flatFrame();"],
        ["function cyclicCount(exponent) {", "$& globalThis.__flatFrame();"],
        ["coefficient * counts[column]", "(globalThis.__flatProduct(), $&)"],
        ["left * right", "(globalThis.__flatProduct(), $&)"],
    ]],
    ["array-flat-capture.js", [["for (const record of node.parts) {", "$& globalThis.__flatPart();"]]],
]), process.env.CASCADA_WORK_NOOP_LOADER !== "1")
const r = await import("../../src/index.js")
verify("Flat work requires its runtime counter loader")
const rows = []

for (const size of [8, 16, 32, 64]) for (const depth of [4096, Infinity]) {
    let inspections = 0
    const wrap = value => new Proxy(value, { ownKeys(target) { inspections++; return Reflect.ownKeys(target) } })
    const nodes = [wrap([]), wrap([])]
    while (nodes.length < size) nodes.push(wrap([nodes.at(-1), nodes.at(-2)]))
    const ctx = { execution: new r.Execution(), errorContext: "flat empty DAG work" }
    const source = new r.Chain(nodes.at(-1), ctx)
    inspections = frames = parts = products = 0
    const result = new r.Chain(r.run(source, [], "flat", [depth], ctx, {}), ctx)
    assert.deepEqual(r.export(result, [], ctx), [])
    assert.equal(inspections, size, "Capture each physical Array once across relative depths")
    assert(parts > 0 && frames > 0, "Flat work instrumentation must count executed capture and expansion")
    assert(parts <= 4 * size, "Ready DAG capture must not revisit each depth path")
    assert(frames <= 12 * size, "Empty DAG expansion must clamp exhausted depths")
    assert.equal(products, 0, "An acyclic graph requires no recurrence powering")
    rows.push({ size, depth: String(depth), inspections, frames, parts, products })
}

for (const size of [8, 32, 128]) {
    const cycles = Array.from({ length: size }, () => [])
    for (const cycle of cycles) cycle.push(cycle)
    const ctx = { execution: new r.Execution(), errorContext: "flat independent cycles" }
    const source = new r.Chain(cycles, ctx)
    frames = parts = products = 0
    const result = new r.Chain(r.run(source, [], "flat", [2 ** 54], ctx, {}), ctx)
    const output = r.export(result, [], ctx)
    assert.equal(output.length, size)
    for (const cycle of output) assert.equal(cycle[0], cycle)
    assert(parts > 0 && frames > 0, "Flat work instrumentation must count executed capture and expansion")
    assert(parts <= 4 * size + 4)
    assert(frames <= 12 * size + 4, "A silent cycle's transient must not depend on unrelated graph size")
    assert(products > 0 && products <= 256 * size + 128, "Independent cycles must retain sparse recurrence rows")
    rows.push({ size, independentCycles: true, frames, parts, products })
}
console.log(JSON.stringify({ cases: rows.length, rows }))
