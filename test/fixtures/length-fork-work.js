// Count only the original Array's refresh work, excluding necessary copy work.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

let measured, visits = 0
globalThis.__countLengthNode = state => { if (state === measured) visits++ }
const moduleURL = new URL("../../src/array-length.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const loaded = next(url, context)
    if (url !== moduleURL) return loaded
    const marker = "for (let node = start; node;) {"
    assert(String(loaded.source).includes(marker), "Length work counter needs updating")
    return { ...loaded, source: String(loaded.source).replace(marker, marker + " globalThis.__countLengthNode(this);") }
} })
const r = await import("../../src/index.js")
const { metaOf } = await import("../../src/meta.js")

for (const size of [2, 8, 32]) for (const imported of [false, true]) for (const view of [false, true])
for (const producer of ["cow", "method result"]) {
    const ctx = { execution: new r.Execution(), errorContext: "length fork work" }
    let source = new r.Chain(imported ? r.import([0], ctx) : [0], ctx)
    if (view) source = new r.Chain(r.run(source, [], "slice", [], ctx, {}), ctx)
    const signals = Array.from({ length: size }, () => Promise.withResolvers())
    const entries = signals.map((signal, index) => r.enter(source, [index + 1], ctx, true, () => signal.promise))
    measured = metaOf(r.lookupPath(source, [], ctx), ctx).arrayRange.lengthState
    const forks = []
    const questions = []
    for (let index = 0; index < 5; index++) {
        const value = r.lookupPath(source, [], ctx)
        const fork = new r.Chain(producer === "cow" ? value : r.importMethodResult(value, ctx), ctx)
        const pause = Promise.withResolvers()
        const entry = r.enter(fork, [size + 2], ctx, true, () => pause.promise)
        pause.resolve()
        await entry
        visits = 0
        assert.equal(r.lookupPath(source, [0], ctx), 0)
        assert.equal(visits, 0, "An unrelated fork must not make a conclusive point read rescan its frontier")
        const revision = measured.outcomes.revision
        visits = 0
        questions.push(r.lookupPath(source, ["length"], ctx))
        assert.equal(measured.outcomes.revision, revision)
        assert.equal(visits, 0, "An unrelated fork must not invalidate an unresolved length question")
        forks.push(fork)
    }
    for (const signal of signals) signal.resolve()
    await Promise.all(entries)
    assert.deepEqual(await Promise.all(questions), Array(5).fill(1))
    for (const chain of [source, ...forks]) assert.deepEqual(await r.export(chain, [], ctx), [0])
}

// Shared contributions still propagate; creation changes every captured shape.
for (const created of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: "shared length outcome" }
    const source = new r.Chain([0], ctx), pause = Promise.withResolvers()
    const entry = r.enter(source, [3], ctx, true, child => pause.promise.then(() => {
        if (created) r.assignPath(child, [], 9, ctx)
    }))
    const fork = new r.Chain(r.lookupPath(source, [], ctx), ctx)
    const sourceLength = r.lookupPath(source, ["length"], ctx), forkLength = r.lookupPath(fork, ["length"], ctx)
    pause.resolve()
    await entry
    assert.equal(await sourceLength, created ? 4 : 1)
    assert.equal(await forkLength, created ? 4 : 1)
    assert.deepEqual(await r.export(source, [], ctx), await r.export(fork, [], ctx))
}
console.log("240 fork-only point/length reads visit no length nodes; shared completion controls pass")
