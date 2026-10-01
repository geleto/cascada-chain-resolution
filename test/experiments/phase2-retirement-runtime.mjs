// Run: node test/experiments/phase2-retirement-runtime.mjs
// Process-local hooks exercise synchronous publication and actual Array owners.
// This is NOT the complete Phase 2 implementation: shared/COW and async capture
// still use production behavior. Pending destination experiments are separate.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { Ownership } from './phase2-ownership-model.mjs'

let metadata, parents, ArrayView, isPoisonError
const graphs = new WeakMap(), ownerBackings = new WeakMap(), backingSeen = new WeakSet()
const storageKey = Symbol('physical storage')
let suppress = 0
const sourceRoot = new URL('../../src/', import.meta.url).href
const bridge = globalThis.__phase2Retirement = {
    graph(ctx) {
        let graph = graphs.get(ctx.execution)
        if (!graph) {
            graph = new Ownership('compact', 'reverse', node => {
                suppress++
                try {
                    for (const [key, child] of graph.state(node).outgoing)
                        if (key !== storageKey) parents.removeParent(child, node, key, ctx)
                    ownerBackings.get(node)?.owners.delete(node)
                    const meta = metadata.metaOf(node, ctx)
                    if (meta) for (const field of ['parents', 'promiseCount', 'errorCount', 'cycleCutCount', 'cycleCuts']) delete meta[field]
                } finally { suppress-- }
            })
            graph.activated = node => {
                suppress++
                try {
                    ownerBackings.get(node)?.owners.add(node)
                    for (const [key, child] of graph.state(node).outgoing)
                        if (key !== storageKey) parents.addParent(child, node, key, ctx)
                } finally { suppress-- }
            }
            graphs.set(ctx.execution, graph)
        }
        return graph
    },
    managed(value, ctx) { return metadata.isTraversableType(metadata.metaOf(value, ctx)?.type) },
    activate(value, ctx) { if (!suppress) this.graph(ctx).activate(value) },
    holder(value, ctx) { this.graph(ctx).retain(value) },
    added(value, owner, key, ctx) {
        if (suppress || !this.managed(value, ctx)) return
        this.graph(ctx).set(owner, key, value)
    },
    removed(value, owner, key, ctx) {
        if (!suppress && this.managed(value, ctx)) this.graph(ctx).set(owner, key, undefined)
    },
    storage(owner, record, ctx) {
        if (!backingSeen.has(record)) {
            backingSeen.add(record)
            ownerBackings.set(record.array, record)
            this.graph(ctx).set(record.array, storageKey, record)
        }
        ownerBackings.set(owner, record)
        this.graph(ctx).set(owner, storageKey, record)
    },
    lease(value, ctx) { this.graph(ctx).retain(value) },
    unlease(value, ctx) { this.graph(ctx).release(value) },
    expireReady(ctx) {
        const graph = this.graph(ctx), previous = graph.ready
        graph.ready = undefined
        for (const record of previous ?? []) this.releaseReady(record)
    },
    releaseReady(record) {
        if (!record.value) return
        const {value, ctx} = record
        record.value = record.ctx = undefined
        const graph = this.graph(ctx)
        graph.ready?.delete(record)
        if (graph.ready?.size === 0) graph.ready = undefined
        this.graph(ctx).transition(() => metadata.decrementReadLease(value, ctx))
    },
    command(ctx, work, delivers = false) {
        const graph = this.graph(ctx), outer = graph.depth === 0
        return graph.transition(() => {
            if (outer) this.expireReady(ctx)
            const result = work()
            assert(!(result instanceof Promise), 'This bounded wiring covers ready commands only')
            if (!delivers || isPoisonError?.(result)) return result
            if (this.managed(result, ctx)) {
                metadata.incrementReadLease(result, ctx)
                const record = { value: result, ctx }
                graph.ready ??= new Set()
                graph.ready.add(record)
                queueMicrotask(() => this.releaseReady(record))
            }
            return result
        })
    },
    body(ctx, work) {
        const graph = this.graph(ctx), depth = graph.depth
        graph.depth = 0
        graph.flush()
        try { return work() } finally {
            graph.depth = depth
            this.expireReady(ctx)
        }
    },
}
registerHooks({ load(url, ctx, next) {
    const loaded = next(url, ctx)
    if (!url.startsWith(sourceRoot)) return loaded
    let source = String(loaded.source)
    const replace = (a, b) => { assert(source.includes(a), `missing hook ${url}: ${a}`); source = source.replace(a, b) }
    const hook = 'globalThis.__phase2Retirement'
    if (url.endsWith('/parent-placements.js')) {
        for (const name of ['addParent', 'removeParent']) {
            replace(`function ${name}(`, `function ${name}Original(`)
            source += `\nfunction ${name}(value, owner, key, ctx) {
                ${name}Original(value, owner, key, ctx)
                ${hook}.${name === 'addParent' ? 'added' : 'removed'}(value, owner, key, ctx)
            }\n`
        }
        replace('meta.placementsInitialized = true', `meta.placementsInitialized = true; ${hook}.activate(owner, operationContext)`)
        replace('function initializeHolder(owner, operationContext) {',
            `function initializeHolder(owner, operationContext) { ${hook}.holder(owner, operationContext);`)
    }
    if (url.endsWith('/array-view.js')) {
        replace('record.owners.add(owner)', `record.owners.add(owner); ${hook}.storage(owner, record, operationContext)`)
        replace('record.owners.add(backing)', `record.owners.add(backing); ${hook}.storage(backing, record, operationContext)`)
    }
    if (url.endsWith('/meta.js')) {
        replace('meta.readLeaseCount = (meta.readLeaseCount ?? 0) + 1',
            `meta.readLeaseCount = (meta.readLeaseCount ?? 0) + 1; ${hook}.lease(value, operationContext)`)
        replace('else meta.readLeaseCount = count - 1',
            `else meta.readLeaseCount = count - 1; ${hook}.unlease(value, operationContext)`)
    }
    if (url.endsWith('/chain.js')) {
        source = source.replaceAll('internalSteps.runInternalStep(operationContext, () => {',
            `${hook}.command(operationContext, () => internalSteps.runInternalStep(operationContext, () => {`)
        source = source.replaceAll('        })', '        }))')
    }
    if (url.endsWith('/enter.js')) replace('const result = onEntered(entered)',
        `const result = ${hook}.body(operationContext, () => onEntered(entered))`)
    if (url.endsWith('/index.js')) {
        for (const [name, contextIndex] of [['run', 4], ['assignPath', 3], ['deletePath', 2], ['enter', 2]]) {
            replace(`function ${name}(`, `function ${name}Original(`)
            source += `\nfunction ${name}(...args) {
                return ${hook}.command(args[${contextIndex}], () => ${name}Original(...args),
                    ${name === 'run' || name === 'enter'})
            }\n`
        }
    }
    return {...loaded, source}
}})
const r = await import('../../src/index.js')
metadata = await import('../../src/meta.js')
parents = await import('../../src/parent-placements.js')
;({ArrayView} = await import('../../src/array-view.js'))
isPoisonError = r.isPoisonError
const context = () => ({execution:new r.Execution(), errorContext:'retirement experiment'})
function backing(value, ctx) {
    const view = ArrayView.projectionOf(value, ctx)
    return metadata.metaOf(view._backing ?? value, ctx).arrayBacking
}

