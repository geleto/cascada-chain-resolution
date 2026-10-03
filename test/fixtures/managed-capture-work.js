import assert from "node:assert/strict"
import { registerHooks } from "node:module"

globalThis.captureAllocations = 0
globalThis.receiverCopies = 0
const moduleURL = new URL("../../src/managed-invocation.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== moduleURL) return result
    let source = String(result.source)
    const capture = "entries: new Map(), parents: new Set(), identity"
    const copy = "const copy = node.copy = createEmptyContainer(source, operationContext)"
    assert(source.includes(capture) && source.includes(copy), "Receiver work counters need updating")
    source = source.replace(capture, "entries: (globalThis.captureAllocations++, new Map()), parents: new Set(), identity")
        .replace(copy, "globalThis.receiverCopies++; " + copy)
    return { ...result, source }
} })
const r = await import("../../src/index.js")
const { OrderedThenable } = await import("../ordered-thenable.js")

for (const size of [16, 64, 128]) for (const reversed of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: "logical receiver capture work" }
    const ready = new OrderedThenable()
    ready.resolve(1)
    const input = { items: Array.from({ length: size }, () => ({ k: ready })), self() { return this } }
    input.cycle = input
    const original = new r.Chain(input, ctx)
    const copy = new r.Chain(r.run(original, [], "self", [], ctx, {}), ctx)
    const pair = reversed ? [copy, original] : [original, copy]
    const both = new r.Chain({ a: r.lookupPath(pair[0], [], ctx), b: r.lookupPath(pair[1], [], ctx),
        same() { return this.a === this.b && this.a.cycle === this.a && this.a.items[0] === this.b.items[0] },
        change() { this.a.items[0].k = 2; return this.b.items[0].k },
    }, ctx)
    for (const mutation of [false, true]) {
        globalThis.captureAllocations = globalThis.receiverCopies = 0
        assert.equal(r.run(both, [], mutation ? "change" : "same", [], ctx,
            mutation ? { mutationScopeDepth: 0 } : {}), mutation ? 2 : true)
        assert.equal(globalThis.captureAllocations, size + 3, "One capture per logical node")
        assert.equal(globalThis.receiverCopies, size + 3, "Selective copying must not grow")
    }
    assert.equal(r.lookupPath(original, ["items", 0, "k"], ctx), 1)
    assert.equal(r.lookupPath(copy, ["items", 0, "k"], ctx), 1)
}
console.log("12 receiver captures allocate once per logical node, preserving copy counts and aliases")
