import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { normalizeModuleURL } from '../../test/module-url.js'

// Measures current dependency state separately from total work. Public calls
// create all runtime state; metadata reads and loader hooks only observe it.
let counts, substitutions = 0
globalThis.reviewHistoryCounts = () => counts
globalThis.ReviewHistoryUses = class extends Set {
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
        ['const delivery = { uses: new Set() }', 'const delivery = { uses: new globalThis.ReviewHistoryUses() }'],
        ['function capturePlacement(owner, key, operationContext, capturedVersion, storage) {',
            '$&\n    globalThis.reviewHistoryCounts().captures++;'],
        ['function createVersionFromPlacement(placement) {',
            '$&\n    globalThis.reviewHistoryCounts().createdVersions++;'],
        ['function copyPlacement(placement, owner, key, operationContext, writeBack = true) {',
            '$&\n    globalThis.reviewHistoryCounts().copiedPlacements++;'],
        ['for (const sourceKey of Object.keys(versions ?? {})) {',
            '$&\n        globalThis.reviewHistoryCounts().overlayVisits++;'],
        ['function continueCapturedPromiseVersion(promise, promiseVersion, operationContext, onValue, operation) {',
            '$&\n    const measured = globalThis.reviewHistoryCounts(); measured.live++; let measuredClosed = false;'],
        ['const complete = () => {\n        unregister?.()',
            'const complete = () => {\n        if (!measuredClosed) { measuredClosed = true; measured.live-- }\n        unregister?.()'],
    ]],
    ['language-values.js', [
        ['return Reflect.apply(then, value, [deliver(onFulfilled), deliver(onRejected)])',
            'globalThis.reviewHistoryCounts().subscriptions++; $&'],
    ]],
])
const root = normalizeModuleURL(new URL('../../src/', import.meta.url).href)
registerHooks({ load(url, context, next) {
    const loaded = next(url, context), normalized = normalizeModuleURL(url)
    if (!normalized.startsWith(root) || process.argv.includes('--no-op-loader')) return loaded
    const edits = changes.get(normalized.slice(root.length))
    if (!edits) return loaded
    let source = String(loaded.source).replaceAll('\r\n', '\n')
    for (const [anchor, replacement] of edits) {
        assert.equal(source.split(anchor).length - 1, 1, anchor)
        source = source.replace(anchor, replacement)
        substitutions++
    }
    return { ...loaded, source }
} })
const r = await import('../../src/index.js')
const { metaOf } = await import('../../src/meta.js')
const { OrderedThenable } = await import('../../test/ordered-thenable.js')
const { verifyRefCounts } = await import('../../test/verify-refcounts.js')
assert.equal(substitutions, 8, 'Every work counter must be installed')

const routes = ['push-pop', 'unshift-pop', 'unshift-shift', 'concat-shift',
    'concat-slice', 'alternating-ends', 'splice-window', 'sparse-assignment']
const samples = []
for (const route of routes) for (const size of [32, 64, 128]) {
    for (const delivery of ['ready', 'native', 'ordered']) for (const readers of [false, true]) {
        counts = { captures: 0, createdVersions: 0, copiedPlacements: 0, overlayVisits: 0,
            live: 0, subscriptions: 0, uses: 0, peakUses: 0 }
        const ctx = { execution: new r.Execution(), errorContext: 'missed history work' }
        const model = [0, , 2, 3], chain = new r.Chain([...model], ctx)
        // Spread would fill the hole; establish the sparse seed explicitly.
        r.deletePath(chain, [1], ctx)
        const signals = [], retained = [], pendingResults = []
        let peakBacking = 0, peakOwners = 0, peakLiveAfterTurn = 0
        const call = (name, args) => {
            const result = r.run(chain, [], name, args, ctx, { mutationScopeDepth: 0 })
            if (r.isPending(result, ctx)) pendingResults.push(result)
            return result
        }
        const assignSlice = () => r.assignPath(chain, [], r.run(chain, [], 'slice', [1], ctx, {}), ctx)
        for (let index = 0; index < size; index++) {
            const signal = delivery === 'native' ? Promise.withResolvers() :
                delivery === 'ordered' ? new OrderedThenable() : undefined
            const value = signal?.promise ?? signal ?? index + 10
            if (signal) signals.push([signal, index + 10])
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
            if (readers && index % 8 === 0) {
                const holder = new r.Chain(r.run(chain, [], 'slice', [], ctx, {}), ctx)
                retained.push({ holder, model: model.slice() })
                if (retained.length > 3) r.deletePath(retained.shift().holder, [], ctx)
            }
            // Periodically construct the optional index, then leave it active.
            if (index === Math.floor(size / 2)) r.hasError(chain, [], ctx)
            const meta = metaOf(chain._state.value, ctx)
            const backing = meta.arrayRange?.backing ?? chain._state.value
            peakBacking = Math.max(peakBacking, backing.length)
            peakOwners = Math.max(peakOwners, metaOf(backing, ctx).arrayBacking?.owners.size ?? 1)
            peakLiveAfterTurn = Math.max(peakLiveAfterTurn, counts.live)
        }
        const issued = { ...counts, peakBacking, peakOwners, peakLiveAfterTurn,
            pendingResults: pendingResults.length }
        assert(peakBacking <= 12, `${route}: backing ${peakBacking} exceeds fixed live range allowance`)
        assert(peakOwners <= 7, `${route}: stale backing owners ${peakOwners}`)
        // Four current slots, at most three four-slot saved readers, and each
        // independently pending removal result have their own preservation uses.
        assert(counts.uses <= 32 + 2 * pendingResults.length,
            `${route}: ${counts.uses} active uses after issuance, ${pendingResults.length} pending results`)
        for (let index = signals.length - 1; index >= signals.length / 2; index--)
            signals[index][0].resolve(signals[index][1])
        await new Promise(setImmediate)
        const partial = { ...counts }
        for (let index = 0; index < signals.length / 2; index++) signals[index][0].resolve(signals[index][1])
        assert.deepEqual(await r.export(chain, [], ctx), model)
        for (const saved of retained) assert.deepEqual(await r.export(saved.holder, [], ctx), saved.model)
        await Promise.all(pendingResults)
        await new Promise(setImmediate)
        assert.equal(counts.live, 0)
        assert.equal(counts.uses, 0)
        verifyRefCounts(ctx, chain._state, ...retained.map(saved => saved.holder._state))
        assert.equal(ctx.execution.fatalError, null)
        samples.push({ route, size, delivery, readers, issued, partial, settled: { ...counts } })
    }
}
for (const sample of samples) {
    if (sample.size === 32) continue
    const smaller = samples.find(other => other.route === sample.route && other.delivery === sample.delivery &&
        other.readers === sample.readers && other.size === sample.size / 2)
    for (const counter of ['captures', 'createdVersions', 'copiedPlacements', 'overlayVisits', 'subscriptions'])
        assert(sample.issued[counter] <= 2.5 * smaller.issued[counter] + 16,
            `${sample.route}/${sample.delivery}/${sample.readers}: superlinear measured ${counter}`)
}
console.log(JSON.stringify({ cases: samples.length, samples }))
