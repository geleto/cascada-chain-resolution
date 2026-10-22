// Terminal invocation cleanup across fulfillment, rejection and invalid state.
// Run with: node --expose-gc test/fixtures/terminal-release.mjs
import assert from "node:assert/strict"
import * as r from "../../src/index.js"

assert(global.gc, "Run with --expose-gc")
const turn = () => new Promise(setImmediate)
const states = []
for (const mutation of [false, true])
for (const mode of ["ready-error", "throw", "native-error", "native-reject", "ordered-error", "ordered-reject"]) {
    const ctx = { execution: new r.Execution(), errorContext: `${mode}, mutation=${mutation}` }
    const cause = new Error("prebuilt failure")
    const poison = r.createPoisonError(cause, ctx, r.ERROR_KIND.InvocationFailed)
    const signal = Promise.withResolvers()
    let root, child
    const chain = new r.Chain({
        child: { payload: new Array(10000).fill(1) },
        change(record, finish) { record(this); return finish() },
    }, ctx)
    const output = r.run(chain, [], "change", [
        value => { root = new WeakRef(value); child = new WeakRef(value.child) },
        () => {
            if (mode === "ready-error") return poison
            if (mode === "throw") throw cause
            if (mode === "ordered-error") return { then(resolve) { return resolve(poison) } }
            if (mode === "ordered-reject") return { then(_resolve, reject) { return reject(cause) } }
            return signal.promise
        },
    ], ctx, mutation ? { mutationScopeDepth: 0 } : {})
    if (mode === "native-reject" || mode === "native-error") {
        for (let index = 0; index < 15; index++) { await turn(); global.gc() }
        if (mutation) assert(root.deref() && child.deref(), "Unfinished mutation must retain its working receiver")
        if (mode === "native-reject") signal.reject(cause)
        else signal.resolve(poison)
    }
    const error = await output
    assert(r.isPoisonError(error))
    assert.equal(error.cause, cause)
    assert.equal(error.errorContext, ctx.errorContext)
    if (mutation) {
        assert.equal(r.lookupPath(chain, [], ctx), error)
        assert.equal(r.repairPath(chain, [], ctx), undefined)
    } else assert.equal(r.hasError(chain, [], ctx), false)
    states.push({ mode: ctx.errorContext, ctx, chain, error, root, child })
}
for (const pendingResult of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: `invalid receiver, pending result=${pendingResult}` }
    const pending = Promise.withResolvers()
    let root, child
    const chain = new r.Chain({ child: { payload: [1, 2, 3] }, change(record, finish) {
        record(this)
        this.bad = Promise.resolve(1)
        return finish()
    } }, ctx)
    const error = r.run(chain, [], "change", [
        value => { root = new WeakRef(value); child = new WeakRef(value.child) },
        () => pendingResult ? { later: pending.promise } : { ok: 1 },
    ], ctx, { mutationScopeDepth: 0 })
    assert.equal(error.kind, r.ERROR_KIND.InvalidManagedReceiver)
    assert.equal(r.lookupPath(chain, [], ctx), error)
    assert.equal(r.repairPath(chain, [], ctx), undefined)
    states.push({ mode: ctx.errorContext, ctx, chain, error, pending, root, child })
}
// Keep executions, repaired holders and unformatted Errors alive. Only the
// discarded private working copies have reached their last use.
for (let index = 0; index < 30; index++) { await turn(); global.gc() }
const retained = states.filter(state => state.root.deref() || state.child.deref()).map(state => state.mode)
assert.deepEqual(retained, [], "Terminal failure retained a discarded working receiver")
console.log(`${states.length} terminal invocation release cases passed`)
