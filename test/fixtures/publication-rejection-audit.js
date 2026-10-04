import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { OrderedThenable, ChainedThenable } from "../ordered-thenable.js"

let replacement, chosenContext
globalThis.auditPublication = (result, operationContext) => {
    if (operationContext !== chosenContext || !replacement) return result
    const { value } = replacement
    replacement = undefined
    return value
}
const target = new URL("../../src/property-versions.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== target) return result
    const source = String(result.source).replaceAll("\r\n", "\n")
    const before = "    const publication = receiveValue(value, operationContext, { kind, imported: Boolean(contextSetup) },\n        publish, undefined, contextSetup?.mutationAccessTree === undefined ? undefined : contextSetup)"
    assert(source.includes(before), "Publication fault anchor needs updating")
    return { ...result, source: source.replace(before,
        before.replace("const publication", "let publication") +
        "\n    publication = globalThis.auditPublication(publication, operationContext)") }
} })
const r = await import("../../src/index.js")

function priorFatal() {
    const context = { execution: new r.Execution(), errorContext: "earlier fatal source" }
    try { r.failExecution(context, new Error("Existing fatal publication")) }
    catch (error) { return error }
}
for (const delivery of ["native", "ordered", "chained", "synchronous"])
for (const route of ["context", "assignment", "unread assignment"])
for (const reason of ["raw", "poison", "undefined", "fatal"]) {
    const label = `${delivery}, ${route}, ${reason}`
    const reports = [], execution = new r.Execution(error => reports.push(error))
    const initialization = { execution, errorContext: { operation: "input preparation", delivery, route, reason } }
    const lookup = { execution, errorContext: "later lookup" }
    const unrelated = new r.Chain({ value: 1 }, initialization)
    const sibling = r.import(new Promise(() => {}), initialization)
    const siblingOutcome = sibling.then(value => ({ value }), error => ({ error }))
    const internal = delivery === "native" ? Promise.withResolvers() :
        delivery === "chained" ? new ChainedThenable() : new OrderedThenable()
    const cause = reason === "raw" ? new Error("Normalized internal publication rejected") :
        reason === "poison" ? r.validationError("Unexpected internal poison rejection", lookup,
            r.ERROR_KIND.OperationInputFailed) : reason === "fatal" ?
            priorFatal() : undefined
    if (delivery === "synchronous") internal.reject(cause)
    replacement = { value: internal.promise ?? internal }
    chosenContext = initialization
    let result, synchronousFailure
    try {
        if (route === "context") {
            const chain = new r.ContextChain(new Promise(() => {}), initialization)
            result = r.lookupPath(chain, [], lookup)
        } else {
            const issued = r.assignPath(unrelated, ["value"], new Promise(() => {}), initialization)
            assert.equal(issued, undefined, label)
            if (route === "assignment") result = r.lookupPath(unrelated, ["value"], lookup)
        }
    } catch (error) { synchronousFailure = error }
    assert.equal(replacement, undefined, label)
    if (delivery !== "synchronous") assert.equal(synchronousFailure, undefined, label)
    if (delivery !== "synchronous" && route !== "unread assignment") assert(result instanceof Promise, label)
    const resultOutcome = Promise.resolve(result).then(value => ({ value }), error => ({ error }))
    if (delivery !== "synchronous") internal.reject(cause)
    await new Promise(resolve => setImmediate(resolve))
    const fatal = execution.fatalError
    assert(r.isFatalError(fatal), label)
    if (reason === "fatal") assert.equal(fatal, cause, label)
    else {
        assert.equal(fatal.cause, cause, label)
        assert.equal(fatal.errorContext, initialization.errorContext, label)
    }
    assert.equal((await siblingOutcome).error, fatal, label)
    if (delivery === "synchronous") assert.equal(synchronousFailure, fatal, label)
    else if (route !== "unread assignment") assert.equal((await resultOutcome).error, fatal, label)
    assert.deepEqual(reports, [fatal], label)
    assert.throws(() => r.assignPath(unrelated, ["value"], 2, lookup), error => error === fatal, label)
}
