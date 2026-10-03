// Public lifetime witnesses; the loader only observes allocated export shells.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

const shells = []
globalThis.captureExportShell = value => { shells.push(new WeakRef(value)); return value }
const exportURL = new URL("../../src/export.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== exportURL) return result
    const source = String(result.source), marker = "createEmptyContainer(value, operationContext)"
    assert(source.includes(marker))
    return { ...result, source: source.replace(marker, "globalThis.captureExportShell(" + marker + ")") }
} })
const r = await import("../../src/index.js")
const { metaOf } = await import("../../src/meta.js")
const { getParentPlacements } = await import("../../src/parent-placements.js")
const { verifyRefCounts } = await import("../verify-refcounts.js")
const context = () => ({ execution: new r.Execution(), errorContext: "ownership destinations" })
const turn = () => new Promise(setImmediate)
async function collected(ref) {
    for (let i = 0; i < 20; i++) { await turn(); global.gc() }
    assert.equal(ref.deref(), undefined)
}
assert(global.gc, "Run with --expose-gc")

// A delivered container is spent once traversal captures its child placements,
// even while those descendants still need to settle for the result.
for (const shape of ["record", "array"])
for (const operation of ["export", "hasError", "getErrors", "lookupPath"]) {
    const ctx = context(), descendant = Promise.withResolvers()
    function issue() {
        const producer = Promise.withResolvers(), holder = new r.Chain({ branch: producer.promise }, ctx)
        const path = operation === "lookupPath" ? ["branch", shape === "record" ? "waiting" : 0] : []
        const result = r[operation](holder, path, ctx)
        r.assignPath(holder, [], null, ctx)
        const source = shape === "record" ? { waiting: descendant.promise, other: { k: 1 } } : [descendant.promise, { k: 1 }]
        producer.resolve(source)
        return { result, source: new WeakRef(source) }
    }
    const { result, source } = issue()
    await collected(source)
    descendant.resolve(8)
    const child = shape === "record" ? { waiting: 8, other: { k: 1 } } : [8, { k: 1 }]
    assert.deepEqual(await result, operation === "export" ? { branch: child } :
        operation === "hasError" ? false : operation === "getErrors" ? null : 8)
}

for (const before of [false, true]) for (const reject of [false, true]) {
    const ctx = context(), pending = Promise.withResolvers()
    let inspections = 0
    const source = new Proxy({ waiting: pending.promise }, {
        ownKeys(value) { inspections++; return Reflect.ownKeys(value) },
        getOwnPropertyDescriptor(value, key) { inspections++; return Reflect.getOwnPropertyDescriptor(value, key) },
    })
    const holder = new r.ContextChain(source, ctx), version = metaOf(source, ctx).placementVersions.waiting
    const outcome = reject ? new Error("expected") : { k: 7 }
    if (before) { pending[reject ? "reject" : "resolve"](outcome); await version.publication }
    r.assignPath(holder, [], null, ctx)
    assert.equal(metaOf(source, ctx).relationshipsActive, false)
    if (!before) { pending[reject ? "reject" : "resolve"](outcome); await version.publication }
    const count = inspections
    const again = new r.ContextChain(source, ctx)
    assert.equal(inspections, count)
    assert.equal(r.lookupPath(again, ["waiting"], ctx), version.value)
    assert.equal(r.isPoisonError(version.value), reject)
    verifyRefCounts(ctx, again._state)
}

{
    const ctx = context(), pending = Promise.withResolvers()
    let subscriptions = 0
    const source = { waiting: { then(resolve, reject) {
        subscriptions++; return pending.promise.then(resolve, reject)
    } } }
    source.self = source
    const holder = new r.ContextChain(source, ctx)
    const captured = new r.Chain(r.lookupPath(holder, ["waiting"], ctx), ctx), count = subscriptions
    r.assignPath(holder, [], null, ctx)
    assert.equal(metaOf(source, ctx).relationshipsActive, false)
    const again = new r.ContextChain(source, ctx)
    assert.equal(subscriptions, count)
    pending.resolve({ k: 5 })
    assert.equal(await r.lookupPath(again, ["waiting"], ctx), await r.lookupPath(captured, [], ctx))
    assert(getParentPlacements(source, ctx).some(p => p.parent === source))
    verifyRefCounts(ctx, again._state, captured._state)
}

// A current destination reopens on re-entry; an overwritten version never does.
{
    const ctx = context(), pending = Promise.withResolvers(), source = { waiting: pending.promise }
    const holder = new r.Chain(source, ctx), captured = r.lookupPath(holder, ["waiting"], ctx)
    r.assignPath(holder, ["waiting"], 12, ctx)
    const current = holder._state.value
    r.assignPath(holder, [], null, ctx)
    const again = new r.Chain(current, ctx)
    pending.resolve(4)
    assert.equal(await captured, 4)
    assert.equal(r.lookupPath(again, ["waiting"], ctx), 12)
    verifyRefCounts(ctx, again._state)
}

