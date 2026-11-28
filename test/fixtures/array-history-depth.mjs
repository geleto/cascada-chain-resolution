import assert from "node:assert/strict"
import { promiseHooks } from "node:v8"
import { instrumentRuntime } from "../runtime-transform.js"

const n = Number(process.argv[2] ?? 192)
assert(Number.isSafeInteger(n) && n >= 16)
let copies, leases, bounds, points, joins, childLinks, materializedSlots, capturedSlots, pointDepth = 0, maxPointDepth = 0
let rangeDepth = 0, maxRangeDepth = 0
globalThis.__arrayMaterializedSlots = length => { materializedSlots += length }
globalThis.__arrayPointDepth = delta => { pointDepth += delta; maxPointDepth = Math.max(maxPointDepth, pointDepth) }
globalThis.__arrayRangeDepth = delta => { rangeDepth += delta; maxRangeDepth = Math.max(maxRangeDepth, rangeDepth) }
const count = (text, name) => [text, text + "\n    globalThis.__arrayHistoryCount(" + JSON.stringify(name) + ")\n"]
globalThis.__arrayHistoryCount = name => {
    if (name === "copy") copies++
    if (name === "lease") leases++
    if (name === "bound") bounds++
    if (name === "point") points++
    if (name === "join") joins++
    if (name === "childLink") childLinks++
    if (name === "slot") capturedSlots++
}
const loaded = instrumentRuntime([
    ["array-layout.js", [["return createArrayFromRemap(entries, ctx)",
        "globalThis.__arrayMaterializedSlots(entries.length)\n    $&"],
        count("const placement = readArrayPlacement(array, key, ctx, inspect)", "slot")]],
    ["array-remap.js", [count("const i = Number(key), segment = i < storage.prefix ? storage : storage.tail", "slot")]],
    ["array-width.js", [count("narrow(low, high, active) {", "bound"), count("function notifyReader(reader, active) {", "bound"),
        count("const [update, lo, hi] = pending[i]", "bound")]],
    ["property-versions.js", [count("function createCopiedVersion(placement, owner, key, operationContext) {", "copy"),
        count("function retainPlacement(placement, operationContext, retentionParent) {", "lease")]],
    ["array-sequence.js", [
        ["function read(value) {", "$&\n        globalThis.__arrayPointDepth(1); try {"],
        ["        return value\n    }\n}",
            "        return value\n        } finally { globalThis.__arrayPointDepth(-1) }\n    }\n}"],
        ["() => project(current()), ctx, blocked)", "() => { globalThis.__arrayRangeDepth(1); " +
            "try { return project(current()) } finally { globalThis.__arrayRangeDepth(-1) } }, ctx, blocked)"],
        count("function pointAt(source, index, back, project) {", "point")]],
    ["array-sequence-layout.js", [["function deriveSequenceLayout(output, left, right, project, ctx, prerequisite) {",
        "$&\n    if (right) globalThis.__arrayHistoryCount(\"join\")"]]],
    ["array-view.js", [["region.children(undefined, placement => addParent(placement.value, record, placement, operationContext))",
        "region.children(undefined, placement => { globalThis.__arrayHistoryCount(\"childLink\"); addParent(placement.value, record, placement, operationContext) })"]]],
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
    copies = leases = bounds = points = joins = maxPointDepth = maxRangeDepth = 0
    const cuts = ["cuts", "splice-start", "toSpliced-start"].includes(method)
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
        case "cuts": case "splice-start": case "toSpliced-start": {
            const start = i === 1 || method === "cuts" && i % 4 === 3 ? expected.length : i % 3
            const args = [input(start), 0, method === "splice-start" ? input(i) : i]
            if (method === "splice-start" || method === "cuts" && i % 2) call("splice", args, true)
            else array = wrap(call("toSpliced", args))
            expected.splice(start, 0, i)
            break
        }
        case "slice":
            array = wrap(call("slice", [input(0)]))
            break
        }
    }
    if (cuts) assert.equal(joins, 0, "joined unselected splice layouts at issuance")
    const first = r.lookupPath(array, [0], ctx)
    const tailReads = cuts && [r.lookupPath(array, [expected.length - 1], ctx),
        call("at", [-1]), r.lookupPath(wrap(call("toReversed", [])), [0], ctx)]
    if (tailReads) assert(tailReads.every(value => r.isPending(value, ctx)))
    const inspectOrder = method === "concat" || method === "reverse" || method === "toReversed"
    const cursor = inspectOrder && r.iterate(array, [], ctx, { metadata: ["index0"] })
    const pull = cursor && cursor.next()
    if (cuts && method !== "cuts") {
        await tick()
        for (const settle of controls) settle()
    } else for (let i = controls.length - 1; i >= 0; i--) controls[i]()
    assert.deepEqual(await first, expected[0], method)
    if (tailReads) for (const read of tailReads) assert.deepEqual(await read, expected.at(-1), method)
    assert.deepEqual(await r.export(array, [], ctx), expected, method)
    if (cuts) assert(maxPointDepth < 16, method + " nested " + maxPointDepth + " point selections")
    if (cuts) assert(maxRangeDepth < 16, method + " nested " + maxRangeDepth + " range selections")
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

