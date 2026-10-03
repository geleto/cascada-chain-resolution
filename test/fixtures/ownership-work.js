// Read-only instrumentation: count actual production graph work, never replace it.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

let counts, nodeCounts
const reset = () => {
    counts = { copies: 0, activations: 0, retirements: 0, proofs: 0, owners: 0, backings: 0, scheduled: 0, identities: 0,
        destinations: 0, lengthConsumers: 0, lengthVisits: 0 }
    nodeCounts = new WeakMap()
}
globalThis.countOwnershipWork = (key, node) => {
    counts[key]++
    if (!node) return
    let events = nodeCounts.get(node)
    if (!events) nodeCounts.set(node, events = { activations: 0, retirements: 0 })
    events[key]++
}
// Count every owner enumeration, including a new loop outside the placement
// visitor. Retaining another view must not add work to each later extension.
globalThis.CountedOwners = class extends Set {
    *[Symbol.iterator]() {
        for (const owner of super[Symbol.iterator]()) {
            counts.owners++
            yield owner
        }
    }
}
const replacements = {
    "captured-identity.js": [["meta.generation = undefined", "identities"]],
    "placement-structure.js": [
        ["function defineCopyProperty(copy, key, value) {", "copies"],
    ],
    "parent-placements.js": [
        ["meta.relationshipsActive = true", "activations", "owner"],
        ["function retireRelationships(owner, operationContext) {", "retirements", "owner"],
    ],
    "ownership.js": [["proofs.set(node, proof)", "proofs"], ["execution._readyDeliveryQueued = true", "scheduled"]],
    "array-view.js": [
        ["constructor(array, operationContext) {", "backings"],
    ],
    "array-length.js": [
        ["for (const [counter, node] of source.consumers) {", "lengthConsumers"],
        ["for (let node = start; node;) {", "lengthVisits"],
    ],
}
const sourceRoot = new URL("../../src/", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (!url.startsWith(sourceRoot)) return result
    let source = String(result.source)
    if (url.endsWith("/array-view.js")) {
        assert(source.includes("this.owners = new Set()"))
        source = source.replace("this.owners = new Set()", "this.owners = new globalThis.CountedOwners()")
    }
    if (url.endsWith("/parent-placements.js")) {
        const marker = "return meta.destination ??= { owner: meta.relationshipsActive ? owner : undefined }"
        assert(source.includes(marker), "Missing publication-destination allocation counter")
        source = source.replace(marker, "if (!meta.destination) globalThis.countOwnershipWork('destinations');\n    " + marker)
    }
    for (const [marker, key, node = "undefined"] of replacements[url.slice(sourceRoot.length)] ?? []) {
        assert(source.includes(marker), `Missing work counter: ${marker}`)
        source = source.replaceAll(marker, `${marker}\n globalThis.countOwnershipWork("${key}", ${node});`)
    }
    return { ...result, source }
} })
reset()
const r = await import("../../src/index.js")
const { metaOf } = await import("../../src/meta.js")
const { getParentPlacements } = await import("../../src/parent-placements.js")
const ctx = () => ({ execution: new r.Execution(), errorContext: "ownership work" })
const samples = []

for (const [depth, width] of [[1, 8], [16, 8], [4, 64]])
for (const pending of [false, true]) for (const protection of ["none", "holder", "imported"]) {
    const context = ctx(), signal = Promise.withResolvers()
    let value = { k: 0 }
    const leaf = value
    for (let index = 0; index < depth; index++)
        value = { ...Object.fromEntries(Array.from({ length: width }, (_, key) => [key, key])), next: value }
    const payload = protection === "imported" ? r.import(value, context) : value
    const source = new r.Chain({ p: pending ? signal.promise : payload }, context)
    const retained = protection === "holder" ? new r.Chain(r.lookupPath(source, ["p"], context), context) : undefined
    const path = ["p", ...Array(depth).fill("next"), "k"]
    reset()
    const mutation = r.assignPath(source, path, 1, context)
    if (pending) signal.resolve(payload)
    await mutation
    const copies = counts.copies
    assert.equal(r.lookupPath(source, path, context), 1)
    if (protection === "none") assert.equal(copies, 0, JSON.stringify({ depth, width, pending, copies }))
    else {
        assert(copies > 0)
        assert.equal(leaf.k, 0, "Independent holders and imported inputs retain their original contents")
        if (retained) assert.equal(await r.lookupPath(retained, path.slice(1), context), 0)
    }
    samples.push({ case: "pending descent", depth, width, pending, protection, copies })
}

