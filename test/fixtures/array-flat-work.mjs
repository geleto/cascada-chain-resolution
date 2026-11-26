import assert from "node:assert/strict"
import { instrumentRuntime } from "../runtime-transform.js"

let frames = 0, parts = 0, substitutions = 0, selections = 0, joins = 0, comparisons = 0, captures = 0
let builtRules = 0
let large
let selectionLimit = Infinity
globalThis.__flatCandidate = () => { if (large) assert(++large.candidates < 2048, "Search unfolded shared candidates") }
globalThis.__flatWrite = count => { if (large) assert((large.writes += count) < 256, "Repeated placements reached physical storage") }
globalThis.__flatMap = () => { if (large) assert(++large.mapped < 100000, "Mapping unfolded an already flagged subtree") }
globalThis.__flatFrame = () => { if (process.env.CASCADA_FLAT_NOOP_COUNTER !== "1") frames++ }
globalThis.__flatRule = () => { builtRules++ }
globalThis.__flatPart = () => { if (process.env.CASCADA_FLAT_NOOP_COUNTER !== "1") parts++ }
globalThis.__flatSubstitution = () => { if (process.env.CASCADA_FLAT_NOOP_COUNTER !== "1") substitutions++ }
globalThis.__flatSelection = () => {
    if (process.env.CASCADA_FLAT_NOOP_COUNTER !== "1") assert(++selections <= selectionLimit, "Repeated failed discovery")
}
globalThis.__flatJoin = () => { if (process.env.CASCADA_FLAT_NOOP_COUNTER !== "1") joins++ }
globalThis.__flatCompare = () => { if (process.env.CASCADA_FLAT_NOOP_COUNTER !== "1") comparisons++ }
globalThis.__flatCapture = () => { if (process.env.CASCADA_FLAT_NOOP_COUNTER !== "1") captures++ }
const verify = instrumentRuntime(new Map([
    ["array-flat.js", [
        ["function initial(node, n) {", "$& globalThis.__flatFrame();"],
        ["if (uses.has(n)) return uses.get(n)", "$&\n        globalThis.__flatRule();"],
        ["function substitute(word, replacement, memo) {", "$& globalThis.__flatSubstitution();"],
        ["for (const record of node.parts) {", "$& globalThis.__flatPart();"],
    ]],
    ["array-flat-stream.js", [
        ["const same = compareIdentities(current.identity, identity, work)", "globalThis.__flatCompare(); $&"],
        ["function select(p, budget, spent, ancestry) {", "$& globalThis.__flatSelection();"],
        ["function captureFlatInput(array, ctx, inspect) {", "$& globalThis.__flatCapture();"],
    ]],
    ["array-sequence.js", [["function appendContribution(output, part, sequential, ctx) {", "$& globalThis.__flatJoin();"]]],
    ["array-search.js", [["function candidate(low, high, position, read, within) {", "$& globalThis.__flatCandidate();"]]],
    ["array-layout.js", [
        ["for (let offset = 0; offset < part.length; offset++) visit(index + offset, part.placement)", "globalThis.__flatWrite(part.length); $&"],
        ["const replacement = select(node)", "globalThis.__flatMap(); $&"],
    ]],
]), process.env.CASCADA_WORK_NOOP_LOADER !== "1")
const r = await import("../../src/index.js")
verify("Flat work requires its runtime counter loader")
const rows = []

for (const size of [8, 16, 32, 64]) for (const depth of [4096, Infinity]) {
    let inspections = 0
    const wrap = value => new Proxy(value, { ownKeys(target) { inspections++; return Reflect.ownKeys(target) } })
    const nodes = [wrap([]), wrap([])]
    while (nodes.length < size) nodes.push(wrap([nodes.at(-1), nodes.at(-2)]))
    const ctx = { execution: new r.Execution(), errorContext: "flat empty DAG work" }
    const source = new r.Chain(nodes.at(-1), ctx, r.CHAIN_MODE.Complete)
    inspections = captures = selections = substitutions = 0
    const result = new r.Chain(r.run(source, [], "flat", [depth], ctx, {}), ctx)
    assert.deepEqual(r.export(result, [], ctx), [])
    assert.equal(inspections, size - 2, "Only nonempty Arrays need their keys inspected")
    assert(captures > 0 && selections > 0, "Flat work instrumentation must count executed capture and expansion")
    assert.equal(captures, size)
    assert(selections <= 4 * size, "Ready DAG capture must not revisit each depth path")
    assert.equal(substitutions, 0, "An acyclic graph requires no cyclic substitution")
    rows.push({ size, depth: String(depth), inspections, captures, selections, substitutions })
}

