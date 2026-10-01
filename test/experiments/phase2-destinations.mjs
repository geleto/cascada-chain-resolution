// Run: node --expose-gc test/experiments/phase2-destinations.mjs
// Actual version settlement/re-entry/export with process-local source changes.
// Retirement selection is supplied by fixtures; Experiment A proves that part.
// This does not replace shared/COW or implement every writer's capture lifetime.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

let metadata, parents
const states = new WeakMap()
const outputShells = []
let restoring = false
const sourceRoot = new URL('../../src/', import.meta.url).href
const bridge = globalThis.__phase2Destinations = {
    restored: 0,
    output(value) { outputShells.push(new WeakRef(value)) },
    state(owner, ctx) {
        let execution = states.get(ctx.execution)
        if (!execution) states.set(ctx.execution, execution = new WeakMap())
        let state = execution.get(owner)
        if (!state) execution.set(owner, state = {active:true, slots:new Map()})
        return state
    },
    destination(owner, ctx) {
        return metadata.requireMeta(owner, ctx).experimentDestination ??= {owner, open:true}
    },
    slot(owner, key, version, ctx) {
        if (!restoring) this.state(owner, ctx).slots.set(key, version)
    },
    ready(owner, key, value, ctx) {
        this.slot(owner, key, metadata.metaOf(owner, ctx)?.placementVersions?.[key] ?? {value}, ctx)
    },
    retire(owner, ctx) {
        const state = this.state(owner, ctx)
        state.active = false
        const meta = metadata.requireMeta(owner, ctx)
        if (meta.experimentDestination) meta.experimentDestination.owner = undefined
        for (const childParents of meta.counterChildren ?? []) childParents.delete(owner)
        for (const [key, version] of state.slots) {
            parents.removeParent(version.value, owner, key, ctx)
            metadata.metaOf(version.value, ctx)?.parents?.delete(owner)
        }
        for (const field of ['parents', 'counterChildren', 'promiseCount', 'errorCount', 'cycleCutCount', 'cycleCuts']) delete meta[field]
    },
    reactivate(owner, ctx) {
        const state = this.state(owner, ctx)
        if (state.active) return
        state.active = true
        const meta = metadata.requireMeta(owner, ctx)
        if (meta.experimentDestination) meta.experimentDestination.owner = owner
        const wasRestoring = restoring
        restoring = true
        try {
            for (const [key, version] of state.slots) {
                this.restored++
                if (version.present === false) continue
                const child = version.value
                if (metadata.isTraversableType(metadata.metaOf(child, ctx)?.type)) {
                    this.reactivate(child, ctx)
                    parents.addParent(child, owner, key, ctx)
                }
            }
        } finally { restoring = wasRestoring }
    },
}
registerHooks({load(url, ctx, next) {
    const loaded = next(url, ctx)
    if (!url.startsWith(sourceRoot)) return loaded
    let source = String(loaded.source).replaceAll('\r\n', '\n')
    const replace = (a, b) => { assert(source.includes(a), `missing hook ${url}: ${a}`); source = source.replace(a, b) }
    const hook = 'globalThis.__phase2Destinations'
    if (url.endsWith('/parent-placements.js')) {
        replace('constructor(owner, operationContext) {',
            `get owner() { return this.destination ? this.destination.owner : this.stagedOwner }
            set owner(value) { this.stagedOwner = value }
            constructor(owner, operationContext) {`)
        replace('this.state = state', `this.state = state
            if (state === "published") {
                this.destination = ${hook}.destination(this.owner, this.operationContext)
                this.stagedOwner = undefined
            }`)
        replace('function addParent(value, source, key, operationContext) {',
            `function addParent(value, source, key, operationContext) {
                ${hook}.ready(source, key, value, operationContext)`)
        replace('if (!meta.placementsInitialized) return',
            `if (!meta.placementsInitialized) return
             ${hook}.ready(owner, key, after, operationContext)`)
    }
    if (url.endsWith('/property-versions.js')) {
        replace('const construction = metadata.metaOf(owner, operationContext)?.construction',
            `const construction = metadata.metaOf(owner, operationContext)?.construction ?? ${hook}.destination(owner, operationContext)`)
        replace('meta.placementVersions[key] = version',
            `meta.placementVersions[key] = version; ${hook}.slot(owner, key, version, operationContext)`)
    }
    if (url.endsWith('/refcounts.js')) {
        source = source.replaceAll('addParentCounterEdge(child, node)', 'addParentCounterEdge(child, node, operationContext)')
        source = source.replaceAll('removeParentCounterEdge(previousState.childCounter, owner)', 'removeParentCounterEdge(previousState.childCounter, owner, operationContext)')
        source = source.replaceAll('addParentCounterEdge(nextState.childCounter, owner)', 'addParentCounterEdge(nextState.childCounter, owner, operationContext)')
        source = source.replaceAll('function addParentCounterEdge(counter, parent)', 'function addParentCounterEdge(counter, parent, operationContext)')
        source = source.replaceAll('function removeParentCounterEdge(counter, parent)', 'function removeParentCounterEdge(counter, parent, operationContext)')
        replace('    counter.parents.set(parent, (counter.parents.get(parent) ?? 0) + 1)',
            `    (metadata.requireMeta(parent, operationContext).counterChildren ??= new Set()).add(counter.parents)
                 counter.parents.set(parent, (counter.parents.get(parent) ?? 0) + 1)`)
        replace('        counter.parents.delete(parent)',
            '        counter.parents.delete(parent); metadata.requireMeta(parent, operationContext).counterChildren?.delete(counter.parents)')
    }
    if (url.endsWith('/input-preparations.js')) {
        replace('if (policy.imported) metadata.markShared(root, operationContext)',
            `${hook}.reactivate(root, operationContext); if (policy.imported) metadata.markShared(root, operationContext)`)
        replace('if (existing) {\n            retentions.add(value)',
            `if (existing) {\n            ${hook}.reactivate(value, operationContext); retentions.add(value)`)
        replace('metadata.getOrCreateMeta(container.target, operationContext, type, admittedPrototype)',
            `metadata.getOrCreateMeta(container.target, operationContext, type, admittedPrototype); if (metadata.isImported(source, operationContext)) metadata.markImported(container.target, operationContext)`)
    }
    if (url.endsWith('/export.js')) {
        replace('let copies = new WeakMap()', 'let copies = new WeakMap(); let targets = []')
        replace('copies = outputs = undefined', 'copies = outputs = targets = undefined')
        replace('? copies.get(value)', '? targets[copies.get(value)]')
        replace('visited.add(value)', 'visited.add(value); let position')
        replace('if (copies) copies.set(value, output)',
            `if (copies) { ${hook}.output(output); position = targets.length; targets.push(output); copies.set(value, position) }`)
        replace('return walkManagedProperties(value, owner, step,', 'const capture = walkManagedProperties(value, owner, step,')
        source = source.replaceAll('copies.get(value)[key]', 'targets[position][key]')
        source = source.replaceAll('defineCopyProperty(copies.get(value),', 'defineCopyProperty(targets[position],')
        source = source.replaceAll('finishContainerCopy(copies.get(value),', 'finishContainerCopy(targets[position],')
        replace('            })\n    }\n}', '            })\n        value = undefined\n        return capture\n    }\n}')
    }
    if (url.endsWith('/managed-traversal.js')) {
        replace('    if (waits.length === 0)', '    value = undefined\n    if (waits.length === 0)')
    }
    return {...loaded, source}
}})
const r = await import('../../src/index.js')
metadata = await import('../../src/meta.js')
parents = await import('../../src/parent-placements.js')
const context = () => ({execution:new r.Execution(),errorContext:'destination experiment'})
const deferred = () => Promise.withResolvers()
async function collect(ref, expected) {
    for (let i = 0; i < 20; i++) { await new Promise(setImmediate); global.gc() }
    assert.equal(ref.deref() !== undefined, expected)
}
assert(global.gc, 'Run with --expose-gc')

