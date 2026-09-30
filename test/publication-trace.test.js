import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const tracer = new URL("./trace-runtime.js", import.meta.url).href
describe("publication route instrumentation", () => {
    it("detects host activity during preparation commit", () => {
        const result = spawnSync(process.execPath, ["--import", tracer, "--input-type=module", "-e",
            'import {Execution} from "./src/index.js"; import {runExternalAction} from "./src/error.js"; import * as trace from "./test/trace-state.js"; trace.enter("commitPreparedInput",[]); runExternalAction({execution:new Execution(),errorContext:{}},()=>{});'],
        { encoding: "utf8", timeout: 10000 })
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /Preparation commit invoked runExternalAction/)
    })

    it("skips batch commit for already prepared input roots", () => {
        const result = spawnSync(process.execPath, ["--import", tracer, "--input-type=module", "-e",
            'import * as r from "./src/index.js"; import * as trace from "./test/trace-state.js"; const ctx={execution:new r.Execution(),errorContext:{}}; const value=r.import({child:{}},ctx); trace.reset(); const chain=new r.Chain(value,ctx); r.import(value,ctx); r.assignPath(chain,[],value,ctx); console.log(JSON.stringify(trace.counts()));'],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stderr)
        assert.equal(JSON.parse(result.stdout).commitPreparedInput, undefined)
    })

    it("releases discarded construction and failed preparation while delivery stays pending", () => {
        const result = spawnSync(process.execPath, ["--import", tracer, "--expose-gc", "--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/construction-retention.js", import.meta.url))],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stderr)
    })

    it("bounds reverse-order preparation delivery without pending-frontier polling", () => {
        const result = spawnSync(process.execPath, ["--import", tracer, "--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/preparation-work.js", import.meta.url))],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stderr)
        const counts = JSON.parse(result.stdout)
        assert.equal(counts.length, 3)
    })

    it("detects an omitted publication boundary in an isolated instrumented load", () => {
        const result = spawnSync(process.execPath, ["--import", tracer, "--input-type=module", "-e",
            'import {Chain,Execution} from "./src/index.js"; new Chain({}, {execution:new Execution(),errorContext:{}})'],
        { encoding: "utf8", timeout: 10000, env: { ...process.env, CASCADA_TRACE_OMIT_BOUNDARY: "replacePlacement" } })
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /Untracked placement route: writeLanguageProperty/)
    })

    it("detects child admission being repaired by an ordinary read", () => {
        const result = spawnSync(process.execPath, ["--import", tracer, "--input-type=module", "-e",
            'import * as r from "./src/index.js"; const ctx={execution:new r.Execution(),errorContext:{}}; const child={}; const chain=new r.Chain({child},ctx); ctx.execution._metadata.delete(child); r.lookupPath(chain,["child"],ctx)'],
        { encoding: "utf8", timeout: 10000 })
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /Ordinary read first admitted a managed child/)
    })
})