{
    const ctx = context(), pending = Promise.withResolvers(), child = { waiting: pending.promise }
    const survivor = new r.Chain(child, ctx), parent = { child }, holder = new r.Chain(parent, ctx)
    const query = r.hasError(holder, [], ctx)
    r.assignPath(holder, [], null, ctx)
    assert.equal(metaOf(parent, ctx).promiseCount, undefined)
    pending.reject(new Error("late failure"))
    assert.equal(await query, true)
    const again = new r.Chain(parent, ctx)
    assert.equal(await r.hasError(again, [], ctx), true)
    verifyRefCounts(ctx, again._state, survivor._state)
}

{
    const ctx = context(), pending = Promise.withResolvers(), child = { waiting: pending.promise }
    const source = new r.Chain([child, child], ctx)
    const view = r.run(source, [], "slice", [], ctx, {}), holder = new r.Chain(view, ctx)
    const query = r.hasError(holder, [], ctx)
    assert.equal(metaOf(child, ctx).parents.get(view), 2)
    r.assignPath(holder, [], null, ctx)
    assert.equal(metaOf(child, ctx).parents.has(view), false)
    pending.reject(new Error("late view failure"))
    assert.equal(await query, true)
    verifyRefCounts(ctx, source._state)
}

// A retained child and pending capture must not retain their abandoned ancestors.
{
    const ctx = context(), pending = Promise.withResolvers(), child = {}, survivor = new r.Chain(child, ctx)
    function issue() {
        const sibling = {}, source = { child, sibling, waiting: pending.promise }
        const holder = new r.Chain(source, ctx), capture = r.lookupPath(holder, ["waiting"], ctx)
        r.assignPath(holder, [], null, ctx)
        return { parent: new WeakRef(source), sibling: new WeakRef(sibling), capture }
    }
    const result = issue()
    await collected(result.parent); await collected(result.sibling)
    assert.deepEqual(getParentPlacements(child, ctx), [{ parent: survivor._state, key: "value" }])
    pending.resolve(9)
    assert.equal(await result.capture, 9)
}

for (const operation of ["export", "hasError", "getErrors"]) for (const poison of [false, true]) {
    const ctx = context(), pending = Promise.withResolvers(), child = { waiting: pending.promise }
    const survivor = new r.Chain(child, ctx)
    const failure = r.validationError("expected", ctx, r.ERROR_KIND.OperationInputFailed)
    shells.length = 0
    function issue() {
        const source = { child, unrelated: { k: 1 } }
        if (poison) source.failure = failure
        const holder = new r.Chain(source, ctx), result = r[operation](holder, [], ctx)
        r.assignPath(holder, [], null, ctx)
        return { source: new WeakRef(source), result }
    }
    const pendingResult = issue()
    await collected(pendingResult.source)
    if (operation === "export" && poison) {
        assert(shells.length > 0)
        for (const shell of shells) await collected(shell)
    }
    pending.resolve(11)
    const result = await pendingResult.result
    if (operation === "export") {
        if (poison) assert.equal(result, failure)
        else assert.deepEqual(result, { child: { waiting: 11 }, unrelated: { k: 1 } })
    } else if (operation === "hasError") assert.equal(result, poison)
    else if (poison) assert(result !== null)
    else assert.equal(result, null)
    assert.equal(r.lookupPath(survivor, ["waiting"], ctx), 11)
}
// Admission copies preserve cached imported state even after the cache retires.
{
    const ctx = context(), pending = Promise.withResolvers()
    const child = { k: 1, nested: { k: 1 }, waiting: pending.promise }
    child.self = child
    r.import(child, ctx)
    const cached = { child, alias: child }
    const api = new r.Chain(r.externalState({ fetch() { return cached } }), ctx)
    const first = new r.Chain(r.run(api, [], "fetch", [], ctx, {}), ctx)
    const survivor = new r.Chain(r.lookupPath(first, ["child"], ctx), ctx)
    const copy = survivor._state.value
    assert.notEqual(copy, child)
    assert.equal(metaOf(copy, ctx).imported, true)
    assert.equal(copy.self, copy)
    pending.resolve(7)
    await turn()
    r.assignPath(first, [], null, ctx)
    r.assignPath(survivor, ["k"], 2, ctx)
    r.assignPath(survivor, ["nested", "k"], 2, ctx)
    assert.equal(metaOf(survivor._state.value, ctx).imported, undefined)
    const again = new r.Chain(r.run(api, [], "fetch", [], ctx, {}), ctx)
    const expected = { k: 1, nested: { k: 1 }, waiting: 7 }; expected.self = expected
    assert.deepEqual(await r.export(again, [], ctx), { child: expected, alias: expected })
    assert.equal(r.lookupPath(survivor, ["nested", "k"], ctx), 2)
}

// Detached cleanup clears its own state after fatality without a queued throw.
{
    const ctx = context(), source = new r.Chain([1], ctx)
    r.run(source, [], "slice", [], ctx, {})
    assert(ctx.execution._readyDeliveries.size > 0)
    assert.throws(() => r.failExecution(ctx, new Error("fatal witness")), r.FatalError)
    await turn()
    assert.equal(ctx.execution._readyDeliveries, undefined)
    assert.equal(ctx.execution._readyDeliveryQueued, false)
}

console.log("Destination retirement, reactivation, counters, source GC, and discarded export GC passed")
