// B22: count the complete unresolved append history, not just its latest Array.
// Hooks observe production work. They neither retain graph objects nor index data.
import assert from 'node:assert/strict'
import { instrumentRuntime } from '../runtime-transform.js'

const reportOnly = process.argv.includes('--report-only')
const noOpLoader = process.argv.includes('--no-op-loader')
const legacyCopies = process.argv.includes('--legacy-copies')
const sizes = [16, 32, 64]
let counts
globalThis.__pendingPushCounts = () => counts
const substitutions = new Map([
    ['property-versions.js', [
        ['placements.set(key, version)', 'globalThis.__pendingPushCounts().parentRecords++; $&'],
        ['function createVersionFromPlacement(placement) {', '$&\n    globalThis.__pendingPushCounts().versions++;'],
        ['const captured = capturePlacementFromVersion(version)\n        copyPlacement(captured, destination', 'globalThis.__pendingPushCounts().copiedEntries++; $&'],
        ['function continueCapturedPromiseVersion(promise, promiseVersion, operationContext, onValue, operation, project) {', '$&\n    const measured = globalThis.__pendingPushCounts(); measured.captures++; measured.liveCaptures++; let measuredClosed = false;'],
        ['const complete = () => {\n        unregister?.()', 'const complete = () => {\n        if (!measuredClosed) { measuredClosed = true; measured.liveCaptures-- }\n        unregister?.()'],
        ['subscribed.add(version)', '$&; globalThis.__pendingPushCounts().captureMemberships++'],
        ['version.captures.delete(visit)', '$&; globalThis.__pendingPushCounts().captureMemberships--'],
    ]],
    ['array-view.js', [
        ['constructor(source, operationContext, start = 0, end) {', '$&\n        globalThis.__pendingPushCounts().views++;'],
        ['this.owners = new Set()', '$&; globalThis.__pendingPushCounts().backings++'],
        ['constructor(backing, operationContext) {', '$&\n        globalThis.__pendingPushCounts().producerRecords++;'],
        ['for (const owner of this.owners) {', '$&\n            globalThis.__pendingPushCounts().ownerVisits++;'],
    ]],
    ['parent-placements.js', [
        ['meta.relationshipsActive = true', '$&; globalThis.__pendingPushCounts().activations++'],
        ['function retireRelationships(owner, operationContext) {', '$&\n    globalThis.__pendingPushCounts().retirements++;'],
        ['function linkParent(value, source, key, operationContext) {', '$&\n    globalThis.__pendingPushCounts().parentLinks++;'],
    ]],
    ['refcounts.js', [
        ['const counter = getRefCounter(owner, operationContext)', 'globalThis.__pendingPushCounts().counterUpdates++; $&'],
        ['function retainBackingCounter(version, owner, key, operationContext) {', '$&\n    globalThis.__pendingPushCounts().counterMemberships++;'],
    ]],
    ['language-values.js', [
        ['return Reflect.apply(then, value, [deliver(onFulfilled), deliver(onRejected)])', 'globalThis.__pendingPushCounts().subscriptions++; $&'],
    ]],
    ['thenable-subscription.js', [
        ['promise.then(ignore, ignore)', 'globalThis.__pendingPushCounts().handledSubscriptions++; $&'],
    ]],
    ['operation-result.js', [
        ['outward.then(release, release)', 'globalThis.__pendingPushCounts().outwardSubscriptions++; $&'],
    ]],
    ['internal-step.js', [
        ['Promise.all(waits)', 'Promise.all((globalThis.__pendingPushCounts().aggregateMembers += waits.length, waits))'],
    ]],
])
if (legacyCopies) substitutions.get('array-view.js').push([
    'static placementDestination(owner, key, operationContext) {', '$&\n        return undefined',
])
const verifyInstrumentation = instrumentRuntime(substitutions, !noOpLoader)

