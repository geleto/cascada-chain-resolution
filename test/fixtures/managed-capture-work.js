import assert from "node:assert/strict"
import { registerHooks } from "node:module"

globalThis.captureAllocations = 0
globalThis.containerCopies = 0
const moduleURL = new URL("../../src/managed-capture.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== moduleURL) return result
    let source = String(result.source)
    const capture = "entries: new Map(), identity"
    const copy = "node.copy = node.shape.length === undefined"
    assert([capture, copy].every(marker => source.includes(marker)), "Capture work counters need updating")
    source = source.replace(capture, "entries: (globalThis.captureAllocations++, new Map()), identity")
        .replace(copy, "globalThis.containerCopies++; " + copy)
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
    globalThis.captureAllocations = globalThis.containerCopies = 0
    const exported = r.export(both, [], ctx)
    assert.equal(exported.a, exported.b)
    assert.equal(exported.a.cycle, exported.a)
    assert.equal(globalThis.captureAllocations, size + 3, "Export shares captures for known equal keys")
    assert.equal(globalThis.containerCopies, size + 3, "Export allocates each canonical node once")
    for (const mutation of [false, true]) {
        globalThis.captureAllocations = globalThis.containerCopies = 0
        assert.equal(r.run(both, [], mutation ? "change" : "same", [], ctx,
            mutation ? { mutationScopeDepth: 0 } : {}), mutation ? 2 : true)
        assert.equal(globalThis.captureAllocations, size + 3, "One capture per logical node")
        assert.equal(globalThis.containerCopies, size + 3,
            "Both native modes copy each canonical node exactly once")
    }
    assert.equal(r.lookupPath(original, ["items", 0, "k"], ctx), 1)
    assert.equal(r.lookupPath(copy, ["items", 0, "k"], ctx), 1)
}

{
    const ctx = { execution: new r.Execution(), errorContext: "canonical edge copying" }
    const input = { child: { k: 1 } }
    input.child.parent = input
    const source = new r.Chain(input, ctx)
    const retained = new r.Chain(r.lookupPath(source, [], ctx), ctx)
    r.enter(source, ["child", "k"], ctx, true, () => undefined)
    const old = r.lookupPath(retained, [], ctx), current = r.lookupPath(source, [], ctx)
    const receiver = new r.Chain({ a: old, b: current, holder: { x: old }, same() {
        return this.a === this.b && this.holder.x === this.a && this.a.child.parent === this.a
    } }, ctx)
    globalThis.containerCopies = 0
    assert.equal(r.run(receiver, [], "same", [], ctx, {}), true)
    assert.equal(globalThis.containerCopies, 4, "Canonical assembly copies each node once, including cycles")
}
{
    const ctx = { execution: new r.Execution(), errorContext: "captured method selection work" }
    let methodReads = 0
    const receiver = new Proxy({ read() { return 1 } }, {
        getOwnPropertyDescriptor(target, key) {
            if (key === "read") methodReads++
            return Reflect.getOwnPropertyDescriptor(target, key)
        },
    })
    const source = new r.Chain(receiver, ctx)
    methodReads = 0
    assert.equal(r.run(source, [], "read", [], ctx, {}), 1)
    assert.equal(methodReads, 2, "Enumeration and value capture suffice for method selection")
}
console.log("20 receiver/export captures preserve aliases with one capture and copy per canonical node")
