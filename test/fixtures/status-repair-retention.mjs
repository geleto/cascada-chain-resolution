import assert from "node:assert/strict"
import * as r from "../../src/index.js"

assert(globalThis.gc)
Error.stackTraceLimit = 1000
function issue() {
    const ctx = { execution: new r.Execution(), errorContext: "retained status diagnostic" }
    const data = { n: 1 }, healthy = { n: 2 }
    const chain = new r.Chain({ then: data, healthy }, ctx)
    const failure = r.assignPath(chain, ["then"], () => 0, ctx)
    return { ctx, chain, failure, data: new WeakRef(data), healthy: new WeakRef(healthy) }
}
async function collect() {
    for (let turn = 0; turn < 12; turn++) {
        await new Promise(setImmediate)
        globalThis.gc()
    }
}
const held = issue()
await collect()
assert(held.data.deref(), "A live flagged placement retains its current data")
assert(held.healthy.deref(), "Healthy owner control retains data")
assert.equal(r.repairPath(held.chain, ["then"], held.ctx), undefined)
assert.equal(r.lookupPath(held.chain, ["then", "n"], held.ctx), 1)
r.deletePath(held.chain, ["then"], held.ctx)
await collect()
assert.equal(held.data.deref(), undefined, "Retaining the unformatted diagnostic must not retain its former data")
assert(held.healthy.deref(), "Unrelated live data remains retained")
r.deletePath(held.chain, [], held.ctx)
await collect()
assert.equal(held.healthy.deref(), undefined)
assert.equal(held.failure.kind, r.ERROR_KIND.PropertyValidation)
console.log("Retained diagnostic and healthy-owner controls passed")
