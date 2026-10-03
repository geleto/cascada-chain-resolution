import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"

const ctx = { execution: new runtime.Execution(), errorContext: {} }
const pending = Promise.withResolvers()
const { ancestor, child } = capture()

function capture() {
    const root = { child: { value: pending.promise }, unrelated: { value: 1 } }
    runtime.import(root, ctx)
    return { ancestor: new WeakRef(root), child: new runtime.Chain(root.child, ctx) }
}

// The child has its own holder. The abandoned ancestor and its reverse edges
// retire without cancelling the child's independent pending publication.
let collected = false
for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(setImmediate)
    global.gc()
    if (ancestor.deref() === undefined) { collected = true; break }
}
assert(collected, "A retained child keeps its discarded ancestor alive")
pending.resolve(7)
assert.equal(await runtime.lookupPath(child, ["value"], ctx), 7)
assert.equal(ctx.execution.fatalError, null)
