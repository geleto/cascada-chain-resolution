import assert from "node:assert/strict"
import { promiseHooks } from "node:v8"
import { instrumentRuntime } from "../runtime-transform.js"

let measuring, operations = 0
globalThis.__historyVisit = () => { if (measuring) operations++ }
const count = text => [text, text + "\n        globalThis.__historyVisit()"]
const loaded = instrumentRuntime([
    ["array-occurrences.js", [count("const [node, from, to, low, high, origin] = todo.pop()")]],
    ["array-sequence.js", [count("function cropSequence(source, first, last, ctx) {"),
        count("function watch(sequence, update, ctx) {")]],
    ["array-interval.js", [count("const point = (index, back) => {")]],
    ["array-region.js", [count("const [part, first, end] = todo.pop()")]],
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
loaded("pending Array history")
stopCounting()
console.log("pending Array reader work and release verified")
