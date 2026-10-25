import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import { OrderedThenable } from '../ordered-thenable.js'

function makeQueue(delivery, trim) {
    const ctx = { execution: new r.Execution(), errorContext: 'queue storage release' }
    const chain = new r.Chain([], ctx), signals = [], removed = []
    let saved, live
    for (let index = 0; index < 64; index++) {
        const value = { index, child: { index } }
        if (index === 0) live = new WeakRef(value)
        // The saved prefix may retain the bounded spare tail of its backing.
        // Sample later generations, which that retained view never covered.
        if (index >= 16 && index < 48) removed.push(new WeakRef(value), new WeakRef(value.child))
        const signal = delivery === 'native' ? Promise.withResolvers() :
            delivery === 'ordered' ? new OrderedThenable() : undefined
        if (signal) signals.push({ signal, value })
        r.run(chain, [], 'push', [signal?.promise ?? signal ?? value], ctx, { mutationScopeDepth: 0 })
        if (index === 3) saved = new r.Chain(r.run(chain, [], 'slice', [], ctx, {}), ctx)
        if (index >= 4) {
            if (trim === 'shift') r.run(chain, [], 'shift', [], ctx, { mutationScopeDepth: 0 })
            else r.assignPath(chain, [], r.run(chain, [], 'slice', [1], ctx, {}), ctx)
        }
    }
    for (const { signal, value } of signals) signal.resolve(value)
    signals.length = 0
    return { ctx, chain, saved, live, removed }
}

let cases = 0
for (const delivery of ['ready', 'native', 'ordered']) for (const trim of ['shift', 'slice']) {
    const state = makeQueue(delivery, trim)
    for (let turn = 0; turn < 20; turn++) {
        await new Promise(setImmediate)
        global.gc()
    }
    assert(state.live.deref(), 'A retained earlier view must keep its payload alive')
    assert(state.removed.every(ref => ref.deref() === undefined),
        `Completed ${delivery}/${trim} queue retains removed payloads through old backing`)
    assert.deepEqual((await r.export(state.chain, [], state.ctx)).map(value => value.index), [60, 61, 62, 63])
    assert.deepEqual((await r.export(state.saved, [], state.ctx)).map(value => value.index), [0, 1, 2, 3])
    assert.equal(state.ctx.execution.fatalError, null)
    cases++
}
console.log(JSON.stringify({ cases, retainedViewControls: cases }))
