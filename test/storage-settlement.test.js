import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import { buildRefIndex } from "../src/refcounts.js"
import { ready } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new runtime.Execution(), errorContext: {} })

describe("optional storage synchronization", () => {
    for (const array of [false, true]) {
        for (const entryDepth of [0, 1, 2]) {
            for (const indexed of [false, true]) {
                for (const refusal of ["throw", "false"]) {
                    it(`keeps pending assignment committed: array=${array}, entry=${entryDepth}, indexed=${indexed}, refusal=${refusal}`, async () => {
                        const ctx = context(), later = Promise.withResolvers()
                        const key = array ? "1" : "value"
                        const physical = array ? [10, 1] : { sibling: 10, value: 1 }
                        let refusals = 0
                        const source = new Proxy(physical, {
                            set(target, property, value, receiver) {
                                if (property === key && value === 2) {
                                    refusals++
                                    if (refusal === "throw") throw new Error("refused cache write")
                                    return false
                                }
                                return Reflect.set(target, property, value, receiver)
                            },
                        })
                        const chain = new runtime.Chain(source, ctx)
                        if (indexed) buildRefIndex(source, ctx)
                        const assign = (chain, path, depth) => depth
                            ? runtime.enter(chain, path, ctx, true, inside => assign(inside, [], depth - 1))
                            : runtime.assignPath(chain, path, later.promise, ctx)
                        await assign(chain, [key], entryDepth)
                        assert.equal(physical[key], later.promise, "Issuance commits the pending value")
                        const observed = runtime.lookupPath(chain, [key], ctx)
                        later.resolve(2)
                        assert.equal(await observed, 2)
                        assert(refusals > 0, "The test must exercise refused settlement storage")
                        assert.equal(physical[key], later.promise)
                        assert.equal(runtime.lookupPath(chain, [key], ctx), 2)
                        // Exercise the next mutation before export/query diagnostics
                        // can add sharing or build an otherwise absent index.
                        runtime.assignPath(chain, [key], 3, ctx)
                        assert.equal(runtime.repairPath(chain, [key], ctx), undefined)
                        assert.equal(runtime.lookupPath(chain, [key], ctx), 3)
                        assert.equal(runtime.getErrors(chain, [], ctx), null)
                        assert.deepEqual(runtime.export(chain, [], ctx), array ? [10, 3] : { sibling: 10, value: 3 })
                        assert.equal(ctx.execution.fatalError, null)
                        verifyRefCounts(ctx, chain._state)
                    })
                }
            }
        }
    }

    it("normalizes synchronous thenable storage even when its optional cache write is refused", () => {
        const ctx = context(), input = ready(2)
        const physical = { value: input }
        const chain = new runtime.Chain(new Proxy(physical, {
            set() { throw new Error("refused cache write") },
        }), ctx)
        assert.equal(runtime.lookupPath(chain, ["value"], ctx), 2)
        assert.equal(physical.value, input)
        assert.equal(runtime.getErrors(chain, [], ctx), null)
        assert.deepEqual(runtime.export(chain, [], ctx), { value: 2 })
        verifyRefCounts(ctx, chain._state)
    })

    it("propagates fatal failure from an optional storage action", async () => {
        const ctx = context(), later = Promise.withResolvers()
        let fatal
        try { runtime.failExecution(context(), new Error("host fatal")) }
        catch (failure) { fatal = failure }
        const chain = new runtime.Chain(new Proxy({ value: later.promise }, {
            set() { throw fatal },
        }), ctx)
        const observed = runtime.lookupPath(chain, ["value"], ctx)
        later.resolve(2)
        await assert.rejects(observed, error => error === fatal)
        assert.equal(ctx.execution.fatalError, fatal)
    })

    it("prepares a native managed receiver from its logical value after refused synchronization", async () => {
        const ctx = context(), later = Promise.withResolvers()
        const physical = { value: later.promise, read() { return this.value } }
        const chain = new runtime.Chain(new Proxy(physical, {
            set() { throw new Error("refused cache write") },
        }), ctx)
        const observed = runtime.lookupPath(chain, ["value"], ctx)
        later.resolve(2)
        assert.equal(await observed, 2)
        assert.equal(physical.value, later.promise)
        assert.equal(runtime.run(chain, [], "read", [], ctx, {}), 2)
        assert.equal(ctx.execution.fatalError, null)
        verifyRefCounts(ctx, chain._state)
    })
})