const r = await import('../../src/index.js')
const { logicalVersionEntries } = await import("../verify-parents.js")
const { metaOf } = await import('../../src/meta.js')
const { ArrayView } = await import('../../src/array-view.js')
verifyInstrumentation('B22 counter loader must execute every substitution')
const turn = () => new Promise(resolve => setImmediate(resolve))
function freshCounts() {
    return { copiedEntries: 0, versions: 0, captures: 0, liveCaptures: 0,
        captureMemberships: 0, subscriptions: 0, handledSubscriptions: 0,
        outwardSubscriptions: 0, aggregateMembers: 0, views: 0, backings: 0,
        activations: 0, retirements: 0, parentRecords: 0, producerRecords: 0,
        ownerVisits: 0, parentLinks: 0, counterUpdates: 0, counterMemberships: 0 }
}
function snapshot(chain, ctx) {
    const value = chain._state.value
    const meta = metaOf(value, ctx)
    const backing = meta.arrayRange?.backing ?? value
    const backingRecord = metaOf(backing, ctx).arrayBacking
    const producerMeta = metaOf(backingRecord?.producers, ctx)
    const producerVersions = logicalVersionEntries(producerMeta).map(([, version]) => version)
    // Count every maintained store on this scalar history's live container set,
    // including reciprocal counter memberships and the root holder. Raw slots
    // are explicit produced data and are reported separately below.
    let maintainedEntries = backingRecord?.owners.size ?? 0
    for (const owner of new Set([chain._state, value, backing, backingRecord, backingRecord?.producers])) {
        const state = metaOf(owner, ctx)
        if (!state) continue
        const versions = logicalVersionEntries(state).map(([, version]) => version)
        maintainedEntries += (state.outgoingPlacements?.size ?? 0) +
            (state.parents?.size ?? 0) + (state.counterChildren?.size ?? 0) +
            (state.cycleCuts?.size ?? 0) + (state.backingCounterVersions?.size ?? 0)
        for (const version of versions) maintainedEntries += version.counterProjections?.size ?? 0
        const incoming = state.incomingParents
        maintainedEntries += incoming instanceof Map
            ? [...incoming.values()].reduce((sum, keys) => sum + 1 + keys.size, 0) : Number(Boolean(incoming))
    }
    return { ...counts, backingSlots: backing.length,
        maintainedEntries,
        activeBackingOwners: backingRecord?.owners.size ?? 0,
        backingParentRecords: metaOf(backingRecord, ctx)?.outgoingPlacements?.size ?? 0,
        producerVersions: producerVersions.length,
        pendingProducerVersions: producerVersions.filter(version => version.value instanceof Promise).length,
        producerParentRecords: producerMeta?.outgoingPlacements?.size ?? 0,
        producerCounterMemberships: producerVersions.reduce((sum, version) => sum + (version.counterProjections?.size ?? 0), 0),
        currentVersions: logicalVersionEntries(meta).length,
        currentParentRecords: meta.outgoingPlacements?.size ?? 0,
        logicalLength: ArrayView.readyLength(value, ctx) }
}

const samples = []
for (const route of ['push', 'assign', 'ready-push'])
for (const delivery of route === 'ready-push' ? ['ready'] : ['forward', 'reverse', 'reject-repair', 'reverse-reject-repair'])
for (const size of sizes) {
    counts = freshCounts()
    const ctx = { execution: new r.Execution(), errorContext: `B22 ${route}/${delivery}/${size}` }
    const inputs = Array.from({ length: size }, () => Promise.withResolvers())
    const chain = new r.Chain([0], ctx)
    const results = []
    for (let index = 0; index < size; index++) {
        const input = route === 'ready-push' ? index + 1 : inputs[index].promise
        const result = route === 'assign'
            ? r.assignPath(chain, [String(index + 1)], input, ctx)
            : r.run(chain, [], 'push', [input], ctx, { mutationScopeDepth: 0 })
        // An unresolved payload must not serialize issuance or structural progress.
        if (route !== 'assign') assert.equal(result, index + 2)
        results.push(result)
    }
    const issued = snapshot(chain, ctx)
    assert.equal(issued.logicalLength, size + 1)
    const order = Array.from({ length: size }, (_, index) => index)
    if (delivery.startsWith('reverse')) order.reverse()
    const causes = new Map()
    const deliver = index => {
        if (delivery.endsWith('reject-repair') && index % 7 === 0) {
            const cause = new Error(`B22 payload ${index}`)
            causes.set(index, cause)
            inputs[index].reject(cause)
        } else inputs[index].resolve(index + 1)
    }
    for (const index of order.slice(0, size / 2)) deliver(index)
    await turn()
    const partial = snapshot(chain, ctx)
    for (const index of order.slice(size / 2)) deliver(index)
    await Promise.all(results)
    await turn()
    const settled = snapshot(chain, ctx)
    if (causes.size) {
        const failure = r.getErrors(chain, [], ctx)
        const leaves = failure.errors ?? [failure]
        assert.equal(leaves.length, causes.size)
        assert.deepEqual(new Set(leaves.map(leaf => leaf.cause)), new Set(causes.values()))
        for (const [index, cause] of causes) {
            const failure = r.lookupPath(chain, [String(index + 1)], ctx)
            assert.equal(failure.cause, cause)
            assert.equal(failure.errorContext, ctx.errorContext)
            assert.equal(failure.kind, route === 'assign' ? r.ERROR_KIND.AssignmentValueFailed : r.ERROR_KIND.OperationInputFailed)
            // Input rejection is data, not path status. Explicit repair must
            // preserve it; final assignment can then replace the failed slot.
            assert.equal(r.repairPath(chain, [String(index + 1)], ctx), undefined)
            assert.equal(r.lookupPath(chain, [String(index + 1)], ctx), failure)
            // Final assignment replaces a failed payload without consuming it.
            r.assignPath(chain, [String(index + 1)], index + 1, ctx)
        }
        assert.equal(r.hasError(chain, [], ctx), false)
    }
    const repaired = snapshot(chain, ctx)
    assert.deepEqual(await r.export(chain, [], ctx), Array.from({ length: size + 1 }, (_, index) => index))
    assert.equal(settled.liveCaptures, 0)
    assert.equal(settled.captureMemberships, 0)
    samples.push({ route, delivery, size, issued, partial, settled, repaired })
    await turn()
}

