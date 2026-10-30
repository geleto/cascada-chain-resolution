import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { normalizeModuleURL } from "../module-url.js"

const target = normalizeModuleURL(new URL("../../src/external-metadata.js", import.meta.url))
const counts = globalThis.pathSelectionCounts = { visits: 0, allocations: 0, forwards: 0, consumers: 0, collections: 0, ancestry: 0 }
let hooked = false
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (normalizeModuleURL(url) !== target) return result
    let source = String(result.source)
    for (const marker of ["const [heldFrom, heldTo] = merges.pop()"] ) {
        assert(source.includes(marker))
        source = source.replaceAll(marker, marker + "; globalThis.pathSelectionCounts.visits++")
    }
    const marker = "this.kind = kind"
    assert(source.includes(marker))
    source = source.replace(marker, marker + "; globalThis.pathSelectionCounts.allocations++")
    for (const [marker, metric] of [
        ["while (state.kind === FORWARD) {", "forwards"],
        ["function consume(state, owner, onReady) {", "consumers"],
        ["function collect(state, owner, found) {", "collections"],
    ]) {
        assert(source.includes(marker))
        source = source.replaceAll(marker, marker + ` globalThis.pathSelectionCounts.${metric}++;`)
    }
    const roots = "while (root.kind === FORWARD) root = root.into"
    assert(source.includes(roots))
    source = source.replace(roots, "while (root.kind === FORWARD) { globalThis.pathSelectionCounts.forwards++; root = root.into }")
    const ascent = "path.push(node); node = node[TREE_NODE].parent"
    assert(source.includes(ascent))
    source = source.replaceAll(ascent, "globalThis.pathSelectionCounts.ancestry++; " + ascent)
    hooked = true
    return { ...result, source }
} })
const r = await import("../../src/index.js")
const { TREE_NODE } = await import("../../src/external-mutation-tree.js")

function checkHistory(source) {
    const visited = new Set(), work = [source._externalMutationTree[TREE_NODE].metadata.current]
    while (work.length) {
        const state = work.pop()
        if (!state || visited.has(state)) continue
        visited.add(state)
        work.push(state.a, state.b, state.into)
    }
    assert(visited.size < 20, `Retained selection history: ${visited.size}`)
}

for (const reverse of [false, true])
for (const prior of ["healthy", "poisoned", "pending"])
for (const selection of ["unregistered", "invalid-prefix", "child", "invalid-suffix"]) {
    let previous
    for (const count of [64, 256, 1024]) {
        for (const metric in counts) counts[metric] = 0
        const ctx = { execution: new r.Execution(), errorContext: "selection work" }
        const held = Promise.withResolvers(), failure = new Error("earlier native failure")
        const source = new r.ContextChain({ api: r.externalState({
            child: r.externalState({ wait() { return held.promise }, fail() { throw failure } }), other: r.externalState({}),
        }) }, ctx, { api: { child: {}, other: {} } })
        const native = prior === "healthy" ? undefined : r.run(source, ["api", "child"],
            prior === "pending" ? "wait" : "fail", [], ctx, { mutationScopeDepth: 2 })
        const earlier = r.getErrors(source, ["api"], ctx)
        const keys = [], results = []
        for (let i = 0; i < count; i++) {
            const key = Promise.withResolvers()
            keys.push(key)
            results.push(r.repairPath(source, selection === "invalid-suffix" ?
                ["api", key.promise, {}] : ["api", key.promise], ctx))
        }
        const failed = selection === "invalid-prefix" || selection === "invalid-suffix"
        for (const key of reverse ? keys.reverse() : keys)
            key.resolve(selection === "invalid-prefix" ? null : selection === "unregistered" ? "unregistered" : "child")
        const completed = await Promise.all(results)
        assert(completed.every(value => failed ? value.kind === r.ERROR_KIND.InvalidPathSegment : value === undefined))
        // Inspect before a query can incidentally compress the completed history,
        // and while an earlier native publisher may still be pending.
        checkHistory(source)
        assert.equal(r.getErrors(source, ["api", "other"], ctx), null)
        if (prior === "pending") held.reject(failure)
        const poison = await native ?? null
        assert.equal(await earlier, poison, "Earlier captures preserve the exact native Error")
        checkHistory(source)
        assert.equal(r.getErrors(source, ["api"], ctx), failed ? poison : null)
        assert(counts.visits > count && counts.allocations > count, "Work hooks must execute")
        if (previous) for (const metric of ["visits", "allocations", "forwards"])
            assert(counts[metric] < previous[metric] * 5,
                `${metric} grew faster than path history: ${JSON.stringify({ reverse, prior, selection, previous, counts })}`)
        previous = { ...counts }
    }
}

