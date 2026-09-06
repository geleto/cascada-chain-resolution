import assert from "node:assert/strict"
import * as runtime from "../../src/index.js"

const reported = []
const unhandled = []
const reportFatal = error => {
    reported.push(error)
}
process.on("unhandledRejection", error => {
    unhandled.push(error)
})

const root = { target: {} }
const operationContext = {
    execution: new runtime.Execution(reportFatal),
    errorContext: "fixture",
}
const pending = runtime.import(new Promise(() => {}), operationContext).catch(error => error)
let entered
let escaped
try {
    runtime.enter(new runtime.Chain(root, operationContext), ["target"], operationContext, true, privateChain => {
        entered = privateChain
        // Simulate runtime corruption that bypasses the root transition.
        privateChain._state.value = process.argv[2] === "ready"
            ? Promise.resolve({ invalid: true })
            : new Promise(() => {})
    })
} catch (failure) {
    escaped = failure
}
assert.equal(runtime.isFatalError(escaped), true)
assert.equal(escaped, operationContext.execution.fatalError)
assert.equal(escaped.errorContext, operationContext.errorContext)
assert.equal(escaped.cause.message, "Pending property has no mirror")
assert.deepEqual(reported, [escaped])
assert.equal(await pending, escaped)
const gate = root.target

const closed = entered._closed === true

await new Promise(resolve => setImmediate(resolve))
await new Promise(resolve => setImmediate(resolve))

console.log(JSON.stringify({
    closed,
    gateRemainsPending: root.target === gate,
    message: reported[0]?.message,
    reportCount: reported.length,
    unhandledCount: unhandled.length,
}))
