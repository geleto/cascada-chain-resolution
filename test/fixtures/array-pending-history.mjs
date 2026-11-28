import assert from "node:assert/strict"
import { promiseHooks } from "node:v8"
import { instrumentRuntime } from "../runtime-transform.js"

let measuring, operations = 0, retirement
let historyWork
globalThis.__historyVisit = () => { if (measuring) operations++ }
globalThis.__historyRetirement = execution => { if (retirement?.execution === execution) retirement.visits++ }
globalThis.__historyRecord = key => { if (historyWork) historyWork[key]++ }
const count = text => [text, text + "\n        globalThis.__historyVisit()"]
const countRecord = (anchor, key) => [anchor, anchor + "\n        globalThis.__historyRecord(" + JSON.stringify(key) + ")"]
const loaded = instrumentRuntime([
    ["array-occurrences.js", [count("const [node, from, to, low, high, origin] = todo.pop()")]],
    ["array-sequence.js", [count("function cropSequence(source, first, last, ctx) {"),
        count("function watch(sequence, update, ctx) {"),
        countRecord("while (value instanceof PointReference) {", "points"),
        countRecord("while (part.parts || part.capacityInput) {", "points"),
        countRecord("function refine(sequence, minimum, maximum, active) {", "notifications")]],
    ["array-width.js", [
        countRecord("function notifyReader(reader, active) {", "notifications"),
        countRecord("const [update, lo, hi] = pending[i]", "dispatches"),
        countRecord("root() {", "width"),
        countRecord("const outer = path.pop(), inner = outer.source", "width"),
        countRecord("for (const run of this.runs) {", "width"),
        countRecord("for (const run of questions.runs) if (run) {", "width"),
        countRecord("const question = from.entries[from.first++]", "width"),
        countRecord("const q = entries[run.first]", "width"),
        countRecord("const q = entries[run.end - 1]", "width"),
    ]],
    ["array-interval.js", [count("const point = (index, back) => {")]],
    ["array-region.js", [count("const [part, first, end] = todo.pop()")]],
    ["ownership.js", [["const discover = (node, dependent) => {",
        "$&\n        globalThis.__historyRetirement(operationContext.execution)"]]],
])
const stopCounting = promiseHooks.createHook({ init() { if (measuring) operations++ } })
const r = await import("../../src/index.js")
const tick = () => new Promise(setImmediate)
const mutation = { mutationScopeDepth: 0 }
const context = () => ({ execution: new r.Execution(), errorContext: "pending history" })

async function measure(read) {
    operations = 0
    measuring = true
    try { await read(); return operations } finally { measuring = false }
}

async function insertions(n, open = false, interleave = false) {
    const ctx = context(), chain = new r.Chain(open ? ["A", "optional"] : ["A"], ctx), starts = [], issued = []
    const count = open && Promise.withResolvers()
    if (open) r.run(chain, [], "splice", [1, count.promise], ctx, mutation)
    const expected = ["A"]
    for (let i = 0; i < n; i++) {
        const d = Promise.withResolvers()
        starts.push(d)
        r.run(chain, [], "splice", [d.promise, 0, i], ctx, mutation)
        expected.splice(i % 3, 0, i)
        if (interleave) {
            r.run(chain, [], "push", [~i], ctx, mutation)
            expected.push(~i)
        }
    }
    const cost = await measure(async () => {
        assert.equal(r.run(chain, [], "includes", [n - 1], ctx, {}), true)
        const cursor = r.iterate(chain, [], ctx)
        for (let i = 0; i < expected.length; i++) {
            const { index, value } = await cursor.next()
            issued.push([index, r.lookupPath(value, [], ctx)])
        }
        if (!open) assert((await cursor.next()).done)
        await cursor.return()
    })
    for (let i = n - 1; i >= 0; i--) starts[i].resolve(i % 3)
    if (open) count.resolve(1)
    for (const [index, value] of issued) assert.equal(expected[await index], value)
    return cost
}

function history(n, shape) {
    const ctx = context(), chain = new r.Chain(["A", "B", "C"], ctx), count = Promise.withResolvers(), starts = []
    const expected = ["A", "C"]
    const call = (method, args) => r.run(chain, [], method, args, ctx, mutation)
    call("splice", [1, count.promise])
    for (let i = 0; i < n; i++) {
        if (shape === "queue") {
            call("push", [i, i]); call("shift", [])
            expected.push(i, i); expected.shift()
        } else {
            const d = Promise.withResolvers()
            starts.push(d)
            call("push", [i]); call("fill", [i, d.promise, 1])
            expected.push(i); expected.fill(i, i % 2, 1)
        }
    }
    return { ctx, chain, expected, settle() {
        for (let i = starts.length - 1; i >= 0; i--) starts[i].resolve(i % 2)
        count.resolve(1)
    } }
}