// Many historical views must not each revisit every unfinished predecessor.
// Separate turns expose wake-and-resubscribe work that bulk delivery hides.
for (const query of [r.hasError, r.getErrors])
for (const incremental of [false, true])
for (const reverse of [false, true])
for (const failed of [false, true]) {
    let previous
    for (const count of [32, 128, 512]) {
        for (const metric in counts) counts[metric] = 0
        const ctx = { execution: new r.Execution(), errorContext: "historical metadata queries" }
        const held = Promise.withResolvers()
        const source = new r.ContextChain({ api: r.externalState({
            child: r.externalState({ wait() { return held.promise } }), other: r.externalState({}),
        }) }, ctx, { api: { child: {}, other: {} } })
        const native = r.run(source, ["api", "child"], "wait", [], ctx, { mutationScopeDepth: 2 })
        const earlier = query(source, ["api"], ctx), rows = []
        for (let i = 0; i < count; i++) {
            const key = Promise.withResolvers()
            const repair = r.repairPath(source, failed ? ["api", key.promise, {}] : ["api", key.promise], ctx)
            rows.push({ key, repair, query: query(source, ["api"], ctx) })
        }
        for (const row of reverse ? rows.reverse() : rows) {
            row.key.resolve("child")
            if (incremental) await row.repair
        }
        const repaired = await Promise.all(rows.map(row => row.repair))
        assert(repaired.every(value => failed ? value.kind === r.ERROR_KIND.InvalidPathSegment : value === undefined))
        checkHistory(source)
        held.reject(new Error("earlier native failure"))
        const poison = await native
        const error = query === r.hasError ? true : poison
        assert.equal(await earlier, error)
        const expected = failed ? error : query === r.hasError ? false : null
        assert((await Promise.all(rows.map(row => row.query))).every(value => value === expected))
        assert(counts.consumers > count, "Historical queries must exercise metadata consumers")
        if (previous) for (const metric of ["visits", "allocations", "forwards", "consumers"])
            assert(counts[metric] < previous[metric] * 5,
                `${metric} grew faster than query output: ${JSON.stringify({ incremental, reverse, failed, previous, counts })}`)
        previous = { ...counts }
    }
}

