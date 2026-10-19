// Phase 4's identity-only waits must use the ordinary fatal result boundary.
// Isolate identity availability using the same publication seam as identity-work.
import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { IdentityPublication, inheritIdentity } from "../../src/captured-identity.js"

let cases = 0
for (const route of ["export", "receiver", "argument", "snapshot-lookup", "snapshot-export"])
for (const settledFirst of [false, true]) {
    const reports = [], execution = new r.Execution(failure => reports.push(failure))
    const ctx = { execution, errorContext: { route, settledFirst } }
    const original = new r.Chain({ n: 7 }, ctx), copy = new r.Chain({ n: 7 }, ctx)
    const left = r.lookupPath(original, [], ctx), right = r.lookupPath(copy, [], ctx)
    inheritIdentity(left, right, ctx)
    const publication = new IdentityPublication(ctx)
    publication.capture(right); publication.suspend()
    let calls = 0
    const pair = { left, right }, receiver = new r.Chain({ pair, same() {
        calls++; return this.pair.left === this.pair.right
    } }, ctx)
    const api = r.externalState({ pair, marker: 0, same(value) { calls++; return value.left === value.right } })
    const authority = new r.ContextChain({ api }, ctx, { api: {} })
    const held = new r.Chain(pair, ctx)
    const result = route === "export" ? r.export(held, [], ctx) :
        route === "receiver" ? r.run(receiver, [], "same", [], ctx, {}) :
        route === "argument" ? r.run(authority, ["api"], "same", [r.lookupPath(held, [], ctx)], ctx, {}) :
        (route === "snapshot-lookup" ? r.lookupPath : r.export)(authority, ["api", "pair"], ctx)
    assert(r.isPending(result, ctx), `${route} must actually wait for identity`)
    const outcome = Promise.resolve(result).then(value => ({ value }), failure => ({ failure }))
    if (route.startsWith("snapshot")) {
        assert.equal(r.assignPath(authority, ["api", "marker"], 2, ctx), undefined)
        assert.equal(api.marker, 2, "Snapshot identity waiting cannot retain native access")
    }
    let delivered
    if (settledFirst) {
        publication.finish(false)
        delivered = await outcome
        assert.equal(delivered.failure, undefined)
        if (route === "argument" || route === "receiver") assert.equal(delivered.value, true)
        else assert.equal(delivered.value.left, delivered.value.right)
    }
    const fatal = new r.FatalError(new Error("host propagates fatal"), ctx.errorContext)
    const thrower = new r.Chain(r.externalState({ fail() { throw fatal } }), ctx)
    assert.throws(() => r.run(thrower, [], "fail", [], ctx, {}), failure => failure === fatal)
    assert.deepEqual(reports, [fatal])
    if (!settledFirst) {
        assert.equal((await outcome).failure, fatal)
        publication.finish(false)
    } else assert.equal((await outcome).value, delivered.value)
    await new Promise(setImmediate)
    assert.equal(calls, settledFirst && (route === "argument" || route === "receiver") ? 1 : 0)
    assert.deepEqual(reports, [fatal])
    const other = { execution: new r.Execution(), errorContext: "independent execution" }
    assert.deepEqual(r.export(new r.Chain({ ok: true }, other), [], other), { ok: true })
    cases++
}
console.log(JSON.stringify({ cases }))
