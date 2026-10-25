import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import { ready, OrderedThenable, ChainedThenable } from '../../test/ordered-thenable.js'
import { verifyRefCounts } from '../../test/verify-refcounts.js'

const methods = ['concat', 'push', 'unshift', 'splice', 'toSpliced', 'with']
const deliveries = ['ready', 'sync', 'native', 'ordered', 'chained']
const mutators = new Set(['push', 'unshift', 'splice'])
const reports = []
function input(delivery, value) {
    if (delivery === 'ready') return { value }
    if (delivery === 'sync') return { value: ready(value) }
    const signal = delivery === 'native' ? Promise.withResolvers() :
        delivery === 'ordered' ? new OrderedThenable() : new ChainedThenable()
    return { value: signal.promise ?? signal, complete: () => signal.resolve(value) }
}
function argumentsFor(method, payload, index) {
    return method === 'with' ? [index, payload] :
        method === 'splice' || method === 'toSpliced' ? [1, 0, payload] : [payload]
}
function expectedOutput(method, source, payload, index) {
    const model = source.slice(), result = Reflect.apply(Array.prototype[method], model,
        argumentsFor(method, payload, index))
    return mutators.has(method) ? model : result
}

for (const method of methods) for (const delivery of deliveries)
for (const created of [false, true]) for (const argumentFirst of [false, true]) {
    const label = `${method}/${delivery}/growth=${created}/argumentFirst=${argumentFirst}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    const source = [1, , 3], chain = new r.Chain(source, ctx), shape = Promise.withResolvers()
    const entry = r.enter(chain, [5], ctx, true, inside => shape.promise.then(() => {
        if (created) r.assignPath(inside, [], 5, ctx)
    }))
    const payload = { selected: label }, argument = input(delivery, payload)
    const result = r.run(chain, [], method, argumentsFor(method, argument.value, 4), ctx,
        mutators.has(method) ? { mutationScopeDepth: 0 } : {})
    const resultHolder = new r.Chain(result, ctx)
    // A complete receiver shape is required by these selected operations.
    assert(r.isPending(result, ctx), label)
    if (argumentFirst) {
        argument.complete?.()
        await new Promise(setImmediate)
        shape.resolve()
    } else {
        shape.resolve()
        await entry
        await new Promise(setImmediate)
        argument.complete?.()
    }
    await entry
    const outcome = await r.export(resultHolder, [], ctx)
    if (method === 'with' && !created) {
        assert(r.isPoisonError(outcome), label)
        assert.equal(outcome.kind, r.ERROR_KIND.InvalidArrayOperation, label)
        assert.equal(outcome.errorContext, label)
    } else {
        const output = mutators.has(method) ? chain : resultHolder
        // Native backing may legally extend under fixed earlier bounds.
        // The sequential oracle starts from the issued logical input.
        const model = [1, , 3]
        if (created) model[5] = 5
        assert.deepEqual(await r.export(output, [], ctx), expectedOutput(method, model, payload, 4), label)
        if (method === 'push' || method === 'unshift') assert.equal(outcome, model.length + 1, label)
        if (method === 'splice') assert.deepEqual(outcome, [], label)
        verifyRefCounts(ctx, chain._state, resultHolder._state)
    }
    assert.equal(ctx.execution.fatalError, null, label)
    reports.push({ route: 'pending-shape', method, delivery, created, argumentFirst })
}

for (const method of methods) for (const delivery of deliveries) {
    const label = `snapshot/${method}/${delivery}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    const child = { n: 1 }, source = [child, child, , 4]
    const chain = new r.ContextChain({ api: r.externalState({ source }) }, ctx, { api: {} })
    const payload = { selected: label }, argument = input(delivery, payload)
    const result = r.run(chain, ['api', 'source'], method, argumentsFor(method, argument.value, 3), ctx, {})
    const output = new r.Chain(result, ctx)
    argument.complete?.()
    const exported = await r.export(output, [], ctx)
    const expected = expectedOutput(method, source, payload, 3)
    assert.deepEqual(exported, expected, label)
    const first = method === 'unshift' ? 1 : 0
    const second = method === 'splice' || method === 'toSpliced' ? 2 : first + 1
    assert.equal(exported[first], exported[second], label)
    assert.deepEqual(source, [child, child, , 4], label)
    verifyRefCounts(ctx, chain._state, output._state)
    assert.equal(ctx.execution.fatalError, null, label)
    reports.push({ route: 'external-snapshot', method, delivery })
}
console.log(JSON.stringify({ cases: reports.length, pendingShape: 120, externalSnapshot: 30, reports }))
