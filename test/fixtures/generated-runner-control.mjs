import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import * as trace from "../trace-state.js"
import { reportGeneratedStage, runGeneratedCases } from "../generated-runner.js"

const scenario = process.env.CASCADA_RUNNER_CONTROL ?? "failures"
const cases = scenario === "failures"
    ? [{ id: "before" }, { id: "first", fail: true }, { id: "between" }, { id: "second", fail: true }, { id: "after" }]
    : scenario === "success" ? [{ id: "first" }, { id: "second" }]
        : [{ id: "before" }, { id: scenario, [scenario]: true }, { id: "after" }]
const receipts = []
const totals = await runGeneratedCases({ moduleURL: import.meta.url, cases,
    async runCase(spec) {
        let receipt
        const modes = ["control", "later-control"]
        for (const [modeIndex, mode] of modes.entries()) {
            reportGeneratedStage({ seed: spec.id, harness: mode, remainingReplays: modes.slice(modeIndex + 1) })
            assert.equal(globalThis.contaminated, undefined, "failed worker cannot contaminate another case")
            const ctx = { execution: new r.Execution(), errorContext: spec.id }
            const chain = new r.Chain(r.import({ value: spec.id }, ctx), ctx)
            assert.deepEqual(r.export(chain, [], ctx), { value: spec.id })
            if (spec.fail || spec.escape || spec.deadline) globalThis.contaminated = chain
            if (spec.fail) assert.fail(`scripted failure ${spec.id}; pid=${process.pid}`)
            if (spec.escape) {
                setImmediate(() => { throw new Error(`scripted escaped failure; pid=${process.pid}`) })
                await new Promise(() => {})
            }
            if (spec.deadline) while (true) await Promise.resolve()
            receipt = { id: spec.id, pid: process.pid, traceEnabled: trace.enabled,
                preparations: trace.counts().prepareInput ?? 0 }
        }
        return receipt
    },
    onPass(receipt) { receipts.push(receipt) },
})
console.log(JSON.stringify({ receipts, ...totals }))