async function outOfOrderStarts(method, mode, interleaved, observe) {
    const ctx = { execution: new r.Execution(), errorContext: method }, controls = []
    let chain = new r.Chain(["A", "B", "C", "D"], ctx, mode)
    const expected = ["A", "B", "C", "D"]
    for (let i = 0; i < n; i++) {
        const control = Promise.withResolvers()
        controls.push(control)
        if (method === "push-delete") {
            r.run(chain, [], "push", [i], ctx, mutation)
            r.run(chain, [], "splice", [control.promise, 1], ctx, mutation)
            expected.push(i)
            expected.splice(1, 1)
        } else {
            const args = [control.promise, 0, i]
            if (method === "splice") r.run(chain, [], method, args, ctx, mutation)
            else chain = new r.Chain(r.run(chain, [], method, args, ctx, {}), ctx, mode)
            expected.splice(1, 0, i)
        }
    }
    const first = observe && r.lookupPath(chain, [0], ctx)
    const end = observe && r.run(chain, [], "at", [-1], ctx, {})
    const errors = observe && r.getErrors(chain, [], ctx)
    const cursor = observe && r.iterate(chain, [], ctx, { windowEnd: 1 })
    const item = cursor && cursor.next()
    const order = interleaved ? controls.filter((_, i) => i % 2).concat(controls.filter((_, i) => !(i % 2))) :
        controls.reverse()
    for (const control of order) control.resolve(1)
    assert.deepEqual(await r.export(chain, [], ctx), expected)
    if (observe) {
        assert.equal(await first, expected[0])
        assert.equal(await end, expected.at(-1))
        assert.equal(await errors, null)
        assert.equal(await r.lookupPath((await item).value, [], ctx), expected[0])
        await cursor.return()
    }
    assert.equal(ctx.execution.fatalError, null)
}

async function fixedEdits(method) {
    const ctx = { execution: new r.Execution(), errorContext: method }, starts = []
    const wrap = value => new r.Chain(value, ctx, method === "length" ? r.CHAIN_MODE.Sequential : r.CHAIN_MODE.Complete)
    const expected = ["A", "B", "C"]
    let chain = wrap(expected.slice())
    materializedSlots = capturedSlots = 0
    for (let i = 0; i < n; i++) {
        const start = Promise.withResolvers(), previous = chain
        starts.push(start)
        if (method === "splice") {
            r.run(chain, [], "splice", [start.promise, 0, i], ctx, mutation)
            expected.splice(1, 0, i)
            continue
        }
        if (method === "length") {
            r.run(chain, [], "push", [i, i], ctx, mutation)
            r.assignPath(chain, ["length"], start.promise, ctx, 0)
            expected.push(i, i)
            expected.length = i + 4
            continue
        }
        chain = wrap(r.run(previous, [], "slice", [start.promise], ctx, {}))
        r.assignPath(previous, [], undefined, ctx)
        r.run(chain, [], method, [i], ctx, mutation)
        expected[method](i)
    }
    for (const [i, start] of starts.entries()) {
        if (method === "length" || method === "splice") {
            const j = n - 1 - i
            starts[j].resolve(method === "length" ? j + 4 : 1)
        } else start.resolve(0)
    }
    assert.deepEqual(await r.export(chain, [], ctx), expected)
    assert(materializedSlots <= 4 * n, `${method} materialized ${materializedSlots} slots for ${n} edits`)
    assert(capturedSlots <= 4 * n, `${method} read ${capturedSlots} storage slots for ${n} edits`)
}

for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
    for (const length of [2048, 0xfffffffe]) await sparse(mode, length)
for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
for (const [method, args, initialCut] of [["pop", [], 1], ["pop", [], 0], ["shift", [], 0],
    ["slice", [0, -1], 0], ["splice", [-1, 1], 0]])
for (const size of [32, 64, 128, 256]) {
    const ctx = { execution: new r.Execution(), errorContext: "regional trim work" }, width = Promise.withResolvers()
    let array = new r.Chain(Array.from({ length: size }, (_, i) => ({ i })), ctx, mode)
    const splice = r.run(array, [], "splice", [initialCut, width.promise], ctx, mutation)
    width.resolve(0)
    await splice
    childLinks = 0
    for (let i = 0; i < size / 2; i++) {
        const output = r.run(array, [], method, args, ctx, method === "slice" ? {} : mutation)
        if (method === "slice") {
            const predecessor = array
            array = new r.Chain(output, ctx, mode)
            r.assignPath(predecessor, [], undefined, ctx)
        }
    }
    assert(childLinks < size * 2, `Republished ${childLinks} region child links during ${size / 2} ${method} trims`)
    assert.equal(r.lookupPath(array, ["length"], ctx), size / 2)
    assert.equal(r.lookupPath(array, [size / 2 - 1, "i"], ctx), method === "shift" ? size - 1 : size / 2 - 1)
}
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
if (!methods.length || methods.includes("out-of-order"))
    for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
        for (const method of ["splice", "toSpliced", "push-delete"])
            for (const interleaved of [false, true])
                await outOfOrderStarts(method, mode, interleaved, interleaved !== (mode === r.CHAIN_MODE.Sequential))
if (!methods.length || methods.includes("slice-edits"))
    for (const method of ["push", "unshift", "splice", "length"]) await fixedEdits(method)
for (const method of methods.length ? methods : ["tail", "copies", "fill", "copyWithin", "reverse", "toReversed", "concat", "toSpliced", "front", "dense", "slice", "cuts", "splice-start", "toSpliced-start"]) {
    if (method === "out-of-order" || method === "slice-edits") continue
    await history(method, ["slice", "cuts"].includes(method) ? r.CHAIN_MODE.Sequential : r.CHAIN_MODE.Unordered)
    if (method === "splice-start" || method === "toSpliced-start") await history(method, r.CHAIN_MODE.Sequential)
    if (n >= 5000) console.log(method, n, "passed")
    await tick()
    globalThis.gc?.()
}
loaded("Array history-depth fixture")
console.log("Array history depth and work verified at", n)
