import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { ready } from "../ordered-thenable.js"

let cases = 0
for (const route of [r.import, r.importMethodResult, value => value])
for (const timing of ["ready", "sync", "promise"]) {
    const ctx = { execution: new r.Execution(), errorContext: "input" }
    const value = new TypeError("data")
    const delivered = timing === "ready" ? value : timing === "sync" ? ready(value) : Promise.resolve(value)
    const chain = new r.Chain(route(delivered, ctx), ctx)
    assert.equal(await r.lookupPath(chain, [], ctx), value)
    assert.equal(await r.hasError(chain, [], ctx), false)
    assert.equal(await r.getErrors(chain, [], ctx), null)
    assert.equal(await r.export(chain, [], ctx), value)
    assert.equal(await r.run(chain, [], "toString", [], ctx, {}), "TypeError: data")
    const aliases = new r.Chain([value, value], ctx)
    assert.equal(r.run(aliases, [], "includes", [value], ctx, {}), true)
    assert.equal(r.run(aliases, [], "includes", [new TypeError("data")], ctx, {}), false)
    assert.deepEqual(r.export(aliases, [], ctx), [value, value])
    cases++
}
for (const external of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: "arguments" }
    const data = new AggregateError([new Error("detail")], "data")
    const object = {
        saved: data,
        inspect(input, wrapper) {
            assert.equal(this.saved, data)
            assert.equal(input, data)
            assert.equal(wrapper.alias, data)
            return input
        },
    }
    const chain = new r.Chain(external ? r.externalState(object) : object, ctx)
    assert.equal(await r.run(chain, [], "inspect", [data, { alias: data }], ctx, {}), data)
    assert.equal(r.hasError(chain, [], ctx), false)
    assert.equal(data.errors[0].message, "detail")
    cases++
}
for (const external of [false, true]) for (const result of ["data", "fulfilled", "poison", "throw", "reject"]) {
    const ctx = { execution: new r.Execution(), errorContext: "method" }
    const reason = new Error("payload")
    const poison = r.createPoisonError(reason, ctx, r.ERROR_KIND.InvocationFailed)
    const object = {
        value: 0,
        call() {
            this.value = 1
            this.saved = reason
            if (result === "throw") throw reason
            if (result === "reject") return Promise.reject(reason)
            return result === "fulfilled" ? Promise.resolve(reason) : result === "poison" ? poison : reason
        },
    }
    const chain = external ? new r.ContextChain({ api: r.externalState(object) }, ctx, { api: {} }) :
        new r.Chain(r.import(object, ctx), ctx)
    const path = external ? ["api"] : []
    const output = await r.run(chain, path, "call", [], ctx, { mutationScopeDepth: path.length })
    if (result === "data" || result === "fulfilled") {
        assert.equal(output, reason)
        assert.equal(await r.lookupPath(chain, [...path, "value"], ctx), 1)
        assert.equal(await r.lookupPath(chain, [...path, "saved"], ctx), reason)
        assert.equal(await r.hasError(chain, path, ctx), false)
    } else {
        assert(r.isPoisonError(output))
        assert.equal(output.cause, reason)
        assert(r.isPoisonError(await r.lookupPath(chain, path, ctx)))
        if (result === "poison") assert.equal(output, poison)
    }
    assert.equal(ctx.execution.fatalError, null)
    cases++
}
{
    const ctx = { execution: new r.Execution(), errorContext: "nested" }
    const data = new Error("data"), cause = new Error("poison")
    const poison = r.createPoisonError(cause, ctx, r.ERROR_KIND.OperationInputFailed)
    const signal = Promise.withResolvers()
    const chain = new r.Chain(r.import({ data, alias: data, pending: signal.promise }, ctx), ctx)
    const collected = r.getErrors(chain, [], ctx)
    signal.resolve(poison)
    assert.equal(await collected, poison)
    assert.equal(await r.lookupPath(chain, ["data"], ctx), data)
    assert.equal(await r.export(chain, [], ctx), poison)
    await r.deletePath(chain, ["pending"], ctx)
    const exported = await r.export(chain, [], ctx)
    assert.equal(exported.data, data)
    assert.equal(exported.data, exported.alias)
    cases++
}
console.log(JSON.stringify({ cases }))
