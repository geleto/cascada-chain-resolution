import assert from 'node:assert/strict'
import { writeHeapSnapshot } from 'node:v8'
import * as r from '../../src/index.js'
import { ready, OrderedThenable } from '../../test/ordered-thenable.js'

assert(globalThis.gc)
const rows = []
async function issue(method, delivery, outcome = 'failure') {
    const live = outcome === 'live'
    const label = `${method}/${delivery}/${outcome}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    let payload = { selected: label }, source = new Array(outcome === 'failure' && method !== 'with' ? 0xffffffff : 2)
    source[0] = { sourceChild: label }
    let chain = new r.Chain(source, ctx)
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
        if (!['push', 'unshift', 'splice'].includes(method)) {
            const output = new r.Chain(result, ctx)
            r.assignPath(chain, [], null, ctx)
            chain = output
        }
    } else {
        assert(r.isPoisonError(result), label)
        assert.equal(result.kind, method === 'with' ? r.ERROR_KIND.InvalidArrayOperation : r.ERROR_KIND.InvalidArrayLength, label)
    }
    if (!live) r.assignPath(chain, [], null, ctx)
    assert.equal(ctx.execution.fatalError, null)
    rows.push({ label, ctx, chain, poison: outcome === 'failure' ? result : undefined, weak, live })
    payload = source = argument = pending = args = result = chain = undefined
}
for (const method of ['concat', 'push', 'unshift', 'splice', 'toSpliced', 'with']) {
    if (process.env.METHOD && method !== process.env.METHOD) continue
    for (const delivery of ['ready', 'sync', 'native', 'ordered']) await issue(method, delivery)
    await issue(method, 'ready', 'discarded')
    await issue(method, 'ready', 'live')
}
if (process.env.FORMAT_STACKS) for (const row of rows) if (row.poison) void row.poison.stack
if (process.env.DROP_POISONS) for (const row of rows) row.poison = undefined
for (let turn = 0; turn < 30; turn++) { await new Promise(setImmediate); globalThis.gc() }
if (process.env.SNAPSHOT) writeHeapSnapshot(process.env.SNAPSHOT)
const retained = rows.filter(row => !row.live && row.weak.some(weak => weak.deref()))
    .map(row => ({ label: row.label, live: row.weak.map(weak => !!weak.deref()) }))
for (const row of rows.filter(row => row.live)) assert(row.weak[0].deref(), `${row.label} lost retained payload`)
console.log(JSON.stringify({ cases: rows.length, retained }, null, 2))
assert.deepEqual(retained, [])