// A source version settles while its imported parent is inactive, then the
// same parent re-enters without reflection or a repeated subscription.
const deliveries = []
for (const before of [false, true]) for (const reject of [false, true]) {
    const ctx = context(), pending = deferred()
    let reads = 0
    const raw = {waiting:pending.promise}, proxy = new Proxy(raw, {
        ownKeys(value) { reads++; return Reflect.ownKeys(value) },
        getOwnPropertyDescriptor(value, key) { reads++; return Reflect.getOwnPropertyDescriptor(value, key) },
    })
    const source = new r.Chain(r.import(proxy, ctx), ctx)
    const version = metadata.metaOf(proxy, ctx).placementVersions.waiting
    const value = {k:7}, error = new Error('expected rejection')
    if (before) { pending[reject ? 'reject' : 'resolve'](reject ? error : value); await version.publication }
    r.assignPath(source, [], null, ctx)
    bridge.retire(proxy, ctx)
    if (!before) { pending[reject ? 'reject' : 'resolve'](reject ? error : value); await version.publication }
    const settled = version.value, capturedReads = reads
    const again = new r.Chain(r.import(proxy, ctx), ctx)
    assert.equal(reads, capturedReads, 'relationship restoration reflected on host storage')
    assert.equal(r.lookupPath(again, ['waiting'], ctx), settled)
    assert.equal(r.isPoisonError(settled), reject)
    if (!reject) assert(parents.getParentPlacements(value, ctx).some(p => p.parent === proxy))
    deliveries.push({beforeRetirement:before, rejection:reject})
}

