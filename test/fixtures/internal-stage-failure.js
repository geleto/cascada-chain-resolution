// Implementation faults at semantic stages of valid public operations. No host
// inputs, primordials, declarations, or integration facts are corrupted.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { ready, OrderedThenable, ChainedThenable } from "../ordered-thenable.js"

const sites = {
    indexing: ["refcounts.js", "function buildRefIndex(value, operationContext) {"],
    publication: ["parent-placements.js", "function recordLogicalPlacement(owner, key, before, after, operationContext, wasOverlay) {"],
    copying: ["placement-structure.js", "function createEmptyContainer(source, operationContext) {"],
    length: ["array-view.js", "static captureLength(array, operationContext, owner) {"],
    remap: ["array-remap.js", "function createArrayFromRemap(\n    remap,\n    operationContext,\n    refIndexSource = undefined,\n) {"],
    isolation: ["mutations.js", "function shallowCopyPathContainer(source, operationContext) {"],
    validation: ["language-properties.js", "function validatePropertyValue(key, value, operationContext, kind = errorUtils.ERROR_KIND.PropertyValidation) {"],
}
let armed, events, issued
globalThis.internalStageFault = (site, context) => {
    if (armed?.site !== site || armed.context !== context) return
    const cause = armed.cause
    armed = undefined
    events.push({ site, issued })
    throw cause
}
const root = new URL("../../src/", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    let source = String(result.source).replaceAll("\r\n", "\n")
    for (const [site, [file, marker]] of Object.entries(sites)) {
        if (url !== root + file) continue
        assert(source.includes(marker), `Internal ${site} fault anchor needs updating`)
        source = source.replace(marker, marker + ` globalThis.internalStageFault("${site}", operationContext);`)
        return { ...result, source }
    }
    return result
} })
const r = await import("../../src/index.js")
const routes = {
    hasError: { site: "indexing", value: { item: 1 }, invoke: (c, p, ctx) => r.hasError(c, p, ctx, 0) },
    getErrors: { site: "indexing", value: { item: 1 }, invoke: (c, p, ctx) => r.getErrors(c, p, ctx, 0) },
    publication: { site: "publication", value: { item: 1 }, invoke: (c, p, ctx) => r.assignPath(c, [...p, "item"], 2, ctx, 2, 0) },
    export: { site: "copying", value: { item: 1 }, invoke: (c, p, ctx) => r.export(c, p, ctx, 0) },
    join: { site: "length", value: [1, 2], invoke: (c, p, ctx) => r.run(c, p, "join", [","], ctx, { firstDynamicSegment: 0 }) },
    flat: { site: "remap", value: [[1], 2], invoke: (c, p, ctx) => r.run(c, p, "flat", [1], ctx, { firstDynamicSegment: 0 }) },
    isolation: { site: "isolation", value: { item: 1 }, invoke: (c, p, ctx) => r.assignPath(c, [...p, "item"], 2, ctx, 2, 0) },
    validation: { site: "validation", value: { item: 1 }, invoke: (c, p, ctx) => r.assignPath(c, [...p, "item"], 2, ctx, 2, 0) },
}
const selectedRoute = process.argv[2]
assert(selectedRoute in routes, "Select an audited semantic route")
const route = routes[selectedRoute]
let count = 0
for (const delivery of ["ready", "synchronous", "native", "ordered", "chained"])
for (const reason of ["raw", "poison", "undefined", "fatal"]) {
    const label = `${selectedRoute}, ${delivery}, ${reason}`
    const reports = [], execution = new r.Execution(error => reports.push(error))
    const initial = { execution, errorContext: "initialization" }
    const context = { execution, errorContext: label }
    const source = delivery === "native" ? Promise.withResolvers()
        : delivery === "ordered" ? new OrderedThenable()
            : delivery === "chained" ? new ChainedThenable() : undefined
    const input = structuredClone(route.value)
    const branch = delivery === "ready" ? input : delivery === "synchronous"
        ? ready(input) : source.promise ?? source
    const original = { branch }
    const chain = new r.Chain(r.import(original, initial), initial)
    const unrelated = new r.Chain({ value: 1 }, initial)
    const sibling = r.import(new Promise(() => {}), initial).then(
        () => assert.fail("Pending sibling succeeded"), error => error)
    let cause = reason === "raw" ? new Error("Internal stage defect") : reason === "poison"
        ? r.validationError("Unexpected internal poison escape", initial, r.ERROR_KIND.OperationInputFailed) : undefined
    if (reason === "fatal") {
        const earlier = { execution: new r.Execution(), errorContext: "earlier source" }
        try { r.failExecution(earlier, new Error("Earlier fatal")) }
        catch (error) { cause = error }
    }
    events = []
    issued = false
    const arm = () => { armed = { site: route.site, context, cause } }
    if (!source) arm()
    let outcome, returnedPending = false
    try {
        const result = route.invoke(chain, ["branch"], context)
        returnedPending = result instanceof Promise
        outcome = Promise.resolve(result).then(value => ({ value }), error => ({ error }))
    } catch (error) { outcome = Promise.resolve({ error }) }
    issued = true
    if (source) { arm(); source.resolve(input) }
    // Writes may finish issuance before the target becomes available. Let the
    // retained transition run; a completed result has no fatal delivery duty.
    if (source) for (let turn = 0; turn < 30; turn++) await Promise.resolve()
    const observed = await outcome, fatal = execution.fatalError
    assert.equal(armed, undefined, `Fault was not reached: ${label}`)
    assert(r.isFatalError(fatal), label)
    if (reason === "fatal") assert.equal(fatal, cause, label)
    else {
        assert.equal(fatal.cause, cause, label)
        assert.equal(fatal.errorContext, context.errorContext, label)
    }
    if (!source || returnedPending) assert.equal(observed.error, fatal, label)
    else assert.deepEqual(observed, { value: undefined }, label)
    assert.equal(await sibling, fatal, label)
    assert.deepEqual(reports, [fatal], label)
    assert.deepEqual(events, [{ site: route.site, issued: Boolean(source) }], label)
    assert.equal(execution._graphDepth, 0, label)
    assert.throws(() => r.lookupPath(unrelated, ["value"], context), error => error === fatal, label)
    assert.equal(original.branch, branch, label)
    assert.deepEqual(input, route.value, label)
    count++
}
console.log(`${count} ${selectedRoute} stage failures preserve fatality, context, and input protection`)
