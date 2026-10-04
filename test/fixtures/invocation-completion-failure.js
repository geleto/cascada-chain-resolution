// Replace a normalized internal result during valid public calls. Host inputs,
// methods, primordials, and integration arguments keep their supported behavior.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { OrderedThenable, ChainedThenable } from "../ordered-thenable.js"

let replacement
globalThis.wrapInvocationResult = accessReceiver => (...args) => {
    const result = accessReceiver(...args)
    if (!replacement) return result
    const { value } = replacement
    replacement = undefined
    return value
}
const target = new URL("../../src/invocation.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== target) return result
    const source = String(result.source)
    const marker = "const { operationContext, mutation } = invocationWork"
    assert(source.includes(marker), "Invocation fault anchor needs updating")
    return { ...result, source: source.replace(marker,
        marker + "\n    accessReceiver = globalThis.wrapInvocationResult(accessReceiver)") }
} })
const r = await import("../../src/index.js")

function makeCall(route, initialization, operation) {
    if (route.startsWith("array")) {
        const original = [1]
        const chain = new r.Chain(r.import(original, initialization), initialization)
        return { original, invoke: () => r.run(chain, [],
            route === "array mutation" ? "push" : "slice",
            route === "array mutation" ? [2] : [0], operation,
            route === "array mutation" ? { mutationScopeDepth: 0 } : {}) }
    }
    const original = { value: 1, read() { return this.value }, change() { return ++this.value } }
    const mutation = route.endsWith("mutation")
    if (route.startsWith("external")) {
        const chain = mutation
            ? new r.ContextChain({ api: r.externalState(original) }, initialization, { api: {} })
            : new r.Chain(r.externalState(original), initialization)
        return { invoke: () => r.run(chain, mutation ? ["api"] : [],
            mutation ? "change" : "read", [], operation, mutation ? { mutationScopeDepth: 1 } : {}) }
    }
    const chain = new r.Chain(r.import(original, initialization), initialization)
    return { original, invoke: () => r.run(chain, [], mutation ? "change" : "read", [], operation,
        mutation ? { mutationScopeDepth: 0 } : {}) }
}

for (const route of ["managed observation", "managed mutation", "external observation",
    "external mutation", "array observation", "array mutation"])
for (const delivery of ["native", "ordered", "chained", "synchronous"])
for (const reason of ["raw", "poison", "undefined", "fatal"]) {
    const label = `${route}, ${delivery}, ${reason}`
    const reports = [], execution = new r.Execution(error => reports.push(error))
    const initialization = { execution, errorContext: "initialization" }
    const operation = { execution, errorContext: { route, delivery, reason } }
    const call = makeCall(route, initialization, operation)
    const unrelated = new r.Chain({ value: 1 }, initialization)
    const sibling = r.import(new Promise(() => {}), initialization)
    const siblingOutcome = sibling.then(() => assert.fail("Sibling succeeded"), error => error)
    let cause = reason === "raw" ? new Error("Internal invocation completion defect") :
        reason === "poison" ? r.validationError("Unexpected internal poison rejection", initialization,
            r.ERROR_KIND.InvocationFailed) : undefined
    if (reason === "fatal") {
        const producer = { execution: new r.Execution(), errorContext: "earlier fatal source" }
        try { r.failExecution(producer, new Error("Earlier fatal")) }
        catch (error) { cause = error }
    }
    const source = delivery === "native" ? Promise.withResolvers() : delivery === "chained"
        ? new ChainedThenable() : new OrderedThenable()
    if (delivery === "synchronous") source.reject(cause)
    replacement = { value: source.promise ?? source }
    let result, synchronousFailure
    try { result = call.invoke() }
    catch (error) { synchronousFailure = error }
    assert.equal(replacement, undefined, label)
    if (delivery !== "synchronous") assert(result instanceof Promise, label)
    const outcome = Promise.resolve(result).then(value => ({ value }), error => ({ error }))
    if (delivery !== "synchronous") source.reject(cause)
    const observed = await outcome
    const fatal = execution.fatalError
    assert(r.isFatalError(fatal), label)
    if (reason === "fatal") assert.equal(fatal, cause, label)
    else {
        assert.equal(fatal.cause, cause, label)
        assert.equal(fatal.errorContext, operation.errorContext, label)
    }
    assert.equal(delivery === "synchronous" ? synchronousFailure : observed.error, fatal, label)
    assert.equal(await siblingOutcome, fatal, label)
    assert.deepEqual(reports, [fatal], label)
    assert.throws(() => r.assignPath(unrelated, ["value"], 2, operation), error => error === fatal, label)
    if (Array.isArray(call.original)) assert.deepEqual(call.original, [1], label)
    else if (call.original) assert.equal(call.original.value, 1, label)
}
