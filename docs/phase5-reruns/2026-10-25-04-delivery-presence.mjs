import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import { OrderedThenable, ChainedThenable } from '../../test/ordered-thenable.js'
import { verifyRefCounts } from '../../test/verify-refcounts.js'
import { metaOf } from '../../src/meta.js'

const makeSignal = mode => mode === 'native' ? Promise.withResolvers() : mode === 'chained' ? new ChainedThenable() : new OrderedThenable()
const promiseOf = signal => signal.promise ?? signal
let cases = 0, retired = 0

for (const mode of ['ready', 'native', 'ordered', 'chained'])
for (const shape of ['record', 'array-hole', 'array-growth'])
for (const initiallyPresent of [false, true])
for (const action of ['absent', 'undefined', 'object', 'recover'])
for (const indexed of [false, true])
for (const discard of [false, true]) {
    const label = `${mode}/${shape}/${initiallyPresent}/${action}/${indexed}/${discard}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    const array = shape !== 'record'
    const key = shape === 'array-growth' ? 4 : array ? 0 : 'selected', marker = array ? 1 : 'marker'
    const initial = array ? [, 0] : { marker: 0 }
    if (initiallyPresent) initial[key] = { n: 0 }
    const initialLength = initial.length
    const chain = new r.Chain(initial, ctx)
    if (indexed) r.hasError(chain, [], ctx)
    const signal = makeSignal(mode)
    if (mode === 'ready') signal.resolve()
    const entry = r.enter(chain, [key], ctx, true, inside => promiseOf(signal).then(() => {
        if (action === 'absent') r.deletePath(inside, [], ctx)
        if (action === 'undefined') r.assignPath(inside, [], undefined, ctx)
        if (action === 'object') r.assignPath(inside, [], { n: 7 }, ctx)
        if (action === 'recover') {
            const failure = r.assignPath(inside, ['missing', 'x'], 9, ctx, 0)
            assert(r.isPoisonError(failure), label)
            r.repairPath(inside, [], ctx)
        }
    }))
    const before = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
    r.assignPath(chain, [marker], 1, ctx) // Force the pending placement through record/Array copying.
    const copied = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
    r.assignPath(copied, [marker], 2, ctx)
    const copiedValue = r.lookupPath(copied, [], ctx)
    const output = r.export(copied, [], ctx)
    const errors = r.getErrors(copied, [], ctx)
    if (discard) {
        r.deletePath(copied, [], ctx)
        assert.equal(metaOf(copiedValue, ctx).relationshipsActive, false, `actual retirement ${label}`)
        retired++
    }
    const later = r.assignPath(chain, [key], { n: 99 }, ctx)
    if (mode !== 'ready') signal.resolve()
    await Promise.all([entry, later])

    const expected = array ? [, 2] : { marker: 2 }
    if (array) expected.length = initialLength
    if (action === 'undefined') expected[key] = undefined
    if (action === 'object') expected[key] = { n: 7 }
    if (action === 'recover' && initiallyPresent) expected[key] = { n: 0 }
    if (shape === 'array-growth' && action === 'recover') expected.length = 5
    const older = array ? expected.slice() : { ...expected }
    older[marker] = 0
    const final = array ? [, 1] : { marker: 1 }
    final[key] = { n: 99 }
    assert.deepEqual(await output, expected, `captured output ${label}`)
    assert.deepEqual(Object.keys(await output), Object.keys(expected), `record order ${label}`)
    assert.equal(await errors, null, `captured query ${label}`)
    assert.deepEqual(await r.export(before, [], ctx), older, `before ${label}`)
    assert.deepEqual(await r.export(chain, [], ctx), final, `later writer ${label}`)
    verifyRefCounts(ctx, chain._state, before._state, copied._state)
    assert.equal(ctx.execution.fatalError, null, label)
    cases++
}
console.log(JSON.stringify({ cases, failures: 0, retired, modes: ['ready', 'native', 'ordered', 'chained'], shapes: ['record', 'array-hole', 'array-growth'], actions: ['absent', 'undefined', 'object', 'recover'], indexed: [false, true], discardedCaptureOwner: [false, true] }))
