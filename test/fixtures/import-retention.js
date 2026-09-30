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

// Complete incoming relationships retain this imported ancestor through its
// surviving child. Retirement and imported host obligations are Phase 2 work.
let collected = false
for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(setImmediate)
    global.gc()
    if (ancestor.deref() === undefined) { collected = true; break }
}
assert(!collected, "The imported child's current parent relationship was lost")
pending.resolve(7)
assert.equal(await runtime.lookupPath(child, ["value"], ctx), 7)
assert.equal(ctx.execution.fatalError, null)
