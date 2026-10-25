import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { normalizeModuleURL } from '../module-url.js'

let visits = 0, substitutions = 0
globalThis.countRangePlacement = () => { visits++ }
const root = normalizeModuleURL(new URL('../../src/property-versions.js', import.meta.url).href)
registerHooks({ load(url, context, next) {
    const loaded = next(url, context)
    if (normalizeModuleURL(url) !== root || process.argv.includes('--no-op-loader')) return loaded
    const anchor = 'function capturePlacement(owner, key, operationContext, capturedVersion, storage) {'
    const source = String(loaded.source)
    assert.equal(source.split(anchor).length - 1, 1)
    substitutions++
    return { ...loaded, source: source.replace(anchor, anchor + '\n    globalThis.countRangePlacement();') }
} })
const r = await import('../../src/index.js')
const { verifyRefCounts } = await import('../verify-refcounts.js')
assert.equal(substitutions, 1, 'Range work instrumentation must execute')
const samples = []
for (const method of ['fill', 'copyWithin']) for (const size of [64, 128, 256]) {
    const ctx = { execution: new r.Execution(), errorContext: 'range work' }
    const model = Array.from({ length: size }, (_, index) => index)
    const chain = new r.Chain({ array: [...model] }, ctx)
    visits = 0
    for (let index = 0; index < size; index++) {
        const source = (index + 1) % size
        const args = method === 'fill' ? [-index, index, index + 1] : [index, source, source + 1]
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
