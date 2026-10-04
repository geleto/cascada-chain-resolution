import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as r from "cascada-chain-resolution"
import { OrderedThenable, ChainedThenable } from "./ordered-thenable.js"

describe("prepared input failure boundaries", () => {
    it("makes normalized argument preparation rejection fatal, including retained payloads", () => {
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/argument-preparation-failure.js", import.meta.url))],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    for (const route of ["length", "external rhs"])
    for (const delivery of ["ready", "native", "ordered", "chained", "synchronous"])
    for (const poison of [false, true]) {
        it(`preserves first reception of assignment failure: ${route}, ${delivery}, poison=${poison}`, async () => {
            const reports = [], execution = new r.Execution(error => reports.push(error))
            const initialization = { execution, errorContext: "initialization" }
            const operation = { execution, errorContext: { route, delivery, poison } }
            const raw = new Error("Assignment source failed")
            const original = r.createPoisonError(raw, initialization, r.ERROR_KIND.ContextValueFailed)
            const reason = poison ? original : raw
            const source = delivery === "ready" ? undefined : delivery === "native" ? Promise.withResolvers() :
                delivery === "chained" ? new ChainedThenable() : new OrderedThenable()
            if (delivery === "synchronous") source.reject(reason)
            const input = source ? source.promise ?? source : reason
            const host = r.externalState({ value: 1 })
            const chain = route === "length" ? new r.Chain([1, 2], initialization) :
                new r.ContextChain({ host }, initialization, { host: {} })
            r.assignPath(chain, route === "length" ? ["length"] : ["host", "value"], input, operation)
            const result = r.lookupPath(chain, route === "length" ? [] : ["host"], initialization)
            if (source && delivery !== "synchronous") source.reject(reason)
            const actual = await result
            assert(r.isPoisonError(actual))
            if (poison) assert.equal(actual, original)
            else {
                assert.equal(actual.cause, raw)
                assert.equal(actual.errorContext, operation.errorContext)
                assert.equal(actual.kind, route === "length" ? r.ERROR_KIND.AssignmentValueFailed :
                    r.ERROR_KIND.OperationInputFailed)
            }
            assert.equal(host.value, 1)
            assert.equal(execution.fatalError, null)
            assert.deepEqual(reports, [])
            assert.equal(r.import(3, operation), 3)
        })
    }
})
