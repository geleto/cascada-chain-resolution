import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as r from '../src/index.js'
import { metaOf } from '../src/meta.js'
import { OrderedThenable } from './ordered-thenable.js'
import { verifyRefCounts } from './verify-refcounts.js'

const context = () => ({ execution: new r.Execution(), errorContext: 'bounded Array queue storage' })

function backingLength(chain, ctx) {
    const value = chain._state.value
    return (metaOf(value, ctx).arrayRange?.backing ?? value).length
}

describe('Array queue storage', () => {
    it('releases removed payloads while preserving retained views', function () {
        this.timeout(30000)
        const fixture = fileURLToPath(new URL('./fixtures/queue-storage-release.mjs', import.meta.url))
        const result = spawnSync(process.execPath,
            [...process.execArgv, '--unhandled-rejections=strict', '--expose-gc', fixture],
            { encoding: 'utf8', timeout: 25000 })
        assert.equal(result.error, undefined)
        assert.equal(result.status, 0, result.stderr || result.stdout)
        assert.deepEqual(JSON.parse(result.stdout), { cases: 6, retainedViewControls: 6 })
    })

    for (const size of [16, 32, 64]) for (const delivery of ['ready', 'native', 'ordered']) {
        it(`bounds physical storage across push/shift, N=${size}, ${delivery}`, async () => {
            const ctx = context(), chain = new r.Chain([], ctx)
            const pending = []
            let peak = 0
            for (let index = 0; index < size; index++) {
                const signal = delivery === 'native' ? Promise.withResolvers() :
                    delivery === 'ordered' ? new OrderedThenable() : undefined
                if (signal) pending.push(signal)
                assert.equal(r.run(chain, [], 'push', [signal?.promise ?? signal ?? index], ctx,
                    { mutationScopeDepth: 0 }), Math.min(index + 1, 5))
                if (index >= 4) r.run(chain, [], 'shift', [], ctx, { mutationScopeDepth: 0 })
                peak = Math.max(peak, backingLength(chain, ctx))
            }
            // Four live elements allow a constant amount of spare storage,
            // independent of the number of discarded queue elements.
            assert(peak <= 12, `queue backing grows with history: ${peak} slots for four live elements`)
            for (let index = pending.length - 1; index >= 0; index--) pending[index].resolve(index)
            assert.deepEqual(await r.export(chain, [], ctx), [size - 4, size - 3, size - 2, size - 1])
            verifyRefCounts(ctx, chain._state)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it('preserves retained sparse views and pending captures when an offset queue grows', async () => {
        const ctx = context(), signal = Promise.withResolvers()
        const chain = new r.Chain([signal.promise, , 2, 3], ctx)
        const saved = new r.Chain(r.run(chain, [], 'slice', [], ctx, {}), ctx)
        const captured = r.export(saved, [], ctx)
        for (let index = 4; index < 40; index++) {
            r.run(chain, [], 'push', [index], ctx, { mutationScopeDepth: 0 })
            r.run(chain, [], 'shift', [], ctx, { mutationScopeDepth: 0 })
        }
        assert(backingLength(chain, ctx) <= 12)
        signal.resolve({ value: 1 })
        const earlier = await captured
        assert.deepEqual(earlier, [{ value: 1 }, , 2, 3])
        assert.equal(Object.hasOwn(earlier, 1), false)
        assert.deepEqual(r.export(chain, [], ctx), [36, 37, 38, 39])
        assert.deepEqual(await r.export(saved, [], ctx), earlier)
        verifyRefCounts(ctx, chain._state, saved._state)
    })
})
