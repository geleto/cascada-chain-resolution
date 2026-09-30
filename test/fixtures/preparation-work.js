import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { OrderedThenable } from "../ordered-thenable.js"
import { verifyParents } from "../verify-parents.js"
import * as trace from "../trace-state.js"

assert(trace.enabled)
const results = []
for (const size of [30, 100, 300]) {
    const ctx = { execution: new r.Execution(), errorContext: {} }
    const sources = Array.from({ length: size }, () => new OrderedThenable())
    const root = Object.fromEntries(sources.map((source, index) => [index, source]))
    let deliveries = 0
    function reveal(index) {
        sources[index].resolve({ trigger: {
            then(deliver) {
                deliveries++
                if (index) reveal(index - 1)
                return deliver(null)
            },
        } })
        sources[index].flush()
    }
    root.start = { then(deliver) { reveal(size - 1); return deliver(null) } }
    trace.reset()
    const chain = new r.Chain(root, ctx)
    const counts = trace.counts()
    assert.equal(deliveries, size)
    assert(sources.every(source => source.subscriptions === 1))
    results.push({ size, checks: counts.isPending })
    assert.equal(r.lookupPath(chain, [0, "trigger"], ctx), null)
    verifyParents(ctx, chain._state)
    await new Promise(setImmediate)
}
for (let i = 1; i < results.length; i++) {
    assert(results[i].checks / results[i - 1].checks <= results[i].size / results[i - 1].size + 0.1,
        `Readiness discovery must grow linearly: ${JSON.stringify(results)}`)
}
console.log(JSON.stringify(results))
