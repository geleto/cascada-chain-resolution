// Audit witnesses, not a Phase 2 implementation. Run each mode separately:
// node test/experiments/phase2-interactions.mjs production
// node test/experiments/phase2-interactions.mjs ownership
// node test/experiments/phase2-interactions.mjs receiver
// Use --expose-gc to include source-retention checks; mode arguments trials
// clearing spent call arguments after preparation starts (bounded cases only).
// Correctness failures are reported separately and make the runner fail.
// The ownership hook covers ordinary record writes only; it does not implement
// retirement, pending handoff, Array storage permission, or generation capture.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const mode = process.argv[2] ?? 'production'
assert(['production', 'ownership', 'receiver', 'arguments'].includes(mode))
let parents
globalThis.__phase2AuditOtherParents = (value, ctx) =>
    parents.getParentPlacements(value, ctx).length > 1
if (mode !== 'production') registerHooks({ load(url, ctx, next) {
    const loaded = next(url, ctx)
    if (mode === 'arguments') {
        if (url.endsWith('/src/run.js')) {
            let source = String(loaded.source)
            const before = 'return mutation ? operation.finishMutation(result) : operation.finish(result)'
            assert(source.includes(before))
            source = source.replace(before, 'args = undefined\n        ' + before)
            return { ...loaded, source }
        }
        if (!url.endsWith('/src/invocation.js')) return loaded
        let source = String(loaded.source).replace(/\r\n/g, '\n')
        const before = 'const preparedArguments = methodDescription.prepareArguments()'
        assert(source.includes(before))
        source = source.replace(before, before + '\n        invocationWork.args = undefined')
        const provisional = 'leaseArgumentsUntilReceiverReached() {\n' +
            '        for (let index = 0; index < this.args.length; index++) {\n' +
            '            const protection = receiveValue(\n' +
            '                this.args[index],'
        assert(source.includes(provisional))
        source = source.replace(provisional, 'leaseArgumentsUntilReceiverReached() {\n' +
            '        const args = this.args\n' +
            '        for (let index = 0; index < args.length && !this.receiverReached; index++) {\n' +
            '            const protection = receiveValue(\n' +
            '                args[index],')
        source = source.replace('this.args[index] = protection', 'args[index] = protection')
        return { ...loaded, source }
    }
    if (mode === 'receiver') {
        if (!url.endsWith('/src/invocation.js')) return loaded
        let source = String(loaded.source).replace(/\r\n/g, '\n')
        const before = 'const preparedArguments = methodDescription.prepareArguments()\n' +
            '        invocationWork.leaseReceiver(methodDescription.receiverToLease)'
        assert(source.includes(before))
        source = source.replace(before, 'invocationWork.leaseReceiver(methodDescription.receiverToLease)\n' +
            '        const preparedArguments = methodDescription.prepareArguments()')
        return { ...loaded, source }
    }
    if (!url.endsWith('/src/meta.js')) return loaded
    let source = String(loaded.source).replace(/\r\n/g, '\n')
    const before = 'return metaOf(value, operationContext)?.shared === true ||\n        hasReadLease(value, operationContext)'
    assert(source.includes(before))
    source = source.replace(before,
        'return metaOf(value, operationContext)?.imported === true ||\n' +
        '        globalThis.__phase2AuditOtherParents(value, operationContext) || hasReadLease(value, operationContext)')
    return { ...loaded, source }
} })

const r = await import('../../src/index.js')
const metadata = await import('../../src/meta.js')
const { ChainedThenable } = await import('../ordered-thenable.js')
const { setImmediate: nextTurn } = await import('node:timers/promises')
parents = await import('../../src/parent-placements.js')
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

for (const custom of [false, true]) for (const method of ['at', 'slice', 'includes', 'indexOf', 'lastIndexOf', 'join', 'flat', 'toSorted']) {
    await check(`${method}: receiver capture before ${custom ? 'synchronous' : 'native'} argument delivery`, async () => {
        const ctx = context(), source = new r.Chain([1], ctx), control = new r.Chain({}, ctx)
        const signal = custom ? new ChainedThenable() : Promise.withResolvers()
        const pending = custom ? signal : signal.promise
        const argument = r.continueOperation(pending, ctx, () => r.enter(control, [], ctx, false, () => {
            r.assignPath(source, ['0'], 2, ctx)
            return method === 'toSorted' ? undefined : method === 'join' ? ',' : 0
        }))
        signal.resolve(0)
        const args = ['includes', 'indexOf', 'lastIndexOf'].includes(method) ? [1, argument] : [argument]
        const result = r.run(source, [], method, args, ctx, {})
        const receiverResult = ['slice', 'flat', 'toSorted'].includes(method)
        const holder = receiverResult ? new r.Chain(result, ctx) : undefined
        const actual = receiverResult ? await r.export(holder, [], ctx) : await result
        const expected = receiverResult ? [1] : method === 'includes' ? true :
            ['indexOf', 'lastIndexOf'].includes(method) ? 0 : method === 'join' ? '1' : 1
        assert.deepEqual(actual, expected)
        assert.deepEqual(await r.export(source, [], ctx), [2])
    })
}

for (const valid of [false, true]) {
    await check(`argument preparation delivers ${valid ? 'valid' : 'rejected'} receiver`, async () => {
        const ctx = context(), receiverSignal = new ChainedThenable(), argumentSignal = new ChainedThenable()
        const receiver = new r.Chain(receiverSignal, ctx)
        const argument = r.continueOperation(argumentSignal, ctx, () => {
            receiverSignal.resolve(valid ? r.externalState({ use(a, b) { return a + b } }) : 1)
            receiverSignal.flush()
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
    await check(`${operation}: prepared sibling capture with ${custom ? 'synchronous' : 'native'} delivery`, async () => {
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

if (mode === 'production') for (const method of ['join', 'toString']) {
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

console.log(JSON.stringify({ mode, results }, null, 2))