{
    const context = ctx(), start = Promise.withResolvers()
    const source = new r.Chain([1, 2, 3], context)
    reset()
    const outcome = r.run(source, [], "splice", [start.promise, 1], context, { mutationScopeDepth: 0 })
    const removed = new r.Chain(outcome, context)
    start.resolve(0)
    assert.deepEqual(await r.export(removed, [], context), [1])
    assert.deepEqual(r.export(source, [], context), [2, 3])
    const events = nodeCounts.get(source._state.value)
    assert.deepEqual(events, { activations: 1, retirements: 0 }, "Replacement stays active until mutation publication")
    samples.push({ case: "pending splice publication", ...events })
}

for (const entry of [false, true]) for (const size of [8, 128]) {
    const context = ctx(), signal = Promise.withResolvers()
    const root = { pending: signal.promise, items: Array.from({ length: size }, () => ({ k: 1 })) }
    const source = new r.Chain(root, context)
    const alias = new r.Chain(r.lookupPath(source, ["items", size - 1], context), context)
    reset()
    const outcome = entry ? r.enter(source, ["pending"], context, true, entered =>
        r.run(entered, ["items"], "pop", [], context, { mutationScopeDepth: 1 })) :
        r.run(source, ["pending", "items"], "pop", [], context, { mutationScopeDepth: 2 })
    const removed = new r.Chain(outcome, context)
    r.assignPath(source, [], null, context)
    assert.equal(nodeCounts.get(root)?.retirements ?? 0, 0)
    r.assignPath(alias, ["k"], 2, context)
    signal.resolve(root)
    assert.deepEqual(await r.export(removed, [], context), { k: 1 })
    await new Promise(setImmediate)
    const events = nodeCounts.get(root)
    assert.deepEqual(events, { activations: 0, retirements: 1 }, "A queued writer releases its original destination once, without reactivation")
    samples.push({ case: "detached pending writer", entry, size, ...events })
    for (const holder of [source, alias, removed]) r.assignPath(holder, [], null, context)
}

for (const depth of [8, 32, 128, 256]) {
    const context = ctx(), root = {}
    let leaf = root
    for (let index = 0; index < depth; index++) leaf = leaf.next = {}
    leaf.k = 0
    const holder = new r.Chain(root, context), path = [...Array(depth).fill("next"), "k"]
    reset()
    for (let value = 1; value <= 2; value++) {
        r.assignPath(holder, path, value, context)
        assert.equal(r.lookupPath(holder, path, context), value)
    }
    assert(counts.identities <= 2 * (depth + 4), JSON.stringify({ depth, ...counts }))
    samples.push({ case: "mutation path identity work", depth, ...counts })
}

for (const mode of ["direct", "guarded", "entered"]) for (const iterations of [50, 200, 800]) {
    const context = ctx(), array = new r.Chain([0], context), control = new r.Chain({}, context)
    reset()
    const loop = () => {
        for (let index = 0; index < iterations; index++) {
            r.run(array, [], "slice", [], context, {})
            r.run(array, [], "push", [index], context, {mutationScopeDepth:0})
            assert.equal(metaOf(array._state.value, context).backingRecord.owners.size, 1)
        }
    }
    if (mode === "entered") r.enter(control, [], context, false, loop)
    else if (mode === "guarded") r.runInternalStep(context, loop)
    else loop()
    assert.equal(counts.scheduled, 1)
    samples.push({case:"ignored owner history", mode, iterations, ...counts})
}

for (const iterations of [200, 400, 800]) for (const offset of [0, 5]) {
    const context = ctx(), backing = new r.Chain(Array(offset + 1).fill(0), context)
    const array = offset ? new r.Chain(r.run(backing, [], "slice", [offset], context, {}), context) : backing
    if (offset) r.assignPath(backing, [], null, context)
    const retained = []
    reset()
    for (let index = 0; index < iterations; index++) {
        r.run(array, [], "push", [index], context, { mutationScopeDepth: 0 })
        retained.push(new r.Chain(r.run(array, [], "slice", [], context, {}), context))
    }
    assert.equal(counts.copies, 0)
    assert(counts.owners <= 2 * iterations, JSON.stringify({ iterations, offset, ...counts }))
    samples.push({ case: "retained view extension", iterations, offset, ...counts })
    for (const [index, holder] of retained.entries()) {
        assert.equal(r.lookupPath(holder, ["length"], context), index + 2)
        assert.equal(r.lookupPath(holder, [index + 1], context), index)
    }
}

