import assert from 'node:assert/strict'
import { writeHeapSnapshot } from 'node:v8'
import * as r from '../../src/index.js'
import { ready, OrderedThenable } from '../../test/ordered-thenable.js'

assert(globalThis.gc)
const rows = []
async function issue(method, mutation, valid, delivery) {
    const label = `${method}/${mutation}/${valid}/${delivery}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    let payload = { selected: label }, value = valid ? Object.assign((a, b) => a - b, { payload }) : payload
    let source = [2, 1], chain = new r.Chain(source, ctx), signal, input = value
    if (delivery === 'sync') input = ready(value)
    if (delivery === 'native' || delivery === 'ordered') {
        signal = delivery === 'native' ? Promise.withResolvers() : new OrderedThenable()
        input = signal.promise ?? signal
    }
    const weak = { payload: new WeakRef(payload), receiver: new WeakRef(source), input: new WeakRef(input) }
    let result = r.run(chain, [], method, [input], ctx, mutation ? { mutationScopeDepth: 0 } : {})
    // No extra property on the signal retains the payload; ordinary delivery owns it.
    signal?.resolve(value)
    if (r.isPending(result, ctx)) result = await result
    if (valid) {
        const output = new r.Chain(result, ctx)
        assert.deepEqual(await r.export(output, [], ctx), [1, 2], label)
        r.deletePath(output, [], ctx)
    } else {
        assert(r.isPoisonError(result), label)
        assert.equal(result.kind, r.ERROR_KIND.NotAFunction, label)
        assert.equal(result.errorContext, label)
    }
    r.deletePath(chain, [], ctx)
    assert.equal(ctx.execution.fatalError, null, label)
    rows.push({ label, valid, ctx, chain, poison: valid ? undefined : result, weak })
    payload = value = source = chain = signal = input = result = undefined
}

for (const [method, mutation] of [['sort', false], ['sort', true], ['toSorted', false]])
for (const valid of [false, true])
for (const delivery of ['ready', 'sync', 'native', 'ordered']) await issue(method, mutation, valid, delivery)

if (process.env.FORMAT_STACKS) for (const row of rows) if (row.poison) void row.poison.stack
if (process.env.DROP_POISONS) for (const row of rows) row.poison = undefined
for (let turn = 0; turn < 30; turn++) { await new Promise(setImmediate); globalThis.gc() }
if (process.env.SNAPSHOT) writeHeapSnapshot(process.env.SNAPSHOT)
const retained = rows.flatMap(row => {
    const live = Object.fromEntries(Object.entries(row.weak).map(([name, weak]) => [name, Boolean(weak.deref())]))
    return live.payload || live.receiver || live.input ? [{ label: row.label, live }] : []
})
console.log(JSON.stringify({ cases: rows.length, retained }))
assert.deepEqual(retained, [])
