import assert from "node:assert/strict"
import { createHook } from "node:async_hooks"
import * as runtime from "../../src/index.js"

const turn = () => new Promise(resolve => setImmediate(resolve))
async function collect() {
    for (let index = 0; index < 8; index++) { global.gc(); await turn() }
}

async function measure(method, stages) {
    const context = { execution: new runtime.Execution(), errorContext: "query frontier work" }
    let pending = Promise.withResolvers()
    const source = new runtime.Chain({ next: pending.promise }, context)
    const promises = []
    const hook = createHook({ init(id, type, trigger, resource) {
        if (type === "PROMISE") promises.push(new WeakRef(resource))
    } })
    let settled = false
    if (!process.argv.includes("--disable-tracker")) hook.enable()
    const result = runtime[method](source, [], context)
    assert(result instanceof Promise)
    result.then(() => { settled = true })
    try {
        for (let index = 0; index < stages; index++) {
            const previous = pending
            pending = Promise.withResolvers()
            previous.resolve({ next: pending.promise })
            await turn()
            assert.equal(settled, false, "A query must follow newly revealed pending descendants")
        }
    } finally { hook.disable() }
    await collect()
    assert(promises.length >= stages, "Promise tracker must observe required pending work")
    const live = promises.reduce((count, promise) => count + Boolean(promise.deref()), 0)
    assert(live > 0, "The unfinished query must retain its actual pending work")

    pending.resolve(0)
    assert.equal(await result, method === "hasError" ? false : null)
    // Keep the source and outward result live across collection. The bound is
    // on spent query completion work, not collection of the entire operation.
    let value = runtime.export(source, [], context)
    for (let index = 0; index <= stages; index++) value = value.next
    assert.equal(value, 0)
    assert.equal(context.execution.fatalError, null)
    return { method, stages, created: promises.length, live }
}

const rows = []
for (const method of ["hasError", "getErrors"]) {
    const measurements = []
    for (const stages of [16, 64, 128]) measurements.push(await measure(method, stages))
    // Allow collection noise without permitting a retained chain per delivered
    // stage. The only unfinished graph dependency is the final next placement.
    assert(measurements[2].live <= measurements[0].live + 16,
        `${method}: spent query completion work grows with delivered stages: ${JSON.stringify(measurements)}`)
    rows.push(...measurements)
}
console.log(JSON.stringify({ rows }))
