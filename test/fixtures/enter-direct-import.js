import { Chain } from "../../src/chain.js"
import { enter } from "../../src/enter.js"
import { Execution } from "../../src/execution.js"

const root = { target: { value: 1 } }
const operationContext = { execution: new Execution(), errorContext: "fixture" }
let callbackCount = 0
const result = enter(new Chain(root, operationContext), ["target"], operationContext, true, () => {
    callbackCount++
    return "done"
})
const gate = root.target
const published = await gate
await new Promise(resolve => setImmediate(resolve))

console.log(JSON.stringify({
    callbackCount,
    gateWasPromise: gate instanceof Promise,
    placementPublished: root.target === published,
    result,
}))
