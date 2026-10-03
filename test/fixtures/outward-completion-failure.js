// Inject an internal defect at final outward processing, after normal graph work.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

let fault
globalThis.injectOutwardFailure = () => {
    if (!fault) return
    const cause = fault
    fault = undefined
    throw cause
}
const target = new URL("../../src/operation-result.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== target) return result
    let source = String(result.source)
    for (const marker of ["delivery?.capture(value)", "if (isPoisonError(value)) reject(value)"]) {
        assert(source.includes(marker))
        source = source.replace(marker, "globalThis.injectOutwardFailure()\n        " + marker)
    }
    return { ...result, source }
} })
const r = await import("../../src/index.js")
for (const route of ["import", "lookup", "call", "entry", "expression"]) {
    const reports = [], ctx = { execution: new r.Execution(error => reports.push(error)), errorContext: route }
    const signal = Promise.withResolvers()
    const result = route === "import" ? r.import(signal.promise, ctx) :
        route === "lookup" ? r.lookupPath(new r.Chain({ value: signal.promise }, ctx), ["value"], ctx) :
        route === "call" ? r.run(new r.Chain(r.externalState({ read() { return signal.promise } }), ctx), [], "read", [], ctx, {}) :
        route === "entry" ? r.enter(new r.Chain({}, ctx), [], ctx, false, () => signal.promise) :
        r.lookupPathForExpression(new r.Chain(signal.promise, ctx), [], ctx)
    const other = r.import(new Promise(() => {}), ctx)
    const outcomes = []
    for (const [index, pending] of [result, other].entries())
        pending.then(value => { outcomes[index] = { value } }, error => { outcomes[index] = { error } })
    const cause = fault = new Error("outward processing defect")
    signal.resolve(route === "expression" ? 42 : { k: 1 })
    await new Promise(setImmediate)
    const fatal = ctx.execution.fatalError
    assert(r.isFatalError(fatal), route)
    assert.equal(fatal.cause, cause)
    assert.deepEqual(outcomes, [{ error: fatal }, { error: fatal }])
    assert.deepEqual(reports, [fatal])
}
