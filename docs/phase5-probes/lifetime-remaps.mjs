import assert from 'node:assert/strict'
import { writeHeapSnapshot } from 'node:v8'
import * as r from '../../src/index.js'

assert(globalThis.gc)
function handlerFor(fresh, failKey) {
    return {
        armed: false, hits: 0, failKey, cause: fresh ? undefined : new Error('prebuilt remap failure'),
        getOwnPropertyDescriptor(target, key) {
            if (this.armed && key === this.failKey) {
                this.hits++
                this.cause ??= new Error('fresh remap failure')
                throw this.cause
            }
            return Reflect.getOwnPropertyDescriptor(target, key)
        },
    }
}
const specs = {
    concat: [], reverse: [], splice: [1, 1], toReversed: [],
    toSpliced: [1, 1], sort: [], toSorted: [], flat: [1],
}
const rows = []
function issue(method, fresh, failKey, live = false, position = 'receiver') {
    const label = `${method}/${fresh}/${failKey ?? 'healthy'}/${live}/${position}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    const raw = [{ selected: 0 }, { selected: 1 }, { selected: 2 }]
    const handler = handlerFor(fresh, failKey), source = new Proxy(raw, handler)
    const admitted = r.import(source, ctx)
    const chain = new r.Chain(position === 'argument' ? [7] : admitted, ctx)
    const weak = [raw, source, ...raw].map(value => new WeakRef(value))
    handler.armed = true
    const args = position === 'argument' ? [admitted] : specs[method].slice()
    if (method === 'splice' || method === 'toSpliced') args.push({ inserted: true })
    let result = r.run(chain, [], method, args, ctx, {})
    handler.armed = false
    if (failKey) {
        assert(r.isPoisonError(result), label)
        assert.equal(result.cause, handler.cause, label)
        assert.equal(result.kind, r.ERROR_KIND.InvocationFailed, label)
        assert.equal(result.errorContext, label)
        assert(handler.hits > 0, label)
    }
    let retained
    if (live) retained = new r.Chain(result, ctx)
    if (!failKey) result = undefined
    r.assignPath(chain, [], null, ctx)
    assert.equal(ctx.execution.fatalError, null)
    rows.push({ label, ctx, chain, retained, poison: result, weak, live })
}
for (const method of Object.keys(specs)) {
    if (process.env.METHOD && method !== process.env.METHOD) continue
    for (const fresh of [false, true]) for (const failKey of ['0', '2']) issue(method, fresh, failKey)
    issue(method, false, undefined)
    issue(method, false, undefined, true)
    if (method === 'concat') {
        for (const fresh of [false, true]) for (const failKey of ['0', '2']) issue(method, fresh, failKey, false, 'argument')
        issue(method, false, undefined, false, 'argument')
        issue(method, false, undefined, true, 'argument')
    }
}
if (process.env.FORMAT_STACKS) for (const row of rows) if (row.poison) { void row.poison.stack; void row.poison.cause?.stack }
if (process.env.DROP_POISONS) for (const row of rows) row.poison = undefined
for (let turn = 0; turn < 30; turn++) { await new Promise(setImmediate); globalThis.gc() }
if (process.env.SNAPSHOT) writeHeapSnapshot(process.env.SNAPSHOT)
const retained = rows.filter(row => !row.live && row.weak.some(value => value.deref()))
    .map(row => ({ label: row.label, live: row.weak.map(value => !!value.deref()) }))
for (const row of rows.filter(row => row.live)) assert(row.weak[2].deref(), `${row.label} lost live payload`)
console.log(JSON.stringify({ cases: rows.length, retained }, null, 2))
assert.deepEqual(retained, [])
