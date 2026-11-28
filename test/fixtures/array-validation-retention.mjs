import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import { ready, OrderedThenable } from '../ordered-thenable.js'

assert(globalThis.gc)
const rows = []
async function issue(method, delivery, outcome = 'failure') {
    const live = outcome === 'live'
    const label = `${method}/${delivery}/${outcome}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    let payload = { selected: label }, source = new Array(outcome === 'failure' && method !== 'with' ? 0xffffffff : 2)
    source[0] = { sourceChild: label }
    let expected = outcome === 'failure' ? undefined : source.slice()
    let chain = new r.Chain(source, ctx, r.CHAIN_MODE.Complete)
    let argument = payload, pending
    if (delivery === 'sync') argument = ready(payload)
    if (delivery === 'native' || delivery === 'ordered') {
        pending = delivery === 'native' ? Promise.withResolvers() : new OrderedThenable()
        argument = pending.promise ?? pending
    }
    let args = method === 'with' ? [outcome === 'failure' ? 3 : 0, argument] :
        method === 'splice' || method === 'toSpliced' ? [0, 0, argument] : [argument]
    const weak = [new WeakRef(payload), new WeakRef(source), new WeakRef(source[0])]
    let result = r.run(chain, [], method, args, ctx,
        ['push', 'unshift', 'splice'].includes(method) ? { mutationScopeDepth: 0 } : {})
    pending?.resolve(payload); pending?.flush?.()
    if (r.isPending(result, ctx)) result = await result
    if (outcome !== 'failure') {
        const output = Reflect.apply(Array.prototype[method], expected,
            method === 'with' ? [0, payload] : method === 'splice' || method === 'toSpliced' ? [0, 0, payload] : [payload])
        if (!['push', 'unshift', 'splice'].includes(method)) expected = output
        if (!['push', 'unshift', 'splice'].includes(method)) {
            const output = new r.Chain(result, ctx)
            r.assignPath(chain, [], null, ctx)
            chain = output
        }
        assert.deepEqual(await r.export(chain, [], ctx), expected, label)
    } else {
        assert(r.isPoisonError(result), label)
        assert.equal(result.kind, method === 'with' ? r.ERROR_KIND.InvalidArrayOperation : r.ERROR_KIND.InvalidArrayLength, label)
        assert.equal(result.errorContext, label)
    }
    if (!live) r.assignPath(chain, [], null, ctx)
    assert.equal(ctx.execution.fatalError, null)
    rows.push({ label, ctx, chain, poison: outcome === 'failure' ? result : undefined, weak, live })
    payload = source = argument = pending = args = result = chain = expected = undefined
}
for (const method of ['concat', 'push', 'unshift', 'splice', 'toSpliced', 'with']) {
    for (const delivery of ['ready', 'sync', 'native', 'ordered']) await issue(method, delivery)
    for (const delivery of ['ready', 'sync', 'native', 'ordered']) {
        await issue(method, delivery, 'discarded')
        await issue(method, delivery, 'live')
    }
}
// The comparator can stay pending after sort has finished reading its source.
// Keep a separate live-holder control and mutate a selected child after capture.
function sortCapture(method, live) {
    const ctx = { execution: new r.Execution(), errorContext: method }
    const source = [{ n: 2 }, { n: 1 }], chain = new r.Chain(source, ctx)
    const weak = new WeakRef(source), comparator = Promise.withResolvers()
    const holder = live && r.capturePath(chain, [], ctx)
    const output = new r.Chain(r.run(chain, [], method, [comparator.promise], ctx, {}), ctx)
    r.assignPath(chain, [0, "n"], 7, ctx)
    r.assignPath(chain, [], null, ctx)
    return { ctx, weak, comparator, holder, output }
}
const sorts = ["sort", "toSorted"].flatMap(method => [false, true].map(live => sortCapture(method, live)))
function withCapture(mode, live) {
    const ctx = { execution: new r.Execution(), errorContext: "with index retention" }
    const source = new r.Chain(["A"], ctx, mode), hold = Promise.withResolvers()
    let inside
    const entry = r.enter(source, [], ctx, { maximumCount: 1, mayPoisonScope: false }, reference => {
        inside = reference
        return hold.promise
    })
    const index = [1], ignored = { unused: true }
    const result = r.run(source, [], "with", [index, "X", ignored], ctx, {})
    assert(r.isPending(result, ctx))
    const output = new r.Chain(result, ctx, mode)
    const holders = live && [new r.Chain(index, ctx), new r.Chain(ignored, ctx)]
    return { ctx, output, holders, index: new WeakRef(index), ignored: new WeakRef(ignored), async finish() {
        r.run(inside, [], "push", ["B"], ctx, { mutationScopeDepth: 0 })
        hold.resolve()
        await entry
    } }
}
const replacements = Object.values(r.CHAIN_MODE).flatMap(mode => [false, true].map(live => withCapture(mode, live)))
function failedInsertion(method, mutation, keep) {
    const ctx = { execution: new r.Execution(), errorContext: "conditional splice insertion" }
    const source = new r.Chain(["A", "B"], ctx, r.CHAIN_MODE.Sequential), earlier = Promise.withResolvers()
    r.run(source, [], "splice", [1, earlier.promise], ctx, { mutationScopeDepth: 0 })
    const receiver = r.capturePath(source, [], ctx, r.CHAIN_MODE.Complete)
    const start = Promise.withResolvers(), count = Promise.withResolvers()
    const failure = r.validationError("start", ctx, r.ERROR_KIND.OperationInputFailed)
    const payload = { n: 1 }, ref = new WeakRef(payload), holder = keep && new r.Chain(payload, ctx)
    const result = r.run(receiver, [], method, [start.promise, count.promise, payload], ctx, mutation ? { mutationScopeDepth: 0 } : {})
    start.resolve(failure)
    return { ctx, earlier, count, failure, ref, holder, result, receiver, mutation }
}
const insertions = [false, true].flatMap(keep => [failedInsertion("splice", true, keep),
    failedInsertion("splice", false, keep), failedInsertion("toSpliced", false, keep)])

function diagnosticCapture(method, live, before) {
    const ctx = { execution: new r.Execution(), errorContext: "conditional validation" }
    const child = { n: 1 }, end = Promise.withResolvers(), index = Promise.withResolvers()
    const cause = r.validationError("index", ctx, r.ERROR_KIND.OperationInputFailed)
    const source = new r.Chain([child], ctx, r.CHAIN_MODE.Unordered)
    const array = new r.Chain(r.run(source, [], "slice", [0, end.promise], ctx, {}), ctx, r.CHAIN_MODE.Complete)
    const failed = before ? cause : index.promise
    const args = method === "with" ? [failed, "X"] : [0, failed, "X"]
    const result = r.run(array, [], method, args, ctx, {})
    r.assignPath(source, [], null, ctx)
    if (!live) r.assignPath(array, [], null, ctx)
    index.resolve(cause)
    return { ctx, array, end, result, cause, method, live, ref: new WeakRef(child) }
}
const conditional = ["with", "splice", "toSpliced"].flatMap(method => [false, true].flatMap(live =>
    [false, true].map(before => diagnosticCapture(method, live, before))))
for (let turn = 0; turn < 30; turn++) { await new Promise(setImmediate); globalThis.gc() }
for (const { ctx, end, result, cause, method, ref, live } of conditional) {
    assert.equal(Boolean(ref.deref()), live, method)
    end.resolve(live ? 1 : 0)
    const value = await result
    if (live) assert.equal(value, cause)
    else if (method === "with") assert.equal(value.kind, r.ERROR_KIND.InvalidArrayOperation)
    else assert.deepEqual(await r.export(new r.Chain(value, ctx), [], ctx), ["X"])
}
for (const { ctx, earlier, count, failure, ref, holder, result, receiver, mutation } of insertions) {
    assert.equal(Boolean(ref.deref()), Boolean(holder), "failed start releases its insertion before count diagnostics")
    if (mutation) assert.equal(await r.hasError(receiver, [], ctx), true)
    count.resolve(0)
    assert.equal(await result, failure)
    if (mutation) await r.repairPath(receiver, [], ctx)
    earlier.resolve(0)
    assert.deepEqual(await r.export(receiver, [], ctx), ["A", "B"])
}
for (const { ctx, weak, comparator, holder, output } of sorts) {
    assert.equal(Boolean(weak.deref()), Boolean(holder), ctx.errorContext)
    comparator.resolve((left, right) => left.n - right.n)
    assert.deepEqual(await r.export(output, [], ctx), [{ n: 1 }, { n: 2 }])
}
for (const { ctx, output, holders, index, ignored, finish } of replacements) {
    assert.equal(Boolean(index.deref()), Boolean(holders), "captured index")
    assert.equal(Boolean(ignored.deref()), Boolean(holders), "unused argument")
    await finish()
    assert.deepEqual(await r.export(output, [], ctx), ["A", "X"])
}
const retained = rows.filter(row => !row.live && row.weak.some(weak => weak.deref()))
    .map(row => ({ label: row.label, live: row.weak.map(weak => !!weak.deref()) }))
for (const row of rows.filter(row => row.live)) assert(row.weak[0].deref(), `${row.label} lost retained payload`)
console.log(JSON.stringify({ cases: rows.length, retained }, null, 2))
assert.deepEqual(retained, [])