for (const array of [false, true]) {
    const context = ctx(), child = {}, cached = array ? [child] : {child}
    const prior = new r.Chain(cached, context)
    r.assignPath(prior, [], null, context)
    const invalid = new Proxy({}, {ownKeys() { throw new Error("expected preparation failure") }})
    reset()
    const received = new r.Chain({cached, invalid}, context)
    assert(r.isPoisonError(received._state.value))
    assert.equal(counts.activations, array ? 4 : 3) // Holder, cached root, child, and optional backing.
    assert.equal(counts.retirements, array ? 3 : 2) // Failed preparation releases its restored region.
    assert.equal(metaOf(cached, context).relationshipsActive, false)
    samples.push({case:"failed preparation", array, ...counts})
}

for (const size of [1, 10, 100]) for (const Constructor of [r.Chain, r.ContextChain]) {
    const context = ctx(), host = new r.Chain(r.externalState({ make() { return { items: Array.from({length:size}, () => ({})) } } }), context)
    const value = r.run(host, [], "make", [], context, {})
    reset()
    const received = new Constructor(value, context)
    assert.equal(counts.retirements, 0)
    assert.equal(counts.activations, 1)
    assert.equal(received._state.value.items.length, size)
    samples.push({case:"whole constructor", size, constructor:Constructor.name, ...counts})
}

for (const size of [8, 64]) for (const iterations of [10, 40]) {
    const context = ctx(), leaf = {}, survivor = new r.Chain(leaf, context)
    let inspections = 0, root = null
    for (let index = 0; index < size; index++) root = new Proxy({ next: root, leaf }, {
        ownKeys(target) { inspections++; return Reflect.ownKeys(target) },
    })
    const holder = new r.Chain(r.import(root, context), context)
    r.assignPath(holder, [], null, context)
    inspections = 0
    reset()
    for (let index = 0; index < iterations; index++) {
        r.assignPath(holder, [], r.import(root, context), context)
        r.assignPath(holder, [], null, context)
    }
    assert.equal(inspections, 0)
    // Each root assignment also creates and closes one operation-private holder.
    assert.equal(counts.activations, (size + 2) * iterations)
    assert.equal(counts.retirements, (size + 2) * iterations)
    assert(counts.proofs <= (2 * size + 8) * iterations, JSON.stringify({ size, iterations, ...counts }))
    assert.equal(metaOf(leaf, context).relationshipsActive, true)
    samples.push({ case: "cached reactivation", size, iterations, ...counts, inspections })
}

for (const size of [16, 128]) for (const iterations of [10, 40])
for (const retainedCount of [0, 8]) for (const offset of [0, 5]) {
    const context = ctx(), backing = new r.Chain(Array.from({ length: size + offset }, (_, index) => index), context)
    const array = offset ? new r.Chain(r.run(backing, [], "slice", [offset], context, {}), context) : backing
    if (offset) r.assignPath(backing, [], null, context)
    const retained = Array.from({ length: retainedCount }, () =>
        new r.Chain(r.run(array, [], "slice", [0, 1], context, {}), context))
    reset()
    for (let index = 0; index < iterations; index++) {
        r.run(array, [], "pop", [], context, { mutationScopeDepth: 0 })
        r.run(array, [], "push", [index], context, { mutationScopeDepth: 0 })
    }
    assert.equal(r.lookupPath(array, ["length"], context), size)
    assert.equal(r.lookupPath(array, [size - 1], context), iterations - 1)
    // Interior extension still uses the conservative materialization fallback.
    // The tail-reuse trial copied no prefix, but failed sparse indexed growth.
    assert.equal(counts.copies, (size - 1) * iterations)
    assert(counts.backings >= iterations - 1 && counts.backings <= iterations)
    for (const holder of retained) assert.equal(r.lookupPath(holder, [0], context), offset)
    samples.push({ case: "pop/push", size, iterations, retainedCount, offset, ...counts })
}

