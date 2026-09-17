import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { OrderedThenable } from "../ordered-thenable.js"
import { verifyRefCounts } from "../verify-refcounts.js"

let cases = 0
for (const count of [2, 3]) for (const reverse of [false, true]) for (const rejects of [false, true]) {
    for (const delivery of ["native", "synchronous"]) for (const route of ["entry", "nested", "push", "borrowed", "view", "fork"]) {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const chain = new r.Chain({ list: [1, , 3] }, ctx), expected = [1, , 3]
        const lengths = [2, 4, 1].slice(0, count), sources = [], cause = new Error("length failure")
        for (const length of lengths) {
            const source = delivery === "native" ? Promise.withResolvers() : new OrderedThenable()
            if (delivery === "synchronous") source.flushOnSubscribe = true
            const promise = delivery === "native" ? source.promise : source
            // A failed predecessor may legitimately leave a later input unused.
            promise.then(() => {}, () => {})
            r.assignPath(chain, ["list", "length"], promise, ctx)
            sources.push(source)
            await Promise.resolve()
        }
        let captured
        if (route === "borrowed") captured = new r.Chain(r.importMethodResult(r.lookupPath(chain, [], ctx), ctx), ctx)
        if (route === "fork") captured = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
        if (route === "view") captured = new r.Chain(r.run(chain, ["list"], "slice", [], ctx, {}), ctx)
        const entry = r.enter(chain, ["list"], ctx, true, inside => {
            if (route === "nested") return r.enter(inside, [], ctx, true, () => {})
            if (route === "push") return r.run(inside, [], "push", [8], ctx, { mutationScopeDepth: 0 })
        })
        await Promise.resolve()
        const order = sources.map((_, index) => index)
        if (reverse) order.reverse()
        for (const index of order) {
            if (rejects && index === count - 1) sources[index].reject(cause)
            else sources[index].resolve(lengths[index])
            // An unresolved next length must not stop unrelated event-loop work.
            await new Promise(setImmediate)
        }
        for (const length of rejects ? lengths.slice(0, -1) : lengths) expected.length = length
        await entry
        const result = await r.export(chain, ["list"], ctx)
        if (rejects) {
            assert.equal(result.cause, cause)
            await r.repairPath(chain, ["list"], ctx)
            assert.deepStrictEqual(await r.export(chain, ["list"], ctx), expected)
        } else {
            if (route === "push") expected.push(8)
            assert.deepStrictEqual(result, expected)
        }
        if (captured) {
            const value = await r.export(captured, route === "view" ? [] : ["list"], ctx)
            if (rejects) assert.equal(value.cause, cause)
            else assert.deepStrictEqual(value, expected)
            verifyRefCounts(ctx, captured._state)
        }
        assert.equal(ctx.execution.fatalError, null)
        verifyRefCounts(ctx, chain._state)
        cases++
    }
}
console.log(`${cases} cases passed`)
