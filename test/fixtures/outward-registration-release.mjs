import assert from "node:assert/strict"
import * as r from "../../src/index.js"

async function collect() {
    for (let turn = 0; turn < 30; turn++) {
        await new Promise(setImmediate)
        global.gc()
    }
}

async function completed(reject, retained) {
    const ctx = { execution: new r.Execution(), errorContext: "completed outward registration" }
    const source = Promise.withResolvers()
    const chain = new r.Chain(source.promise, ctx)
    const result = reject ? r.lookupPathForExpression(chain, [], ctx) : r.export(chain, [], ctx)
    assert(r.isPending(result, ctx), "The operation must own a pending outward result")
    source.resolve(reject ? null : { payload: [1, 2, 3] })
    let value
    if (reject) {
        try { await result; assert.fail("Expected expression validation rejection") }
        catch (error) {
            assert.equal(error.kind, r.ERROR_KIND.InvalidExpressionValue)
            assert.equal(error.errorContext, ctx.errorContext)
            value = error
        }
    } else {
        value = await result
        assert.deepEqual(value, { payload: [1, 2, 3] })
    }
    assert.equal(ctx.execution.fatalError, null)
    return { ctx, reject, retained, weak: [new WeakRef(result), new WeakRef(value)],
        held: retained ? { result, value } : undefined }
}

function pending() {
    const ctx = { execution: new r.Execution(), errorContext: "live outward registration" }
    const source = Promise.withResolvers(), chain = new r.Chain(source.promise, ctx)
    const result = r.export(chain, [], ctx)
    let outcome
    result.then(value => { outcome = { value } }, error => { outcome = { error } })
    assert(r.isPending(result, ctx))
    return { ctx, source, result, outcome: () => outcome }
}

const states = []
for (const reject of [false, true]) for (const retained of [false, true])
    states.push(await completed(reject, retained))
const live = pending()
await collect()
for (const state of states) for (const weak of state.weak)
    assert.equal(weak.deref() !== undefined, state.retained,
        `Settled outward result leaves no fatal-rejector history: reject=${state.reject}, retained=${state.retained}`)
assert.equal(live.outcome(), undefined)
const cause = new Error("later fatal")
let fatal
assert.throws(() => r.failExecution(live.ctx, cause), error => {
    fatal = error
    return r.isFatalError(error) && error.cause === cause
})
await new Promise(setImmediate)
assert.equal(live.outcome().error, fatal, "A live registration rejects before its source is released")
live.source.resolve({ payload: [4] })
for (const state of states) {
    assert.equal(state.ctx.execution.fatalError, null, "Separate completed executions remain live")
    assert.equal(r.import(7, state.ctx), 7)
    state.held = undefined
}
await collect()
for (const state of states) for (const weak of state.weak)
    assert.equal(weak.deref(), undefined, "Released healthy results do not become settled execution history")
console.log("Four settled-result histories and live pending fatal control passed")
