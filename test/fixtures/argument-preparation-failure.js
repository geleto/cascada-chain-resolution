import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { OrderedThenable, ChainedThenable } from "../ordered-thenable.js"

let replacement, chosenContext, skip
globalThis.auditArgument = (result, operationContext) => {
    if (operationContext !== chosenContext || !replacement || skip-- > 0) return result
    const { value } = replacement
    replacement = undefined
    return value
}
const target = new URL("../../src/invocation.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== target) return result
    let source = String(result.source)
    const before = "        if (languageValues.isPending(result, operationContext)) {"
    assert(source.includes(before), "Argument fault anchor needs updating")
    source = source.replace("const result = receiveValue(value, operationContext,",
        "let result = receiveValue(value, operationContext,")
    return { ...result, source: source.replace(before,
        "        result = globalThis.auditArgument(result, operationContext)\n" + before) }
} })
const r = await import("../../src/index.js")

function priorFatal() {
    const context = { execution: new r.Execution(), errorContext: "earlier source" }
    try { r.failExecution(context, new Error("Earlier fatal")) }
    catch (error) { return error }
}

for (const route of ["numeric", "string", "identity", "comparator", "search bound", "concat",
    "managed export", "external export", "primitive export", "push payload", "fill payload", "with payload"])
for (const delivery of ["native", "ordered", "chained", "synchronous"])
for (const reason of ["raw", "poison", "undefined", "fatal"]) {
    const label = `${route}, ${delivery}, ${reason}`
    const reports = [], execution = new r.Execution(error => reports.push(error))
    const initialization = { execution, errorContext: "initialization" }
    const operation = { execution, errorContext: { route, delivery, reason } }
    const original = [10, 20]
    const receiver = route === "primitive export" ? "abc" : route === "managed export" ?
        { read(value) { return value } } : route === "external export" ?
            r.externalState({ read(value) { return value } }) : original
    const chain = new r.Chain(r.import(receiver, initialization), initialization)
    const unrelated = new r.Chain({ value: 1 }, initialization)
    const sibling = r.import(new Promise(() => {}), initialization)
    const siblingOutcome = sibling.then(value => ({ value }), error => ({ error }))
    const source = delivery === "native" ? Promise.withResolvers() :
        delivery === "chained" ? new ChainedThenable() : new OrderedThenable()
    const cause = reason === "raw" ? new Error("Normalized argument preparation rejected") :
        reason === "poison" ? r.validationError("Unexpected internal argument rejection", initialization,
            r.ERROR_KIND.OperationInputFailed) : reason === "fatal" ?
            priorFatal() : undefined
    if (delivery === "synchronous") source.reject(cause)
    replacement = { value: source.promise ?? source }
    chosenContext = operation
    skip = route === "search bound" || route === "with payload" ? 1 : 0
    const method = route === "numeric" ? "at" : route === "string" ? "join" :
        route === "identity" ? "includes" : route === "comparator" ? "toSorted" :
            route === "search bound" ? "indexOf" : route === "concat" ? "concat" :
                route.endsWith(" export") ? route === "primitive export" ? "slice" : "read" :
                    route === "push payload" ? "push" : route === "fill payload" ? "fill" : "with"
    const args = route === "string" ? [","] : route === "comparator" ? [(a, b) => a - b] :
        route === "search bound" ? [10, 0] : route === "with payload" ? [0, 0] : [0]
    const mutation = route === "push payload" || route === "fill payload"
    let result, synchronousFailure, pendingResult
    try {
        result = r.run(chain, [], method, args, operation, mutation ? { mutationScopeDepth: 0 } : {})
        if (route.endsWith("payload")) {
            const outputChain = route === "with payload" ? new r.Chain(result, initialization) : chain
            pendingResult = r.export(outputChain, [], operation)
        } else pendingResult = result
    } catch (error) { synchronousFailure = error }
    assert.equal(replacement, undefined, label)
    if (delivery !== "synchronous") assert(pendingResult instanceof Promise, label)
    const outcome = Promise.resolve(pendingResult).then(value => ({ value }), error => ({ error }))
    if (delivery !== "synchronous") source.reject(cause)
    await new Promise(resolve => setImmediate(resolve))
    const fatal = execution.fatalError
    assert(r.isFatalError(fatal), label)
    if (reason === "fatal") assert.equal(fatal, cause, label)
    else {
        assert.equal(fatal.cause, cause, label)
        assert.equal(fatal.errorContext, operation.errorContext, label)
    }
    assert.equal(delivery === "synchronous" ? synchronousFailure : (await outcome).error, fatal, label)
    assert.equal((await siblingOutcome).error, fatal, label)
    assert.deepEqual(reports, [fatal], label)
    assert.deepEqual(original, [10, 20], label)
    assert.throws(() => r.assignPath(unrelated, ["value"], 2, operation), error => error === fatal, label)
}
