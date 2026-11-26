import assert from 'node:assert/strict'
import * as r from '../../src/index.js'

assert(globalThis.gc)
function handlerFor(fresh, failKey) {
    return {
        armed: false, hits: 0, failKey, cause: fresh ? undefined : new Error('prebuilt remap failure'),
        ownKeys(target) {
            if (this.armed && this.failKey === 'keys') {
                this.hits++
                this.cause ??= new Error('fresh remap failure')
                throw this.cause
            }
            return Reflect.ownKeys(target)
        },
        getOwnPropertyDescriptor(target, key) {
            if (this.armed && key === this.failKey) {
                this.hits++
                this.cause ??= new Error('fresh remap failure')
                throw this.cause
            }
            return Reflect.getOwnPropertyDescriptor(target, key)
        },
    }
}
const specs = {
    concat: [], reverse: [], splice: [1, 1], toReversed: [],
    toSpliced: [1, 1], sort: [], toSorted: [], flat: [1],
}
const rows = []
function issue(method, fresh, failKey, live = false, route = 'receiver') {
    const label = `${method}/${fresh}/${failKey ?? 'healthy'}/${live}/${route}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    const raw = [{ selected: 0 }, { selected: 1 }, { selected: 2 }]
    const mutation = route === 'mutation'
    const pending = mutation ? new Promise(() => {}) : undefined
    if (pending) raw.splice(1, 0, pending)
    const handler = handlerFor(fresh, failKey), source = new Proxy(raw, handler)
    const admitted = r.import(source, ctx)
    const chain = new r.Chain(route === 'argument' ? [7] : admitted, ctx, r.CHAIN_MODE.Complete)
    const weak = [raw, source, ...raw.filter(value => value !== pending)].map(value => new WeakRef(value))
    handler.armed = true
    const args = route === 'argument' ? [admitted] : specs[method].slice()
    if (method === 'splice' || method === 'toSpliced') {
        // The retained prefix must reach sparse key enumeration for this fault.
        if (failKey === 'keys') args[0] = 2
        if (mutation) args[1] = 2
        else args.push({ inserted: true })
    }
    let result = r.run(chain, [], method, args, ctx, mutation ? { mutationScopeDepth: 0 } : {})
    handler.armed = false
    if (failKey) {
        assert(r.isPoisonError(result), label)
        assert.equal(result.cause, handler.cause, label)
        assert.equal(result.kind, mutation ? r.ERROR_KIND.PropertyMutationFailed : r.ERROR_KIND.InvocationFailed, label)
        assert.equal(result.errorContext, label)
        assert(handler.hits > 0, label)
        if (mutation) {
            r.repairPath(chain, [], ctx)
            assert.equal(r.lookupPath(chain, [3, 'selected'], ctx), 2)
        }
    }
    let retained
    if (live) retained = new r.Chain(result, ctx, r.CHAIN_MODE.Complete)
    if (!failKey) result = undefined
    r.assignPath(chain, [], null, ctx)
    assert.equal(ctx.execution.fatalError, null)
    rows.push({ label, ctx, chain, retained, poison: result, weak, live, pending })
}
for (const method of Object.keys(specs)) {
    for (const fresh of [false, true]) for (const failKey of ['keys', '0', '2']) issue(method, fresh, failKey)
    issue(method, false, undefined)
    issue(method, false, undefined, true)
    if (method === 'concat') {
        for (const fresh of [false, true]) for (const failKey of ['keys', '0', '2']) issue(method, fresh, failKey, false, 'argument')
        issue(method, false, undefined, false, 'argument')
        issue(method, false, undefined, true, 'argument')
    }
}
// A late failure follows a surviving child and two removed slots, one pending.
for (const fresh of [false, true]) issue('splice', fresh, '3', false, 'mutation')
for (let turn = 0; turn < 30; turn++) { await new Promise(setImmediate); globalThis.gc() }
const retained = rows.filter(row => !row.live && row.weak.some(value => value.deref()))
    .map(row => ({ label: row.label, live: row.weak.map(value => !!value.deref()) }))
for (const row of rows.filter(row => row.live)) assert(row.weak[2].deref(), `${row.label} lost live payload`)
console.log(JSON.stringify({ cases: rows.length, retained }, null, 2))
assert.deepEqual(retained, [])
