import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { captureIdentity } from "../../src/captured-identity.js"

assert(global.gc)

function prepare(route, failed) {
    const ctx = { execution: new r.Execution(), errorContext: "discarded capture identity" }
    const gate = Promise.withResolvers()
    const known = r.createPoisonError(new Error("known failure"), ctx, r.ERROR_KIND.InvocationFailed)
    let calls = 0
    const value = { wait: gate.promise, known: failed ? known : 1 }
    if (route === "receiver") value.read = function () { calls++; return this.wait }
    const source = new r.Chain(value, ctx)
    const identity = captureIdentity(value, ctx)
    const refs = { source: new WeakRef(value), key: new WeakRef(identity), domain: new WeakRef(identity.domain) }
    let result
    if (route === "export") result = r.export(source, [], ctx)
    else if (route === "receiver") result = r.run(source, [], "read", [], ctx, {})
    else {
        const target = new r.Chain(r.externalState({ read(argument) { calls++; return argument.wait } }), ctx)
        result = r.run(target, [], "read", [value], ctx, {})
    }
    r.assignPath(source, [], null, ctx)
    return { ctx, gate, known, result, refs, calls: () => calls }
}

for (const stackLimit of [10, 1000]) {
    Error.stackTraceLimit = stackLimit
    for (const route of ["export", "receiver", "argument"]) for (const failed of [false, true]) {
        const work = prepare(route, failed)
        for (let turn = 0; turn < 16; turn++) { await new Promise(setImmediate); global.gc() }
        const label = `${route}, failed=${failed}, stack=${stackLimit}`
        assert.equal(work.refs.source.deref(), undefined, `Captured source retained: ${label}`)
        for (const name of ["key", "domain"])
            assert.equal(work.refs[name].deref() !== undefined, !failed, `Output ${name} lifetime: ${label}`)
        assert.equal(work.calls(), 0, `Invocation must wait for required input: ${label}`)
        const late = r.createPoisonError(new Error("late failure"), work.ctx, r.ERROR_KIND.InvocationFailed)
        work.gate.resolve(failed ? late : 2)
        const result = await work.result
        if (failed) assert.deepEqual(new Set(result.errors ?? [result]), new Set([work.known, late]))
        else if (route === "export") assert.deepEqual(result, { wait: 2, known: 1 })
        else { assert.equal(result, 2); assert.equal(work.calls(), 1) }
        assert.equal(work.ctx.execution.fatalError, null)
    }
}
console.log("Discarded capture keys/domains release while required Error collection continues; healthy controls retain them")
