import assert from "node:assert/strict"
import * as r from "cascada-chain-resolution"
import { OrderedThenable, ChainedThenable } from "./ordered-thenable.js"

describe("partial import progress", () => {
    for (const separate of [false, true]) for (const rejects of [false, true])
    for (const delivery of ["native", "ordered", "chained"]) {
        it(`exposes independent ready data: separate=${separate}, rejects=${rejects}, ${delivery}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "partial import" }
            const pending = delivery === "native" ? Promise.withResolvers() :
                delivery === "ordered" ? new OrderedThenable() : new ChainedThenable()
            const input = pending.promise ?? pending
            const root = new r.Chain(r.import(separate ? input : { first: input, second: { value: 7 } }, ctx), ctx)
            const later = separate ? new r.Chain(r.import({ value: 7 }, ctx), ctx) : root
            const ready = r.lookupPath(later, separate ? ["value"] : ["second", "value"], ctx)
            // No dependency on the earlier input: its producer can use this result.
            assert.equal(ready, 7)
            const cause = new Error("first input")
            if (rejects) pending.reject(cause)
            else pending.resolve({ value: ready + 1 })
            const first = await r.lookupPath(root, separate ? [] : ["first"], ctx)
            if (rejects) {
                assert(r.isPoisonError(first))
                assert.equal(first.cause, cause)
                assert.equal(first.errorContext, ctx.errorContext)
            } else assert.equal(first.value, 8)
            assert.equal(r.lookupPath(later, separate ? ["value"] : ["second", "value"], ctx), 7)
            assert.equal(ctx.execution.fatalError, null)
        })
    }
})
