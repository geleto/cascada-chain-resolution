// Faults at the first instruction of valid public commands must reach their
// causal fatal boundary, before any guarded helper or continuation runs.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

const entries = {
    "import.js": ["importValue", "importMethodResult"],
    "enter.js": ["enter"],
    "run.js": ["run"],
    "mutations.js": ["mutatePath"],
    "observations.js": ["lookupPath", "lookupPathForExpression", "exportPath", "hasError", "getErrors"],
    "path-operation.js": ["repairPath"],
}
let armed
globalThis.entryFailure = (site, context) => {
    if (armed?.site !== site || armed.context !== context) return
    const cause = armed.cause
    armed = undefined
    throw cause
}
const root = new URL("../../src/", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    const names = entries[url.slice(root.length)]
    if (!url.startsWith(root) || !names) return result
    let source = String(result.source)
    for (const name of names) {
        const header = new RegExp(`function ${name}\\([^{}]*\\) \\{`)
        assert(header.test(source), `${name}: entry fault anchor needs updating`)
        source = source.replace(header, match => match +
            ` globalThis.entryFailure("${name}", operationContext);`)
    }
    return { ...result, source }
} })
const r = await import("../../src/index.js")
const commands = [
    ["importValue", (_, ctx) => r.import({ value: 1 }, ctx)],
    ["importMethodResult", (_, ctx) => r.importMethodResult({ value: 1 }, ctx)],
    ["enter", (chain, ctx) => r.enter(chain, [], ctx, false, () => undefined)],
    ["run", (chain, ctx) => r.run(chain, [], "method", [], ctx, {})],
    ["mutatePath", (chain, ctx) => r.assignPath(chain, ["value"], 2, ctx)],
    ["mutatePath", (chain, ctx) => r.deletePath(chain, ["value"], ctx)],
    ["lookupPath", (chain, ctx) => r.lookupPath(chain, ["value"], ctx)],
    ["lookupPathForExpression", (chain, ctx) => r.lookupPathForExpression(chain, ["value"], ctx)],
    ["exportPath", (chain, ctx) => r.export(chain, [], ctx)],
    ["hasError", (chain, ctx) => r.hasError(chain, [], ctx)],
    ["getErrors", (chain, ctx) => r.getErrors(chain, [], ctx)],
    ["repairPath", (chain, ctx) => r.repairPath(chain, ["value"], ctx)],
]
let count = 0
for (const [site, invoke] of commands) for (const reason of ["raw", "poison", "undefined", "fatal"]) {
    const reports = []
    const execution = new r.Execution(error => reports.push(error))
    const initial = { execution, errorContext: "initialization" }
    const context = { execution, errorContext: { site, reason } }
    const value = { value: 1, method() { return this.value } }
    const chain = new r.Chain(value, initial)
    const sibling = r.import(new Promise(() => {}), initial).then(
        () => assert.fail("Pending sibling succeeded"), error => error)
    let cause = reason === "raw" ? new Error("Entry defect") : reason === "poison"
        ? r.validationError("Unexpected poison escape", initial, r.ERROR_KIND.OperationInputFailed) : undefined
    if (reason === "fatal") {
        try { r.failExecution({ execution: new r.Execution(), errorContext: "earlier" }, new Error("Earlier defect")) }
        catch (error) { cause = error }
    }
    armed = { site, context, cause }
    let failed
    try { invoke(chain, context) }
    catch (error) { failed = error }
    assert.equal(armed, undefined, `${site}: fault was unused`)
    assert(r.isFatalError(failed), `${site}, ${reason}`)
    if (reason === "fatal") assert.equal(failed, cause)
    else {
        assert.equal(failed.cause, cause)
        assert.equal(failed.errorContext, context.errorContext)
    }
    assert.equal(execution.fatalError, failed)
    assert.equal(await sibling, failed)
    assert.deepEqual(reports, [failed])
    assert.equal(execution._graphDepth, 0)
    assert.equal(value.value, 1)
    assert.throws(() => r.lookupPath(chain, ["value"], context), error => error === failed)
    count++
}
console.log(`${count} public entry faults preserve fatality, context, and pending-result rejection`)
