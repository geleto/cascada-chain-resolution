// Independent, bounded follow-up of pending mutation/transition capture hypotheses.
import assert from 'node:assert/strict'
import * as r from '../../src/index.js'

assert(globalThis.gc, 'Run with --expose-gc')
const context = name => ({ execution: new r.Execution(), errorContext: { name } })
const refs = values => values.map(value => new WeakRef(value))
const retained = []
function nativeFailure() { throw new Error('fresh native failure') }

async function queuedNative(failing) {
    const ctx = context('queued native'), api = r.externalState({ fail: failing ? nativeFailure : () => 7 })
    const outer = { api, payload: {} }, raw = { outer }
    const chain = new r.ContextChain(raw, ctx, { outer: { api: {} } })
    const signal = Promise.withResolvers()
    const entry = r.enter(chain, ['outer'], ctx, true, () => signal.promise)
    const pending = r.run(chain, ['outer', 'api'], 'fail', [], ctx, { mutationScopeDepth: 2 })
    signal.resolve()
    const result = await pending
    await entry
    assert.equal(r.isPoisonError(result), failing)
    if (failing) assert.equal(result.kind, r.ERROR_KIND.InvocationFailed)
    else assert.equal(result, 7)
    await r.assignPath(chain, [], undefined, ctx)
    return { label: `native/${failing}`, ctx, result, refs: refs([raw, outer, outer.payload]) }
}

function handler(fresh, failing) {
    return {
        armed: false, hits: 0, cause: fresh ? undefined : new Error('prebuilt write'),
        defineProperty(target, key, descriptor) {
            if (this.armed && failing && key === 'slot') {
                this.hits++
                this.cause ??= new Error('fresh write')
                throw this.cause
            }
            return Reflect.defineProperty(target, key, descriptor)
        },
    }
}

async function queuedTransition(fresh, failing) {
    const ctx = context('queued transition'), host = handler(fresh, failing)
    const old = { payload: {} }, backing = { slot: old }, source = new Proxy(backing, host)
    const chain = new r.Chain(source, ctx), signal = Promise.withResolvers()
    const entry = r.enter(chain, ['slot'], ctx, true, () => signal.promise)
    const replacement = r.assignPath(chain, ['slot'], { next: 7 }, ctx)
    host.armed = true
    signal.resolve()
    await entry
    await replacement
    host.armed = false
    const error = await r.getErrors(chain, [], ctx)
    assert.equal(host.hits, failing ? 1 : 0)
    if (failing) {
        assert.equal(error.kind, r.ERROR_KIND.PropertyMutationFailed)
        assert.equal(error.cause, host.cause)
    } else assert.equal(error, null)
    await r.assignPath(chain, [], undefined, ctx)
    return { label: `transition/${fresh}/${failing}`, ctx, error, refs: refs([source, backing, old, old.payload]) }
}

for (const failing of [false, true]) retained.push(await queuedNative(failing))
for (const fresh of [false, true]) for (const failing of [false, true]) {
    retained.push(await queuedTransition(fresh, failing))
}
for (let i = 0; i < 30; i++) { await new Promise(setImmediate); globalThis.gc() }
for (const row of retained) {
    for (const [index, reference] of row.refs.entries()) {
        assert.equal(reference.deref(), undefined, `${row.label}: source ${index} retained`)
    }
}
console.log(JSON.stringify({ queuedNative: 2, queuedTransition: 4, retainedUnformattedDiagnostics: true }))
