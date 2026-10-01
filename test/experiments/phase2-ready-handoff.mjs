// Bounded Phase 2 experiment, not a production implementation or suite test.
// Run: node test/experiments/phase2-ready-handoff.mjs
// Source hooks try next-transition ready release and validation-copy protection.
// Retirement below models only flat Array owner histories; it is not a collector.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

const queued = []
const exposed = new WeakMap(), depths = new WeakMap()
let metadata
const experiment = globalThis.__phase2HandoffExperiment = {
    ignoreShared: false,
    command(context, work) {
        const execution = context.execution, depth = depths.get(execution) ?? 0
        depths.set(execution, depth + 1)
        try {
            if (!depth) {
                const previous = exposed.get(execution)
                exposed.delete(execution)
                for (const record of previous ?? []) releaseReady(record)
            }
            return work()
        } finally { depths.set(execution, depth) }
    },
}
const sourceRoot = new URL("../../src/", import.meta.url).href
registerHooks({
    load(url, context, nextLoad) {
        const loaded = nextLoad(url, context)
        if (!url.startsWith(sourceRoot)) return loaded
        let source = String(loaded.source)
        const replace = (before, after) => {
            assert(source.includes(before), `Experiment hook missing in ${url}`)
            source = source.replace(before, after)
        }
        if (url.endsWith("/meta.js")) {
            replace("return metaOf(value, operationContext)?.shared === true ||",
                "return metaOf(value, operationContext)?.imported === true || (!globalThis.__phase2HandoffExperiment.ignoreShared && metaOf(value, operationContext)?.shared === true) ||")
        }
        if (url.endsWith("/chain.js")) {
            source = source.replaceAll('internalSteps.runInternalStep(operationContext, () => {',
                'globalThis.__phase2HandoffExperiment.command(operationContext, () => internalSteps.runInternalStep(operationContext, () => {')
            source = source.replaceAll('        })', '        }))')
        }
        if (url.endsWith("/index.js")) {
            for (const [name, index] of [['run', 4], ['assignPath', 3], ['deletePath', 2],
                ['enter', 2], ['exportValue', 2], ['lookupPath', 2], ['importValue', 1], ['importMethodResult', 1]]) {
                replace(`function ${name}(`, `function ${name}Original(`)
                source += `\nfunction ${name}(...args) {
                    return globalThis.__phase2HandoffExperiment.command(args[${index}], () => ${name}Original(...args))
                }\n`
            }
        }
        if (url.endsWith("/input-preparations.js")) {
            replace("metadata.getOrCreateMeta(container.target, operationContext, type, admittedPrototype)",
                "metadata.getOrCreateMeta(container.target, operationContext, type, admittedPrototype); if (metadata.isImported(source, operationContext)) metadata.markImported(container.target, operationContext)")
        }
        return { ...loaded, source }
    },
})
const r = await import("../../src/index.js")
metadata = await import("../../src/meta.js")
const parents = await import("../../src/parent-placements.js")
const { ArrayView } = await import("../../src/array-view.js")

function context() {
    return { execution: new r.Execution(), errorContext: "Phase 2 experiment" }
}
function count(value, ctx) {
    return metadata.metaOf(value, ctx)?.readLeaseCount ?? 0
}
function ready(value, ctx, enqueue = callback => queued.push(callback)) {
    metadata.incrementReadLease(value, ctx)
    const record = { value, context: ctx }
    let records = exposed.get(ctx.execution)
    if (!records) exposed.set(ctx.execution, records = new Set())
    records.add(record)
    // The callback keeps only this clearable record, not the value or metadata.
    enqueue(releaseReady.bind(undefined, record))
    return record
}
function releaseReady(record) {
    const { value, context: ctx } = record
    if (!value) return
    record.value = record.context = undefined
    const records = exposed.get(ctx.execution)
    records?.delete(record)
    if (records?.size === 0) exposed.delete(ctx.execution)
    metadata.decrementReadLease(value, ctx)
}
function drain() {
    for (const release of queued.splice(0)) release()
}
function backing(value, ctx) {
    const view = ArrayView.projectionOf(value, ctx)
    return metadata.metaOf(view._backing ?? value, ctx).arrayBacking
}
function retireFlatArrayOwners(record, ctx) {
    // These fixtures have no Array cycles, private writers, or recovery.
    // Do not generalize this local proof to the production retirement design.
    for (const owner of record.owners) {
        if (!count(owner, ctx) && !parents.getParentPlacements(owner, ctx).length)
            record.owners.delete(owner)
    }
}

