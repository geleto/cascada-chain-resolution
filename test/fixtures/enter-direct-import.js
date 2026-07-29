import { Chain } from "../../src/chain.js"
import { enter } from "../../src/enter.js"

const root = { target: { value: 1 } }
let callbackCount = 0
const result = enter(new Chain(root), ["target"], true, () => {
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
