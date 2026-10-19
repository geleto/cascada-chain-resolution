// Strict source-owner lifetime witness. Production currently fails its ready
// cases at 50 frames. The pending cases are controls, not expected failures.
// node --expose-gc --stack-trace-limit=50 test/experiments/phase4-path-release.mjs
import assert from "node:assert/strict"
import * as r from "../../src/index.js"

assert(global.gc, "Run with --expose-gc")
const turn = () => new Promise(setImmediate)

async function issue(array, ready) {
    const ctx = { execution: new r.Execution(), errorContext: `lookup array=${array}, ready=${ready}` }
    const resource = r.externalState({})
    const authority = new r.ContextChain({ resource }, ctx, { resource: {} })
    const pending = Promise.withResolvers()
    const root = array ? [pending.promise, { payload: 1 }]
        : { value: pending.promise, payload: { n: 1 } }
    let holder = new r.Chain(r.import(root, ctx), ctx)
    if (ready) {
        pending.resolve(resource)
        await turn()
    }
    const output = r.lookupPath(holder, [array ? 0 : "value"], ctx)
    if (!ready) pending.resolve(resource)
    const error = await output
    assert.equal(error.kind, r.ERROR_KIND.ExternalLocationConflict)
    assert.equal(error.errorContext, ctx.errorContext)
    holder = undefined
    return { ctx, authority, error, weak: new WeakRef(root) }
}

const states = []
for (const array of [false, true]) for (const ready of [false, true])
    states.push(await issue(array, ready))
for (let index = 0; index < 30; index++) { await turn(); global.gc() }
assert.deepEqual(states.filter(state => state.weak.deref()).map(state => state.ctx.errorContext), [],
    "A completed lookup Error retains its former source holder")
console.log(`${states.length} ready/pending path source-release cases passed`)