async function readers(n, shape) {
    const { ctx, chain, expected, settle } = history(n, shape), checks = []
    const cost = await measure(async () => {
        for (const mode of Object.values(r.CHAIN_MODE)) {
            const view = new r.Chain(r.lookupPath(chain, [], ctx), ctx, mode)
            const call = (method, args) => r.run(view, [], method, args, ctx, {})
            const cursor = r.iterate(view, [], ctx, { metadata: ["index0"] }), items = []
            checks.push((async () => {
                for (;;) {
                    const step = await cursor.next()
                    if (step.done) break
                    items.push([step.metadata.index0, r.lookupPath(step.value, [], ctx)])
                }
                const ordered = []
                for (const [index, value] of items) ordered[await index] = await value
                assert.deepEqual(ordered, expected)
            })())
            for (const [value, want] of [[r.lookupPath(view, [0], ctx), expected[0]],
                [r.lookupPath(view, [n - 1], ctx), expected[n - 1]], [r.getErrors(view, [], ctx), null],
                [call("at", [-1]), n - 1], [call("includes", [n - 1]), true],
                [call("includes", ["absent"]), false], [call("indexOf", [n - 1]), expected.indexOf(n - 1)]])
                checks.push(Promise.resolve(value).then(actual => assert.deepEqual(actual, want)))
        }
        await tick()
    })
    settle()
    await Promise.all(checks)
    return cost
}

for (const [name, run] of [["insertions", insertions], ["open insertions", n => insertions(n, true)],
    ["insertions and pushes", n => insertions(n, false, true)], ["queue", n => readers(n, "queue")],
    ["fill", n => readers(n, "fill")]]) {
    const small = await run(48), large = await run(144)
    assert(small > 0 && large < 4 * small + 128, `${name} pending reader work: ${small}, ${large}`)
}

async function completedReaders(chain, ctx) {
    const refs = []
    for (let i = 0; i < 25; i++) {
        const op = { execution: ctx.execution, errorContext: { reader: i } }
        const slice = r.run(chain, [], "slice", [-1], op, {})
        const cursor = r.iterate(chain, [], op)
        assert.equal(r.run(chain, [], "includes", [59], op, {}), true)
        assert.deepEqual(r.export(new r.Chain(slice, op), [], op), [59])
        await cursor.return()
        refs.push(new WeakRef(op), new WeakRef(cursor), new WeakRef(slice))
    }
    return refs
}
const live = history(60, "queue")
const refs = await completedReaders(live.chain, live.ctx)
const duplicates = new r.Chain(["X"], live.ctx), starts = []
for (const values of [["A"], ["B", "X"]]) {
    const start = Promise.withResolvers()
    starts.push(start)
    r.run(duplicates, [], "splice", [start.promise, 0, ...values], live.ctx, mutation)
}
function boundedSearches() {
    for (let i = 0; i < 24; i++) {
        const op = { execution: live.ctx.execution, errorContext: { search: i } }
        assert.equal(r.run(duplicates, [], "includes", ["X", 1], op, {}), true)
        refs.push(new WeakRef(op))
    }
}
boundedSearches()
async function mixedReaders() {
    const hold = Promise.withResolvers(), deliveries = []
    for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) {
        const chain = new r.Chain(["A", "B", "optional"], live.ctx, mode)
        r.run(chain, [], "splice", [2, hold.promise], live.ctx, mutation)
        for (let i = 0; i < 24; i++) {
            const start = Promise.withResolvers(), value = Promise.withResolvers()
            deliveries.push(() => { start.resolve(0); value.resolve(i) })
            r.run(chain, [], "splice", [start.promise, 0, i === 7 ? "needle" : value.promise], live.ctx, mutation)
        }
        r.run(chain, [], "push", ["Z"], live.ctx, mutation)
        for (let i = 0; i < 16; i++) {
            const op = { execution: live.ctx.execution, errorContext: { mixed: i } }
            assert.equal(r.run(chain, [], "includes", ["Z", 1], op, {}), true)
            if (mode === r.CHAIN_MODE.Unordered) assert.equal(r.run(chain, [], "includes", ["needle"], op, {}), true)
            const cursor = r.iterate(chain, [], op, { windowEnd: 2 })
            await cursor.return()
            refs.push(new WeakRef(op), new WeakRef(cursor))
        }
    }
    return () => { hold.resolve(1); for (const deliver of deliveries) deliver() }
}
const settleMixed = await mixedReaders()
async function closedMetadataCursors() {
    for (let i = 0; i < 12; i++) {
        const op = { execution: live.ctx.execution, errorContext: { cursor: i } }
        const cursor = r.iterate(duplicates, [], op, { metadata: ["index", "revindex", "first", "last"] })
        while (!(await cursor.next()).done) {}
        await cursor.return()
        refs.push(new WeakRef(op), new WeakRef(cursor))
    }
}
await closedMetadataCursors()
for (let i = 0; i < 5; i++) { await tick(); globalThis.gc() }
assert.deepEqual(refs.flatMap((ref, i) => ref.deref() ? [i] : []), [], "completed readers retained while the count is pending")
assert.equal(r.run(live.chain, [], "includes", [59], live.ctx, {}), true)
live.settle()
settleMixed()
for (const start of starts) start.resolve(0)