// Completed failures also release their reconstruction history while an earlier
// selection (not just a native result) still has an unknown metadata subtree.
for (const reverse of [false, true])
for (const incremental of [false, true])
for (const query of [undefined, r.hasError, r.getErrors])
for (const clearChild of [false, true]) {
    let previous
    for (const count of [32, 128, 512]) {
        for (const metric in counts) counts[metric] = 0
        const ctx = { execution: new r.Execution(), errorContext: "pending selection normalization" }
        const key = Promise.withResolvers(), held = Promise.withResolvers()
        const source = new r.ContextChain({ api: r.externalState({
            child: r.externalState({ wait() { return held.promise } }), other: r.externalState({}),
        }) }, ctx, { api: { child: {}, other: {} } })
        const native = r.run(source, ["api", "child"], "wait", [], ctx, { mutationScopeDepth: 2 })
        const original = query?.(source, ["api"], ctx)
        const earlier = r.repairPath(source, ["api", key.promise], ctx), rows = []
        for (let index = 0; index < count; index++) {
            const selected = Promise.withResolvers()
            const repair = r.repairPath(source, ["api", selected.promise, {}], ctx)
            rows.push({ key: selected, repair, query: query?.(source, ["api"], ctx) })
        }
        for (const row of reverse ? rows.reverse() : rows) {
            row.key.resolve("child")
            if (incremental) await row.repair
        }
        assert((await Promise.all(rows.map(row => row.repair)))
            .every(value => value.kind === r.ERROR_KIND.InvalidPathSegment))
        // Retain only the fixed graph and the genuinely pending operations.
        checkHistory(source)
        key.resolve(clearChild ? "child" : "other")
        assert.equal(await earlier, undefined)
        held.reject(new Error("earlier native failure"))
        const poison = await native
        if (query) {
            assert.equal(await original, query === r.hasError ? true : poison)
            const expected = clearChild ? query === r.hasError ? false : null : query === r.hasError ? true : poison
            assert((await Promise.all(rows.map(row => row.query))).every(value => value === expected))
        }
        assert.equal(await r.getErrors(source, ["api"], ctx), clearChild ? null : poison)
        checkHistory(source)
        if (previous) for (const metric of ["visits", "allocations", "forwards", "consumers"])
            assert(counts[metric] <= previous[metric] * 5 + 1,
                `${metric} grew faster than pending selection history: ${JSON.stringify({ reverse, incremental, clearChild, previous, counts })}`)
        previous = { ...counts }
    }
}

for (const deferred of [false, true]) for (const query of [r.hasError, r.getErrors]) {
    let previous
    for (const depth of [16, 32, 64]) {
        let value = r.externalState({}), request = {}
        for (let index = 1; index < depth; index++) {
            value = r.externalState({ child: value })
            request = { child: request }
        }
        const ctx = { execution: new r.Execution(), errorContext: "metadata path work" }
        const source = new r.ContextChain({ api: value }, ctx, { api: request })
        const keys = Array.from({ length: depth - 1 }, () => deferred ? Promise.resolve("child") : "child")
        counts.ancestry = 0
        assert.equal(await query(source, ["api", ...keys], ctx), query === r.hasError ? false : null)
        assert(counts.ancestry >= depth, "Path-work hooks must execute")
        if (previous) assert(counts.ancestry < previous * 3, "Metadata selection repeatedly walks its ancestors")
        previous = counts.ancestry
    }
}
// Healthy results must not make every later query rediscover the same empty
// topology. Count visits, independently of wall time and the representation.
for (const deferred of [false, true]) for (const query of [r.hasError, r.getErrors])
for (const width of [16, 64, 256]) {
    const ctx = { execution: new r.Execution(), errorContext: "settled healthy query work" }
    const held = Promise.withResolvers(), api = r.externalState({}), tree = { api: {} }
    for (let index = 0; index < width; index++) {
        api[index] = r.externalState({ run() { return deferred ? held.promise : 1 } })
        tree.api[index] = {}
    }
    const source = new r.ContextChain({ api }, ctx, tree)
    const work = []
    for (let index = 0; index < width; index++)
        work.push(r.run(source, ["api", index], "run", [], ctx, { mutationScopeDepth: 2 }))
    held.resolve(1)
    assert((await Promise.all(work)).every(value => value === 1))
    counts.collections = 0
    for (let index = 0; index < width; index++)
        assert.equal(query(source, ["api"], ctx), query === r.hasError ? false : null)
    assert(counts.collections > 0, "Collection-work hooks must execute")
    assert(counts.collections <= width * 6,
        `Repeated healthy subtree scans: width=${width}, visits=${counts.collections}`)
}
assert(hooked)
console.log("Linear metadata path/query work and released selection history across 216 schedules")
