import assert from 'node:assert/strict'
import { writeHeapSnapshot } from 'node:v8'
import * as r from '../../src/index.js'
import { ready, OrderedThenable } from '../../test/ordered-thenable.js'

assert(globalThis.gc)
const rows = []
async function issue(kind, delivery) {
    const label = `${kind}/${delivery}`, ctx = { execution: new r.Execution(), errorContext: label }
    let payload = { selected: label }, source = [2, 1], chain = new r.Chain(source, ctx)
    const poison = r.validationError('controlled input failure', ctx, r.ERROR_KIND.OperationInputFailed)
    let pending, failureInput = kind === 'comparator' ? payload : kind === 'fill-numeric' ? Symbol('bad') : poison
    if (delivery === 'sync') failureInput = ready(failureInput)
    if (delivery === 'native' || delivery === 'ordered') {
        pending = delivery === 'native' ? Promise.withResolvers() : new OrderedThenable()
        pending.original = failureInput
        failureInput = pending.promise ?? pending
    }
    let args = kind === 'comparator' ? [failureInput] : kind === 'fill-numeric' ? [payload, failureInput] : [payload, failureInput]
    const weak = [new WeakRef(payload), new WeakRef(source)]
    let result = r.run(chain, [], kind === 'comparator' ? 'sort' : kind === 'fill-numeric' ? 'fill' : 'concat', args, ctx, {})
    pending?.resolve(pending.original); pending?.flush?.()
    if (r.isPending(result, ctx)) result = await result
    assert(r.isPoisonError(result), label)
    assert.equal(result.kind, kind === 'comparator' ? r.ERROR_KIND.NotAFunction : kind === 'fill-numeric' ?
        r.ERROR_KIND.ScalarConversionFailed : r.ERROR_KIND.OperationInputFailed, label)
    r.assignPath(chain, [], null, ctx)
    assert.equal(ctx.execution.fatalError, null)
    rows.push({ label, ctx, chain, poison: result, weak })
    payload = source = chain = args = pending = failureInput = result = undefined
}
for (const kind of ['comparator', 'fill-numeric', 'concat-late-poison'])
    for (const delivery of ['ready', 'sync', 'native', 'ordered']) await issue(kind, delivery)
if (process.env.FORMAT_STACKS) for (const row of rows) void row.poison.stack
if (process.env.DROP_POISONS) for (const row of rows) row.poison = undefined
for (let turn = 0; turn < 30; turn++) { await new Promise(setImmediate); globalThis.gc() }
if (process.env.SNAPSHOT) writeHeapSnapshot(process.env.SNAPSHOT)
const retained = rows.filter(row => row.weak.some(weak => weak.deref())).map(row => ({label: row.label, live: row.weak.map(weak => !!weak.deref())}))
console.log(JSON.stringify({ cases: rows.length, retained }))
assert.deepEqual(retained, [])
