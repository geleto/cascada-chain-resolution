// Faults occur in runtime lease cleanup reached through valid public imports.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

let selectedContext, cause, armed = false, reached = 0
globalThis.detachedCleanupFault = context => {
    if (!armed || context !== selectedContext) return
    armed = false
    reached++
    throw cause
}
const target = new URL("../../src/ownership.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== target) return result
    const marker = "function release() {\n        if (closed) return"
    const source = String(result.source).replaceAll("\r\n", "\n")
    assert(source.includes(marker), "Lease cleanup fault anchor needs updating")
    return { ...result, source: source.replace(marker,
        marker + "\n        globalThis.detachedCleanupFault(operationContext)") }
} })
const r = await import("../../src/index.js")
const uncaught = []
const recordUncaught = error => {
    if (error === cause) uncaught.push(error)
    else {
        process.removeListener("uncaughtException", recordUncaught)
        throw error
    }
}
process.on("uncaughtException", recordUncaught)

for (const pending of [false, true])
for (const alreadyFailed of [false, true])
for (const reason of ["raw", "poison", "undefined"]) {
    const reports = [], execution = new r.Execution(error => reports.push(error))
    const initialize = { execution, errorContext: "initialization" }
    const operation = { execution, errorContext: { pending, alreadyFailed, reason } }
    selectedContext = operation
    const signal = pending ? Promise.withResolvers() : undefined
    const sibling = r.import(new Promise(() => {}), initialize)
        .then(value => ({ value }), error => ({ error }))
    const output = r.import(signal?.promise ?? { value: 1 }, operation)
    if (pending) {
        signal.resolve({ value: 1 })
        assert.equal((await output).value, 1)
    } else assert.equal(output.value, 1)

    const priorCause = new Error("unrelated runtime failure")
    let priorFatal
    if (alreadyFailed) {
        try { r.runInternalStep(initialize, () => { throw priorCause }) }
        catch (error) { priorFatal = error }
        assert(r.isFatalError(priorFatal))
    }
    cause = reason === "raw" ? new Error("detached cleanup defect")
        : reason === "poison" ? r.createPoisonError(new Error("escaped cleanup poison"),
            initialize, r.ERROR_KIND.InvocationFailed) : undefined
    const before = reached
    armed = true
    await new Promise(setImmediate)
    assert.equal(reached, before + 1, "The queued runtime release must encounter the defect")
    assert.deepEqual(uncaught, [], "Detached cleanup must not throw into the host queue")
    const fatal = execution.fatalError
    assert(r.isFatalError(fatal))
    if (alreadyFailed) assert.equal(fatal, priorFatal)
    else {
        assert.equal(fatal.cause, cause)
        assert.equal(fatal.errorContext, operation.errorContext)
    }
    assert.deepEqual(await sibling, { error: fatal })
    assert.deepEqual(reports, [fatal])
    assert.throws(() => r.import(2, operation), error => error === fatal)
    assert.equal(Boolean(execution._readyDeliveryQueued), false)
    assert.equal(execution._readyDeliveries, undefined)
    assert.equal(execution._graphDepth, 0)
}
process.removeListener("uncaughtException", recordUncaught)
console.log("12 ready/pending detached cleanup defects preserve first fatal without host-queue escapes")
