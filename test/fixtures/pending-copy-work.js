import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { normalizeModuleURL } from '../module-url.js'

const reportOnly = process.argv.includes('--report-only')
const disabled = process.argv.includes('--no-op-loader')
let counts, substitutions = 0
globalThis.pendingCopyWorkCounts = () => counts
globalThis.CountedCopyUses = class extends Set {
    add(use) {
        if (!this.has(use)) {
            counts.uses++
            counts.peakUses = Math.max(counts.peakUses, counts.uses)
        }
        return super.add(use)
    }
    delete(use) {
        if (!super.delete(use)) return false
        counts.uses--
        return true
    }
    clear() { counts.uses -= this.size; super.clear() }
}
const changes = new Map([
    ['property-versions.js', [
        ['const delivery = { uses: new Set() }', 'const delivery = { uses: new globalThis.CountedCopyUses() }'],
        ['function continueCapturedPromiseVersion(promise, promiseVersion, operationContext, onValue, operation) {',
            '$&\n    const measured = globalThis.pendingCopyWorkCounts(); measured.live++; let measuredClosed = false;'],
        ['const complete = () => {\n        unregister?.()',
            'const complete = () => {\n        if (!measuredClosed) { measuredClosed = true; measured.live-- }\n        unregister?.()'],
    ]],
    ['language-values.js', [
        ['return Reflect.apply(then, value, [deliver(onFulfilled), deliver(onRejected)])',
            'globalThis.pendingCopyWorkCounts().subscriptions++; $&'],
    ]],
])
const root = normalizeModuleURL(new URL('../../src/', import.meta.url).href)
registerHooks({ load(url, context, next) {
    const loaded = next(url, context), normalized = normalizeModuleURL(url)
    if (disabled || !normalized.startsWith(root)) return loaded
    const replacements = changes.get(normalized.slice(root.length))
    if (!replacements) return loaded
    let source = String(loaded.source).replaceAll('\r\n', '\n')
    for (const [anchor, replacement] of replacements) {
        assert.equal(source.split(anchor).length - 1, 1, `Pending-copy counter anchor: ${anchor}`)
        source = source.replace(anchor, replacement)
        substitutions++
    }
    return { ...loaded, source }
} })
const r = await import('../../src/index.js')
assert.equal(substitutions, 4, 'Pending-copy counter loader must execute every substitution')
const { OrderedThenable } = await import('../ordered-thenable.js')
const { verifyRefCounts } = await import('../verify-refcounts.js')
const samples = []
for (const route of ['unshift', 'splice', 'reverse', 'fill', 'record', 'array']) {
    for (const size of [16, 32, 64]) for (const delivery of ['native', 'ordered']) {
        counts = { live: 0, subscriptions: 0, uses: 0, peakUses: 0 }
        const ctx = { execution: new r.Execution(), errorContext: 'pending copy work' }
        const signals = Array.from({ length: size }, () => delivery === 'native' ? Promise.withResolvers() : new OrderedThenable())
        const record = route === 'record', cow = record || route === 'array'
        const chain = new r.Chain(record ? {} : [0], ctx), model = record ? {} : [0]
        for (let index = 0; index < size; index++) {
            const value = signals[index].promise ?? signals[index]
            if (cow) {
                const key = record ? `k${index}` : index + 1
                r.assignPath(chain, [key], value, ctx)
                model[key] = index + 1
                const holder = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
                r.assignPath(chain, [record ? 'last' : 0], -index, ctx)
                model[record ? 'last' : 0] = -index
                r.deletePath(holder, [], ctx)
            } else {
                const call = (method, args) => r.run(chain, [], method, args, ctx, { mutationScopeDepth: 0 })
                if (route === 'unshift') { call('unshift', [value]); model.unshift(index + 1) }
                if (route === 'splice') { call('splice', [0, 0, value]); model.splice(0, 0, index + 1) }
                if (route === 'reverse') { call('push', [value]); call('reverse', []); model.push(index + 1); model.reverse() }
                if (route === 'fill') { call('push', [0]); call('fill', [value, index + 1, index + 2]); model.push(index + 1) }
            }
        }
        const issued = { ...counts }
        for (let index = size - 1; index >= size / 2; index--) signals[index].resolve(index + 1)
        await new Promise(setImmediate)
        const partial = { ...counts }
        for (let index = 0; index < size / 2; index++) signals[index].resolve(index + 1)
        assert.deepEqual(await r.export(chain, [], ctx), model)
        await new Promise(setImmediate)
        verifyRefCounts(ctx, chain._state)
        assert.equal(ctx.execution.fatalError, null)
        assert.equal(counts.live, 0, 'Completed copy captures must release')
        assert.equal(counts.uses, 0, 'Completed copy destinations must release')
        samples.push({ route, size, delivery, issued, partial, settled: { ...counts } })
    }
}
console.log(JSON.stringify({ samples }))
if (!reportOnly) for (const sample of samples) {
    assert(sample.issued.peakUses <= 8 * sample.size,
        `Pending-copy destination history is not bounded: ${JSON.stringify(sample)}`)
    assert(sample.issued.live <= 8 * sample.size,
        `Pending-copy live capture history is not bounded: ${JSON.stringify(sample)}`)
    assert(sample.issued.subscriptions <= 32 * sample.size,
        `Pending-copy subscription history is not bounded: ${JSON.stringify(sample)}`)
}
