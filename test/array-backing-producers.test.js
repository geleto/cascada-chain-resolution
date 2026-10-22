import assert from 'node:assert/strict'
import * as r from '../src/index.js'
import { metaOf } from '../src/meta.js'
import { buildRefIndex } from '../src/refcounts.js'
import { ArrayView } from '../src/array-view.js'
import { verifyRefCounts } from './verify-refcounts.js'
import { OrderedThenable } from './ordered-thenable.js'

const context = () => ({ execution: new r.Execution(), errorContext: 'shared Array backing producer' })
const turn = () => new Promise(resolve => setImmediate(resolve))
function producer(chain, ctx) {
    const value = chain._state.value
    const backing = metaOf(value, ctx).arrayRange?.backing ?? value
    return metaOf(backing, ctx).arrayBacking?.producers
}

describe('shared Array backing producers', () => {
    for (const delivery of ['ready', 'native', 'ordered', 'rejected'])
        it(`publishes an authorized backing slot before physical growth, delivery=${delivery}`, async () => {
            const ctx = context(), gate = Promise.withResolvers()
            const input = delivery === 'ordered' ? new OrderedThenable() : Promise.withResolvers()
            const value = delivery === 'ready' ? 7 : delivery === 'ordered' ? input : input.promise
            const chain = new r.Chain([], ctx)
            const first = r.enter(chain, ['4'], ctx, true,
                inside => gate.promise.then(() => r.assignPath(inside, [], 2, ctx)))
            const unchanged = r.enter(chain, ['4'], ctx, true, () => undefined)
            const popped = r.run(chain, [], 'pop', [], ctx, { mutationScopeDepth: 0 })
            const assigned = r.enter(chain, ['1'], ctx, true,
                inside => r.assignPath(inside, [], value, ctx))
            gate.resolve()
            if (delivery === 'rejected') input.reject(new Error('payload rejection'))
            else if (delivery !== 'ready') input.resolve(7)
            await Promise.all([first, unchanged, assigned])
            assert.equal(await popped, 2)
            if (delivery === 'rejected') {
                assert.equal(r.lookupPath(chain, ['length'], ctx), 4)
                assert(Error.isError(await r.export(chain, [], ctx)))
                assert.equal(r.hasError(chain, [], ctx), true)
                r.assignPath(chain, ['1'], 7, ctx)
            }
            const output = await r.export(chain, [], ctx)
            assert.equal(output.length, 4)
            assert.deepEqual(Object.keys(output), ['1'])
            assert.equal(output[1], 7)
            assert.equal(r.hasError(chain, [], ctx), false)
            const retained = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
            r.assignPath(chain, ['1'], 9, ctx)
            assert.deepEqual(r.export(retained, [], ctx), output)
            assert.deepEqual(r.export(chain, [], ctx), [, 9, , ,])
            verifyRefCounts(ctx, chain._state, retained._state)
        })

    it('orders length truncation after shared structural transitions without waiting for ordinary payloads', async () => {
        const ctx = context(), gate = Promise.withResolvers(), data = Promise.withResolvers()
        let effect = false
        const source = new r.Chain([1, 2], ctx)
        const entry = r.enter(source, ['0'], ctx, true, inside => gate.promise.then(() => {
            effect = true
            return r.deletePath(inside, [], ctx)
        }))
        const receiver = new r.Chain([], ctx)
        const output = new r.Chain(r.run(receiver, [], 'concat', [r.lookupPath(source, [], ctx)], ctx, {}), ctx)
        assert(metaOf(producer(output, ctx), ctx).placementVersions['0'].transition)
        const tail = new r.Chain(r.run(output, [], 'slice', [1, 2], ctx, {}), ctx)
        const prefix = new r.Chain(r.run(output, [], 'slice', [], ctx, {}), ctx)
        r.assignPath(receiver, ['length'], 0, ctx)
        assert.deepEqual(r.export(receiver, [], ctx), [])
        r.assignPath(tail, ['length'], 0, ctx)
        assert.deepEqual(r.export(tail, [], ctx), [])
        r.assignPath(prefix, ['length'], 1, ctx)
        assert.equal(r.lookupPath(prefix, ['length'], ctx), 1)
        r.assignPath(output, ['length'], 0, ctx)
        const exported = r.export(output, [], ctx)
        let delivered = false
        Promise.resolve(exported).then(() => { delivered = true })
        await turn()
        assert.equal(effect, false)
        assert.equal(delivered, false)
        gate.resolve()
        await entry
        assert.deepEqual(await exported, [])
        assert.equal(effect, true)
        verifyRefCounts(ctx, source._state, output._state, prefix._state, tail._state, receiver._state)

        const payload = new r.Chain([0], ctx)
        r.run(payload, [], 'push', [data.promise], ctx, { mutationScopeDepth: 0 })
        r.assignPath(payload, ['length'], 1, ctx)
        assert.deepEqual(r.export(payload, [], ctx), [0])
        data.resolve(9)
        await turn()
        assert.deepEqual(r.export(payload, [], ctx), [0])
        verifyRefCounts(ctx, payload._state)
    })

    it('enumerates only selected in-range backing versions beneath local overrides', async () => {
        const ctx = context(), inputs = Array.from({ length: 3 }, () => Promise.withResolvers())
        const chain = new r.Chain([0], ctx)
        for (const input of inputs) r.run(chain, [], 'push', [input.promise], ctx, { mutationScopeDepth: 0 })
        const view = new r.Chain(r.run(chain, [], 'slice', [2, 4], ctx, {}), ctx)
        assert.deepEqual([...ArrayView.backingVersions(view._state.value, 0, ctx)].map(([key]) => key), ['0', '1'])
        assert.deepEqual([...ArrayView.backingVersions(view._state.value, 1, ctx)].map(([key]) => key), ['1'])
        assert.deepEqual([...ArrayView.backingVersions(view._state.value, 2, ctx)], [])
        r.assignPath(chain, [], null, ctx)
        buildRefIndex(view._state.value, ctx)
        r.assignPath(view, ['1'], 99, ctx)
        assert.deepEqual([...ArrayView.backingVersions(view._state.value, 0, ctx)].map(([key]) => key), ['0'])
        assert.deepEqual([...ArrayView.backingVersions(view._state.value, 1, ctx)], [])
        inputs.forEach((input, index) => input.resolve(index + 1))
        await turn()
        assert.deepEqual(r.export(view, [], ctx), [2, 99])
        verifyRefCounts(ctx, view._state)
    })

    it('excludes a masked canonical structural transition from projected version enumeration', async () => {
        const ctx = context(), gate = Promise.withResolvers()
        const source = new r.Chain([1, 2], ctx)
        const entry = r.enter(source, ['0'], ctx, true, inside => gate.promise.then(() => r.deletePath(inside, [], ctx)))
        const receiver = new r.Chain([], ctx)
        const output = new r.Chain(r.run(receiver, [], 'concat', [r.lookupPath(source, [], ctx)], ctx, {}), ctx)
        const record = producer(output, ctx)
        const canonical = metaOf(record, ctx).placementVersions['0']
        assert(canonical.transition)
        r.assignPath(receiver, [], null, ctx)
        const deletion = r.deletePath(output, ['0'], ctx)
        assert.equal(producer(output, ctx), record)
        assert.equal(metaOf(record, ctx).placementVersions['0'], canonical)
        assert.equal([...ArrayView.backingVersions(output._state.value, 0, ctx)].some(([key]) => key === '0'), false)
        gate.resolve()
        await Promise.all([entry, deletion])
        assert.deepEqual(r.export(output, [], ctx), [, 2])
        verifyRefCounts(ctx, output._state)
    })

    for (const pending of [false, true]) for (const indexed of [false, true])
        it(`keeps an entered deletion masked over a backing producer, pending=${pending}, indexed=${indexed}`, async () => {
            const ctx = context(), input = Promise.withResolvers()
            const chain = new r.Chain([0], ctx)
            r.run(chain, [], 'push', [input.promise], ctx, { mutationScopeDepth: 0 })
            if (!pending) { input.resolve(1); await turn() }
            const query = indexed ? r.getErrors(chain, [], ctx) : undefined
            const deletion = r.enter(chain, ['1'], ctx, true, inside => r.deletePath(inside, [], ctx))
            if (pending) input.resolve(1)
            await deletion
            if (indexed) assert.equal(await query, null)
            const expected = [0, ,]
            assert.equal(r.lookupPath(chain, ['1'], ctx), undefined)
            assert.equal(r.lookupPath(chain, ['length'], ctx), 2)
            assert.deepEqual(r.export(chain, [], ctx), expected)
            assert.equal(metaOf(chain._state.value, ctx).placementVersions['1'].present, false)
            const received = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
            const copied = new r.Chain(r.run(received, [], 'slice', [], ctx, {}), ctx)
            assert.deepEqual(r.export(copied, [], ctx), expected)
            r.assignPath(chain, ['1'], 9, ctx)
            assert.deepEqual(r.export(chain, [], ctx), [0, 9])
            assert.deepEqual(r.export(copied, [], ctx), expected)
            verifyRefCounts(ctx, chain._state, received._state, copied._state)
        })

    it('detaches indexed backing consumers when a queued nested mutation installs its own version', async () => {
        const ctx = context(), input = Promise.withResolvers(), child = Promise.withResolvers()
        const cause = new Error('nested child rejected')
        const chain = new r.Chain([0], ctx)
        r.run(chain, [], 'push', [input.promise], ctx, { mutationScopeDepth: 0 })
        const query = r.getErrors(chain, [], ctx)
        const shared = metaOf(producer(chain, ctx), ctx).placementVersions['1']
        assert.equal(shared.counterProjections.size, 1)
        const mutation = r.assignPath(chain, ['1', 'n'], 2, ctx)
        assert.equal(shared.counterProjections, undefined)
        assert.equal(metaOf(chain._state.value, ctx).backingCounterVersions, undefined)
        verifyRefCounts(ctx, chain._state)
        input.resolve({ n: 1, other: child.promise })
        await mutation
        verifyRefCounts(ctx, chain._state)
        child.reject(cause)
        const failure = await query
        assert.equal(failure.cause, cause)
        assert.equal(r.hasError(chain, [], ctx), true)
        verifyRefCounts(ctx, chain._state)
        r.assignPath(chain, ['1', 'other'], 3, ctx)
        assert.equal(r.hasError(chain, [], ctx), false)
        assert.equal(r.getErrors(chain, [], ctx), null)
        assert.deepEqual(r.export(chain, [], ctx), [0, { n: 2, other: 3 }])
        verifyRefCounts(ctx, chain._state)
    })

    it('updates only maintained indexed projections and preserves retained owners', async () => {
        const ctx = context(), input = Promise.withResolvers()
        const chain = new r.Chain([0], ctx)
        assert.equal(r.run(chain, [], 'push', [input.promise], ctx, { mutationScopeDepth: 0 }), 2)
        const earlier = new r.Chain(r.run(chain, [], 'slice', [], ctx, {}), ctx)
        buildRefIndex(chain._state.value, ctx)
        buildRefIndex(earlier._state.value, ctx)
        const shared = metaOf(producer(chain, ctx), ctx).placementVersions['1']
        assert.equal(shared.counterProjections.size, 2)
        input.resolve({ n: 1 })
        await turn()
        verifyRefCounts(ctx, chain._state.value, earlier._state.value)
        r.assignPath(chain, ['1', 'n'], 2, ctx)
        assert.deepEqual(r.export(chain, [], ctx), [0, { n: 2 }])
        assert.deepEqual(r.export(earlier, [], ctx), [0, { n: 1 }])
        r.assignPath(earlier, [], null, ctx)
        assert.equal(shared.counterProjections, undefined)
        verifyRefCounts(ctx, chain._state.value)
    })

    it('retires only the departed indexed projection before late shared settlement', async () => {
        const ctx = context(), input = Promise.withResolvers()
        const chain = new r.Chain([r.validationError('ready poison', ctx, r.ERROR_KIND.PropertyValidation)], ctx)
        r.run(chain, [], 'push', [input.promise], ctx, { mutationScopeDepth: 0 })
        const survivor = new r.Chain(r.run(chain, [], 'slice', [], ctx, {}), ctx)
        // Both public queries finish immediately; no pending query retains the
        // owner whose reciprocal membership must now be removed.
        assert.equal(r.hasError(chain, [], ctx), true)
        assert.equal(r.hasError(survivor, [], ctx), true)
        const departed = chain._state.value, live = survivor._state.value
        const shared = metaOf(producer(chain, ctx), ctx).placementVersions['1']
        assert.equal(shared.counterProjections.size, 2)
        r.assignPath(chain, [], null, ctx)
        assert.equal(metaOf(departed, ctx).backingCounterVersions, undefined)
        assert.equal(shared.counterProjections.has(departed), false)
        assert.equal(shared.counterProjections.get(live), '1')
        assert.equal(shared.counterProjections.size, 1)
        r.assignPath(survivor, ['0'], 0, ctx)
        const pending = r.hasError(survivor, [], ctx)
        assert(pending instanceof Promise)
        input.resolve({ n: 1 })
        assert.equal(await pending, false)
        assert.equal(r.getErrors(survivor, [], ctx), null)
        assert.deepEqual(r.export(survivor, [], ctx), [0, { n: 1 }])
        verifyRefCounts(ctx, chain._state, survivor._state)
        r.assignPath(survivor, [], null, ctx)
        assert.equal(shared.counterProjections, undefined)
        assert.equal(metaOf(live, ctx).backingCounterVersions, undefined)
    })

    for (const pending of [false, true]) it(`masks an overridden backing producer and retires its backing independently of a capture, pending=${pending}`, async () => {
        const ctx = context(), input = Promise.withResolvers(), value = { n: 1 }
        const chain = new r.Chain([0], ctx)
        r.run(chain, [], 'push', [input.promise], ctx, { mutationScopeDepth: 0 })
        const record = producer(chain, ctx)
        let earlier
        if (pending) earlier = r.export(chain, [], ctx)
        else { input.resolve(value); await turn() }
        buildRefIndex(chain._state.value, ctx)
        const shared = metaOf(record, ctx).placementVersions['1']
        assert(shared)
        r.assignPath(chain, ['1'], 7, ctx)
        assert.equal(metaOf(record, ctx).placementVersions['1'], shared)
        assert.equal(shared.counterProjections, undefined)
        assert.equal(metaOf(chain._state.value, ctx).backingCounterVersions, undefined)
        if (pending) {
            input.resolve(value)
            assert.deepEqual(await earlier, [0, { n: 1 }])
        }
        await turn()
        assert.deepEqual(r.export(chain, [], ctx), [0, 7])
        verifyRefCounts(ctx, chain._state.value)
        r.assignPath(chain, [], null, ctx)
        assert.equal(metaOf(record, ctx).relationshipsActive, false)
        assert.equal(metaOf(record, ctx).destination.owner, undefined)
        assert.equal(metaOf(value, ctx).relationshipsActive, false)
        assert.equal(metaOf(record, ctx).placementVersions['1'], shared)
    })

    it('retains one forward producer per backing slot through out-of-range owners and repeated overrides', async () => {
        const ctx = context(), input = Promise.withResolvers(), value = { n: 1 }
        const chain = new r.Chain([0], ctx)
        const prefixes = Array.from({ length: 32 }, () => new r.Chain(r.run(chain, [], 'slice', [], ctx, {}), ctx))
        r.run(chain, [], 'push', [input.promise], ctx, { mutationScopeDepth: 0 })
        const record = producer(chain, ctx)
        const shared = metaOf(record, ctx).placementVersions['1']
        buildRefIndex(chain._state.value, ctx)
        for (let index = 0; index < 32; index++) {
            r.assignPath(chain, ['1'], index, ctx)
            r.deletePath(chain, ['1'], ctx)
        }
        assert.equal(metaOf(record, ctx).placementVersions['1'], shared)
        assert.equal(Object.keys(metaOf(record, ctx).placementVersions).length, 1)
        assert.equal(shared.counterProjections, undefined)
        r.assignPath(chain, [], null, ctx)
        input.resolve(value)
        await turn()
        assert.equal(metaOf(record, ctx).relationshipsActive, true)
        for (const prefix of prefixes) assert.deepEqual(r.export(prefix, [], ctx), [0])
        verifyRefCounts(ctx, ...prefixes.map(prefix => prefix._state.value))
        for (const prefix of prefixes) r.assignPath(prefix, [], null, ctx)
        assert.equal(metaOf(record, ctx).relationshipsActive, false)
        assert.equal(metaOf(record, ctx).destination.owner, undefined)
        assert.equal(metaOf(value, ctx).relationshipsActive, false)
        assert.equal(metaOf(value, ctx).incomingParents, undefined)
        assert.equal(metaOf(record, ctx).placementVersions['1'], shared)
    })

    it('keeps producer presence through sparse concat without physical placeholder data', async () => {
        const ctx = context(), release = Promise.withResolvers()
        const input = new r.Chain([1, 2], ctx)
        const entry = r.enter(input, ['0'], ctx, true,
            child => release.promise.then(() => r.deletePath(child, [], ctx)))
        const receiver = new r.Chain([], ctx)
        const output = new r.Chain(r.run(receiver, [], 'concat', [r.lookupPath(input, [], ctx)], ctx, {}), ctx)
        const record = producer(output, ctx)
        assert(metaOf(record, ctx).placementVersions['0'].pendingPresence)
        buildRefIndex(output._state.value, ctx)
        const exported = r.export(output, [], ctx)
        release.resolve()
        await entry
        const result = await exported
        assert.equal(result.length, 2)
        assert.equal(Object.hasOwn(result, '0'), false)
        assert.equal(result[1], 2)
        verifyRefCounts(ctx, output._state.value)
    })

    it('preserves recovery through actual physical refusal and late shared settlement', async () => {
        const ctx = context(), input = Promise.withResolvers(), cause = new Error('refused explicit write')
        let refused = 0
        const backing = new Proxy([0], {
            set(target, key, value, receiver) {
                if (key === '1' && value === 7) { refused++; throw cause }
                return Reflect.set(target, key, value, receiver)
            },
        })
        const chain = new r.Chain(backing, ctx)
        r.run(chain, [], 'push', [input.promise], ctx, { mutationScopeDepth: 0 })
        const failure = r.assignPath(chain, ['1'], 7, ctx)
        assert(r.isPoisonError(failure), 'Required physical refusal must publish poison before the write is visible')
        assert.equal(failure.cause, cause)
        assert.equal(refused, 1)
        input.resolve({ n: 1 })
        await turn()
        assert.equal(r.repairPath(chain, ['1'], ctx), undefined)
        assert.deepEqual(await r.export(chain, [], ctx), [0, { n: 1 }])
        verifyRefCounts(ctx, chain._state.value)
    })
})
