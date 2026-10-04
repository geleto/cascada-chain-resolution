import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as r from "cascada-chain-resolution"
import { OrderedThenable, ChainedThenable } from "./ordered-thenable.js"

describe("invocation completion failure boundaries", () => {
    it("fails execution for every normalized internal rejection, including poison", () => {
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/invocation-completion-failure.js", import.meta.url))],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    for (const delivery of ["native", "ordered", "chained", "synchronous"])
    for (const mutation of [false, true])
    for (const reason of ["raw", "poison"])
    for (const channel of ["reject", "fulfill"]) {
        it(`keeps host ${channel} failure recoverable: ${delivery}, mutation=${mutation}, ${reason}`, async () => {
            const reports = [], execution = new r.Execution(error => reports.push(error))
            const initialization = { execution, errorContext: "initialization" }
            const operation = { execution, errorContext: { delivery, mutation, reason, channel } }
            const source = delivery === "native" ? Promise.withResolvers() : delivery === "chained"
                ? new ChainedThenable() : new OrderedThenable()
            const cause = new Error("Host method failed")
            const failure = reason === "raw" ? cause : r.createPoisonError(cause, initialization,
                r.ERROR_KIND.InvocationFailed)
            const host = r.externalState({ value: 1, read() { return source.promise ?? source } })
            const chain = mutation ? new r.ContextChain({ api: host }, initialization, { api: {} })
                : new r.Chain(host, initialization)
            const path = mutation ? ["api"] : []
            if (delivery === "synchronous") source[channel === "reject" ? "reject" : "resolve"](failure)
            const result = r.run(chain, path, "read", [], operation, mutation ? { mutationScopeDepth: 1 } : {})
            assert.equal(result instanceof Promise, delivery !== "synchronous")
            if (delivery !== "synchronous") source[channel === "reject" ? "reject" : "resolve"](failure)
            const actual = await result
            assert(r.isPoisonError(actual))
            if (reason === "poison") assert.equal(actual, failure)
            else {
                assert.equal(actual.cause, cause)
                assert.equal(actual.kind, r.ERROR_KIND.InvocationFailed)
                assert.equal(actual.errorContext, operation.errorContext)
            }
            if (mutation) {
                assert.equal(r.lookupPath(chain, path, operation), actual)
                r.repairPath(chain, path, operation)
                assert.equal(r.lookupPath(chain, [...path, "value"], operation), 1)
            } else assert.equal(r.lookupPath(chain, ["value"], operation), 1)
            assert.equal(execution.fatalError, null)
            assert.deepEqual(reports, [])
            assert.equal(r.import(3, operation), 3)
        })
    }
})
