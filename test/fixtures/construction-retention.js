import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { OrderedThenable } from "../ordered-thenable.js"
import { trackCopies } from "../trace-state.js"

const ctx = { execution: new r.Execution(), errorContext: {} }
const pending = new OrderedThenable()
let armed = false, reads = 0
const source = new Proxy({ pending, bad: 1 }, {
    getOwnPropertyDescriptor(target, key) {
        if (armed && key === "bad" && ++reads === 2) throw new Error("copy failed")
        return Reflect.getOwnPropertyDescriptor(target, key)
    },
})
const chain = new r.Chain(source, ctx)
const retained = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
const copies = trackCopies()
armed = true
r.assignPath(chain, ["next"], 2, ctx)
assert.equal(copies.length, 1)
armed = false
for (let turn = 0; turn < 20; turn++) {
    await new Promise(resolve => setImmediate(resolve))
    global.gc()
}
assert.equal(copies[0].deref(), undefined, "A discarded destination is retained by a pending copy callback")
pending.resolve({ done: true })
assert.deepEqual(await r.export(retained, ["pending"], ctx), { done: true })

// Error stack frames can retain a preparation receiver as well as pending
// callbacks. Keep the failure observable while proving its input can be freed.
const failedPending = new OrderedThenable()
function failInspection() { throw new Error("failed input inspection") }
function captureFailedInput() {
    const root = { pending: failedPending, unrelated: {}, bad: new Proxy({}, { ownKeys: failInspection }) }
    return { root: new WeakRef(root), unrelated: new WeakRef(root.unrelated), error: r.import(root, ctx) }
}
const failed = captureFailedInput()
assert(r.isPoisonError(failed.error))
for (let turn = 0; turn < 20; turn++) {
    await new Promise(setImmediate)
    global.gc()
}
assert.equal(failed.root.deref(), undefined, "Failed preparation retains its root through a callback or Error stack")
assert.equal(failed.unrelated.deref(), undefined, "Failed preparation retains unrelated input")
const late = {}
failedPending.resolve(late)
failedPending.flush()
assert.equal(ctx.execution._metadata.get(late), undefined)
assert.equal(ctx.execution.fatalError, null)
