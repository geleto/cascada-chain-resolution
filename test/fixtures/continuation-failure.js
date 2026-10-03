// Internal defects at the callback and retirement lanes of valid public work.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

let faults, selectedContext, issued, events
globalThis.continuationFault = (site, context) => {
    if (context !== selectedContext || !faults?.has(site)) return
    const cause = faults.get(site)
    faults.delete(site)
    events.push({ site, issued })
    throw cause
}
const root = new URL("../../src/", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    const marker = url === root + "observations.js" ? "const retain = value => {"
        : url === root + "input-preparations.js" ? "const accept = root => {"
        : url === root + "ownership.js" ? "function retireCandidates(operationContext) {" : undefined
    if (!marker) return result
    const source = String(result.source)
    assert(source.includes(marker), "Continuation fault anchor needs updating")
    const site = url.endsWith("ownership.js") ? "retirement" : "callback"
    return { ...result, source: source.replace(marker, marker + ` globalThis.continuationFault("${site}", operationContext);`) }
} })
const r = await import("../../src/index.js")
const { ready, OrderedThenable, ChainedThenable } = await import("../ordered-thenable.js")

for (const delivery of ["ready", "synchronous", "native", "ordered", "chained"])
for (const route of ["lookup", "import"])
for (const lane of ["callback", "retirement", "both"]) {
    const reports = [], execution = new r.Execution(error => reports.push(error))
    const ctx = { execution, errorContext: `${delivery} ${route} ${lane}` }
    const initialize = { execution, errorContext: "initialization" }
    const signal = delivery === "native" ? Promise.withResolvers()
        : delivery === "ordered" ? new OrderedThenable() : delivery === "chained" ? new ChainedThenable() : undefined
    const value = delivery === "ready" ? 1 : delivery === "synchronous" ? ready(1) : signal.promise ?? signal
    const chain = route === "lookup" ? new r.Chain({ value }, initialize) : undefined
    const other = r.import(new Promise(() => {}), initialize).then(value => ({ value }), error => ({ error }))
    const callbackCause = new Error("callback defect"), retirementCause = new Error("retirement defect")
    const arm = () => {
        selectedContext = ctx
        faults = new Map(lane === "callback" ? [["callback", callbackCause]]
            : lane === "retirement" ? [["retirement", retirementCause]]
                : [["callback", callbackCause], ["retirement", retirementCause]])
        events = []
    }
    issued = false
    if (!signal) arm()
    let outcome
    try {
        const result = route === "lookup" ? r.lookupPath(chain, ["value"], ctx) : r.import(value, ctx)
        outcome = Promise.resolve(result).then(value => ({ value }), error => ({ error }))
    } catch (error) { outcome = Promise.resolve({ error }) }
    issued = true
    if (signal) { arm(); signal.resolve(1) }
    const result = await outcome, fatal = execution.fatalError
    assert(r.isFatalError(fatal), `${delivery} ${route} ${lane}`)
    const sibling = await other
    assert.equal(fatal.cause, lane === "retirement" ? retirementCause : callbackCause)
    assert.equal(fatal.errorContext, ctx.errorContext)
    assert.equal(result.error, fatal)
    assert.equal(sibling.error, fatal)
    assert.deepEqual(reports, [fatal])
    assert.equal(execution._graphDepth, 0)
    assert(events.length >= 1)
    assert(events.every(event => event.issued === Boolean(signal)), "Deferred failures must occur after issuance")
    if (lane === "both") assert.deepEqual(events.map(event => event.site), ["callback", "retirement"])
    faults = undefined
}
console.log("30 callback/retirement failure cases preserve the exact first fatal and its source")
