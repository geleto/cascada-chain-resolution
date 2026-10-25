import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import { OrderedThenable } from '../../test/ordered-thenable.js'
import { verifyRefCounts } from '../../test/verify-refcounts.js'

const routes = ['push-pop', 'unshift-pop', 'unshift-shift', 'concat-shift',
    'concat-slice', 'alternating-ends', 'splice-window', 'sparse-assignment']

async function prepare(route, delivery) {
    const ctx = { execution: new r.Execution(), errorContext: 'missed history payload release' }
    const sentinel = { id: 0, child: {} }, live = new WeakRef(sentinel)
    const chain = new r.Chain([sentinel, , { id: 2 }, { id: 3 }], ctx), model = [0, , 2, 3]
    const saved = new r.Chain(r.run(chain, [], 'slice', [], ctx, {}), ctx)
    const signals = [], removed = [], pendingResults = []
    const call = (name, args) => {
        const result = r.run(chain, [], name, args, ctx, { mutationScopeDepth: 0 })
        if (r.isPending(result, ctx)) pendingResults.push(result)
        return result
    }
    const assignSlice = () => r.assignPath(chain, [], r.run(chain, [], 'slice', [1], ctx, {}), ctx)
    for (let index = 0; index < 64; index++) {
        const payload = { id: index + 10, child: { id: index + 10 } }
        // The retained original view may keep its bounded spare backing tail;
        // these later inputs were never covered by that retained generation.
        if (index >= 16 && index < 48) removed.push(new WeakRef(payload), new WeakRef(payload.child))
        const signal = delivery === 'native' ? Promise.withResolvers() :
            delivery === 'ordered' ? new OrderedThenable() : undefined
        const value = signal?.promise ?? signal ?? payload
        if (signal) signals.push([signal, payload])
        switch (route) {
            case 'push-pop': call('push', [value]); call('pop', []); break
            case 'unshift-pop': call('unshift', [value]); call('pop', []); model.unshift(index + 10); model.pop(); break
            case 'unshift-shift': call('unshift', [value]); call('shift', []); break
            case 'concat-shift':
                r.assignPath(chain, [], r.run(chain, [], 'concat', [[value]], ctx, {}), ctx)
                call('shift', []); model.push(index + 10); model.shift(); break
            case 'concat-slice':
                r.assignPath(chain, [], r.run(chain, [], 'concat', [[value]], ctx, {}), ctx)
                assignSlice(); model.push(index + 10); model.shift(); break
            case 'alternating-ends':
                if (index % 2) { call('unshift', [value]); call('pop', []); model.unshift(index + 10); model.pop() }
                else { call('push', [value]); call('shift', []); model.push(index + 10); model.shift() }
                break
            case 'splice-window': call('splice', [1, 1, value]); model.splice(1, 1, index + 10); break
            case 'sparse-assignment':
                r.assignPath(chain, [4], value, ctx); assignSlice(); model[4] = index + 10; model.shift(); break
        }
    }
    for (let index = signals.length - 1; index >= 0; index--) signals[index][0].resolve(signals[index][1])
    await Promise.all(pendingResults)
    assert.deepEqual((await r.export(chain, [], ctx)).map(value => value.id), model)
    assert.deepEqual((await r.export(saved, [], ctx)).map(value => value.id), [0, , 2, 3])
    verifyRefCounts(ctx, chain._state, saved._state)
    assert.equal(ctx.execution.fatalError, null)
    return { ctx, chain, saved, removed, live }
}

const results = []
for (const route of routes) for (const delivery of ['ready', 'native', 'ordered']) {
    const state = await prepare(route, delivery)
    for (let turn = 0; turn < 20; turn++) {
        await new Promise(setImmediate)
        global.gc()
    }
    assert(state.live.deref(), `${route}/${delivery}: retained view lost positive control`)
    assert(state.removed.every(ref => ref.deref() === undefined), `${route}/${delivery}: obsolete selected payload retained`)
    results.push({ route, delivery, collectedPayloadsAndChildren: state.removed.length, retainedControl: true })
}
console.log(JSON.stringify({ cases: results.length, results }))