// Actual receiving routes: fresh nested input, aliases, cycles, and a call lease.
{
    const ctx = context(), source = new r.Chain([{ k: 1 }], ctx)
    const value = r.run(source, [], "slice", [0], ctx, {})
    const record = ready(value, ctx)
    const wrapper = { first: value, second: value }
    wrapper.self = wrapper
    const destination = new r.Chain(wrapper, ctx)
    assert.equal(record.value, undefined)
    assert.equal(count(value, ctx), 0)
    assert.equal(parents.getParentPlacements(value, ctx).length, 2)
    assert.equal(destination._state.value.self, wrapper)
    drain()

    const signal = Promise.withResolvers()
    const receiver = new r.Chain(signal.promise, ctx)
    const argument = r.run(source, [], "slice", [0], ctx, {})
    const argumentRecord = ready(argument, ctx)
    const result = r.run(receiver, [], "use", [argument], ctx, {})
    assert.equal(argumentRecord.value, undefined)
    assert.equal(count(argument, ctx), 1, "receiving call owns its lease")
    drain()
    assert.equal(count(argument, ctx), 1)
    signal.resolve(r.externalState({ use(items) { return items.length } }))
    assert.equal(await result, 1)
    assert.equal(count(argument, ctx), 0)
}

// Detached export captures input without creating a managed parent or extra lease.
{
    const ctx = context(), source = new r.Chain([{ k: 1 }], ctx)
    const receiver = new r.Chain(r.externalState({ use(items) { return items.length } }), ctx)
    const value = r.run(source, [], "slice", [0], ctx, {})
    const record = ready(value, ctx)
    assert.equal(r.run(receiver, [], "use", [value], ctx, {}), 1)
    assert.equal(record.value, undefined)
    assert.equal(count(value, ctx), 0)
    drain()

    const pending = Promise.withResolvers()
    const deferred = new r.Chain(pending.promise, ctx)
    const second = r.run(source, [], "slice", [0], ctx, {})
    ready(second, ctx)
    // The existing pending assignment takes its own input lease at issuance.
    r.assignPath(deferred, ["items"], second, ctx)
    drain()
    assert.equal(count(second, ctx), 1)
    pending.resolve({})
    assert.deepEqual(await r.export(deferred, [], ctx), { items: [{ k: 1 }] })
    assert.equal(count(second, ctx), 0)
}

// A failed next command also ends the prior delivery interval.
{
    const ctx = context(), source = new r.Chain([1], ctx), invalid = new r.Chain(1, ctx)
    const value = r.run(source, [], "slice", [0], ctx, {})
    const record = ready(value, ctx)
    assert(Error.isError(r.run(invalid, [], "missing", [value], ctx, {})))
    assert.equal(count(value, ctx), 0)
    drain()
    assert.equal(count(value, ctx), 0)
    assert.equal(record.value, undefined)
    assert.equal(record.context, undefined)

    const another = r.run(source, [], "slice", [0], ctx, {})
    const failedRecord = ready(another, ctx)
    const bad = new Proxy({ bad: 1 }, { getOwnPropertyDescriptor(target, key) {
        if (key === "bad") throw new Error("supported inspection failure")
        return Reflect.getOwnPropertyDescriptor(target, key)
    } })
    const failed = new r.Chain({ first: another, bad }, ctx)
    assert(Error.isError(failed._state.value))
    assert.equal(failedRecord.value, undefined, "failed preparation needs no delivery fallback")
    drain()
    assert.equal(count(another, ctx), 0)
}

