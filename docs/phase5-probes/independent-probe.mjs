import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import { OrderedThenable } from '../../test/ordered-thenable.js'
import { verifyRefCounts } from '../../test/verify-refcounts.js'

let externalControls = 0, presenceControls = 0
for (const mutable of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: 'independent native Error' }
    const error = new Error('healthy data')
    error.detail = { value: 4 }
    error.read = function () { return this.message }
    const native = r.externalState({ error })
    const chain = mutable ? new r.ContextChain({ native }, ctx, { native: {} })
        : new r.Chain(r.import({ native }, ctx), ctx)
    assert.equal(r.lookupPath(chain, ['native', 'error'], ctx), error)
    assert.equal(r.lookupPath(chain, ['native', 'error', 'message'], ctx), 'healthy data')
    assert.equal(r.run(chain, ['native', 'error'], 'read', [], ctx, {}), 'healthy data')
    assert.equal(r.run(chain, ['native', 'error'], 'toString', [], ctx, {}), 'Error: healthy data')
    assert.equal(r.lookupPath(chain, ['native', 'error', 'detail', 'value'], ctx), 4)
    const captured = new r.Chain(r.lookupPath(chain, ['native', 'error', 'detail'], ctx), ctx)
    r.assignPath(captured, ['value'], 9, ctx)
    assert.equal(error.detail.value, 4)
    assert.equal(r.hasError(chain, [], ctx), false)
    assert.equal(ctx.execution.fatalError, null)
    externalControls++
}

// The placement's value and final presence must transfer before a spent
// continuation releases its original version and callback. A later write must
// not change a result already captured through an observing Array operation.
for (const mode of ['native', 'ordered']) for (const deleting of [false, true])
for (const method of ['toReversed', 'toSpliced', 'with', 'slice']) {
    const ctx = { execution: new r.Execution(), errorContext: `${mode}/${deleting}/${method}` }
    const chain = new r.Chain([1, 2, 3], ctx)
    const signal = mode === 'native' ? Promise.withResolvers() : new OrderedThenable()
    const wait = signal.promise ?? signal
    const entry = r.enter(chain, [1], ctx, true, inside => wait.then(() => {
        if (deleting) r.deletePath(inside, [], ctx)
        else r.assignPath(inside, [], 5, ctx)
    }))
    const args = method === 'toSpliced' ? [0, 0, 7] : method === 'with' ? [0, 7] : []
    const result = r.run(chain, [], method, args, ctx, {})
    const held = new r.Chain(result, ctx)
    const exported = r.export(held, [], ctx)
    const changed = r.assignPath(chain, [1], 9, ctx)
    signal.resolve()
    await Promise.all([entry, changed])
    const earlier = deleting ? [1, , 3] : [1, 5, 3]
    const expected = Reflect.apply(Array.prototype[method], earlier, args)
    assert.deepEqual(await exported, expected)
    assert.deepEqual(await r.export(held, [], ctx), expected)
    assert.deepEqual(await r.export(chain, [], ctx), [1, 9, 3])
    verifyRefCounts(ctx, chain._state, held._state)
    assert.equal(ctx.execution.fatalError, null)
    presenceControls++
}
console.log(JSON.stringify({ externalControls, presenceControls }))
