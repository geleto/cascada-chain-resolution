import { Chain } from "../../src/chain.js"
import { enter } from "../../src/enter.js"
import { Execution } from "../../src/execution.js"

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
    execution: new Execution(reportFatal),
    errorContext: "fixture",
}
let entered
enter(new Chain(root, operationContext), ["target"], operationContext, true, privateChain => {
    entered = privateChain
    // Simulate compiler/host corruption that bypasses the root transition.
    privateChain._state.value = Promise.resolve({ invalid: true })
})
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