// A synchronous custom delivery receives within the same transition. Internal
// nested helpers do not expire the producer's newly established hold.
{
    const ctx = context(), source = new r.Chain([1], ctx)
    const value = r.run(source, [], "slice", [0], ctx, {})
    let record
    experiment.command(ctx, () => {
        record = ready(value, ctx)
        r.import(value, ctx) // nested helper, not the next source command
        assert.equal(record.value, value)
    })
    let calls = 0
    const receiver = new r.Chain({then(resolve) { calls++; resolve(value) }}, ctx)
    assert.equal(calls, 1)
    assert.equal(receiver._state.value, value)
    assert.equal(record.value, undefined)
    assert.equal(count(value, ctx), 0)
    drain()
}

// Only the same execution ends this delivery interval. With no next command,
// the fallback releases the exact ready record, without needing a consumer.
{
    const first = context(), second = context(), value = new r.Chain({}, first)._state.value
    const record = ready(value, first, queueMicrotask)
    new r.Chain({}, second)
    assert.equal(record.value, value)
    assert.equal(count(value, first), 1)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(record.value, undefined)
    assert.equal(count(value, first), 0)
}

// All 256 four-event histories preserve unrelated holds and release at most once.
let histories = 0
const events = ["placement", "lease", "fallback", "readyAgain"]
function sequences(prefix, depth) {
    if (depth === 0) return [prefix]
    return events.flatMap(event => sequences([...prefix, event], depth - 1))
}
for (const events of sequences([], 4)) {
    const ctx = context(), source = new r.Chain({}, ctx), value = source._state.value
    metadata.incrementReadLease(value, ctx) // unrelated pending producer
    ready(value, ctx)
    let consumers = 0, readyCount = 1
    for (const event of events) {
        if (event === "placement") {
            new r.Chain(value, ctx)
            readyCount = 0
        } else if (event === "lease") {
            experiment.command(ctx, () => metadata.incrementReadLease(value, ctx))
            consumers++
            readyCount = 0
        } else if (event === "fallback") {
            drain()
            readyCount = 0
        } else {
            ready(value, ctx)
            readyCount++
        }
        assert.equal(count(value, ctx), 1 + consumers + readyCount)
    }
    drain()
    while (consumers--) metadata.decrementReadLease(value, ctx)
    assert.equal(count(value, ctx), 1)
    metadata.decrementReadLease(value, ctx)
    histories++
}

// An earlier queued callback cannot release a later ready-delivery generation.
{
    const ctx = context(), value = new r.Chain({}, ctx)._state.value
    ready(value, ctx)
    new r.Chain(value, ctx)
    const second = ready(value, ctx)
    queued.shift()()
    assert.equal(count(value, ctx), 1)
    assert.equal(second.value, value)
    drain()
}

// Native Promise delivery remains independently protected across direct receivers.
{
    const ctx = context(), value = new r.Chain({}, ctx)._state.value
    metadata.incrementReadLease(value, ctx) // pending output, no ready slot
    const signal = Promise.withResolvers(), order = []
    signal.promise.then(() => queueMicrotask(() => {
        metadata.decrementReadLease(value, ctx)
        order.push("pending release")
    }))
    signal.promise.then(() => { new r.Chain(value, ctx); order.push("receiver A"); assert.equal(count(value, ctx), 1) })
    signal.promise.then(() => { new r.Chain(value, ctx); order.push("receiver B"); assert.equal(count(value, ctx), 1) })
    signal.resolve(value)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(order, ["receiver A", "receiver B", "pending release"])
    assert.equal(count(value, ctx), 0)

    ready(value, ctx, queueMicrotask)
    new r.Chain(value, ctx)
    assert.equal(count(value, ctx), 0)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(count(value, ctx), 0)
}

