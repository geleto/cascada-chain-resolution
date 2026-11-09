import assert from "node:assert/strict"
import { instrumentRuntime } from "../runtime-transform.js"

let counts
globalThis.statusRepairCounts = () => counts
const verifyInstrumentation = instrumentRuntime(new Map([["property-versions.js", [
    ["function createVersionFromPlacement(placement) {", "$&\n    globalThis.statusRepairCounts().versions++;"],
    ["function continueCapturedPromiseVersion(promise, promiseVersion, operationContext, onValue, operation, project) {",
        "$&\n    const measured = globalThis.statusRepairCounts(); measured.live++; let measuredClosed = false;"],
    ["const complete = () => {\n        unregister?.()",
        "const complete = () => {\n        if (!measuredClosed) { measuredClosed = true; measured.live-- }\n        unregister?.()"],
]]]))
const r = await import("../../src/index.js")
const { OrderedThenable } = await import("../ordered-thenable.js")
const { verifyRefCounts } = await import("../verify-refcounts.js")
verifyInstrumentation("Status repair work hooks must execute")
const samples = []
for (const size of [16, 64, 256]) for (const delivery of ["native", "ordered"]) {
    counts = { live: 0, versions: 0 }
    const ctx = { execution: new r.Execution(), errorContext: "status work" }
    const pending = delivery === "native" ? Promise.withResolvers() : new OrderedThenable()
    const chain = new r.Chain({ then: pending.promise ?? pending }, ctx)
    for (let i = 0; i < size; i++) {
        const failure = r.assignPath(chain, ["then"], () => i, ctx)
        assert.equal(r.lookupPath(chain, ["then"], ctx), failure)
        assert.equal(r.repairPath(chain, ["then"], ctx), undefined)
    }
    const issued = { ...counts }
    assert(issued.versions >= size, "Version instrumentation must execute")
    assert(issued.versions < size * 6, "Status publication work must remain linear")
    assert(issued.live <= 3, "Spent status history must not retain pending captures")
    if (delivery === "ordered") assert(pending.subscriptions <= 2, "Payload subscriptions must not grow with status history")
    pending.resolve({ n: 1 })
    assert.equal(await r.lookupPath(chain, ["then", "n"], ctx), 1)
    await new Promise(setImmediate)
    assert.equal(counts.live, 0)
    verifyRefCounts(ctx, chain._state)
    samples.push({ size, delivery, issued, settled: { ...counts } })
}
console.log(JSON.stringify(samples))
