// Count range-key production, independently of time or garbage collection.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

let produced = 0
globalThis.countRangeKey = () => produced++
registerHooks({ load(url, context, next) {
    const loaded = next(url, context)
    if (!url.endsWith("/src/array-view.js")) return loaded
    const source = String(loaded.source)
    // Match both streamed and formerly eager bounded-range enumeration.
    const marker = /(yield |keys\.push\()String\(index(?: - offset)?\)/g
    assert(marker.test(source), "Range-key counter needs updating")
    return { ...loaded, source: source.replace(marker, (match, prefix) =>
        `${prefix}(globalThis.countRangeKey(), ${match.slice(prefix.length)})`) }
} })
const r = await import("../../src/index.js")
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
console.log(JSON.stringify({ samples }))