// A transient reader releasing a managed candidate cannot re-prove every
// still-live layout between that candidate and the current Array owner.
async function noEffectRetirement(n, mode, payload, back, hold) {
    const ctx = context(), inputs = [], saved = []
    const rejected = payload === "rejected" && Promise.withResolvers()
    const value = payload === "managed" ? { n: 1 } :
        rejected ? r.validationError("rejected slot", ctx, r.ERROR_KIND.OperationInputFailed) : "A"
    const chain = new r.Chain([rejected ? rejected.promise : value], ctx, mode)
    retirement = { execution: ctx.execution, visits: 0 }
    for (let i = 0; i < n; i++) {
        const count = Promise.withResolvers()
        inputs.push(count)
        r.run(chain, [], "splice", [0, count.promise], ctx, mutation)
        if (hold) saved.push(r.capturePath(chain, [], ctx, mode))
    }
    await tick()
    const issued = retirement.visits
    retirement.visits = 0
    if (rejected) { rejected.reject(value); await tick() }
    if (back) inputs.reverse()
    for (const input of inputs) { input.resolve(0); await tick() }
    const settled = retirement.visits
    retirement = undefined
    const scenario = [n, mode, payload, back, hold].join("/")
    assert(issued > 0 && issued <= 20 * n, "no-effect issuance retirement visits " + scenario + ": " + issued)
    assert(settled <= 20 * n, "no-effect settlement retirement visits " + scenario + ": " + settled)
    for (const view of [chain, ...saved]) {
        assert.equal(r.lookupPath(view, ["length"], ctx), 1)
        assert.equal(await r.lookupPath(view, [0], ctx), value)
        r.assignPath(view, [], undefined, ctx)
    }
}
for (const mode of [r.CHAIN_MODE.Unordered, r.CHAIN_MODE.Sequential])
    for (const payload of ["scalar", "managed", "rejected"]) for (const back of [false, true])
        for (const hold of [false, true]) for (const n of [32, 64, 128])
            await noEffectRetirement(n, mode, payload, back, hold)

// A selector replaces its old operand path with a new path through the
// retained slots. Forward settlement makes the surviving ancestry longest.
for (const n of [64, 128, 256]) for (const search of [false, true]) {
    const ctx = context(), expected = ["A", "B", "C"], deliveries = []
    const chain = new r.Chain(expected.slice(), ctx, r.CHAIN_MODE.Sequential)
    for (let i = 0; i < n; i++) {
        const start = Promise.withResolvers(), payload = Promise.withResolvers()
        deliveries.push([start, i % 3], [payload, i])
        r.run(chain, [], "splice", [start.promise, 0, payload.promise], ctx, mutation)
        expected.splice(i % 3, 0, i)
    }
    const miss = search && r.run(chain, [], "includes", ["Q"], ctx, {})
    await tick()
    retirement = { execution: ctx.execution, visits: 0 }
    for (const [delivery, value] of deliveries) delivery.resolve(value)
    assert.equal(await miss, false)
    assert.deepEqual(await r.export(chain, [], ctx), expected)
    const { visits } = retirement
    retirement = undefined
    assert(visits > 0 && visits < 32 * n, `forward splice settlement visited ${visits} retirement nodes for ${n} insertions`)
}

