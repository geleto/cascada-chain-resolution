// Count range-key production, independently of time or garbage collection.
import assert from "node:assert/strict"
import { instrumentRuntime } from "../runtime-transform.js"

let produced = 0, branches = 0, transfers = 0, pointLookups = 0
globalThis.countLayoutPoint = () => pointLookups++
globalThis.countPlacementTransfer = () => transfers++
let watched, tailStart, tailReads = 0
globalThis.countTailRead = (source, key) => { if (source === watched && Number(key) >= tailStart) tailReads++ }
globalThis.countLayoutBranch = () => branches++
globalThis.countRangeKey = () => produced++
// Match both streamed and formerly eager bounded-range enumeration so the
// existing safeguard fault still measures the work it restores.
const verifyInstrumentation = instrumentRuntime(new Map([["array-view.js", [[
    /(yield |keys\.push\()String\(index(?: - offset)?\)/g,
    (match, prefix) => `${prefix}(globalThis.countRangeKey(), ${match.slice(prefix.length)})`,
    2,
]]], ["array-layout.js", [[
    "function branch(left, right) {", "$& globalThis.countLayoutBranch();",
], [
    "function layoutAt(node, index) {", "$& globalThis.countLayoutPoint();",
]]], ["property-versions.js", [[
    /function transferPlacement\([^)]*\) \{/g,
    "$& globalThis.countPlacementTransfer();",
]]], ["array-remap.js", [[
    "for (const key of languageProperties.enumerableLanguageKeyCandidates(source, ctx, first, end)) {",
    "$& globalThis.countTailRead(source, key);",
]]]]))
const r = await import("../../src/index.js")
verifyInstrumentation("Range-key instrumentation must execute")
const { enumerableLanguageKeyCandidates } = await import("../../src/language-properties.js")
const { verifyRefCounts } = await import("../verify-refcounts.js")
const samples = []

for (const size of [128, 4096]) for (const offset of [0, 1, 17])
for (const width of [4, size - offset]) for (const pending of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: "sparse range work" }
    const signal = Promise.withResolvers()
    const input = new Array(size)
    input[offset] = pending ? signal.promise : { k: 1 }
    input[offset + width - 1] = 2
    const source = new r.Chain(input, ctx)
    const view = new r.Chain(r.run(source, [], "slice", [offset, offset + width], ctx, {}), ctx)
    signal.resolve({ k: 1 })
    await new Promise(setImmediate)
    produced = 0
    const keys = enumerableLanguageKeyCandidates(view._state.value, ctx)
    assert.equal(produced, 0, "Capturing bounds must not allocate keys for holes, including with overlays")
    let previous = -1, candidates = 0
    for (const key of keys) {
        assert(Number(key) > previous)
        previous = Number(key)
        candidates++
    }
    const rangeKeys = produced
    // The two stored indexes can come directly from storage. Any additional
    // candidates came from enumerating the interval and must reach the counter.
    assert(rangeKeys >= candidates - 2, "Range-key instrumentation must count each streamed candidate")
    assert(candidates <= 16 && rangeKeys <= 16,
        `Visited ${candidates} candidates and produced ${rangeKeys} range keys for two slots in width ${width}`)
    const expected = new Array(width)
    expected[0] = { k: 1 }
    expected[width - 1] = 2
    assert.deepEqual(await r.export(view, [], ctx), expected)
    const reversed = new r.Chain(r.run(view, [], "toReversed", [], ctx, {}), ctx)
    // toReversed is deliberately dense, including the input's holes.
    assert.deepEqual(await r.export(reversed, [], ctx), expected.toReversed())
    verifyRefCounts(ctx, source._state, view._state, reversed._state)
    samples.push({ size, offset, width, pending, candidates, rangeKeys })
}
for (const size of [2048, 8192]) {
    const ctx = { execution: new r.Execution(), errorContext: "dense layout work" }
    const source = new r.Chain(Array.from({ length: size }, (_, i) => i), ctx)
    const suffix = Promise.withResolvers(), tail = Array.from({ length: 129 }, (_, i) => size + i)
    const joined = new r.Chain(r.run(source, [], "concat", [suffix.promise], ctx, {}), ctx)
    suffix.resolve(tail)
    const largeSuffix = Promise.withResolvers()
    const smallHead = new r.Chain(r.run(new r.Chain([0], ctx), [], "concat", [largeSuffix.promise], ctx, {}), ctx)
    largeSuffix.resolve(Array.from({ length: size - 1 }, (_, i) => i + 1))
    await new Promise(setImmediate)
    for (const [input, last] of [[source, size - 1], [joined, tail.at(-1)], [smallHead, size - 1]])
    for (const mode of Object.values(r.CHAIN_MODE)) {
        for (const [method, args, mutation, first, end, final] of [
            ["splice", [1, 1], true, 0, last - 1, last],
            ["with", [0, 9], false, 9, last, last],
            ["toReversed", [], false, last, last, 0],
            ["reverse", [], false, last, last, 0], ["reverse", [], true, last, last, 0],
            ["unshift", [-1], false, -1, last + 1, last], ["unshift", [-1], true, -1, last + 1, last],
        ]) {
            const receiver = new r.Chain(r.lookupPath(input, [], ctx), ctx, mode)
            branches = transfers = pointLookups = 0
            const output = r.run(receiver, [], method, args, ctx, mutation ? { mutationScopeDepth: 0 } : {})
            const counts = { branches, transfers, pointLookups }
            assert(counts.branches < 64 && counts.transfers < 20 && counts.pointLookups < 20,
                `${method} on ${size} distinct slots: ${JSON.stringify(counts)}`)
            const kept = mutation ? receiver : new r.Chain(output, ctx, mode)
            assert.equal(r.lookupPath(kept, [0], ctx), first)
            assert.equal(r.lookupPath(kept, ["length"], ctx), end + 1)
            assert.equal(r.lookupPath(kept, [end], ctx), final)
            if (method === "splice") {
                assert.equal(r.lookupPath(new r.Chain(output, ctx, mode), [0], ctx), 1)
                assert.equal(r.lookupPath(kept, [1], ctx), 2)
            }
            if (method === "unshift" && mutation) assert.equal(output, end + 1)
            assert.equal(r.lookupPath(input, [1], ctx), 1)
        }
    }
    const signal = Promise.withResolvers(), child = { n: 7 }
    const repeated = r.run(new r.Chain(new Array(size / 2), ctx), [], "fill", [child], ctx, {})
    const mixed = new r.Chain(r.run(source, [], "concat", [signal.promise], ctx, {}), ctx)
    signal.resolve(repeated)
    await new Promise(setImmediate)
    watched = r.lookupPath(mixed, [], ctx)
    tailStart = size
    tailReads = 0
    const flipped = new r.Chain(r.run(mixed, [], "toReversed", [], ctx, {}), ctx)
    assert(tailReads < 10, `Expanded ${tailReads} slots of a repeated tail`)
    watched = undefined
    assert.equal(r.lookupPath(flipped, [0, "n"], ctx), 7)
    assert.equal(r.lookupPath(flipped, [size / 2], ctx), size - 1)
}
console.log(JSON.stringify({ samples }))