const historiesMeasured = []
for (const size of [50, 200, 800]) for (const mode of ["received", "ignored"]) {
    const ctx = context(), source = new r.Chain([{ k: -1 }], ctx)
    let peak = 0, examined = 0, record
    for (let i = 0; i < size; i++) {
        const value = r.run(source, [], mode === "received" ? "concat" : "slice",
            mode === "received" ? [[{ k: i }]] : [0], ctx, {})
        ready(value, ctx)
        if (mode === "received") r.assignPath(source, [], value, ctx)
        else {
            r.run(source, [], "push", [{ k: i }], ctx, { mutationScopeDepth: 0 })
        }
        record = backing(source._state.value, ctx)
        retireFlatArrayOwners(record, ctx)
        peak = Math.max(peak, record.owners.size)
        // Count actual owner candidates for the newest backing index.
        const iterator = record.owners[Symbol.iterator].bind(record.owners)
        record.owners[Symbol.iterator] = function* () {
            for (const owner of iterator()) { examined++; yield owner }
        }
        record.visitViewPlacements([i + 1], ctx, () => {})
        delete record.owners[Symbol.iterator]
    }
    assert.equal(peak, 1)
    assert.equal(examined, size)
    drain()
    retireFlatArrayOwners(record, ctx)
    assert.equal(record.owners.size, 1)
    historiesMeasured.push({ size, mode, peakOwners: peak, examined })
}

// Import-validation copies inherit source protection; mutation copies do not.
{
    const ctx = context(), signal = Promise.withResolvers()
    const child = { k: 1, nested: { k: 1 }, waiting: signal.promise }
    child.self = child
    r.import(child, ctx)
    const cached = { child, alias: child }, api = new r.Chain(r.externalState({ fetch() { return cached } }), ctx)
    const first = new r.Chain(r.run(api, [], "fetch", [], ctx, {}), ctx)
    const survivor = new r.Chain(r.lookupPath(first, ["child"], ctx), ctx)
    const copy = survivor._state.value
    assert.notEqual(copy, child)
    assert.equal(metadata.isImported(copy, ctx), true)
    assert.equal(copy.self, copy)
    signal.resolve(7)
    await new Promise(resolve => setImmediate(resolve))
    r.assignPath(first, [], null, ctx)
    parents.removeParent(copy, cached, "child", ctx) // model parent retirement
    parents.removeParent(copy, cached, "alias", ctx)
    experiment.ignoreShared = true // this fixture must not rely on shared
    r.assignPath(survivor, ["k"], 2, ctx)
    r.assignPath(survivor, ["nested", "k"], 2, ctx)
    assert.equal(metadata.isImported(survivor._state.value, ctx), false)
    const again = new r.Chain(r.run(api, [], "fetch", [], ctx, {}), ctx)
    const expected = { k: 1, nested: { k: 1 }, waiting: 7 }
    expected.self = expected
    assert.deepEqual(await r.export(again, [], ctx), { child: expected, alias: expected })
    assert.equal(r.lookupPath(survivor, ["nested", "k"], ctx), 2)
    experiment.ignoreShared = false
}

// The rule is source-specific and also applies to copied Array containers.
for (const imported of [false, true]) {
    const ctx = context(), signal = Promise.withResolvers()
    const source = new r.Chain(imported ? r.import([signal.promise], ctx) : [signal.promise], ctx)
    const copy = r.importMethodResult(source._state.value, ctx)
    assert.notEqual(copy, source._state.value)
    assert.equal(metadata.isImported(copy, ctx), imported)
    const destination = new r.Chain(copy, ctx)
    signal.resolve(4)
    assert.deepEqual(await r.export(destination, [], ctx), [4])
}

assert.equal(queued.length, 0)
console.log(JSON.stringify({ histories, historiesMeasured,
    scope: "Hooked reception and copy-protection probes; flat Array retirement model only. Full Phase 2 ownership and GC are not implemented." }, null, 2))
