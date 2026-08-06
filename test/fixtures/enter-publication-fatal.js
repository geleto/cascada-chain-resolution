import { Chain } from "../../src/chain.js"
import { enter } from "../../src/enter.js"
import { setFatalErrorReporter } from "../../src/error.js"
import { readPath } from "../../src/observations.js"

const reported = []
const unhandled = []
const reportFatal = error => {
    reported.push(error)
}
setFatalErrorReporter(reportFatal)
process.on("unhandledRejection", error => {
    unhandled.push(error)
})

const root = { target: {} }
let entered
enter(new Chain(root), ["target"], true, privateChain => {
    entered = privateChain
    // Simulate compiler/host corruption that bypasses the root transition.
    privateChain._state.value = Promise.resolve({ invalid: true })
})
const gate = root.target

let closed = false
setFatalErrorReporter()
try {
    readPath(entered, [])
} catch {
    closed = true
}
setFatalErrorReporter(reportFatal)

await new Promise(resolve => setImmediate(resolve))
await new Promise(resolve => setImmediate(resolve))

console.log(JSON.stringify({
    closed,
    gateRemainsPending: root.target === gate,
    message: reported[0]?.message,
    reportCount: reported.length,
    sameFailure: reported[0] === unhandled[0],
    unhandledCount: unhandled.length,
}))
