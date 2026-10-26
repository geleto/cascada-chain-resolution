import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import { ready, OrderedThenable } from '../ordered-thenable.js'

assert(globalThis.gc)
const rows = []
const specifications = {
    at: { keys: ['1'], args: [1] },
    join: { keys: ['0', '1', '2'], args: [] },
    includes: { keys: ['0', '1', '2'], args: [42], captureRead: 1 },
    indexOf: { keys: ['0', '1', '2'], args: [42] },
    lastIndexOf: { keys: ['0', '1', '2'], args: [42] },
    slice: { keys: ['0', '1', '2'], args: [] },
    concat: { keys: ['0', '1', '2'], args: [] },
    flat: { keys: ['0', '1', '2'], args: [1] },
    sort: { keys: ['0', '1', '2'], args: [] },
    toSorted: { keys: ['0', '1', '2'], args: [] },
    reverse: { keys: ['0', '1', '2'], args: [] },
    toReversed: { keys: ['0', '1', '2'], args: [] },
    toSpliced: { keys: ['0', '2'], args: [1, 1] },
    with: { keys: ['0', '2'], args: [1, 7] },
    fill: { keys: ['2'], args: [7, 0, 1] },
    copyWithin: { keys: ['2'], args: [1, 0, 1] },
}

function makeHandler(key, captureRead, fresh, failing) {
    return {
        armed: false, reads: 0, hits: 0,
        cause: fresh ? undefined : new Error('prebuilt placement capture failure'),
        getOwnPropertyDescriptor(target, selected) {
            if (this.armed && selected === key && ++this.reads === captureRead && failing) {
                this.hits++
                this.cause ??= new Error('fresh placement capture failure')
                throw this.cause
            }
            return Reflect.getOwnPropertyDescriptor(target, selected)
        },
    }
}

// Delegate delivery to native Promise reactions so retained diagnostic stacks
// contain no host queue closure that intentionally owns the delivered source.
function customSignal() {
    const signal = Promise.withResolvers()
    return { resolve: signal.resolve, then(onValue, onError) { return signal.promise.then(onValue, onError) } }
}

