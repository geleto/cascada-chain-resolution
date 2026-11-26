import assert from 'node:assert/strict'
import * as r from '../../src/index.js'

assert(globalThis.gc)
function fail(handler, boundary, key) {
    if (!handler.armed || handler.boundary !== boundary || handler.key !== key) return
    handler.hits++
    handler.cause ??= new Error('fresh range failure')
    throw handler.cause
}
function arrayHandler(boundary, key, fresh) {
    return {
        boundary, key, armed: false, hits: 0, cause: fresh ? undefined : new Error('prebuilt range failure'),
        getOwnPropertyDescriptor(target, key) { fail(this, 'reflection', key); return Reflect.getOwnPropertyDescriptor(target, key) },
        set(target, key, value, receiver) { fail(this, 'storage', key); return Reflect.set(target, key, value, receiver) },
        deleteProperty(target, key) { fail(this, 'storage', key); return Reflect.deleteProperty(target, key) },
    }
}
function issue(method, boundary, fresh, indexed, live = false) {
    const label = `${method}/${boundary ?? 'healthy'}/${fresh}/${indexed}/${live}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    const payload = { value: 7 }, tail = { n: 9 }, raw = [{ n: 1 }, { n: 2 }, { n: 3 }, tail]
    const handler = arrayHandler(boundary, method === 'fill' ? '1' : '2', fresh)
    const source = new Proxy(raw, handler)
    const root = new Proxy({ array: source }, {
        set(target, key, value, receiver) {
            fail(handler, 'publication', method === 'fill' ? '1' : '2')
            return Reflect.set(target, key, value, receiver)
        },
    })
    const chain = new r.Chain(root, ctx)
    if (indexed) assert.equal(r.hasError(chain, [], ctx), false)
    const weak = [new WeakRef(raw), new WeakRef(source), new WeakRef(root), new WeakRef(tail)]
    const selected = (method === 'fill' ? [payload] : [raw[0], raw[1]]).map(value => new WeakRef(value))
    handler.armed = true
    let result = r.run(chain, ['array'], method, method === 'fill' ? [payload, 0, 2] : [1, 0, 2], ctx, { mutationScopeDepth: 1 })
    handler.armed = false
    if (boundary === 'reflection') {
        assert.equal(result.cause, handler.cause, label)
        assert.equal(result.errorContext, label)
        assert(handler.hits > 0)
    } else {
        assert(!r.isPoisonError(result), label)
        result = undefined
    }
    if (!live) r.assignPath(chain, [], null, ctx)
    assert.equal(ctx.execution.fatalError, null)
    return { label, ctx, chain, poison: result, weak, selected, live }
}
const rows = []
// Explicit point assignment still has a required storage boundary. Retaining
// its diagnostic after replacing the root must release the old descriptor value.
function pointFailure() {
    const ctx = { execution: new r.Execution(), errorContext: 'point assignment' }
    const old = { n: 1 }, raw = [old]
    const source = new Proxy(raw, { set() { throw new Error('refused point') } })
    const chain = new r.Chain(source, ctx)
    r.assignPath(chain, [0], 7, ctx)
    const poison = r.lookupPath(chain, [0], ctx)
    assert.equal(poison.kind, r.ERROR_KIND.PropertyMutationFailed)
    r.assignPath(chain, [], null, ctx)
    return { label: 'point assignment', poison, ctx, chain,
        weak: [new WeakRef(old), new WeakRef(raw), new WeakRef(source)], selected: [], live: false }
}
rows.push(pointFailure())
for (const method of ['fill', 'copyWithin']) {
    for (const boundary of ['reflection', 'storage', 'publication'])
        for (const fresh of [false, true]) for (const indexed of [false, true])
            rows.push(issue(method, boundary, fresh, indexed))
    rows.push(issue(method, undefined, true, false), issue(method, undefined, true, false, true))
}
for (let turn = 0; turn < 20; turn++) { await new Promise(setImmediate); globalThis.gc() }
for (const row of rows) {
    for (let index = 0; index < row.weak.length; index++)
        assert.equal(row.weak[index].deref() !== undefined, row.live, `${row.label} retained object ${index}`)
    for (let index = 0; index < row.selected.length; index++)
        assert.equal(row.selected[index].deref() !== undefined, row.live, `${row.label} retained selected value ${index}`)
}
console.log(JSON.stringify({ cases: rows.length, liveControls: rows.filter(row => row.live).length }))
