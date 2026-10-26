import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import { OrderedThenable, ChainedThenable } from '../../test/ordered-thenable.js'
import { verifyRefCounts } from '../../test/verify-refcounts.js'

const makeSignal = mode => mode === 'native' ? Promise.withResolvers() : mode === 'chained' ? new ChainedThenable() : new OrderedThenable()
const promiseOf = signal => signal.promise ?? signal
const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
let cases = 0, earlyCompletions = 0
for (const mode of ['ready', 'native', 'ordered', 'chained'])
for (const indexed of [false, true])
for (const order of orders)
for (const reject of [false, true]) {
    if (mode === 'ready' && order !== orders[0]) continue
    const label = `${mode}/${indexed}/${order}/${reject}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    const failureContext = { ...ctx, errorContext: `scope/${label}` }
    const signals = [makeSignal(mode), makeSignal(mode), makeSignal(mode)]
    const cause = new Error(`input/${label}`)
    if (mode === 'ready') {
        if (reject) signals[0].reject(cause)
        else signals[0].resolve({ n: 0 })
        signals[1].resolve({ k: 1 })
        signals[2].resolve()
    }
    const source = new r.Chain({ selected: { child: promiseOf(signals[0]), sibling: promiseOf(signals[1]) }, marker: 0 }, ctx)
    if (indexed) r.hasError(source, [], ctx)
    const entry = r.enter(source, ['selected'], ctx, true, inside => promiseOf(signals[2]).then(() => {
        const error = r.assignPath(inside, ['missing', 'x'], 9, failureContext, 0)
        assert(r.isPoisonError(error), label)
    }))
    const before = new r.Chain(r.lookupPath(source, [], ctx), ctx)
    r.assignPath(source, ['marker'], 1, ctx)
    const copy = new r.Chain(r.lookupPath(source, [], ctx), ctx)
    r.assignPath(copy, ['marker'], 2, ctx)
    const capturedError = r.export(copy, [], ctx)
    // Repair is issued through the copied pending gate before its poison exists.
    const repaired = r.repairPath(copy, ['selected'], ctx)
    const overwrite = r.assignPath(copy, ['selected', 'child'], { n: 7 }, ctx)
    let repairedReady = false, overwriteReady = false
    Promise.resolve(repaired).then(() => { repairedReady = true })
    Promise.resolve(overwrite).then(() => { overwriteReady = true })
    const complete = r.export(copy, [], ctx)
    const sourceReplace = r.assignPath(source, ['selected'], { newer: true }, ctx)
    for (const index of order) {
        if (mode === 'ready') continue
        if (index === 0 && reject) signals[index].reject(cause)
        else signals[index].resolve(index === 0 ? { n: 0 } : index === 1 ? { k: 1 } : undefined)
        await Promise.resolve()
        if (index === 2 && order[0] === 2) {
            // Let already-queued native bridges drain, while both payloads remain unresolved.
            await new Promise(setImmediate)
            assert.equal(repairedReady, true, `repair waits for unused recovery input: ${label}`)
            assert.equal(overwriteReady, true, `replacement waits for overwritten input: ${label}`)
            earlyCompletions++
        }
    }
    await Promise.all([entry, repaired, overwrite, sourceReplace])
    const poison = await capturedError
    assert(r.isPoisonError(poison), label)
    assert.equal(poison.errorContext, failureContext.errorContext, label)
    assert.equal(await r.getErrors(before, [], ctx), poison, label)
    assert.deepEqual(await complete, { selected: { child: { n: 7 }, sibling: { k: 1 } }, marker: 2 }, label)
    assert.deepEqual(await r.export(source, [], ctx), { selected: { newer: true }, marker: 1 }, label)
    await r.repairPath(before, ['selected'], ctx)
    const original = await r.export(before, [], ctx)
    if (reject) {
        assert(r.isPoisonError(original), label)
        assert.equal(original.cause, cause, label)
    } else assert.deepEqual(original, { selected: { child: { n: 0 }, sibling: { k: 1 } }, marker: 0 }, label)
    verifyRefCounts(ctx, source._state, copy._state, before._state)
    assert.equal(ctx.execution.fatalError, null, label)
    cases++
}
console.log(JSON.stringify({ cases, failures: 0, earlyCompletions, modes: ['ready', 'native', 'ordered', 'chained'], indexed: [false, true], orders, outcomes: ['fulfillment', 'rejection'], scenario: 'copied pending entry poison; queued repair; overwritten pending recovery child; independent original recovery' }))