// Re-entry of a still-current pending version reopens its destination, without
// consuming the host thenable twice. A retired alias cycle is restored once.
{
    const ctx = context(), pending = deferred()
    let subscriptions = 0
    const source = {waiting:{then(resolve, reject) {
        subscriptions++; return pending.promise.then(resolve, reject)
    }}}
    source.self = source
    const chain = new r.Chain(r.import(source, ctx), ctx)
    const captured = r.lookupPath(chain, ['waiting'], ctx), count = subscriptions
    r.assignPath(chain, [], null, ctx); bridge.retire(source, ctx)
    const again = new r.Chain(r.import(source, ctx), ctx)
    assert.equal(subscriptions, count)
    pending.resolve({k:5})
    const result = await captured
    assert.equal(await r.lookupPath(again, ['waiting'], ctx), result)
    assert(parents.getParentPlacements(source, ctx).some(p => p.parent === source))
}

// Actual capture keeps its version, not an abandoned destination or siblings.
{
    const ctx = context(), pending = deferred()
    function fixture() {
        const root = {waiting:pending.promise, unrelated:{large:[1,2,3]}}
        const chain = new r.Chain(root, ctx)
        const result = r.lookupPath(chain, ['waiting'], ctx)
        r.assignPath(chain, [], null, ctx)
        bridge.retire(root, ctx)
        return {ref:new WeakRef(root), result}
    }
    const f = fixture()
    await collect(f.ref, false)
    pending.resolve({k:9})
    assert.equal((await f.result).k, 9)
}

// Overwrite while active, retire, re-enter before settlement: old version's
// destination cell reopens but its installed-version check still forbids writes.
{
    const ctx = context(), pending = deferred(), source = {waiting:pending.promise}
    const chain = new r.Chain(source, ctx)
    const old = r.lookupPath(chain, ['waiting'], ctx)
    // Exercise the actual version API at the trusted publication boundary.
    const versions = await import('../../src/property-versions.js')
    versions.assignProperty(source, 'waiting', 12, ctx)
    bridge.retire(source, ctx); bridge.reactivate(source, ctx)
    pending.resolve(4)
    assert.equal(await old, 4)
    assert.equal(r.lookupPath(chain, ['waiting'], ctx), 12)
}

// Retired counter summaries cannot survive child settlement. Re-entry restores
// edges only; the ordinary query reconstructs its optional counter projection.
{
    const ctx = context(), pending = deferred(), child = {waiting:pending.promise}
    const childChain = new r.Chain(r.import(child, ctx), ctx)
    const parent = {child}, chain = new r.Chain(r.import(parent, ctx), ctx)
    const query = r.hasError(chain, [], ctx)
    r.assignPath(chain, [], null, ctx); bridge.retire(parent, ctx)
    assert.equal(metadata.metaOf(parent, ctx).parents, undefined)
    pending.reject(new Error('late child failure'))
    await query
    const again = new r.Chain(r.import(parent, ctx), ctx)
    assert.equal(await r.hasError(again, [], ctx), true)
    assert.equal(await r.hasError(childChain, [], ctx), true)
}

// Indexed views have logical counter edges even when ownership uses compressed
// backing occurrences. Unlink these through the optional outgoing projection;
// retirement must not discover them by scanning the view's physical prefix.
{
    const ctx = context(), pending = deferred(), child = {waiting:pending.promise}
    const chain = new r.Chain([child, child], ctx)
    const view = r.run(chain, [], 'slice', [0], ctx, {})
    const holder = new r.Chain(view, ctx)
    const query = r.hasError(holder, [], ctx)
    assert.equal(metadata.metaOf(child, ctx).parents.get(view), 2)
    r.assignPath(holder, [], null, ctx); bridge.retire(view, ctx)
    assert.equal(metadata.metaOf(child, ctx).parents.has(view), false)
    pending.reject(new Error('indexed view settlement'))
    assert.equal(await query, true)
    assert.equal(await r.hasError(chain, [], ctx), true)
}

