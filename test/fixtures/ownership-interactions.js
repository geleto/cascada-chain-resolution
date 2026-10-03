// Public-operation regressions for ownership, ordering, and source release.
// Run with --expose-gc to include the pending-source retention checks.
import assert from "node:assert/strict"

const r = await import('../../src/index.js')
const metadata = await import('../../src/meta.js')
const { ChainedThenable } = await import('../ordered-thenable.js')
const { setImmediate: nextTurn } = await import('node:timers/promises')
const context = () => ({ execution: new r.Execution(() => {}), errorContext: 'interaction audit' })
const results = []
async function check(name, run) {
    try {
        const result = await run()
        results.push({ name, status: 'pass', ...result })
    } catch (error) {
        results.push({ name, status: 'FAIL', message: error.message, actual: error.actual, expected: error.expected })
        process.exitCode = 1
    }
}

for (const method of ['includes', 'indexOf', 'lastIndexOf']) {
    await check(`${method}: search identity retained across source reuse`, async () => {
        const ctx = context(), source = new r.Chain({ k: 1 }, ctx)
        const signal = Promise.withResolvers()
        const delivered = r.continueOperation(signal.promise, ctx, () => r.lookupPath(source, [], ctx))
        const haystack = new r.Chain([delivered], ctx)
        const needle = r.lookupPath(source, [], ctx)
        const result = r.run(haystack, [], method, [needle], ctx, {})
        const needleLeases = metadata.metaOf(needle, ctx).readLeaseCount ?? 0
        r.assignPath(source, ['k'], 2, ctx)
        const reused = source._state.value === needle
        signal.resolve(0)
        assert.equal(await result, method === 'includes' ? false : -1,
            `Captured old needle must differ from later changed value; reused=${reused}, needleLeases=${needleLeases}`)
        return { reused, needleLeases }
    })
}

for (const custom of [false, true]) for (const method of ['at', 'slice', 'includes', 'indexOf', 'lastIndexOf', 'join', 'flat', 'toSorted', 'concat', 'toSpliced', 'with', 'copyWithin', 'fill', 'sort', 'splice', 'push', 'unshift']) {
    await check(`${method}: receiver capture before ${custom ? 'ordered' : 'native'} argument delivery`, async () => {
        const ctx = context(), source = new r.Chain([1], ctx), control = new r.Chain({}, ctx)
        const signal = custom ? new ChainedThenable() : Promise.withResolvers()
        const pending = custom ? signal : signal.promise
        const argument = r.continueOperation(pending, ctx, () => r.enter(control, [], ctx, false, () => {
            r.assignPath(source, ['0'], 2, ctx)
            return ['sort', 'toSorted'].includes(method) ? undefined : method === 'join' ? ',' : 0
        }))
        signal.resolve(0)
        const args = ['includes', 'indexOf', 'lastIndexOf'].includes(method) ? [1, argument] :
            ['toSpliced', 'with', 'splice'].includes(method) ? [0, argument] : [argument]
        const result = r.run(source, [], method, args, ctx, {})
        const receiverResult = ['slice', 'flat', 'toSorted', 'concat', 'toSpliced', 'with', 'copyWithin', 'fill', 'sort', 'splice', 'push', 'unshift'].includes(method)
        const holder = receiverResult ? new r.Chain(result, ctx) : undefined
        const actual = receiverResult ? await r.export(holder, [], ctx) : await result
        const expected = ['concat', 'push'].includes(method) ? [1, 0] : method === 'unshift' ? [0, 1] :
            ['with', 'fill'].includes(method) ? [0] : receiverResult ? [1] : method === 'includes' ? true :
            ['indexOf', 'lastIndexOf'].includes(method) ? 0 : method === 'join' ? '1' : 1
        assert.deepEqual(actual, expected)
        assert.deepEqual(await r.export(source, [], ctx), [2])
    })
}

for (const method of ['pop', 'reverse', 'shift', 'toReversed', 'toString']) {
    await check(method + ': unused arguments stay unconsumed', () => {
        const ctx = context(), source = new r.Chain([1], ctx)
        let subscriptions = 0
        const unused = { then() { subscriptions++; return new Promise(() => {}) } }
        const result = r.run(source, [], method, [unused], ctx, {})
        assert(!(result instanceof Promise))
        assert.equal(subscriptions, 0)
    })
}

for (const valid of [false, true]) {
    await check(`argument preparation delivers ${valid ? 'valid' : 'rejected'} receiver`, async () => {
        const ctx = context(), receiverSignal = new ChainedThenable(), argumentSignal = new ChainedThenable()
        const receiver = new r.Chain(receiverSignal, ctx)
        const argument = r.continueOperation(argumentSignal, ctx, () => {
            receiverSignal.resolve(valid ? r.externalState({ use(a, b) { return a + b } }) : 1)
            return 3
        })
        argumentSignal.resolve(0)
        const result = await r.run(receiver, [], 'use', [argument, 4], ctx, {})
        if (valid) assert.equal(result, 7)
        else assert(r.isPoisonError(result))
        assert.equal(ctx.execution.fatalError, null)
    })
}

