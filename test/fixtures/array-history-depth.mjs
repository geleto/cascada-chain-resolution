import assert from "node:assert/strict"
import { promiseHooks } from "node:v8"
import { instrumentRuntime } from "../runtime-transform.js"

const n = Number(process.argv[2] ?? 192)
assert(Number.isSafeInteger(n) && n >= 16)
let copies, leases, bounds, points
const count = (text, name) => [text, text + "\n    globalThis.__arrayHistoryCount(" + JSON.stringify(name) + ")\n"]
globalThis.__arrayHistoryCount = name => {
    if (name === "copy") copies++
    if (name === "lease") leases++
    if (name === "bound") bounds++
    if (name === "point") points++
}
const loaded = instrumentRuntime([
    ["property-versions.js", [count("function createCopiedVersion(placement, owner, key, operationContext) {", "copy"),
        count("function retainPlacement(placement, operationContext) {", "lease")]],
    ["array-sequence.js", [count("function refine(sequence, minimum, maximum, active) {", "bound"),
        count("function pointAt(source, index, back, project) {", "point")]],
])
const r = await import("../../src/index.js")
const mutation = { mutationScopeDepth: 0 }
const tick = () => new Promise(setImmediate)

async function history(method, mode) {
    const ctx = { execution: new r.Execution(), errorContext: method }
    const wrap = value => new r.Chain(value, ctx, mode)
    const expected = ["A", "B", "C"], controls = []
    let array = wrap(expected.slice())
    const call = (name, args, change) => r.run(array, [], name, args, ctx, change ? mutation : {})
    const input = value => {
        const signal = Promise.withResolvers()
        controls.push(() => signal.resolve(value))
        return signal.promise
    }
    copies = leases = bounds = points = 0
    if (["tail", "reverse", "toReversed", "fill", "copyWithin"].includes(method)) {
        call("splice", [1, input(1)], true)
        expected.splice(1, 1)
    }
    for (let i = 0; i < n; i++) {
        switch (method) {
        case "tail":
            call("push", [input(i)], true); expected.push(i)
            break
        case "reverse": case "toReversed": case "fill": case "copyWithin":
            call("push", [i], true); expected.push(i)
            if (method === "reverse") { call("reverse", [], true); expected.reverse() }
            if (method === "toReversed") { array = wrap(call(method, [])); expected.reverse() }
            if (method === "fill") { call(method, [i, -1], true); expected.fill(i, -1) }
            if (method === "copyWithin") { call(method, [0, 1], true); expected.copyWithin(0, 1) }
            break
        case "copies":
            call("push", [input(i)], true); expected.push(i)
            call("copyWithin", [0, 1], true); expected.copyWithin(0, 1)
            break
        case "concat":
            array = wrap(call("concat", [input([i])]))
            expected.push(i)
            break
        case "toSpliced":
            array = wrap(call("toSpliced", [1, 0, input(i)]))
            expected.splice(1, 0, i)
            break
        case "dense":
            call("push", [input(i)], true); expected.push(i)
            if (i % 3 === 0) { array = wrap(call("toReversed", [])); expected.reverse() }
            else if (i % 3 === 1) { array = wrap(call("with", [0, i])); expected[0] = i }
            else array = wrap(call("flat", [0]))
            break
        case "front":
            call("unshift", [input(i), i], true); expected.unshift(i, i)
            call("shift", [], true); expected.shift()
            break
        case "cuts": {
            const start = i % 3
            if (i % 2) call("splice", [input(start), 0, i], true)
            else array = wrap(call("toSpliced", [input(start), 0, i]))
            expected.splice(start, 0, i)
            break
        }
        case "slice":
            array = wrap(call("slice", [input(0)]))
            break
        }
    }
    const first = r.lookupPath(array, [0], ctx)
    const inspectOrder = method === "concat" || method === "reverse" || method === "toReversed"
    const cursor = inspectOrder && r.iterate(array, [], ctx, { metadata: ["index0"] })
    const pull = cursor && cursor.next()
    for (let i = controls.length - 1; i >= 0; i--) controls[i]()
    assert.deepEqual(await first, expected[0], method)
    assert.deepEqual(await r.export(array, [], ctx), expected, method)
    if (cursor) {
        const observed = []
        for (let step = await pull; !step.done; step = await cursor.next())
            observed[await step.metadata.index0] = await r.lookupPath(step.value, [], ctx)
        assert.deepEqual(observed, expected, method)
    }
    assert.equal(ctx.execution.fatalError, null)
    const bound = n * (12 + 4 * Math.ceil(Math.log2(n)))
    if (["tail", "copies", "toSpliced", "front", "dense"].includes(method))
        assert(copies < bound && leases < bound, method + " copies=" + copies + " leases=" + leases)
    if (method === "concat") assert(bounds < bound, method + " bound updates=" + bounds)
}

async function sparse(mode, length) {
    const ctx = { execution: new r.Execution(), errorContext: "sparse admission" }
    const array = new r.Chain(new Array(length), ctx, mode), start = Promise.withResolvers()
    r.run(array, [], "splice", [start.promise, 0, "X"], ctx, mutation)
    points = 0
    let subscriptions = 0
    const stop = promiseHooks.createHook({ init() { subscriptions++ } })
    const hit = r.run(array, [], "includes", ["X"], ctx, {}), miss = r.run(array, [], "includes", ["absent"], ctx, {})
    const cursor = r.iterate(array, [], ctx, { windowEnd: 1, metadata: ["index0"] }), pull = cursor.next()
    stop()
    assert(points < 128 && subscriptions < 512, "sparse point requests=" + points + " Promises=" + subscriptions)
    start.resolve(0)
    assert.equal(await hit, true)
    assert.equal(await miss, false)
    const item = await pull
    assert.equal(await item.metadata.index0, 0)
    assert.equal(await r.lookupPath(item.value, [], ctx), "X")
    await cursor.return()
}

for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
    for (const length of [2048, 0xfffffffe]) await sparse(mode, length)
for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) for (const flagged of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: "sparse copy" }
    const data = new Array(8192), value = Promise.withResolvers(), target = Promise.withResolvers()
    data[0] = value.promise
    data[8191] = { n: 1 }
    const array = new r.Chain(data, ctx, mode)
    const error = r.validationError("sparse flag", ctx, r.ERROR_KIND.OperationInputFailed)
    if (flagged) r.poisonPath(array, [8191], error, ctx)
    r.run(array, [], "copyWithin", [target.promise, 0, 1], ctx, mutation)
    let subscriptions = 0
    const stop = promiseHooks.createHook({ init() { subscriptions++ } })
    const miss = r.run(array, [], "includes", ["missing"], ctx, {})
    stop()
    assert(subscriptions < 512, "mixed sparse copy Promises=" + subscriptions)
    target.resolve(4096)
    value.resolve("present")
    assert.equal(await miss, flagged ? error : false)
    assert.equal(await r.lookupPath(array, [4096], ctx), "present")
}
const methods = process.argv.slice(3)
for (const method of methods.length ? methods : ["tail", "copies", "fill", "copyWithin", "reverse", "toReversed", "concat", "toSpliced", "front", "dense", "slice", "cuts"]) {
    await history(method, ["slice", "cuts"].includes(method) ? r.CHAIN_MODE.Sequential : r.CHAIN_MODE.Unordered)
    if (n >= 5000) console.log(method, n, "passed")
    await tick()
    globalThis.gc?.()
}
loaded("Array history-depth fixture")
console.log("Array history depth and work verified at", n)