// Grow the number of abandoned cyclic parents while either keeping one pending
// result at a time or retaining the complete explicit Promise frontier. Neither
// history can leave reverse edges or live publication authority on old parents.
for (const size of [16, 64, 128]) for (const frontier of ["constant", "growing"]) {
    const context = ctx(), child = { k: 0 }, survivor = new r.Chain(child, context)
    const history = []
    reset()
    for (let index = 0; index < size; index++) {
        const signal = Promise.withResolvers(), root = { child, waiting: signal.promise }
        root.self = root
        const holder = new r.Chain(root, context)
        const result = r.lookupPath(holder, ["waiting"], context)
        history.push({ root, signal, result, index })
        r.assignPath(holder, [], null, context)
        assert.equal(metaOf(root, context).relationshipsActive, false)
        assert.equal(metaOf(root, context).destination.owner, undefined)
        assert.deepEqual(getParentPlacements(child, context), [{ parent: survivor._state, key: "value" }])
        r.assignPath(survivor, ["k"], index + 1, context)
        assert.equal(survivor._state.value, child, "Abandoned parents impose no copy-on-write protection")
        if (frontier === "constant") {
            signal.resolve({ delivered: index })
            assert.deepEqual(await result, { delivered: index })
            await new Promise(setImmediate)
        }
    }
    if (frontier === "growing") {
        // Reverse settlement crosses the issuance history without changing the
        // value captured by any earlier lookup or reopening its old parent.
        for (const item of history.toReversed()) item.signal.resolve({ delivered: item.index })
        assert.deepEqual(await Promise.all(history.map(item => item.result)),
            history.map(item => ({ delivered: item.index })))
        await new Promise(setImmediate)
    }
    for (const { root } of history) {
        assert.equal(metaOf(root, context).relationshipsActive, false)
        assert.equal(metaOf(root, context).destination.owner, undefined)
        assert.equal(metaOf(root, context).incomingParents, undefined)
    }
    assert.equal(r.lookupPath(survivor, ["k"], context), size)
    assert.deepEqual(getParentPlacements(child, context), [{ parent: survivor._state, key: "value" }])
    assert.equal(counts.copies, 0)
    // One two-placement cyclic parent and one delivered record per operation:
    // all tracked work is bounded by that explicit input, never history squared.
    for (const key of ["activations", "retirements", "destinations"])
        assert(counts[key] <= 6 * size, JSON.stringify({ size, frontier, key, ...counts }))
    assert(counts.proofs <= 24 * size, JSON.stringify({ size, frontier, ...counts }))
    samples.push({ case: "abandoned cyclic publication history", size, frontier, ...counts })
}

// Historical Array copies must not stay registered as consumers of a pending
// length contribution after their holders close. Retained copies are genuine
// dependencies and do receive its outcome; one registry entry per live sequence
// is the bound, independently of how many copies previously existed.
for (const size of [16, 64, 128]) for (const frontier of ["constant", "growing"])
for (const created of [false, true]) {
    const context = ctx(), source = new r.Chain([0], context), signal = Promise.withResolvers()
    const entry = r.enter(source, [3], context, true, inside => signal.promise.then(() => {
        if (created) r.assignPath(inside, [], 9, context)
    }))
    const lengthState = metaOf(source._state.value, context).arrayRange.lengthState
    const contribution = lengthState.head.source
    assert.equal(contribution.consumers.size, 1)
    const retained = []
    reset()
    for (let index = 0; index < size; index++) {
        const fork = new r.Chain(r.lookupPath(source, [], context), context), pause = Promise.withResolvers()
        const privateEntry = r.enter(fork, [5], context, true, () => pause.promise)
        pause.resolve()
        await privateEntry
        const before = counts.lengthVisits
        assert.equal(r.lookupPath(source, [0], context), 0)
        assert.equal(counts.lengthVisits, before, "Private fork completion must not rescan the original frontier")
        if (frontier === "constant") r.assignPath(fork, [], null, context)
        else retained.push(fork)
        assert.equal(contribution.consumers.size, 1 + retained.length)
    }
    const questions = [source, ...retained].map(holder => r.lookupPath(holder, ["length"], context))
    assert.equal(contribution.consumers.size, 1 + retained.length, "Questions reuse their sequence's subscription")
    signal.resolve()
    await entry
    assert.deepEqual(await Promise.all(questions), Array(1 + retained.length).fill(created ? 4 : 1))
    assert.equal(contribution.consumers.size, 0, "Settlement releases every registered consumer")
    const expected = created ? [0, , , 9] : [0]
    for (const holder of [source, ...retained]) assert.deepEqual(await r.export(holder, [], context), expected)
    // Counts include completion of each fork's private no-op contribution too.
    assert(counts.lengthConsumers <= 2 * size + 1, JSON.stringify({ size, frontier, created, ...counts }))
    assert(counts.lengthVisits <= 24 * size, JSON.stringify({ size, frontier, created, ...counts }))
    assert(counts.copies <= 4 * size + 2, JSON.stringify({ size, frontier, created, ...counts }))
    assert(counts.proofs <= 16 * size + 8, JSON.stringify({ size, frontier, created, ...counts }))
    assert(counts.owners <= 2 * size + 1, JSON.stringify({ size, frontier, created, ...counts }))
    samples.push({ case: "captured length consumer history", size, frontier, created, ...counts })
}
console.log(JSON.stringify(samples, null, 2))
