// Historical reporting witness; compound regressions now run in error-union.test.js.
// Fatal controls retain the first-encountered shutdown contract.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { setImmediate } from "node:timers/promises"

// Inject an implementation defect at an existing stage of a valid query.
// No application input, integration fact, or runtime prototype is corrupted.
let faults = new Map(), detections = []
globalThis.reportingOrderFault = context => {
    const cause = faults.get(context)
    if (!cause) return
    detections.push(context.errorContext)
    throw cause
}
const target = new URL("../../src/refcounts.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== target) return result
    const source = String(result.source)
    const marker = "function buildRefIndex(value, operationContext) {"
    assert(source.includes(marker), "Update the indexing fault anchor")
    return { ...result, source: source.replace(marker,
        marker + " globalThis.reportingOrderFault(operationContext);") }
} })
const r = await import("../../src/index.js")

async function collection(order) {
    const context = { execution: new r.Execution(), errorContext: "collection" }
    const deliveries = [Promise.withResolvers(), Promise.withResolvers()]
    const causes = [new Error("first"), new Error("second")]
    const errors = causes.map(cause => r.createPoisonError(cause,
        { ...context, errorContext: cause.message }, r.ERROR_KIND.ContextValueFailed))
    const chain = new r.Chain(r.import({
        first: deliveries[0].promise, second: deliveries[1].promise,
    }, context), context)
    const queried = r.getErrors(chain, [], context)
    const exported = r.export(chain, [], context)
    for (const index of order) {
        deliveries[index].resolve(errors[index])
        await setImmediate()
    }
    const labels = error => {
        assert(error instanceof r.CompoundPoisonError)
        assert.deepEqual(new Set(error.errors.map(leaf => leaf.cause)), new Set(causes))
        assert.deepEqual(new Set(error.errors), new Set(errors))
        return error.errors.map(leaf => leaf.cause.message)
    }
    const query = await queried, exportedError = await exported
    return { query: labels(query), export: labels(exportedError),
        sources: { query: query.errorContext, export: exportedError.errorContext } }
}

async function completeInput(order) {
    const context = { execution: new r.Execution(), errorContext: 'complete input' }
    const leaves = ['a', 'b'].map(name => r.createPoisonError(new Error(name),
        { ...context, errorContext: name }, r.ERROR_KIND.ContextValueFailed))
    const compounds = [r.combineErrors(leaves), r.combineErrors(leaves)]
    const deliveries = [Promise.withResolvers(), Promise.withResolvers()]
    const chain = new r.Chain({ first: deliveries[0].promise, second: deliveries[1].promise }, context)
    const result = r.getErrors(chain, [], context)
    for (const index of order) {
        deliveries[index].resolve(compounds[index])
        await setImmediate()
    }
    const error = await result
    assert.deepEqual(new Set(error.errors), new Set(leaves))
    return { source: error.errorContext, message: error.message }
}

async function fatal(order) {
    const reports = [], execution = new r.Execution(error => reports.push(error))
    const initial = { execution, errorContext: "initial" }
    const contexts = ["earlier query", "later query"].map(errorContext => ({ execution, errorContext }))
    const deliveries = [Promise.withResolvers(), Promise.withResolvers()]
    const chain = new r.Chain(r.import({
        first: deliveries[0].promise, second: deliveries[1].promise,
    }, initial), initial)
    faults = new Map(contexts.map(context => [context, new Error(context.errorContext)]))
    detections = []
    const outcomes = ["first", "second"].map((key, index) =>
        Promise.resolve(r.getErrors(chain, [key], contexts[index])).then(
            () => assert.fail("Injected query defect must fail"), error => error))
    for (const index of order) {
        deliveries[index].resolve({ value: 1 })
        await setImmediate()
    }
    for (const error of await Promise.all(outcomes)) assert.equal(error, execution.fatalError)
    assert.deepEqual(reports, [execution.fatalError])
    assert(r.isFatalError(execution.fatalError))
    const encountered = contexts[order[0]]
    assert.equal(execution.fatalError.errorContext, encountered.errorContext)
    assert.equal(execution.fatalError.cause, faults.get(encountered))
    assert.deepEqual(detections, [encountered.errorContext])
    faults.clear()
    return { source: execution.fatalError.errorContext, detections: [...detections] }
}

const forward = { collection: await collection([0, 1]), complete: await completeInput([0, 1]), fatal: await fatal([0, 1]) }
const reverse = { collection: await collection([1, 0]), complete: await completeInput([1, 0]), fatal: await fatal([1, 0]) }

// The first import has returned; only its nested data remains pending.
// Waiting for its whole graph before doing independent work adds a cycle.
const context = { execution: new r.Execution(), errorContext: "finite dependency" }
const delivery = Promise.withResolvers()
const earlier = new r.Chain(r.import({ next: delivery.promise }, context), context)
const later = new r.Chain(r.import({ ok: 1 }, context), context)
const ready = r.lookupPath(later, ["ok"], context)
assert.equal(ready, 1)
delivery.resolve(ready)
assert.equal(await r.lookupPath(earlier, ["next"], context), 1)

console.log(JSON.stringify({ forward, reverse, finiteDependency: "passed" }, null, 2))
// Poison attribution must be deterministic despite unspecified child order.
// Fatal controls above require the first actual crash, not schedule equivalence.
assert.deepEqual({ sources: reverse.collection.sources, complete: reverse.complete },
    { sources: forward.collection.sources, complete: forward.complete })