// A later deletion can prove a range error while an earlier capture still
// needs its own delete count. Both consumers are issued before either input.
{
    const ctx = context(), mode = r.CHAIN_MODE.Sequential
    const source = new r.Chain(["A", "B", "C"], ctx, mode)
    const first = Promise.withResolvers(), last = Promise.withResolvers()
    r.run(source, [], "push", ["X", "Y"], ctx, mutation)
    r.run(source, [], "splice", [1, first.promise], ctx, mutation)
    const earlier = r.capturePath(source, [], ctx, mode)
    const oldCopy = new r.Chain(r.run(earlier, [], "with", [4, "Z"], ctx, {}), ctx, mode)
    const old = r.export(oldCopy, [], ctx)
    r.run(source, [], "push", ["U", "V"], ctx, mutation)
    r.run(source, [], "splice", [1, last.promise], ctx, mutation)
    const current = r.run(source, [], "with", [6, "Z"], ctx, {})
    let oldReady = false, rangeError
    Promise.resolve(old).then(() => { oldReady = true })
    Promise.resolve(current).then(value => { rangeError = value })
    last.resolve(1)
    await tick()
    assert.equal(rangeError?.kind, r.ERROR_KIND.InvalidArrayOperation)
    assert.equal(oldReady, false)
    first.resolve(0)
    assert.deepEqual(await old, ["A", "B", "C", "X", "Z"])
    assert.deepEqual(await r.export(source, [], ctx), ["A", "C", "X", "Y", "U", "V"])
}

// The baseline point hooks count forwarding records and join/capacity nodes.
// Charge a replacement index for each mapping examined during construction,
// query, update and release. Keep width and final output work separate.
function startHistoryPhase() {
    historyWork = { points: 0, width: 0, notifications: 0, dispatches: 0 }
    return historyWork
}

async function measureSpliceHistory(n, count, retainPoints, { prependAndTrim, readLengths }) {
    const ctx = context(), model = ["A", "B", "C"], counts = [], reads = [], expected = []
    const chain = new r.Chain(model.slice(), ctx, r.CHAIN_MODE.Sequential)
    let duringLookup = 0
    const issued = startHistoryPhase()
    for (let i = 0; i < n; i++) {
        const control = Promise.withResolvers()
        counts.push(control)
        const first = 3 * i, second = first + 1
        reads.push(r.run(chain, [], "push", [first, second], ctx, mutation))
        expected.push(model.push(first, second))
        r.run(chain, [], "splice", [1, control.promise], ctx, mutation)
        model.splice(1, count)
        if (prependAndTrim) {
            r.run(chain, [], "unshift", [first + 2], ctx, mutation)
            model.unshift(first + 2)
            r.run(chain, [], "splice", [-1, 1], ctx, mutation)
            model.splice(-1, 1)
        }
        if (readLengths) {
            reads.push(r.lookupPath(chain, ["length"], ctx))
            expected.push(model.length)
        }
        if (retainPoints) {
            const index = 1 + i % 15, before = issued.points
            reads.push(r.lookupPath(chain, [index], ctx))
            expected.push(model[index])
            duringLookup += issued.points - before
        }
    }
    const settled = startHistoryPhase()
    for (const control of counts.reverse()) control.resolve(count)
    assert.deepEqual(await Promise.all(reads), expected)
    const exported = startHistoryPhase()
    assert.deepEqual(await r.export(chain, [], ctx), model)
    const released = startHistoryPhase()
    await r.assignPath(chain, [], undefined, ctx)
    historyWork = undefined
    const notifications = settled.notifications + settled.dispatches + exported.notifications + exported.dispatches
    assert(notifications < 12 * n, `width notifications for ${n} splices deleting ${count}, points=${retainPoints}`)
    return { n, count, retainPoints, prependAndTrim, readLengths, issued, settled, exported, released, duringLookup }
}

const lookupGrowth = []
const checkLookupBound = process.argv.includes("--check-lookup-bound")

async function measureLookupPair(n, count, options) {
    const control = await measureSpliceHistory(n, count, false, options)
    const points = await measureSpliceHistory(n, count, true, options)
    // Require work from a lookup itself or extra work during its settlement.
    // Activity common to both programs cannot supply this receipt.
    assert(points.duringLookup > 0 || points.settled.points > control.settled.points,
        `retained lookup counter missed its public route for ${n} splices deleting ${count}, ${JSON.stringify(options)}`)
    lookupGrowth.push(control, points)
    return control
}