// A live child and an observed, never-settling property may both survive an old
// parent. Neither may keep that parent or its unrelated siblings reachable.
{
    const ctx = context(), pending = deferred(), child = {}
    const survivor = new r.Chain(child, ctx)
    assert.equal(survivor._state.value, child)
    assert.equal(parents.getParentPlacements(child, ctx).length, 1, 'initial survivor parent')
    function fixture() {
        const sibling = {}, source = {child, sibling, waiting:pending.promise}
        const chain = new r.Chain(source, ctx)
        const capture = r.lookupPath(chain, ['waiting'], ctx)
        r.assignPath(chain, [], null, ctx); bridge.retire(source, ctx)
        return {parent:new WeakRef(source), sibling:new WeakRef(sibling), capture}
    }
    const f = fixture()
    await collect(f.parent, false); await collect(f.sibling, false)
    assert.deepEqual(parents.getParentPlacements(child, ctx), [{parent:survivor._state, key:'value'}])
    assert(f.capture instanceof Promise)
}

// Restoration is proportional to retired topology, without another host walk.
// Keep the execution, host cache and one child alive across every cycle.
const cachedImports = []
for (const size of [8, 64]) for (const calls of [10, 40]) {
    const ctx = context(), child = {}, held = new r.Chain(child, ctx)
    let reads = 0
    const nodes = Array.from({length:size}, () => new Proxy({child}, {
        ownKeys(value) { reads++; return Reflect.ownKeys(value) },
        getOwnPropertyDescriptor(value, key) { reads++; return Reflect.getOwnPropertyDescriptor(value, key) },
    }))
    for (let i = 0; i < size; i++) nodes[i].next = nodes[(i + 1) % size]
    let holder = new r.Chain(r.import(nodes[0], ctx), ctx)
    const before = reads, restored = bridge.restored
    for (let i = 0; i < calls; i++) {
        r.assignPath(holder, [], null, ctx)
        for (const node of nodes) bridge.retire(node, ctx)
        assert.deepEqual(parents.getParentPlacements(child, ctx), [{parent:held._state, key:'value'}])
        holder = new r.Chain(r.import(nodes[0], ctx), ctx)
    }
    assert.equal(reads, before)
    assert.equal(bridge.restored - restored, size * calls * 2)
    cachedImports.push({size, calls, restoredPlacements:bridge.restored - restored, additionalHostReads:reads - before})
}

// Source collection while output is pending, including output discard after
// Error. Pre-create Error outside fixture to exclude native diagnostic stacks.
for (const poison of [false, true]) {
    const ctx = context(), pending = deferred(), child = {waiting:pending.promise}
    const childChain = new r.Chain(child, ctx)
    const failure = r.createPoisonError(new Error('data Error'), ctx, r.ERROR_KIND.OperationInputFailed)
    function fixture() {
        const source = {child, unrelated:{k:1}}
        if (poison) source.failure = failure
        const chain = new r.Chain(source, ctx)
        const output = r.export(chain, [], ctx)
        r.assignPath(chain, [], null, ctx); bridge.retire(source, ctx)
        return {ref:new WeakRef(source), output}
    }
    const f = fixture()
    await collect(f.ref, false)
    if (poison) {
        assert(outputShells.length > 0, 'GC must observe actual allocated output')
        for (const ref of outputShells.splice(0)) await collect(ref, false)
    } else outputShells.length = 0
    pending.resolve(11)
    const output = await f.output
    if (poison) assert.equal(output, failure)
    else assert.deepEqual(output, {child:{waiting:11}, unrelated:{k:1}})
    assert.equal(r.lookupPath(childChain, ['waiting'], ctx), 11)
}
// Aliases and cycles still address the same detached export shells.
{
    const ctx = context(), pending = deferred(), root = {waiting:pending.promise}
    root.self = root; root.alias = root
    const chain = new r.Chain(root, ctx), output = r.export(chain, [], ctx)
    pending.resolve(1)
    const value = await output
    assert.equal(value.self, value); assert.equal(value.alias, value)
}
console.log(JSON.stringify({deliveries, capturedVersionGC:true, staleDestination:true,
    counterRebuild:true, indexedViewUnlink:true, cachedImports,
    exportSourceGC:['success','Error'], discardedOutputGC:true, exportAliasCycle:true,
    scope:'Actual property-version and export mechanisms with hooked destinations; explicit retirement selection, shared remains enabled.'}, null, 2))
