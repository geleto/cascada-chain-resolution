import assert from 'node:assert/strict'
import * as r from '../src/index.js'
import { OrderedThenable } from './ordered-thenable.js'
import { verifyRefCounts } from './verify-refcounts.js'
import { metaOf } from '../src/meta.js'

describe('shared captured placement delivery', () => {
    for (const delivery of ['native', 'ordered']) for (const array of [false, true]) {
        it(`preserves earlier writes and excludes later writes across copies, ${delivery}, array=${array}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: 'copy ordering' }
            const signal = delivery === 'native' ? Promise.withResolvers() : new OrderedThenable()
            const key = array ? 0 : 'child', marker = array ? 1 : 'marker'
            const chain = new r.Chain(array ? [signal.promise ?? signal, 0] : { child: signal.promise ?? signal, marker: 0 }, ctx)
            const first = r.assignPath(chain, [key, 'n'], 1, ctx)
            const earlier = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
            r.assignPath(chain, [marker], 5, ctx)
            const copied = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
            const second = r.assignPath(chain, [key, 'n'], 2, ctx)
            const before = r.export(copied, [], ctx)
            // Retire one source owner while its independently captured export survives.
            r.deletePath(copied, [], ctx)
            signal.resolve({ n: 0 })
            await Promise.all([first, second])
            assert.deepEqual(await r.export(earlier, [], ctx), array ? [{ n: 1 }, 0] : { child: { n: 1 }, marker: 0 })
            assert.deepEqual(await before, array ? [{ n: 1 }, 5] : { child: { n: 1 }, marker: 5 })
            assert.deepEqual(await r.export(chain, [], ctx), array ? [{ n: 2 }, 5] : { child: { n: 2 }, marker: 5 })
            verifyRefCounts(ctx, earlier._state, chain._state, copied._state)
            assert.equal(ctx.execution.fatalError, null)
        })

        it(`keeps cached imported re-entry and a surviving copy isolated, ${delivery}, array=${array}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: 'cached copy' }
            const signal = delivery === 'native' ? Promise.withResolvers() : new OrderedThenable()
            const key = array ? 0 : 'child', marker = array ? 1 : 'marker'
            const input = array ? [signal.promise ?? signal, 0] : { child: signal.promise ?? signal, marker: 0 }
            const original = new r.Chain(r.import(input, ctx), ctx)
            const copy = new r.Chain(r.lookupPath(original, [], ctx), ctx)
            r.assignPath(copy, [marker], 5, ctx)
            r.deletePath(original, [], ctx)
            assert.equal(metaOf(input, ctx).relationshipsActive, false)
            signal.resolve({ n: 0 })
            assert.deepEqual(await r.export(copy, [key], ctx), { n: 0 })
            const restored = new r.Chain(r.import(input, ctx), ctx)
            r.assignPath(copy, [key, 'n'], 9, ctx)
            assert.deepEqual(await r.export(restored, [], ctx), array ? [{ n: 0 }, 0] : { child: { n: 0 }, marker: 0 })
            assert.deepEqual(await r.export(copy, [key], ctx), { n: 9 })
            verifyRefCounts(ctx, restored._state, copy._state)
            assert.equal(ctx.execution.fatalError, null)
        })
    }
})
