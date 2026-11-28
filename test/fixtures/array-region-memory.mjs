import assert from "node:assert/strict"
import { instrumentRuntime } from "../runtime-transform.js"

const measure = (anchor, field) => [anchor, anchor + "\n    globalThis.arrayRegionCount('" + field + "')"]
let counts, regions
globalThis.arrayRegionCount = field => { if (counts) counts[field]++ }
globalThis.arrayRegionCreated = region => { if (regions) regions.push(new WeakRef(region)) }
const loaded = instrumentRuntime([
    ["array-layout.js", [
        ...["function fixedPayloads(node, ctx) {", "function individualFixedSlots(node, ctx) {",
            "function resolvedFixedLayout(node) {", "function followFixedChildren(node, use, offset, previous, indexed = false) {",
            "function settledScalarLayout(node, seen = new Map()) {", "function mapLayout(node, select, cache = new Map()) {"].map(s => measure(s, "tree")),
        ["if (copies.has(part) || include && !include(part)) return",
            "globalThis.arrayRegionCount('tree'); $&"],
        ["for (let offset = 0; offset < part.length; offset++) visit(index + offset, part.placement)",
            "for (let offset = 0; offset < part.length; offset++) { globalThis.arrayRegionCount('slots'); visit(index + offset, part.placement) }"],
        measure(";(this.listeners ??= new Set()).add(use)", "subscriptions"),
        ["deliver(index, placement, count, indexed) { this.parent.deliver", "deliver(index, placement, count, indexed) { globalThis.arrayRegionCount('links'); this.parent.deliver"],
    ]],
    ["array-region.js", [
        ["super(span(0))", "$&\n        globalThis.arrayRegionCreated(this)"],
        ["versionAt(index, delivered) {", "$&\n        if (delivered) globalThis.arrayRegionCount('deliveredPoints')"],
    ]],
    ["property-versions.js", [
        [/function installPlacementGate(?:Untraced)?\(owner, key, operationContext, captured, capturedVersion\) \{/g,
            "$&\n    globalThis.arrayRegionCount('gates')"],
    ]],
    ["array-sequence.js", [
        ["function followLength(sequence, ctx) {",
            "$&\n    if (sequence.watch) throw new Error('A self-refining count subscribed to its own length')"],
    ]],
    ["language-values.js", [
        ["return Reflect.apply(then, value, [fulfill, reject])", "globalThis.arrayRegionCount('continuations'); $&"],
    ]],
], !process.argv.includes("--without-counters"))
const r = await import("../../src/index.js")
const { ArrayView } = await import("../../src/array-view.js")
const { getParentPlacements } = await import("../../src/parent-placements.js")
const { hasReadLease } = await import("../../src/meta.js")
loaded("Array region memory counters")
const turn = () => new Promise(setImmediate)
const size = Number(process.argv[2] ?? 96)
const mut = { mutationScopeDepth: 0 }
const context = label => ({ execution: new r.Execution(), errorContext: label })
const freshCounts = () => ({ tree: 0, slots: 0, subscriptions: 0, continuations: 0, deliveredPoints: 0, gates: 0, links: 0 })

function prepend(method, source, values, ctx) {
    if (method === "unshift" || method === "splice") {
        r.run(source, [], method, method === "unshift" ? values : [0, 0, ...values], ctx, mut)
        return source
    }
    let output
    if (method === "concat") {
        const prefix = new r.Chain(values, ctx)
        output = new r.Chain(r.run(prefix, [], method, [r.lookupPath(source, [], ctx)], ctx, {}), ctx)
        r.assignPath(prefix, [], undefined, ctx)
    } else output = new r.Chain(r.run(source, [], method, [0, 0, ...values], ctx, {}), ctx)
    r.assignPath(source, [], undefined, ctx)
    return output
}

async function history(method, n, widthFirst) {
    const ctx = context(method), width = Promise.withResolvers(), inputs = [], snapshots = []
    let source = new r.Chain(["A", "B", "C"], ctx)
    r.run(source, [], "splice", [1, width.promise], ctx, mut)
    counts = freshCounts()
    for (let i = 0; i < n; i++) {
        const input = Promise.withResolvers()
        inputs.push(input)
        if (method === "push") {
            r.run(source, [], "push", [input.promise], ctx, mut)
            snapshots.push(new r.Chain(r.lookupPath(source, [], ctx), ctx))
        } else source = prepend(method, source, [input.promise], ctx)
    }
    const issue = counts
    counts = freshCounts()
    const payloads = () => { for (let i = n - 1; i >= 0; i--) inputs[i].resolve(i) }
    if (widthFirst) width.resolve(1)
    else payloads()
    await turn()
    const first = counts
    counts = freshCounts()
    if (widthFirst) payloads()
    else width.resolve(1)
    await turn()
    const second = counts
    const exportWork = counts = freshCounts()
    const values = Array.from({ length: n }, (_, i) => i)
    const final = await r.export(source, [], ctx)
    let exportedSlots = final.length
    assert.deepEqual(final, method === "push" ? ["A", "C", ...values] : [...values.reverse(), "A", "C"])
    for (const [i, snapshot] of snapshots.entries()) {
        const out = await r.export(snapshot, [], ctx)
        assert.deepEqual(out, ["A", "C", ...values.slice(0, i + 1)])
        exportedSlots += out.length
        r.assignPath(snapshot, [], undefined, ctx)
    }
    counts = undefined
    r.assignPath(source, [], undefined, ctx)
    assert.equal(ctx.execution.fatalError, null)
    const total = freshCounts()
    for (const key of Object.keys(total)) total[key] = issue[key] + first[key] + second[key]
    assert(total.tree > n && total.continuations > n)
    if (method !== "push" || widthFirst) assert(total.subscriptions > 0)
    assert(total.slots <= 4 * n, method + " copied slots: " + total.slots)
    if (process.argv.includes("--report")) console.log(JSON.stringify({ method, n, widthFirst, issue, first, second, exportWork, exportedSlots }))
    return total
}

async function countPendingExport() {
    const ctx = context("slot counter control"), width = Promise.withResolvers(), value = Promise.withResolvers()
    const source = new r.Chain(["A", "B", "C"], ctx)
    r.run(source, [], "splice", [1, width.promise], ctx, mut)
    r.run(source, [], "unshift", [value.promise], ctx, mut)
    counts = freshCounts()
    const out = r.export(source, [], ctx)
    width.resolve(1)
    await turn()
    assert(counts.slots > 0, "an export consuming the pending range must exercise the slot counter")
    counts = undefined
    value.resolve(7)
    assert.deepEqual(await out, [7, "A", "C"])
}

async function mixedPrefixes() {
    const ctx = context("published prefix"), width = Promise.withResolvers(), n = 36
    const source = new r.Chain(["A", "B", "C"], ctx), inputs = [], snapshots = [], values = []
    r.run(source, [], "splice", [1, width.promise], ctx, mut)
    for (let i = 0; i < n; i++) {
        const value = Promise.withResolvers()
        inputs.push(value)
        values.push(i % 3 ? i : { i })
        r.run(source, [], "unshift", [value.promise], ctx, mut)
        snapshots.push(r.capturePath(source, [], ctx))
    }
    counts = freshCounts()
    for (let i = 0; i < n; i += 3) inputs[i].resolve(values[i])
    await turn()
    assert(counts.deliveredPoints > n)
    assert.equal(counts.gates, 0, "ready children have backing placements in each held version")
    const parents = getParentPlacements(values[0], ctx)
    for (const [i, snapshot] of snapshots.entries()) {
        const raw = r.lookupPath(snapshot, [], ctx)
        assert(parents.some(p => p.parent === raw && p.key === String(i)))
    }
    counts = freshCounts()
    width.resolve(1)
    await turn()
    assert(counts.deliveredPoints <= n, "closing the width replayed already published managed children")
    counts = undefined
    for (let i = n - 1; i >= 0; i--) if (i % 3) inputs[i].resolve(values[i])
    for (const [i, snapshot] of snapshots.entries()) {
        assert.deepEqual(await r.export(snapshot, [], ctx), [...values.slice(0, i + 1).reverse(), "A", "C"])
        r.assignPath(snapshot, [], undefined, ctx)
    }
}

async function collect() {
    for (let i = 0; i < 6; i++) { await turn(); global.gc() }
}

function issueCensus(hold) {
    const ctx = context(hold), width = Promise.withResolvers(), inputs = [], results = []
    const target = new r.Chain(["A", "B", "C"], ctx), n = 32
    r.run(target, [], "splice", [1, width.promise], ctx, mut)
    regions = []
    for (let i = 0; i < n; i++) {
        const input = Promise.withResolvers()
        inputs.push(input)
        const length = r.run(target, [], "push", [input.promise], ctx, mut)
        if (hold === "lengths") results.push(length)
        if (hold === "views") results.push(new r.Chain(r.lookupPath(target, [], ctx), ctx))
        if (hold === "points" && (i + 1) % 8 === 0) results.push(r.lookupPath(target, [i + 2], ctx))
    }
    const captured = regions
    regions = undefined
    return { ctx, width, inputs, results, target, n, captured }
}

async function census(hold) {
    const { ctx, width, inputs, results, target, n, captured } = issueCensus(hold)
    await collect()
    const live = captured.filter(ref => ref.deref()).length
    const limit = hold === "views" ? n : hold === "points" ? n / 8 : 1
    assert(captured.length && live && live <= limit, hold + " retained " + live + " of " + captured.length)
    for (let i = n - 1; i >= 0; i--) inputs[i].resolve(i)
    width.resolve(1)
    for (const [i, result] of results.entries()) {
        if (hold === "views") {
            assert.equal(await r.lookupPath(result, ["length"], ctx), i + 3)
            r.assignPath(result, [], undefined, ctx)
        } else assert.equal(await result, hold === "lengths" ? i + 3 : (i + 1) * 8 - 1)
    }
    assert.deepEqual(await r.export(target, [], ctx), ["A", "C", ...inputs.map((_, i) => i)])
    r.assignPath(target, [], undefined, ctx)
    await collect()
    assert(captured.every(ref => !ref.deref()))
}

async function childLifetime(method) {
    const ctx = context(method), width = Promise.withResolvers(), slow = Promise.withResolvers(), fast = Promise.withResolvers()
    function issue() {
        const source = new r.Chain(["A", "B", "C"], ctx), binding = new r.Chain(r.import({ value: 7 }, ctx), ctx)
        const child = r.lookupPath(binding, [], ctx)
        r.run(source, [], "splice", [1, width.promise], ctx, mut)
        const output = prepend(method, source, [slow.promise, fast.promise, child], ctx)
        const raw = r.lookupPath(output, [], ctx)
        assert.deepEqual(getParentPlacements(child, ctx).filter(p => p.parent === raw).map(p => p.key), ["2"])
        const held = new r.Chain(raw, ctx)
        r.assignPath(binding, [], undefined, ctx)
        return { output, held, ref: new WeakRef(child) }
    }
    const state = issue()
    fast.resolve(8)
    width.resolve(1)
    await collect()
    await verifyAndRelease(state, ctx)
    await collect()
    assert.equal(state.ref.deref(), undefined, method)
    slow.resolve(0)
    await turn()
    assert.equal(ctx.execution.fatalError, null)
}

// End the positive control's frame before testing reachability. In particular,
// a temporary holder used by a lookup must not be a root during forced GC.
async function verifyAndRelease(state, ctx) {
    assert(state.ref.deref())
    assert.equal(r.lookupPath(state.held, ["length"], ctx), 5)
    assert.equal(await r.lookupPath(state.held, [1], ctx), 8)
    assert.equal(await r.lookupPath(state.held, [2, "value"], ctx), 7)
    r.assignPath(state.output, [], undefined, ctx)
    r.assignPath(state.held, [], undefined, ctx)
    state.held = state.output = undefined
}

async function flatCaptureLifetime(mode, widthFirst) {
    const ctx = context("flat source release"), width = Promise.withResolvers()
    const slow = Promise.withResolvers(), fast = Promise.withResolvers()
    const source = new r.Chain(["A", "B", "C"], ctx, mode)
    r.run(source, [], "splice", [1, width.promise], ctx, mut)
    r.run(source, [], "unshift", [slow.promise, fast.promise], ctx, mut)
    const copy = new r.Chain(r.run(source, [], "flat", [0], ctx, {}), ctx, mode)
    if (widthFirst) width.resolve(1)
    else fast.resolve("fast")
    await turn()
    if (widthFirst) fast.resolve("fast")
    else width.resolve(1)
    await turn()
    assert.equal(await r.lookupPath(copy, ["length"], ctx), 4)
    assert.equal(await r.lookupPath(copy, [1], ctx), "fast")
    assert.equal(hasReadLease(r.lookupPath(source, [], ctx), ctx), false)
    r.assignPath(source, [], undefined, ctx)
    slow.resolve("slow")
    assert.deepEqual(await r.export(copy, [], ctx), ["slow", "fast", "A", "C"])
}

async function middleInsertions(n) {
    const ctx = context("middle insertions"), width = Promise.withResolvers(), inputs = []
    const source = new r.Chain(["A", "B", "C", "D"], ctx), expected = ["A", "B", "C"]
    r.run(source, [], "splice", [3, width.promise], ctx, mut)
    counts = freshCounts()
    for (let i = 0; i < n; i++) {
        const value = Promise.withResolvers(), index = 1 + Math.floor(i / 2)
        inputs.push(value)
        r.run(source, [], "splice", [index, 0, value.promise], ctx, mut)
        expected.splice(index, 0, i)
    }
    assert(counts.slots <= 4 * n, "moving middle recopied " + counts.slots + " slots")
    counts = undefined
    width.resolve(1)
    for (let i = n - 1; i >= 0; i--) inputs[i].resolve(i)
    assert.deepEqual(await r.export(source, [], ctx), expected)
}

async function rejectedInsertions(n, position, hold) {
    const ctx = context("rejected insertions"), width = Promise.withResolvers()
    const source = new r.Chain(["A", "B", "C", "D"], ctx), expected = ["A", "B", "C"]
    const inputs = [], snapshots = []
    r.run(source, [], "splice", [3, width.promise], ctx, mut)
    counts = freshCounts()
    for (let i = 0; i < n; i++) {
        const input = Promise.withResolvers()
        const cause = r.validationError("insertion " + i, ctx, r.ERROR_KIND.OperationInputFailed)
        const at = position === "head" ? 0 : position === "middle" ? 1 + Math.floor(i / 2) : expected.length
        if (position === "tail") r.run(source, [], "push", [input.promise], ctx, mut)
        else r.run(source, [], "splice", [at, 0, input.promise], ctx, mut)
        inputs.push({ input, cause })
        expected.splice(at, 0, cause)
        if (hold) snapshots.push({ view: r.capturePath(source, [], ctx), at, cause })
    }
    const issue = counts
    await turn()
    counts = freshCounts()
    for (const { input, cause } of inputs.reverse()) input.reject(cause)
    await turn()
    const delivery = counts
    // A rejected payload owns no managed parent key. Distinct historical
    // causes can share the captured leaves before anyone requests a slot.
    assert(delivery.deliveredPoints <= 4 * n, position + " redelivered " + delivery.deliveredPoints + " rejected points")
    assert(delivery.links <= 4 * n, position + " forwarded " + delivery.links + " rejected deliveries")
    counts = freshCounts()
    width.resolve(1)
    await turn()
    const settle = counts
    counts = undefined
    assert.equal(r.lookupPath(source, ["length"], ctx), expected.length)
    for (const [i, expectedValue] of expected.entries()) assert.equal(r.lookupPath(source, [i], ctx), expectedValue)
    for (const { view, at, cause } of snapshots) {
        assert.equal(r.lookupPath(view, [at], ctx), cause)
        r.assignPath(view, [], undefined, ctx)
    }
    if (process.argv.includes("--report")) console.log(JSON.stringify({ position, hold, n, issue, delivery, settle }))
}

async function retiredErrorIndex() {
    const ctx = context("retired fixed Error index"), width = Promise.withResolvers()
    const first = Promise.withResolvers(), second = Promise.withResolvers()
    const a = r.validationError("first", ctx, r.ERROR_KIND.OperationInputFailed)
    const b = r.validationError("second", ctx, r.ERROR_KIND.OperationInputFailed)
    const source = new r.Chain(["A", "B"], ctx)
    r.run(source, [], "splice", [1, width.promise], ctx, mut)
    r.run(source, [], "unshift", [first.promise, second.promise], ctx, mut)
    const indexed = r.capturePath(source, [], ctx)
    r.assignPath(source, [2], "replacement", ctx)
    const region = ArrayView.region(r.lookupPath(source, [], ctx), ctx)
    assert.equal(region, ArrayView.region(r.lookupPath(indexed, [], ctx), ctx))
    const found = r.hasError(indexed, [], ctx)
    first.reject(a)
    assert.equal(await found, true)
    assert.equal(region.indexed.size, 1)
    r.assignPath(indexed, [], undefined, ctx)
    assert.equal(region.indexed.size, 0)
    counts = freshCounts()
    second.reject(b)
    await turn()
    assert.equal(counts.links, 0, "a retired index kept forwarding rejected placements")
    counts = undefined
    assert.equal(r.lookupPath(source, [1], ctx), b)
    width.resolve(1)
    assert.deepEqual(new Set((await r.getErrors(source, [], ctx)).errors), new Set([a, b]))
}

async function fixedHeadReads(n) {
    const ctx = context("fixed head reads"), width = Promise.withResolvers(), pay = Promise.withResolvers()
    const callback = () => 42
    const data = Array.from({ length: n + 1 }, (_, i) => i % 5 ? i : callback)
    const source = new r.Chain(data, ctx)
    r.run(source, [], "splice", [n, width.promise], ctx, mut)
    r.run(source, [], "unshift", [pay.promise], ctx, mut)
    counts = freshCounts()
    for (let i = 0; i < n; i++) assert.equal(r.lookupPath(source, [i + 1], ctx), data[i])
    assert.equal(counts.gates, 0)
    counts = undefined
    width.resolve(1)
    pay.resolve("first")
    assert.deepEqual(await r.export(source, [], ctx), ["first", ...data.slice(0, n)])
}

await middleInsertions(size)
await fixedHeadReads(size)
await countPendingExport()
await mixedPrefixes()
for (const method of ["unshift", "splice", "toSpliced", "concat", "push"]) for (const widthFirst of [false, true]) {
    const small = await history(method, Math.floor(size / 2), widthFirst)
    const large = await history(method, size, widthFirst)
    for (const field of ["tree", "subscriptions", "continuations"])
        assert(large[field] <= small[field] * 3.2, method + " " + field + ": " + small[field] + " -> " + large[field])
}
for (const position of ["head", "middle", "tail"]) for (const hold of [false, true])
    for (const n of [Math.floor(size / 2), size, size * 2]) await rejectedInsertions(n, position, hold)
await retiredErrorIndex()
for (const hold of ["current", "lengths", "points", "views"]) await census(hold)
for (const method of ["unshift", "splice", "toSpliced", "concat"]) await childLifetime(method)
for (const mode of Object.values(r.CHAIN_MODE)) for (const widthFirst of [false, true]) await flatCaptureLifetime(mode, widthFirst)
console.log("Shared Array ranges and retired destinations verified")