// Negative controls: ordinary prepared graph traversal already preserves these
// sibling captures when an older callback advances the source during delivery.
for (const custom of [false, true]) for (const operation of ['export', 'hasError', 'getErrors']) {
    await check(`${operation}: prepared sibling capture with ${custom ? 'ordered' : 'native'} delivery`, async () => {
        const ctx = context(), signal = custom ? new ChainedThenable() : Promise.withResolvers()
        const pending = custom ? signal : signal.promise
        const source = new r.Chain({ drain: pending, k: 1 }, ctx)
        const next = operation === 'export' ? 2 : r.validationError('later', ctx, r.ERROR_KIND.OperationInputFailed)
        const older = r.continueOperation(pending, ctx, () => r.assignPath(source, ['k'], next, ctx))
        signal.resolve(0)
        const result = r[operation](source, [], ctx)
        assert.deepEqual(await result, operation === 'export' ? { drain: 0, k: 1 } : operation === 'hasError' ? false : null)
        await older
    })
}

for (const method of ['join', 'toString']) {
    await check(`${method}: previously reported false ancestry`, async () => {
        const ctx = context(), signal = Promise.withResolvers()
        let source
        const delivered = r.continueOperation(signal.promise, ctx, () => r.lookupPath(source, [], ctx))
        source = new r.Chain([1, delivered], ctx)
        const result = r.run(source, [], method, [','], ctx, {})
        r.assignPath(source, ['0'], 2, ctx)
        r.assignPath(source, ['1'], 3, ctx)
        signal.resolve(0)
        assert.equal(await result, '1,2,3')
    })
}

if (global.gc) for (const route of ['exported argument', 'unused argument', 'other argument pending']) {
    await check(`${route}: source collection before independent result`, async () => {
        const ctx = context(), signal = Promise.withResolvers()
        const receiver = route === 'unused argument' ? new r.Chain([signal.promise], ctx)
            : new r.Chain(r.externalState({ use() { return route === 'exported argument' ? signal.promise : 7 } }), ctx)
        function issue() {
            const argument = { items: new Array(1000).fill(1) }
            const args = route === 'other argument pending' ? [argument, { wait: signal.promise }] : [argument]
            return { weak: new WeakRef(argument), result: r.run(receiver, [],
                route === 'unused argument' ? 'pop' : 'use', args, ctx,
                route === 'unused argument' ? { mutationScopeDepth: 0 } : {}) }
        }
        const { weak, result } = issue()
        for (let turn = 0; turn < 20; turn++) { await nextTurn(); global.gc() }
        const beforeCompletion = weak.deref() !== undefined
        signal.resolve(7)
        assert.equal(await result, 7)
        for (let turn = 0; turn < 20; turn++) { await nextTurn(); global.gc() }
        const afterCompletion = weak.deref() !== undefined
        assert.deepEqual([beforeCompletion, afterCompletion], [false, false],
            'Finished argument use must not retain its source until the independent result settles')
    })
}

if (global.gc) for (const pendingReceiver of [false, true]) {
    await check(`delivered argument collection before another root, receiver=${pendingReceiver}`, async () => {
        const ctx = context(), other = Promise.withResolvers(), receiverSignal = Promise.withResolvers()
        const receiverValue = r.externalState({ use(first, second) { return first.k + second } })
        const receiver = new r.Chain(pendingReceiver ? receiverSignal.promise : receiverValue, ctx)
        function issue() {
            const argument = Promise.withResolvers(), value = { k: 1 }
            const result = r.run(receiver, [], 'use', [argument.promise, other.promise], ctx, {})
            argument.resolve(value)
            return { weak: new WeakRef(value), result }
        }
        const { weak, result } = issue()
        receiverSignal.resolve(receiverValue)
        for (let i = 0; i < 20; i++) { await nextTurn(); global.gc() }
        assert.equal(weak.deref(), undefined, 'Delivery protection ends independently of another pending argument')
        other.resolve(7)
        assert.equal(await result, 8)
    })
}

if (global.gc) for (const method of ['join', 'toString']) {
    await check(`${method}: captured receiver collection before nested conversion finishes`, async () => {
        const ctx = context(), pending = Promise.withResolvers()
        function issue() {
            const array = [[pending.promise]], source = new r.Chain(array, ctx)
            const result = r.run(source, [], method, [], ctx, { repair: false })
            r.assignPath(source, [], null, ctx)
            assert.equal(metadata.metaOf(array, ctx).readLeaseCount ?? 0, 0)
            assert.equal(metadata.metaOf(array, ctx).relationshipsActive, false)
            return { weak: new WeakRef(array), result, source }
        }
        const { weak, result, source } = issue()
        for (let turn = 0; turn < 20; turn++) { await nextTurn(); global.gc() }
        const retained = weak.deref() !== undefined
        pending.resolve(8)
        assert.equal(await result, '8')
        assert.equal(r.export(source, [], ctx), null)
        assert.equal(retained, false, 'Completed placement capture must release its original receiver')
    })
}

console.log(JSON.stringify({ results }, null, 2))
