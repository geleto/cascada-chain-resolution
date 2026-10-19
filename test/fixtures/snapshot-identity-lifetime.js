import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { IdentityPublication, inheritIdentity } from "../../src/captured-identity.js"

assert(global.gc)
function pendingSnapshot(route) {
    const ctx = { execution: new r.Execution(), errorContext: "snapshot source release" }
    const a = new r.Chain({ value: 7 }, ctx), b = new r.Chain({ value: 7 }, ctx)
    const left = r.lookupPath(a, [], ctx), right = r.lookupPath(b, [], ctx)
    inheritIdentity(left, right, ctx)
    // Isolate identity-only waiting from data writers which legitimately retain
    // sources. The production Phase 3 publication retains only keys on suspend.
    const publication = new IdentityPublication(ctx)
    publication.capture(right)
    publication.suspend()
    const pair = { a: left, b: right }
    const api = r.externalState({ pair })
    const chain = new r.ContextChain({ api }, ctx, { api: {} })
    const result = (route === "lookup" ? r.lookupPath : r.export)(chain, ["api", "pair"], ctx)
    assert(r.isPending(result, ctx))
    const held = route === "lookup" ? new r.Chain(result, ctx) : undefined
    assert.equal(r.assignPath(chain, ["api", "pair"], null, ctx), undefined)
    r.assignPath(a, [], null, ctx)
    r.assignPath(b, [], null, ctx)
    return { ctx, publication, result, held, refs: [pair, left, right].map(value => new WeakRef(value)) }
}
for (const route of ["lookup", "export"]) {
    const work = pendingSnapshot(route)
    for (let i = 0; i < 16; i++) { await new Promise(setImmediate); global.gc() }
    assert(work.refs.every(ref => ref.deref() === undefined), `${route}: captured sources retained during identity-only wait`)
    work.publication.finish(false)
    const output = work.held ? await r.export(work.held, [], work.ctx) : await work.result
    assert.equal(output.a, output.b)
    assert.deepEqual(output.a, { value: 7 })
}
console.log("Both snapshot routes release captured sources before identity completion")