// Actual retained values justify their own capture work. Keep those controls
// separate from the no-history target; do not weaken its linear work budget.
const controls = []
for (const retained of ['view', 'outputs']) {
    counts = freshCounts()
    const ctx = { execution: new r.Execution(), errorContext: `B22 retained ${retained}` }
    const source = [0]
    const chain = new r.Chain(r.import(source, ctx), ctx)
    const inputs = Array.from({ length: 8 }, () => Promise.withResolvers())
    const outputs = []
    let earlier
    for (let index = 0; index < inputs.length; index++) {
        assert.equal(r.run(chain, [], 'push', [inputs[index].promise], ctx, { mutationScopeDepth: 0 }), index + 2)
        if (retained === 'outputs') outputs.push(r.export(chain, [], ctx))
        if (retained === 'view' && index === 3)
            earlier = new r.Chain(r.run(chain, [], 'slice', [], ctx, {}), ctx)
    }
    if (earlier) {
        r.assignPath(earlier, ['1'], -1, ctx)
        r.assignPath(chain, ['2'], -2, ctx)
    }
    const issued = snapshot(chain, ctx)
    for (let index = inputs.length - 1; index >= 0; index--) inputs[index].resolve(index + 1)
    await turn()
    if (earlier) {
        assert.deepEqual(await r.export(earlier, [], ctx), [0, -1, 2, 3, 4])
        assert.deepEqual(await r.export(chain, [], ctx), [0, 1, -2, 3, 4, 5, 6, 7, 8])
    } else {
        const settledOutputs = await Promise.all(outputs)
        for (let index = 0; index < settledOutputs.length; index++)
            assert.deepEqual(settledOutputs[index], Array.from({ length: index + 2 }, (_, value) => value))
    }
    assert.deepEqual(source, [0])
    controls.push({ retained, issued, settled: snapshot(chain, ctx) })
    await turn()
}
assert(samples.some(sample => sample.issued.liveCaptures > 0), 'B22 must witness unfinished captures')
assert(samples.some(sample => sample.issued.currentVersions > 0), 'B22 must witness actual pending placements')
if (!legacyCopies) assert(samples.filter(sample => sample.route === 'push').every(sample =>
    sample.issued.pendingProducerVersions === sample.size), 'B22 must witness shared pending backing producers')
console.log(JSON.stringify({ samples, controls, anchors: [...substitutions.values()].flat().length,
    contract: 'B22 unresolved append histories require linear additional storage and aggregate copied placement/frontier entries' }))

if (!reportOnly) {
    for (const sample of samples.filter(sample => sample.route === 'push')) {
        // These are deterministic work limits, independent of V8 heap size/time.
        // Allow one complete explicit prefix transfer per slot, plus small fixed work.
        // Settlement must not move the same quadratic work behind issuance.
        for (const stage of ['issued', 'partial', 'settled', 'repaired']) {
            const measured = sample[stage]
            const label = `${sample.size} ${sample.delivery} ${stage}`
            assert(measured.copiedEntries <= 2 * sample.size + 8,
                `B22 copied placement entries are not linear: ${label}: ${measured.copiedEntries}`)
            assert(measured.versions <= 12 * sample.size + 16,
                `B22 allocated versions exceed the linear bound: ${label}: ${measured.versions}`)
            assert(measured.liveCaptures <= 6 * sample.size + 16,
                `B22 unresolved capture storage exceeds the linear bound: ${label}: ${measured.liveCaptures}`)
            const subscriptions = measured.subscriptions + measured.handledSubscriptions +
                measured.outwardSubscriptions + measured.aggregateMembers
            assert(subscriptions <= 96 * sample.size + 64,
                `B22 subscriptions exceed the linear bound: ${label}: ${subscriptions}`)
            assert(measured.maintainedEntries <= 8 * sample.size + 16,
                `B22 maintained placement storage exceeds the linear bound: ${label}: ${measured.maintainedEntries}`)
            const parentWork = measured.parentRecords + measured.parentLinks + measured.ownerVisits +
                measured.counterUpdates + measured.counterMemberships
            assert(parentWork <= 32 * sample.size + 64,
                `B22 parent/index work exceeds the linear bound: ${label}: ${parentWork}`)
            assert(measured.views + measured.backings + measured.producerRecords <= 2 * sample.size + 4,
                `B22 owner allocation exceeds the linear bound: ${label}`)
        }
    }
}
