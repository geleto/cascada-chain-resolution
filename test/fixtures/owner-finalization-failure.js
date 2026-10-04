// Finalization faults are injected into runtime work reached by valid public operations.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { OrderedThenable, ChainedThenable } from "../ordered-thenable.js"

let runtime, selectedContext, faults, reached, commitFirst = false
globalThis.ownerFinalizationFault = (site, context) => {
    if (context !== selectedContext || !faults?.has(site)) return
    const cause = faults.get(site)
    faults.delete(site)
    reached.push(site)
    if (commitFirst && site === "owner-release") runtime.failExecution(context, cause)
    throw cause
}
const root = new URL("../../src/", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    let source = String(result.source)
    if (url === root + "operation-lifecycle.js") {
        for (const [marker, replacement] of [
            ["this.release?.()", 'globalThis.ownerFinalizationFault("owner-release", this.operationContext); this.release?.()'],
            ["for (const release of releases) release()", 'for (const release of releases) { globalThis.ownerFinalizationFault("registered-release", this.operationContext); release() }'],
        ]) {
            assert(source.includes(marker), "Owner finalization fault anchor needs updating")
            source = source.replace(marker, replacement)
        }
    } else if (url === root + "export.js") {
        const marker = "function discardOutput() {"
        assert(source.includes(marker), "Export output cleanup fault anchor needs updating")
        source = source.replace(marker, marker + '\n        globalThis.ownerFinalizationFault("export-discard", operationContext)')
    } else return result
    return { ...result, source }
} })
runtime = await import("../../src/index.js")
const r = runtime

function reason(kind, context) {
    return kind === "raw" ? new Error("runtime finalization defect")
        : kind === "poison" ? r.validationError("unexpected cleanup poison", context,
            r.ERROR_KIND.PropertyValidation) : undefined
}
function scenario(label) {
    const reports = [], execution = new r.Execution(error => reports.push(error))
    const initialize = { execution, errorContext: "initialization" }
    const operation = { execution, errorContext: label }
    selectedContext = operation
    faults = new Map()
    reached = []
    commitFirst = false
    const sibling = r.import(new Promise(() => {}), initialize)
        .then(value => ({ value }), error => ({ error }))
    return { reports, execution, initialize, operation, sibling }
}
async function verify(state, outcome, cause, sites, completedIssuance = false) {
    const { execution, operation, reports, sibling } = state
    const actual = await outcome
    await new Promise(setImmediate)
    const fatal = execution.fatalError
    assert(r.isFatalError(fatal), JSON.stringify(operation.errorContext))
    assert.equal(fatal.cause, cause)
    assert.equal(fatal.errorContext, operation.errorContext)
    assert.deepEqual(actual, completedIssuance ? { value: undefined } : { error: fatal })
    assert.deepEqual(await sibling, { error: fatal })
    assert.deepEqual(reports, [fatal])
    assert.deepEqual(reached, sites)
    assert.throws(() => r.import(2, operation), error => error === fatal)
}
function observe(work) {
    try { return Promise.resolve(work()).then(value => ({ value }), error => ({ error })) }
    catch (error) { return Promise.resolve({ error }) }
}

for (const route of ["lookup", "expression", "export", "hasError", "getErrors", "assign", "delete", "repair"])
for (const pending of [false, true])
for (const kind of ["raw", "poison", "undefined"]) {
    const state = scenario({ site: "owner-release", route, pending, kind })
    const { initialize, operation } = state
    const signal = pending ? Promise.withResolvers() : undefined
    const source = { value: 1 }
    const chain = new r.Chain(signal?.promise ?? source, initialize)
    const cause = reason(kind, initialize)
    faults.set("owner-release", cause)
    const call = route === "export" ? () => r.export(chain, [], operation)
        : route === "lookup" ? () => r.lookupPath(chain, ["value"], operation)
        : route === "expression" ? () => r.lookupPathForExpression(chain, ["value"], operation)
        : route === "hasError" ? () => r.hasError(chain, [], operation)
        : route === "getErrors" ? () => r.getErrors(chain, [], operation)
        : route === "assign" ? () => r.assignPath(chain, ["value"], 2, operation)
        : route === "delete" ? () => r.deletePath(chain, ["value"], operation)
        : () => r.repairPath(chain, ["value"], operation)
    const outcome = observe(call)
    signal?.resolve(source)
    await verify(state, outcome, cause, ["owner-release"], pending && (route === "assign" || route === "delete"))
}

for (const pending of [false, true])
for (const shape of ["record", "array"])
for (const kind of ["raw", "poison", "undefined"]) {
    const state = scenario({ site: "export-discard", pending, shape, kind })
    const { initialize, operation } = state
    const poison = r.validationError("ordinary data failure", initialize, r.ERROR_KIND.OperationInputFailed)
    const source = shape === "record" ? { first: { value: 1 }, last: poison } : [{ value: 1 }, poison]
    const signal = pending ? Promise.withResolvers() : undefined
    const chain = new r.Chain(signal?.promise ?? source, initialize)
    const cause = reason(kind, initialize)
    faults.set("export-discard", cause)
    const outcome = observe(() => r.export(chain, [], operation))
    signal?.resolve(source)
    await verify(state, outcome, cause, ["export-discard"])
}

for (const delivery of ["native", "ordered", "chained"])
for (const kind of ["raw", "poison", "undefined"])
for (const firstCommitted of [false, true]) {
    const state = scenario({ site: "registered-release", delivery, kind, firstCommitted })
    const { initialize, operation } = state
    const signal = delivery === "native" ? Promise.withResolvers() : delivery === "ordered"
        ? new OrderedThenable() : new ChainedThenable()
    const chain = new r.Chain({ found: signal.promise ?? signal, unfinished: new Promise(() => {}) }, initialize)
    const cause = reason(kind, initialize)
    const secondCause = new Error("later registered-release defect")
    if (firstCommitted) {
        commitFirst = true
        faults.set("owner-release", cause)
        faults.set("registered-release", secondCause)
    } else faults.set("registered-release", cause)
    const outcome = observe(() => r.hasError(chain, [], operation))
    signal.resolve(r.validationError("early Error proof", initialize, r.ERROR_KIND.OperationInputFailed))
    await verify(state, outcome, cause, firstCommitted
        ? ["owner-release", "registered-release"] : ["registered-release"])
}
console.log("78 owner, export-discard and registered-release faults preserve fatality and first-commit context")