async function issue(method, key, fresh, delivery, control = 'failure', nested = false) {
    const label = `${method}/${key}/${fresh}/${delivery}/${control}/${nested}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    const spec = specifications[method], raw = [{ n: 2 }, { n: 1 }, { n: 3 }]
    const handler = makeHandler(key, spec.captureRead ?? 2, fresh, control === 'failure')
    const source = new Proxy(raw, handler)
    r.import(source, ctx)
    const signal = delivery === 'native' ? Promise.withResolvers() : delivery === 'custom' ? customSignal() : undefined
    const input = delivery === 'ready' ? source : delivery === 'synchronous' ? ready(source) : signal.promise ?? signal
    const chain = new r.Chain(nested ? { nested: input } : input, ctx)
    const weak = [source, raw, ...raw].map(value => new WeakRef(value))
    handler.armed = true
    const result = r.run(chain, nested ? ['nested'] : [], method, spec.args.slice(), ctx, {})
    // Receive successful ready or pending managed results at issuance.
    const output = new r.Chain(result, ctx)
    signal?.resolve(source)
    const value = await result
    handler.armed = false
    if (control === 'failure') {
        assert.equal(handler.hits, 1, `${label}: reaches selected capture`)
        assert(r.isPoisonError(value), label)
        assert.equal(value.cause, handler.cause, label)
        assert.equal(value.kind, method === 'join' ? r.ERROR_KIND.ScalarConversionFailed : r.ERROR_KIND.InvocationFailed, label)
        assert.equal(value.errorContext, label)
    } else {
        const expected = Reflect.apply(Array.prototype[method], raw.slice(), spec.args)
        assert.deepEqual(await r.export(output, [], ctx), expected, label)
    }
    assert.equal(r.hasError(chain, [], ctx), false, `${label}: reflection failure is local`)
    assert.equal(ctx.execution.fatalError, null, label)
    if (control !== 'live') {
        r.assignPath(chain, [], null, ctx)
        r.assignPath(output, [], null, ctx)
    }
    rows.push({ label, ctx, chain, output, weak, live: control === 'live', poison: control === 'failure' ? value : undefined })
}

for (const [method, spec] of Object.entries(specifications)) {
    for (const key of spec.keys) for (const fresh of [false, true])
        for (const delivery of ['ready', 'synchronous', 'native', 'custom'])
            await issue(method, key, fresh, delivery)
    for (const delivery of ['ready', 'synchronous', 'native', 'custom']) {
        await issue(method, spec.keys[0], true, delivery, 'discarded')
        await issue(method, spec.keys[0], true, delivery, 'live')
    }
}

// Pending captures retain both presence and their earlier value when later
// writes proceed. These semantic controls use the ordinary host-owned queue.
for (const method of ['slice', 'toReversed', 'fill', 'copyWithin', 'flat', 'toSorted'])
for (const delivery of ['native', 'ordered']) for (const present of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: `presence/${method}/${delivery}/${present}` }
    const signal = delivery === 'native' ? Promise.withResolvers() : new OrderedThenable()
    const chain = new r.Chain([4, , 8], ctx), expected = [4, , 8]
    const entry = r.enter(chain, [1], ctx, true, selected => {
        if (present) r.assignPath(selected, [], 3, ctx)
        return signal.promise ?? signal
    })
    if (present) expected[1] = 3
    const args = method === 'fill' ? [7, 2] : method === 'copyWithin' ? [2, 0, 1] : []
    const output = new r.Chain(r.run(chain, [], method, args, ctx, {}), ctx)
    r.assignPath(chain, [0], 99, ctx)
    signal.resolve()
    await entry
    assert.deepEqual(await r.export(output, [], ctx), Reflect.apply(Array.prototype[method], expected, args), ctx.errorContext)
    assert.equal(ctx.execution.fatalError, null)
}
for (const method of ['at', 'toReversed']) for (const fresh of [false, true])
    for (const delivery of ['ready', 'synchronous', 'native', 'custom'])
        await issue(method, '1', fresh, delivery, 'failure', true)

// Complete collection still needs poison before and after a failed value capture.
for (const method of ['join', 'flat', 'sort', 'toSorted']) {
    const ctx = { execution: new r.Execution(), errorContext: `collection/${method}` }
    const causes = [new Error('earlier poison'), new Error('later poison')]
    const later = Promise.withResolvers()
    const handler = makeHandler('1', 2, true, true)
    const nested = cause => new Proxy([1], {
        ownKeys(target) { if (handler.armed) throw cause; return Reflect.ownKeys(target) },
    })
    const laterValue = method === 'flat' ? r.import(nested(causes[1]), ctx) : undefined
    const firstValue = method === 'flat' ? nested(causes[0])
        : r.createPoisonError(causes[0], ctx, r.ERROR_KIND.OperationInputFailed)
    const source = new Proxy([firstValue, 0, later.promise], handler)
    const chain = new r.Chain(r.import(source, ctx), ctx)
    handler.armed = true
    const result = r.run(chain, [], method, method === 'flat' ? [1] : [], ctx, {})
    let complete = false
    Promise.resolve(result).then(() => { complete = true })
    await new Promise(setImmediate)
    assert.equal(complete, false, `${method}: required later poison remains pending`)
    if (method === 'flat') later.resolve(laterValue)
    else later.reject(causes[1])
    const poison = await result, leaves = poison.errors ?? [poison]
    assert.equal(handler.hits, 1)
    assert.equal(leaves.length, 3, method)
    for (const cause of [...causes, handler.cause]) assert(leaves.some(error => error.cause === cause), method)
    for (const error of leaves) assert.equal(error.errorContext, ctx.errorContext)
    handler.armed = false
    r.assignPath(chain, [], null, ctx)
    assert.equal(ctx.execution.fatalError, null)
}

async function collect() {
    for (let turn = 0; turn < 30; turn++) { await new Promise(setImmediate); globalThis.gc() }
}
await collect()
for (const row of rows) for (let index = 0; index < row.weak.length; index++)
    assert.equal(row.weak[index].deref() !== undefined, row.live, `${row.label}: retained source or payload ${index}`)
for (const row of rows.filter(row => row.live)) {
    r.assignPath(row.chain, [], null, row.ctx)
    r.assignPath(row.output, [], null, row.ctx)
}
await collect()
for (const row of rows) for (let index = 0; index < row.weak.length; index++)
    assert.equal(row.weak[index].deref(), undefined, `${row.label}: released control ${index}`)
console.log(JSON.stringify({ cases: rows.length, failures: rows.filter(row => row.poison).length,
    healthyControls: rows.filter(row => !row.poison).length, completeCollection: 4, pendingPresence: 24 }))