for (const count of [1, 3]) {
    let previousWidth
    for (const n of [120, 240, 480]) {
        const control = await measureLookupPair(n, count, { prependAndTrim: false, readLengths: true })
        const visits = control.settled.width + control.exported.width
        assert(visits > 0 && visits < n * (300 + 8 * Math.ceil(Math.log2(n))), `width visits ${visits} for ${n} splices deleting ${count}`)
        if (previousWidth) assert(visits < 2.6 * previousWidth, `width visits doubled from ${previousWidth} to ${visits}`)
        previousWidth = visits
    }
}
// Vary the history and explicit length reads independently. Keep the
// additional samples small in the ordinary subprocess regression.
for (const options of [
    { prependAndTrim: false, readLengths: false },
    { prependAndTrim: true, readLengths: false },
    { prependAndTrim: true, readLengths: true },
]) {
    for (const n of checkLookupBound ? [120, 240, 480] : [32])
        await measureLookupPair(n, 1, options)
}
console.log("retained lookup work " + JSON.stringify(lookupGrowth))

// A later clipping count makes a distinct appended value certain. An older
// historical point still depends on the first count.
{
    const ctx = context(), source = new r.Chain(["A", "B", "C"], ctx, r.CHAIN_MODE.Sequential)
    const first = Promise.withResolvers(), last = Promise.withResolvers()
    const call = (method, args) => r.run(source, [], method, args, ctx, mutation)
    call("push", ["U", "V"]); call("splice", [1, first.promise])
    const earlier = r.lookupPath(source, [1], ctx)
    call("push", ["W", "X"]); call("splice", [1, last.promise])
    call("push", ["Y", "Z"]); call("splice", [1, 1])
    const later = r.lookupPath(source, [1], ctx)
    assert(r.isPending(earlier, ctx) && r.isPending(later, ctx))
    last.resolve(6)
    await tick()
    const pending = Symbol("pending")
    assert.equal(await Promise.race([earlier, Promise.resolve(pending)]), pending)
    assert.equal(await Promise.race([later, Promise.resolve(pending)]), "Z")
    first.resolve(1)
    assert.equal(await earlier, "C")
    assert.deepEqual(await r.export(source, [], ctx), ["A", "Z"])
}

// Each known delete count of three cancels its push and one earlier slot.
// The last snapshot is exact after enough deletions, even with the first
// count still held. Its immediate predecessor can still be one or two.
{
    const ctx = context(), source = new r.Chain(["A", "B", "C"], ctx, r.CHAIN_MODE.Sequential)
    const first = Promise.withResolvers(), counts = [], answers = []
    for (let i = 0; i < 5; i++) {
        const control = i ? Promise.withResolvers() : first
        counts.push(control)
        r.run(source, [], "push", [i, i], ctx, mutation)
        r.run(source, [], "splice", [1, control.promise], ctx, mutation)
        const index = i
        Promise.resolve(r.lookupPath(source, ["length"], ctx)).then(n => { answers[index] = n })
    }
    for (let i = 4; i > 0; --i) counts[i].resolve(3)
    await tick()
    assert.deepEqual([...answers], [undefined, undefined, undefined, undefined, 1])
    first.resolve(0)
    await tick()
    assert.deepEqual(answers, [5, 4, 3, 2, 1])
    assert.deepEqual(await r.export(source, [], ctx), ["A"])
}

loaded("pending Array history")
stopCounting()
if (checkLookupBound) {
    const total = (row, key) => row.issued[key] + row.settled[key] + row.exported[key] + row.released[key]
    const violations = []
    const growing = lookupGrowth.filter(row => row.count === 1 && row.retainPoints)
    const series = Map.groupBy(growing, row => `prependAndTrim=${row.prependAndTrim} readLengths=${row.readLengths}`)
    for (const [label, rows] of series) {
        for (let i = 1; i < rows.length; i++) {
            const previous = rows[i - 1], current = rows[i]
            for (const key of ["points", "width"]) {
                const small = total(previous, key), large = total(current, key)
                if (large > 0 && large >= 2.6 * small)
                    violations.push(`${label} H=${previous.n}/${current.n} ${key} ${small}/${large}`)
            }
        }
    }
    assert.equal(violations.length, 0, "retained lookup growth exceeded the doubling check\n" + violations.join("\n"))
}
console.log("pending Array reader work and release verified")