const histories = []
for (const body of ['direct', 'guarded', 'entered']) for (const mode of ['received', 'ignored']) {
    const ctx = context(), array = new r.Chain([0], ctx)
    let peak = 0, examinations = 0
    const commands = target => {
        for (let i = 0; i < 200; i++) {
            if (mode === 'received') r.assignPath(target, [], r.run(target, [], 'concat', [[i]], ctx, {}), ctx)
            else r.run(target, [], 'slice', [0], ctx, {})
            r.run(target, [], 'push', [i], ctx, {mutationScopeDepth:0})
            const record = backing(target._state.value, ctx)
            peak = Math.max(peak, record.owners.size)
            const iterate = record.owners[Symbol.iterator].bind(record.owners)
            record.owners[Symbol.iterator] = function* () {
                for (const owner of iterate()) { examinations++; yield owner }
            }
            record.visitViewPlacements([ArrayView.minimumLength(target._state.value, ctx) - 1], ctx, () => {})
            delete record.owners[Symbol.iterator]
        }
    }
    if (body === 'direct') commands(array)
    else if (body === 'guarded') r.runInternalStep(ctx, () => commands(array))
    else r.enter(array, [], ctx, true, commands)
    assert.equal(peak, 1)
    assert.equal(examinations, 200)
    histories.push({body, mode, peak, examinations})
}
// Actual graph cycles, aliases, retained children, root replacement/deletion,
// and a logical []/[[]] history with a physical backing cycle.
{
    const ctx = context(), kept = {}, first = {kept}, second = {first}
    first.second = second
    const root = new r.Chain(first, ctx), survivor = new r.Chain(kept, ctx)
    r.assignPath(root, [], null, ctx)
    assert.equal(bridge.graph(ctx).state(first).active, false)
    assert.equal(bridge.graph(ctx).state(second).active, false)
    assert.deepEqual(parents.getParentPlacements(kept, ctx), [{parent:survivor._state, key:'value'}])
    const array = new r.Chain([], ctx)
    r.run(array, [], 'push', [array._state.value], ctx, {mutationScopeDepth:0})
    const record = backing(array._state.value, ctx)
    r.assignPath(array, [], null, ctx)
    assert.equal(record.owners.size, 0)
    r.deletePath(survivor, [], ctx)
    assert.equal(bridge.graph(ctx).state(kept).active, false)
}

// Enter finalization is a receiving transition for its callback result. The
// inner result remains active until the enclosing producer establishes its hold.
{
    const ctx = context(), array = new r.Chain([1], ctx)
    const result = r.enter(array, [], ctx, true, inner => r.run(inner, [], 'slice', [0], ctx, {}))
    assert(bridge.graph(ctx).state(result).active)
    assert.equal(metadata.metaOf(result, ctx).readLeaseCount, 1)
    const holder = new r.Chain(result, ctx)
    assert.equal(metadata.metaOf(result, ctx).readLeaseCount ?? 0, 0)
    assert(bridge.graph(ctx).state(result).active)
    r.assignPath(holder, [], null, ctx)
    assert.equal(bridge.graph(ctx).state(result).active, false)
}
console.log(JSON.stringify({histories, scope:'Actual synchronous graph/Array publication with hooked retirement; shared/COW remains production behavior.'}, null, 2))
