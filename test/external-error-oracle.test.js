import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { ExternalErrorOracle } from "./external-error-oracle.js"

describe("external sequence Error oracle", () => {
    it("validates failures first observed after a queued write returned", async () => {
        const oracle = new ExternalErrorOracle(), execution = new r.Execution()
        const setup = { execution, errorContext: {} }
        const api = r.externalState({ db: r.externalState({ value: 0 }) })
        const chain = new r.ContextChain({ api }, setup, { api: { db: {} } })
        const hold = Promise.withResolvers()
        const entry = r.enter(chain, ["api"], setup, true, () => hold.promise)
        const command = { seq: 1, creates: "ExternalLocationConflict" }
        const ctx = oracle.context(execution, command)
        assert.equal(r.assignPath(chain, ["api", "db", "value"], 1, ctx, 2, 1), undefined)
        const captured = r.getErrors(chain, ["api"], setup)
        hold.resolve()
        await entry
        const poison = await captured
        assert.equal(oracle.identify(poison), "E:1")
        assert.equal(oracle.identify(await r.getErrors(chain, ["api"], setup)), "E:1")
        assert.throws(() => oracle.identify(r.validationError("wrong kind", ctx, "InvalidArrayLength")), /Error kind/)
        assert.throws(() => oracle.identify(r.validationError("replacement wrapper", ctx, command.creates)), /Error identity/)
    })

    it("rejects a wrong cause or unknown source even without an earlier Error witness", () => {
        const oracle = new ExternalErrorOracle(), execution = new r.Execution()
        const command = { seq: 1, creates: "InvocationFailed" }
        const ctx = oracle.context(execution, command)
        const cause = oracle.failure(1, "native failure")
        assert.throws(() => oracle.identify(r.createPoisonError(new Error("native failure"), ctx, command.creates)), /Error cause/)
        assert.throws(() => oracle.identify(r.createPoisonError(cause, { execution, errorContext: {} }, command.creates)), /unknown source/)
        const poison = r.createPoisonError(cause, ctx, command.creates)
        assert.equal(oracle.identify(poison), "E:1")
        assert.equal(oracle.identify(poison), "E:1")
    })

    it("requires a local failure to belong to its consuming command", () => {
        const oracle = new ExternalErrorOracle(), execution = new r.Execution()
        const command = { seq: 1 }, later = { seq: 2 }
        const ctx = oracle.context(execution, command)
        const poison = r.validationError("dynamic selection", ctx, "ExternalLocationConflict")
        assert.throws(() => oracle.identify(poison, later), /another command/)
        assert.equal(oracle.identify(poison, command), "L:ExternalLocationConflict")
    })
})
