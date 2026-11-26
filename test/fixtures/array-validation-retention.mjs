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
for (let turn = 0; turn < 30; turn++) { await new Promise(setImmediate); globalThis.gc() }
for (const { ctx, weak, comparator, holder, output } of sorts) {
    assert.equal(Boolean(weak.deref()), Boolean(holder), ctx.errorContext)
    comparator.resolve((left, right) => left.n - right.n)
    assert.deepEqual(await r.export(output, [], ctx), [{ n: 1 }, { n: 2 }])
}
const retained = rows.filter(row => !row.live && row.weak.some(weak => weak.deref()))
    .map(row => ({ label: row.label, live: row.weak.map(weak => !!weak.deref()) }))
for (const row of rows.filter(row => row.live)) assert(row.weak[0].deref(), `${row.label} lost retained payload`)
console.log(JSON.stringify({ cases: rows.length, retained }, null, 2))
assert.deepEqual(retained, [])