for (const size of [16, 64]) {
    const ctx = { execution: new r.Execution(), errorContext: "failed flat shared discovery" }
    const early = r.validationError("first", ctx, r.ERROR_KIND.OperationInputFailed)
    const late = r.validationError("second", ctx, r.ERROR_KIND.OperationInputFailed)
    const pending = Promise.withResolvers(), nodes = [[pending.promise], []]
    while (nodes.length < size) nodes.push([nodes.at(-1), nodes.at(-2)])
    const source = new r.Chain([early, nodes.at(-1)], ctx, r.CHAIN_MODE.Complete)
    selections = captures = 0
    selectionLimit = 6 * size
    const failure = r.run(source, [], "flat", [Infinity], ctx, {})
    assert(r.isPending(failure, ctx))
    const issued = selections
    assert.equal(captures, size + 1)
    pending.resolve(late)
    assert.deepEqual(new Set((await failure).errors), new Set([early, late]))
    assert(selections >= issued)
    rows.push({ size, issued, selections, captures })
    selectionLimit = Infinity
}
for (const size of [8, 32, 128]) for (const deepEmpty of [false, true]) {
    const cycles = Array.from({ length: size }, () => [])
    for (const cycle of cycles) cycle.push(cycle)
    if (deepEmpty) {
        let tail = []
        for (let i = 0; i < size; i++) tail = [tail]
        cycles.push(tail)
    }
    const ctx = { execution: new r.Execution(), errorContext: "flat independent cycles" }
    const source = new r.Chain(cycles, ctx, r.CHAIN_MODE.Complete)
    frames = parts = substitutions = 0
    const result = new r.Chain(r.run(source, [], "flat", [2 ** 54], ctx, {}), ctx)
    const output = r.export(result, [], ctx)
    assert.equal(output.length, size)
    for (const cycle of output) assert.equal(cycle[0], cycle)
    assert(parts > 0 && frames > 0, "Flat work instrumentation must count executed capture and expansion")
    assert(parts <= (deepEmpty ? 8 : 4) * size + 8)
    assert(frames <= 12 * size + 4, "A silent cycle's transient must not depend on unrelated graph size")
    assert(substitutions > 0 && substitutions <= 256 * size + 128, "Independent cycles must scale with their captured edges")
    rows.push({ size, deepEmpty, frames, parts, substitutions })
}
{
    // Put the silent cycles inside the same recursive capture as a deep empty
    // exit. Each additional cycle contributes one terminal per outer lap.
    const size = 24, depth = 4 * size
    function measure(count) {
        const ctx = { execution: new r.Execution(), errorContext: "silent cycles in a recursive component" }
        let tail = []
        for (let i = 0; i < size; i++) tail = [tail]
        const cycles = Array.from({ length: count }, () => [])
        for (const cycle of cycles) cycle.push(cycle)
        const root = []
        root.push(root, ...cycles, tail)
        const source = new r.Chain(root, ctx, r.CHAIN_MODE.Complete)
        builtRules = 0
        const result = new r.Chain(r.run(source, [], "flat", [depth], ctx, {}), ctx)
        assert.equal(r.lookupPath(result, ["length"], ctx), (depth + 1) * count + size + 2)
        return builtRules
    }
    const one = measure(1), many = measure(size)
    assert(one <= 4 * size, "A single empty exit chain must take work proportional to its depth and output")
    assert(many > one && many - one <= 4 * size, "Additional silent cycles must not rebuild one rule per empty-exit depth")
    rows.push({ size, one, many })
}
for (const mode of Object.values(r.CHAIN_MODE)) {
    const ctx = { execution: new r.Execution(), errorContext: "finite cycle capture" }
    const raw = []
    let reads = 0
    const cyclic = new Proxy(raw, { getOwnPropertyDescriptor(target, key) {
        if (key === "0") reads++
        return Reflect.getOwnPropertyDescriptor(target, key)
    } })
    raw.push(cyclic)
    const source = new r.Chain(cyclic, ctx, mode)
    reads = 0
    const value = r.run(source, [], "flat", [2 ** 54], ctx, {})
    assert.equal(reads, 1, "Finite cyclic expansion must reuse the captured descriptor")
    assert.equal(r.lookupPath(new r.Chain(value, ctx), [0], ctx), cyclic)
    rows.push({ mode, reads })
}
for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) for (const depth of [4096, Infinity]) {
    for (const size of [16, 64]) for (const kind of ["ready", "pending", "independent", "mixed"]) {
        const ctx = { execution: new r.Execution(), errorContext: "stream flat shared discovery" }
        const first = Promise.withResolvers(), second = Promise.withResolvers()
        const nodes = [kind === "ready" ? [] : [first.promise], kind === "independent" ? [second.promise] : kind === "mixed" ? [42] : []]
        const lengths = [0, Number(kind === "mixed")]
        while (nodes.length < size) {
            nodes.push([nodes.at(-1), nodes.at(-2)])
            lengths.push(lengths.at(-1) + lengths.at(-2))
        }
        const source = new r.Chain(["prefix", nodes.at(-1)], ctx, mode)
        selections = joins = comparisons = captures = 0
        const result = new r.Chain(r.run(source, [], "flat", [depth], ctx, {}), ctx, mode)
        assert.equal(r.lookupPath(result, [0], ctx), "prefix")
        let errors, collected, absent
        if (kind === "mixed") {
            errors = r.hasError(result, [], ctx)
            collected = r.getErrors(result, [], { ...ctx, errorContext: "full flat result" })
            if (lengths.at(-1) >= 0xffffffff) {
                assert.equal(errors, true)
                assert.equal(collected.kind, r.ERROR_KIND.InvalidArrayLength)
            } else {
                assert(r.isPending(collected, ctx))
                absent = r.run(result, [], "includes", ["absent"], ctx, {})
            }
            assert.equal(r.lookupPath(result, [1], ctx), 42)
            assert.equal(r.run(result, [], "includes", [42], ctx, {}), true)
            const cursor = r.iterate(result, [], ctx, { windowEnd: 2 }), values = []
            for (let i = 0; i < 2; i++) values.push(r.lookupPath((await cursor.next()).value, [], ctx))
            assert.deepEqual(new Set(values), new Set(["prefix", 42]))
            await cursor.return()
        }
        assert.equal(captures, size + 1)
        const issued = selections
        assert(issued > 0 && issued <= 6 * size, `stream selected ${issued} placements before delivery for ${size} nodes`)
        assert(joins > 0 && joins <= 6 * size, `stream joined ${joins} contributions before delivery for ${size} nodes`)
        first.resolve([])
        if (kind === "independent") await new Promise(setImmediate)
        second.resolve([])
        assert.equal(await r.lookupPath(result, ["length"], ctx), 1 + lengths.at(-1))
        if (kind !== "mixed") assert.deepEqual(await r.export(result, [], ctx), ["prefix"])
        else {
            const last = lengths.at(-1)
            assert.equal(await errors, last >= 0xffffffff)
            if (last < 0xffffffff) assert.equal(await absent, false)
            assert.equal(await r.lookupPath(result, [Math.min(last, 0xfffffffe)], ctx), 42)
            if (last >= 0xffffffff) {
                const lost = await r.lookupPath(result, [last], ctx)
                assert.equal(lost.kind, r.ERROR_KIND.InvalidArrayLength)
                assert.equal(collected.errorContext, "full flat result")
            } else assert.equal(await collected, null)
        }
        assert.equal(comparisons, 0, "Distinct identity domains cannot contain a recursive edge")
        assert.equal(captures, size + 1 + Number(kind !== "ready") + Number(kind === "independent"))
        assert(selections <= 16 * size && joins <= 16 * size,
            `stream selected ${selections} placements and joined ${joins} contributions for ${size} nodes`)
        rows.push({ mode, depth: String(depth), size, kind, issued, selections, joins, comparisons })
    }
}
for (const openPrefix of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: "shared splice insertion" }, cut = Promise.withResolvers()
    const chain = value => new r.Chain(value, ctx, r.CHAIN_MODE.Unordered)
    const cause = r.validationError("shared marker", ctx, r.ERROR_KIND.OperationInputFailed)
    let input = [7, openPrefix ? cause : 8]
    for (let i = 0; i < 20; i++) input = [input, input]
    const source = chain(r.run(chain(input), [], "flat", [Infinity], ctx, {})), count = 2 ** 21
    const inserted = r.run(source, [], "toSpliced", [cut.promise, 0, "X"], ctx, {})
    const prefix = chain(["P"]), hold = Promise.withResolvers()
    const opened = openPrefix && r.enter(prefix, [], ctx, { maximumCount: 0xffffffff, mayPoisonScope: false }, () => hold.promise)
    const joined = chain(r.run(prefix, [], "concat", [inserted], ctx, {}))
    const search = (...args) => r.run(joined, [], "includes", args, ctx, {})
    large = { candidates: 0, writes: 0, mapped: 0 }
    const found = search("X"), absent = search("absent")
    if (openPrefix) {
        assert(r.isPending(found, ctx))
        hold.resolve()
        await opened
        assert.equal(await found, true)
        assert.equal(await absent, cause)
    } else {
        assert.equal(found, true)
        assert.equal(search(8, count), true)
        assert.equal(absent, false)
    }
    const last = search("X", count + 1)
    assert(r.isPending(last, ctx))
    cut.resolve(count)
    assert.equal(await last, true)
    assert(large.candidates > 0 && large.candidates < 40)
    rows.push({ size: count, openPrefix, ...large })
    large = undefined
}
for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) for (const kind of ["empty", "scalar", "object", "failure"]) {
    const ctx = { execution: new r.Execution(), errorContext: "shared flat search" }, gate = Promise.withResolvers()
    const cause = r.validationError("leaf", ctx, r.ERROR_KIND.OperationInputFailed)
    const value = kind === "empty" ? [] : kind === "failure" ? cause : kind === "object" ? { value: 7 } : 7
    const nodes = [[gate.promise], [42]]
    while (nodes.length < 64) nodes.push([nodes.at(-1), nodes.at(-2)])
    const source = new r.Chain(nodes.at(-1), ctx, mode)
    large = { candidates: 0, writes: 0, mapped: 0 }
    const result = new r.Chain(r.run(source, [], "flat", [Infinity], ctx, {}), ctx, mode)
    const search = () => ["includes", "indexOf", "lastIndexOf"].map(method => r.run(result, [], method, ["absent"], ctx, {}))
    const searches = search()
    const collected = r.getErrors(result, [], { ...ctx, errorContext: "full search source" })
    assert.equal(collected.kind, r.ERROR_KIND.InvalidArrayLength)
    assert.equal(collected.errorContext, "full search source")
    assert.equal(r.hasError(result, [], ctx), true)
    assert.equal(r.lookupPath(result, [0], ctx), 42)
    gate.resolve(value)
    const [any, first, last] = await Promise.all(searches)
    const length = await r.lookupPath(result, ["length"], ctx), lost = await r.lookupPath(result, [0xffffffff], ctx)
    assert.equal(length, kind === "empty" ? 6557470319842 : 10610209857723)
    assert.equal(first, kind === "failure" ? cause : lost)
    assert.equal(last, await r.lookupPath(result, [length - 1], ctx))
    if (kind === "failure") {
        assert(any.errors.includes(cause))
        assert(any.errors.some(error => error.kind === r.ERROR_KIND.InvalidArrayLength))
    } else {
        assert.equal(any, lost)
        if (kind === "object") assert.equal(await r.lookupPath(result, [1], ctx), value)
    }
    assert(large.candidates > 0 && large.mapped > 0)
    const openCandidates = large.candidates
    large.candidates = 0
    // A whole-value overflow report finishes before the flat producer. Drain
    // its already-delivered native continuations for the settled search control.
    await new Promise(setImmediate)
    const [settledAny, settledFirst, settledLast] = search()
    if (any.errors) assert.deepEqual(new Set(settledAny.errors), new Set(any.errors))
    else assert.equal(settledAny, any)
    assert.equal(settledFirst, first)
    assert.equal(settledLast, last)
    rows.push({ mode, kind, openCandidates, ...large })
    large = undefined
}
console.log(JSON.stringify({ cases: rows.length, rows }))
