import { Chain } from "../../src/chain.js"
import { enter } from "../../src/enter.js"
import { setFatalErrorReporter } from "../../src/error.js"

const reported = []
const unhandled = []
setFatalErrorReporter(error => {
    reported.push(error)
})
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

await new Promise(resolve => setImmediate(resolve))
await new Promise(resolve => setImmediate(resolve))

console.log(JSON.stringify({
    closed: !Object.hasOwn(entered._state, "mutates"),
    gateRemainsPending: root.target === gate,
    message: reported[0]?.message,
    reportCount: reported.length,
    sameFailure: reported[0] === unhandled[0],
    unhandledCount: unhandled.length,
}))
