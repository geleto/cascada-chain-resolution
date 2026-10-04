import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as r from "cascada-chain-resolution"
import { OrderedThenable, ChainedThenable } from "./ordered-thenable.js"

describe("captured publication failure boundaries", () => {
    it("fails execution when normalized publication readiness rejects", () => {
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/publication-rejection-audit.js", import.meta.url))],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    for (const delivery of ["native", "ordered", "chained", "synchronous"])
    for (const root of [false, true])
    for (const poison of [false, true]) {
        it(`preserves raw source rejection publication: ${delivery}, root=${root}, poison=${poison}`, async () => {
            const reports = [], execution = new r.Execution(error => reports.push(error))
            const initialization = { execution, errorContext: { delivery, root, poison } }
            const operation = { execution, errorContext: "later consumer" }
            const source = delivery === "native" ? Promise.withResolvers() :
                delivery === "chained" ? new ChainedThenable() : new OrderedThenable()
            const raw = new Error("Host input rejected")
            const reason = poison ? r.createPoisonError(raw, initialization, r.ERROR_KIND.ContextValueFailed) : raw
            if (delivery === "synchronous") source.reject(reason)
            const value = source.promise ?? source
            const chain = new r.ContextChain(root ? value : { value }, initialization)
            const result = r.lookupPath(chain, root ? [] : ["value"], operation)
            if (delivery !== "synchronous") source.reject(reason)
            const actual = await result
            assert(r.isPoisonError(actual))
            if (poison) assert.equal(actual, reason)
            else {
                assert.equal(actual.cause, raw)
                assert.equal(actual.errorContext, initialization.errorContext)
                assert.equal(actual.kind, r.ERROR_KIND.ContextValueFailed)
            }
            assert.equal(execution.fatalError, null)
            assert.deepEqual(reports, [])
            assert.equal(r.import(3, operation), 3)
        })
    }
})
