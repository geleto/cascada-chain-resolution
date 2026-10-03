// Read-only copy-loop counter for exclusive Array point writes.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

let copied = 0
globalThis.__phase2CountCopy = () => copied++
const moduleURL = new URL('../../src/mutations.js', import.meta.url).href
registerHooks({load(url, context, next) {
    const loaded = next(url, context)
    if (url !== moduleURL) return loaded
    const marker = 'const placement = languageProperties.readLanguagePlacement(source, key, operationContext)'
    const source = String(loaded.source)
    assert(source.includes(marker), 'Copy-loop hook changed')
    return {...loaded, source:source.replace(marker, 'globalThis.__phase2CountCopy(); ' + marker)}
}})
const r = await import('../../src/index.js')
const samples = []
for (const size of [50, 100, 200]) for (const mode of ['assign', 'enter']) {
    for (const alternating of [false, true]) {
        const ctx = {execution:new r.Execution(), errorContext:'Array point-write experiment'}
        const array = new r.Chain([], ctx)
        const write = index => mode === 'assign'
            ? r.assignPath(array, [String(index), 'k'], 1, ctx)
            : r.enter(array, [String(index)], ctx, true, child => r.assignPath(child, ['k'], 1, ctx))
        copied = 0
        for (let index = 0; index < size; index++) {
            r.run(array, [], 'push', [{k:0}], ctx, {mutationScopeDepth:0})
            if (alternating) write(index)
        }
        if (!alternating) { copied = 0; write(0) }
        const measured = copied
        assert.equal(measured, 0)
        assert.equal(r.lookupPath(array, ['0', 'k'], ctx), 1)
        samples.push({size, mode, alternating, copiedPlacements:measured})
    }
}
for (const size of [50, 200]) for (const mode of ['assign', 'enter']) {
    const ctx = {execution:new r.Execution(), errorContext:'retained point writes'}
    const array = new r.Chain([], ctx)
    for (let index = 0; index < size; index++)
        r.run(array, [], 'push', [{k:0}], ctx, {mutationScopeDepth:0})
    const earlier = new r.Chain(r.run(array, [], 'slice', [], ctx, {}), ctx)
    copied = 0
    if (mode === 'assign') r.assignPath(array, ['0', 'k'], 1, ctx)
    else r.enter(array, ['0'], ctx, true, child => r.assignPath(child, ['k'], 1, ctx))
    const measured = copied
    assert.equal(measured, size + 1)
    assert.equal(r.lookupPath(earlier, ['0', 'k'], ctx), 0)
    assert.equal(r.lookupPath(array, ['0', 'k'], ctx), 1)
    samples.push({size, mode, retained:true, copiedPlacements:measured})
}
console.log(JSON.stringify({samples,
    scope:'Exclusive point writes copy no Array prefix; retained backing owners still require materialization.'}, null, 2))
