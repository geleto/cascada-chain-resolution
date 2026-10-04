// Fail runtime classification logic while valid public reads copy external state.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

let fault, remaining, reached
globalThis.injectSnapshotClassificationFailure = () => {
    if (!fault || --remaining !== 0) return
    const cause = fault
    fault = undefined
    reached = true
    throw cause
}
const target = new URL("../../src/meta.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== target) return result
    const source = String(result.source)
    const marker = "    if (prototype === Object.prototype) return true"
    assert(source.includes(marker), "Snapshot classification fault anchor needs updating")
    return { ...result, source: source.replace(marker,
        "    globalThis.injectSnapshotClassificationFailure()\n" + marker) }
} })
const r = await import("../../src/index.js")

for (const delivery of ["ready", "pending"])
for (const route of ["lookup", "export"])
for (const probe of [1, 2])
for (const reason of ["Error", "PoisonError"]) {
    const label = `${delivery} ${route} probe=${probe} ${reason}`
    const reports = [], execution = new r.Execution(error => reports.push(error))
    const ctx = { execution, errorContext: label }
    const initialize = { execution, errorContext: "initialization" }
    const signal = delivery === "pending" ? Promise.withResolvers() : undefined
    const data = { value: 1 }
    const native = r.externalState({ data: signal?.promise ?? data, changes: 0 })
    const chain = new r.ContextChain({ api: native }, initialize, { api: {} })
    const sibling = r.import(new Promise(() => {}), initialize)
    const siblingOutcome = sibling.then(value => ({ value }), error => ({ error }))
    const cause = reason === "Error" ? new Error("snapshot classification defect")
        : r.validationError("escaped snapshot poison", ctx, r.ERROR_KIND.InvalidExternalSnapshot)
    remaining = probe
    reached = false
    fault = cause
    let result
    try {
        const value = (route === "lookup" ? r.lookupPath : r.export)(chain, ["api", "data"], ctx)
        result = Promise.resolve(value).then(value => ({ value }), error => ({ error }))
    } catch (error) { result = Promise.resolve({ error }) }
    signal?.resolve(data)
    const outcome = await result
    const fatal = execution.fatalError
    assert(reached, label)
    assert(r.isFatalError(fatal), label)
    assert.equal(fatal.cause, cause, label)
    assert.equal(fatal.errorContext, ctx.errorContext, label)
    assert.equal(outcome.error, fatal, label)
    assert.equal((await siblingOutcome).error, fatal, label)
    assert.deepEqual(reports, [fatal], label)
    assert.throws(() => r.assignPath(chain, ["api", "changes"], 1, ctx), error => error === fatal)
    assert.equal(native.changes, 0)
}

for (const delivery of ["ready", "pending"])
for (const probe of [1, 2])
for (const reason of ["Error", "PoisonError"]) {
    const label = `managed method ${delivery} probe=${probe} ${reason}`
    const reports = [], execution = new r.Execution(error => reports.push(error))
    const ctx = { execution, errorContext: label }
    const initialize = { execution, errorContext: "initialization" }
    let calls = 0
    class Base { read() { calls++; return this.value } }
    class Data extends Base {}
    r.managedStateClass(Data)
    const receiver = Object.assign(new Data(), { value: 1 })
    const chain = new r.Chain(r.import(receiver, initialize), initialize)
    const signal = delivery === "pending" ? Promise.withResolvers() : undefined
    const sibling = r.import(new Promise(() => {}), initialize)
    const siblingOutcome = sibling.then(value => ({ value }), error => ({ error }))
    const cause = reason === "Error" ? new Error("managed selection defect")
        : r.validationError("escaped selection poison", ctx, r.ERROR_KIND.InvalidManagedReceiver)
    remaining = probe
    reached = false
    fault = cause
    let result
    try {
        const value = r.run(chain, [], "read", [signal?.promise ?? 1], ctx, {})
        result = Promise.resolve(value).then(value => ({ value }), error => ({ error }))
    } catch (error) { result = Promise.resolve({ error }) }
    signal?.resolve(1)
    const outcome = await result
    const fatal = execution.fatalError
    assert(reached, label)
    assert(r.isFatalError(fatal), label)
    assert.equal(fatal.cause, cause, label)
    assert.equal(fatal.errorContext, ctx.errorContext, label)
    assert.equal(outcome.error, fatal, label)
    assert.equal((await siblingOutcome).error, fatal, label)
    assert.deepEqual(reports, [fatal], label)
    assert.throws(() => r.run(chain, [], "read", [], ctx, {}), error => error === fatal)
    assert.equal(calls, 0)
}
console.log("24 snapshot and managed selection helper defects preserve fatality and causal context")
