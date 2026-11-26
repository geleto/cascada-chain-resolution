import assert from 'node:assert/strict'
import { instrumentRuntime } from '../runtime-transform.js'

let visits = 0
let sortCopies
globalThis.membershipVisits = globalThis.overlayVisits = 0
globalThis.countRangePlacement = () => { visits++ }
globalThis.countSortCopy = () => {
    if (sortCopies !== undefined) assert(++sortCopies < 100, "Sort expanded a counted undefined run")
}
const verifyInstrumentation = instrumentRuntime(new Map([['property-versions.js', [[
    'function capturePlacement(owner, key, operationContext, capturedVersion, storage) {',
    '$&\n    globalThis.countRangePlacement();',
], [
    'if (index < sourceStart || index >= sourceEnd) continue',
    '$&\n        globalThis.countRangePlacement();',
], [
    'const entries = [...(meta?.outgoingPlacements ?? [])].filter',
    'globalThis.overlayVisits += meta?.outgoingPlacements?.size ?? 0;\n    $&',
]]], ['array-region.js', [[
    'const [part, first, end] = todo.pop()',
    '$&\n                globalThis.membershipVisits++;',
]]], ['array-methods.js', [[
    'entries.push(part.placement)',
    '{ globalThis.countSortCopy(); entries.push(part.placement) }',
]]]]), !process.argv.includes('--no-op-loader'))
const r = await import('../../src/index.js')
const { verifyRefCounts } = await import('../verify-refcounts.js')
verifyInstrumentation('Range work instrumentation must execute')
const samples = []
{
    const ctx = { execution: new r.Execution(), errorContext: 'shared membership' }, hold = Promise.withResolvers()
    const wrap = value => new r.Chain(value, ctx)
    let source = wrap([])
    const depth = 16, entry = r.enter(source, [], ctx, { maximumCount: 1, mayPoisonScope: false }, () => hold.promise)
    for (let i = 0; i < depth; i++)
        source = wrap(r.run(source, [], 'concat', [r.lookupPath(source, [], ctx)], ctx, {}))
    const before = globalThis.membershipVisits
    const query = r.hasError(source, [], ctx)
    hold.resolve()
    await entry
    assert.equal(await query, false)
    assert.equal(await r.lookupPath(source, ['length'], ctx), 0)
    assert(globalThis.membershipVisits - before <= 4 * depth, 'membership work must follow shared structure')
}
{
    const ctx = { execution: new r.Execution(), errorContext: 'skipped ranges' }
    const wrap = value => new r.Chain(value, ctx), size = 1024
    const cause = r.validationError('missing', ctx, r.ERROR_KIND.OperationInputFailed)
    let source = wrap([])
    r.appendMissingOutput(source, cause, ctx)
    for (let n = 1; n < size; n *= 2)
        source = wrap(r.run(source, [], 'concat', [r.lookupPath(source, [], ctx)], ctx, {}))
    for (let i = 2; i < size; i += 3) r.assignPath(source, [i], 7, ctx)
    const before = globalThis.overlayVisits
    let items = 0, skipped = 0
    const cursor = r.iterate(source, [], ctx, { onSkip(first, end, error, count) {
        assert.equal(error, cause)
        skipped += count
    } })
    await assert.rejects(async () => {
        for await (const item of cursor) {
            items++
            assert.equal(r.lookupPath(item, [], ctx), 7)
        }
    }, error => error === cause)
    assert.equal(items, Math.floor(size / 3))
    assert.equal(items + skipped, size)
    assert(globalThis.overlayVisits - before <= 2 * size, 'skip discovery must not rescan every override per run')
}
{
    const ctx = { execution: new r.Execution(), errorContext: 'compact sort' }
    const sparse = new Array(0xffffffff)
    sparse[0] = 'b'
    sparse[sparse.length - 1] = 'a'
    const source = new r.Chain(sparse, ctx)
    const dense = new r.Chain(r.run(source, [], 'toSpliced', [], ctx, {}), ctx)
    sortCopies = 0
    const sorted = new r.Chain(r.run(dense, [], 'toSorted', [], ctx, {}), ctx)
    assert.equal(r.lookupPath(sorted, [0], ctx), 'a')
    assert.equal(r.lookupPath(sorted, [1], ctx), 'b')
    assert.equal(r.lookupPath(sorted, [sparse.length - 1], ctx), undefined)
    assert.equal(r.run(sorted, [], 'indexOf', [undefined, sparse.length - 1], ctx, {}), sparse.length - 1)
    assert.equal(r.lookupPath(sorted, ['length'], ctx), sparse.length)
    assert(sortCopies > 0)
    sortCopies = undefined
}
for (const method of ['fill', 'copyWithin', 'splice']) for (const size of [64, 128, 256]) {
    const ctx = { execution: new r.Execution(), errorContext: 'range work' }
    const model = Array.from({ length: size }, (_, index) => index)
    const chain = new r.Chain({ array: [...model] }, ctx)
    visits = 0
    for (let index = 0; index < size; index++) {
        const source = (index + 1) % size
        const args = method === 'splice' ? [index, 1, -index] :
            method === 'fill' ? [-index, index, index + 1] : [index, source, source + 1]
        model[method](...args)
        const result = r.run(chain, ['array'], method, args, ctx, { mutationScopeDepth: 1 })
        assert.equal(r.isPending(result, ctx), false)
    }
    const measured = visits
    assert.deepEqual(r.export(chain, ['array'], ctx), model)
    verifyRefCounts(ctx, chain._state)
    assert.equal(ctx.execution.fatalError, null)
    samples.push({ method, size, visits: measured })
}
console.log(JSON.stringify({ samples }))
for (const sample of samples) assert(sample.visits <= 40 * sample.size,
    `Point Array mutation inspected unrelated placements: ${JSON.stringify(sample)}`)
