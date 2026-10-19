// Work and GC acceptance for the opt-in N2 producer, independently of copy counts.
// node --expose-gc --import ./test/experiments/n2-validation-reuse.mjs test/experiments/n2-validation-coverage-checks.mjs
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

assert(global.gc, "Run with --expose-gc")
const coverageURL = new URL("./n2-validation-coverage.mjs", import.meta.url).href
const inputURL = new URL("../../src/input-preparations.js", import.meta.url).href
const reset = () => globalThis.n2CoverageProbe = {
    queries: 0, visits: 0, additions: 0, bitSteps: 0, copies: 0, nodes: [],
}
reset()
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    let source = String(result.source)
    const edits = url === coverageURL ? [
        ["function hasCoverage(root, id) {", "function hasCoverage(root, id) {\n    globalThis.n2CoverageProbe.queries++"],
        ['    while (typeof root === "object") root = side(id, root.bit) ? root.one : root.zero',
            '    while (typeof root === "object") { globalThis.n2CoverageProbe.visits++; root = side(id, root.bit) ? root.one : root.zero }'],
        ["function addCoverage(root, id) {", "function addCoverage(root, id) {\n    globalThis.n2CoverageProbe.additions++"],
        ["    while (left !== right) {", "    while (left !== right) {\n        globalThis.n2CoverageProbe.bitSteps++"],
        ["function branch(bit, zero, one) { return { bit, zero, one } }",
            "function branch(bit, zero, one) { const node = { bit, zero, one }; globalThis.n2CoverageProbe.nodes.push(new WeakRef(node)); return node }"],
    ] : url === inputURL ? [
        ["        container.target = createEmptyContainer(source, operationContext)",
            "        globalThis.n2CoverageProbe.copies++\n        container.target = createEmptyContainer(source, operationContext)"],
    ] : []
    for (const [marker, replacement] of edits) {
        assert.equal(source.split(marker).length, 2, marker)
        source = source.replace(marker, replacement)
    }
    return edits.length ? { ...result, source } : result
} })
const { hasCoverage, addCoverage } = await import("./n2-validation-coverage.mjs")
const r = await import("../../src/index.js")
const turn = () => new Promise(setImmediate)
async function collect() {
    for (let i = 0; i < 12; i++) { await turn(); global.gc() }
}
const liveNodes = () => n2CoverageProbe.nodes.filter(ref => ref.deref()).length

// Independent Set oracle, including non-monotonic insertion, large scope IDs,
// duplicate additions and branches derived from older immutable roots.
const ids = [...Array.from({ length: 64 }, (_, i) => i + 1),
    2 ** 31, 2 ** 32 + 1, 2 ** 40, 2 ** 52, Number.MAX_SAFE_INTEGER]
let membershipChecks = 0
for (const order of [ids, ids.toReversed(), ids.toSorted((a, b) => (a % 7) - (b % 7))]) {
    const roots = [undefined], sets = [new Set()]
    for (const id of order) {
        roots.push(addCoverage(roots.at(-1), id))
        sets.push(new Set([...sets.at(-1), id]))
    }
    for (let i = 0; i < roots.length; i++) {
        for (const id of [...ids, 111, 2 ** 40 + 3, Number.MAX_SAFE_INTEGER - 1]) {
            assert.equal(hasCoverage(roots[i], id), sets[i].has(id))
            membershipChecks++
        }
        const fork = addCoverage(roots[i], 111)
        assert(hasCoverage(fork, 111))
        assert(!hasCoverage(roots[i], 111))
        assert.equal(addCoverage(fork, 111), fork)
    }
}
console.log(JSON.stringify({ membershipChecks, persistentBranches: "passed", numericIds: "53-bit passed" }))

// Retaining only the latest root must not retain obsolete paths or roots.
reset()
let latest
const history = 20000
for (let id = 1; id <= history; id++) latest = addCoverage(latest, id)
await collect()
assert.equal(liveNodes(), history - 1)
const beforeQueries = n2CoverageProbe.nodes.length
for (let i = 0; i < history; i++) assert(hasCoverage(latest, history - i))
assert.equal(n2CoverageProbe.nodes.length, beforeQueries, "Queries allocate no retained membership cache")
assert(n2CoverageProbe.visits <= history * Math.ceil(Math.log2(history + 1)))
latest = undefined
await collect()
assert.equal(liveNodes(), 0)
console.log(JSON.stringify({ history, allocatedBranches: beforeQueries, latestRootBranches: history - 1, releasedBranches: "all" }))

// The review witness: O(n) copies and tasks on one two-property graph. A late
// back-reference queries composed coverage while a sibling remains pending.
for (const scopes of [64, 128, 256, 512]) {
    reset()
    const ctx = { execution: new r.Execution(), errorContext: "N2 coverage cost and lifetime" }
    const p = Promise.withResolvers(), q = Promise.withResolvers()
    const raw = { p: p.promise, q: q.promise }
    const chains = [new r.Chain(r.import(raw, ctx), ctx)]
    for (let i = 0; i < scopes; i++) chains.push(new r.Chain(
        r.importMethodResult(r.lookupPath(chains.at(-1), [], ctx), ctx), ctx))
    p.resolve(r.lookupPath(chains.at(-1), [], ctx))
    await collect()
    const { copies, queries, visits, additions, bitSteps, nodes } = n2CoverageProbe
    const retained = liveNodes(), depth = Math.ceil(Math.log2(scopes + 1))
    assert.equal(copies, scopes)
    assert(queries <= 4 * scopes)
    assert(visits <= queries * depth)
    assert(nodes.length <= additions * depth)
    assert(bitSteps <= additions * depth)
    assert(retained <= nodes.length)

    q.resolve(42)
    for (const chain of chains) assert.equal(await r.lookupPath(chain, ["q"], ctx), 42)
    await collect()
    assert.equal(liveNodes(), 0, "Completed producer coverage must be collectible while values remain held")
    const allocationCount = nodes.length, additionCount = n2CoverageProbe.additions
    for (let i = 0; i < 128; i++) r.importMethodResult(r.lookupPath(chains.at(-1), [], ctx), ctx)
    assert.equal(n2CoverageProbe.nodes.length, allocationCount)
    assert.equal(n2CoverageProbe.additions, additionCount, "Ready validation creates no coverage history")
    assert.equal(ctx.execution.fatalError, null)
    console.log(JSON.stringify({ scopes, copies, queries, visits, additions, bitSteps,
        allocatedBranches: nodes.length, retainedWhilePending: retained, retainedAfterCompletion: 0 }))
}
