import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { IdentityPublication, inheritIdentity, captureIdentity } from "../../src/captured-identity.js"

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
    assert.equal(r.isPending(result, ctx), route === "export")
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

function snapshot(value, ctx) {
    const host = new r.ContextChain({ api: r.externalState({ value }) }, ctx, { api: {} })
    const result = r.lookupPath(host, ["api", "value"], ctx)
    assert(!r.isPending(result, ctx))
    r.assignPath(host, [], undefined, ctx)
    return result
}

// A shared pending cell must retain neither discarded snapshot copies nor a
// history of their keys/domains. Keep live values as controls for this check.
const ctx = { execution: new r.Execution(), errorContext: "snapshot identity release" }
const a = new r.Chain({ n: 7 }, ctx), b = new r.Chain({ n: 7 }, ctx)
const left = r.lookupPath(a, [], ctx), right = r.lookupPath(b, [], ctx)
inheritIdentity(left, right, ctx)
const publication = new IdentityPublication(ctx)
publication.capture(right)
publication.suspend()
const discarded = [], history = []
function discardSnapshot() {
    const held = new r.Chain(snapshot([left, right], ctx), ctx)
    const value = r.lookupPath(held, [], ctx), key = captureIdentity(r.lookupPath(held, [1], ctx), ctx)
    discarded.push(new WeakRef(value), new WeakRef(key), new WeakRef(key.domain))
    r.assignPath(held, [], undefined, ctx)
}
for (let i = 0; i < 128; i++) discardSnapshot()
const live = new r.Chain(snapshot([left, right], ctx), ctx)
const liveKey = captureIdentity(r.lookupPath(live, [1], ctx), ctx)
const repeated = new r.Chain(snapshot([left, right], ctx), ctx)
function recapture() {
    const key = captureIdentity(r.lookupPath(repeated, [1], ctx), ctx)
    history.push(new WeakRef(key), new WeakRef(key.domain))
    r.assignPath(repeated, [], snapshot(r.lookupPath(repeated, [], ctx), ctx), ctx)
}
for (let i = 0; i < 256; i++) recapture()
assert.equal(captureIdentity(right, ctx).cell.queries?.size ?? 0, 0,
    "Copying creates no identity completion subscriptions")
for (let i = 0; i < 20; i++) { await new Promise(setImmediate); global.gc() }
assert(discarded.every(ref => ref.deref() === undefined), "Discarded values, keys and domains must collect")
assert(history.every(ref => ref.deref() === undefined), "A snapshot must not retain preceding snapshot keys or domains")
assert.equal(captureIdentity(r.lookupPath(live, [1], ctx), ctx), liveKey)
publication.finish(false)
for (const held of [live, repeated]) {
    const output = await r.export(held, [], ctx)
    assert.equal(output[0], output[1])
    assert.deepEqual(output[0], { n: 7 })
}
console.log("Snapshot sources and discarded identities collect before pending identity completion")
