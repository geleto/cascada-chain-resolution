import assert from 'node:assert/strict'
import * as r from '../src/index.js'
import { OrderedThenable } from './ordered-thenable.js'
import { verifyRefCounts } from './verify-refcounts.js'

const cases = [
    ['fill', [9, 0, 1], true], ['fill', [1, 0, 1], true], ['fill', [9, 1, 1], false],
    ['copyWithin', [1, 0, 1], true], ['copyWithin', [0, 0, 1], true], ['copyWithin', [0, 1, 1], false],
]
describe('localized Array write identity', () => {
    for (const [method, args, writes] of cases) for (const view of [false, true])
    for (const delivery of ['native', 'ordered']) for (const searchMethod of ['includes', 'indexOf', 'lastIndexOf']) {
        it(`publishes ${method}(${args}) identity to a pending ${searchMethod}, view=${view}, ${delivery}`, async () => {
            for (const indexed of [false, true]) {
                const ctx = { execution: new r.Execution(), errorContext: 'range write identity' }
                const source = new r.Chain(view ? [77, 1, 2, 3, 88] : [1, 2, 3], ctx)
                const chain = view ? new r.Chain(r.run(source, [], 'slice', [1, 4], ctx, {}), ctx) : source
                if (view) r.deletePath(source, [], ctx)
                if (indexed) assert.equal(r.hasError(chain, [], ctx), false)
                const signal = delivery === 'native' ? Promise.withResolvers() : new OrderedThenable()
                const haystack = new r.Chain([signal.promise ?? signal], ctx)
                // The search retains an identity token, not another owner of the Array.
                const search = r.run(haystack, [], searchMethod, [r.lookupPath(chain, [], ctx)], ctx, {})
                r.run(chain, [], method, args, ctx, { mutationScopeDepth: 0 })
                signal.resolve(r.lookupPath(chain, [], ctx))
                assert.equal(await search, searchMethod === 'includes' ? !writes : writes ? -1 : 0)
                const expected = [1, 2, 3]
                expected[method](...args)
                assert.deepEqual(await r.export(chain, [], ctx), expected)
                verifyRefCounts(ctx, chain._state, haystack._state)
                assert.equal(ctx.execution.fatalError, null)
            }
        })
    }
})
