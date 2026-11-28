import assert from "node:assert/strict"
import { resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { instrumentRuntime } from "../runtime-transform.js"

// The width implementation and these receipts are common to the plan commit,
// the pilot and the rewrite. Each process measures a single runtime.
const root = pathToFileURL(resolve(process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? ".", "src") + sep)
let phase, live, peak, records
globalThis.widthVisit = key => { phase[key]++ }
globalThis.widthOpen = (record, kind) => {
    records.set(record, kind)
    live[kind]++
    peak[kind] = Math.max(peak[kind], live[kind])
    peak.total = Math.max(peak.total, live.exact + live.member + live.reader)
}
globalThis.widthClose = record => {
    const kind = records.get(record)
    if (kind) { live[kind]--; records.delete(record) }
}
const count = (anchor, key) => [anchor, anchor + "\n        globalThis.widthVisit(" + JSON.stringify(key) + ")"]
const loaded = instrumentRuntime([["array-width.js", [
    ...["root() {", "const outer = path.pop(), inner = outer.source", "for (const run of this.runs) {",
        "for (const run of questions.runs) if (run) {", "const question = from.entries[from.first++]",
        "const q = entries[run.first]", "const q = entries[run.end - 1]"].map(line => count(line, "visits")),
    count("function notifyReader(reader, active) {", "notifications"),
    count("const [update, lo, hi] = pending[i]", "dispatches"),
    ["const receipt = width.exact = {}", "$&\n    globalThis.widthOpen(receipt, 'exact')"],
    ["receipt.value = n", "globalThis.widthClose(receipt); $&"],
    ["const q = { index, deliver }", "$&\n    globalThis.widthOpen(q, 'member')"],
    ["q.run = q.deliver = undefined", "globalThis.widthClose(q); $&", 2],
    ["        attachReader(reader)\n        return () => { reader.remove?.();",
        "        if (reader.low !== reader.high) globalThis.widthOpen(reader, 'reader')\n        attachReader(reader)\n        return () => { globalThis.widthClose(reader); reader.remove?.();"],
    ["if (low === high) reader.remove?.()", "if (low === high) { globalThis.widthClose(reader); reader.remove?.() }"],
]]], true, root)
const r = await import(new URL("index.js", root))
loaded("shrinking history width receipts")
const tick = () => new Promise(setImmediate)
const counters = () => ({ visits: 0, notifications: 0, dispatches: 0 })

let previous
for (const n of [120, 240, 480]) {
    const ctx = { execution: new r.Execution(), errorContext: "reverse shrinking history" }
    const native = ["A", "B", "C"], source = new r.Chain(native.slice(), ctx, r.CHAIN_MODE.Sequential)
    const controls = [], reads = [], expected = []
    peak = { total: 0, exact: 0, member: 0, reader: 0 }
    live = { exact: 0, member: 0, reader: 0 }
    records = new WeakMap()
    const issued = phase = counters()
    for (let i = 0; i < n; i++) {
        const ctl = Promise.withResolvers(), pair = [3 * i, 3 * i + 1]
        controls.push(ctl)
        reads.push(r.run(source, [], "push", pair, ctx, { mutationScopeDepth: 0 }))
        expected.push(native.push(...pair))
        r.run(source, [], "splice", [1, ctl.promise], ctx, { mutationScopeDepth: 0 })
        native.splice(1, 3)
        reads.push(r.lookupPath(source, ["length"], ctx))
        expected.push(native.length)
    }
    const settled = phase = counters()
    for (const ctl of controls.reverse()) { ctl.resolve(3); await tick() }
    assert.deepEqual(await Promise.all(reads), expected)
    const exported = phase = counters()
    assert.deepEqual(await r.export(source, [], ctx), native)
    const released = phase = counters()
    await r.assignPath(source, [], undefined, ctx)
    await tick()
    assert.deepEqual(live, { exact: 0, member: 0, reader: 0 })
    assert(peak.exact > n && peak.member > 0 && settled.visits > 0)
    if (process.argv.includes("--check-bound")) {
        const work = settled.visits + exported.visits
        assert(work < n * (320 + 8 * Math.ceil(Math.log2(n))) && (!previous || work < 2.6 * previous),
            `repeated width propagation for ${n} shrinking edits: ${work}`)
        assert(peak.total < 20 * n && settled.notifications + settled.dispatches < 12 * n)
        previous = work
    }
    console.log(JSON.stringify({ n, pointReaders: 0, scalarAnswers: reads.length, finalSlots: native.length,
        issued, settled, exported, released, peak, live }))
}
