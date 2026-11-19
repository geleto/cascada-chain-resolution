// Run: node --unhandled-rejections=strict test/experiments/iterate-sequential-equivalence-probes.mjs
// Current public-runtime witnesses for the iteration specification. This does
// not implement or certify the future partial-layout evaluator or iterator.
import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import { ready } from '../ordered-thenable.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
const context = label => ({ execution: new r.Execution(), errorContext: label })
const copy = value => Array.isArray(value) ? value.map(copy) : value
const mutators = new Set(['copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'])
const source = () => [4, , 1, 3]
const cases = [
    ['at', [-1]], ['includes', [3, -2]], ['indexOf', [3, 0]], ['lastIndexOf', [3]],
    ['join', ['|']], ['toString', []], ['copyWithin', [1, 0, 3]], ['fill', [8, 1, 3]],
    ['pop', []], ['push', [8, 9]], ['reverse', []], ['shift', []],
    ['sort', [(a, b) => a - b]], ['splice', [1, 2, 8]], ['unshift', [8]],
    ['slice', [1, -1]], ['toReversed', []], ['toSorted', [(a, b) => a - b]],
    ['toSpliced', [1, 2, 8]], ['with', [-1, 8]], ['concat', [[8, , 9]]],
    ['flat', [2], () => [4, , [1, [3]], 2]],
    // Argument-shape, sparse, equality, overlap and search-direction cases.
    ['splice', []], ['splice', [1]], ['splice', [1, undefined, 8]],
    ['copyWithin', [0, 1, 4]], ['copyWithin', [1, 1, 3]],
    ['includes', [undefined]], ['indexOf', [undefined]],
    ['includes', [NaN], () => [1, NaN, 3]], ['indexOf', [NaN], () => [1, NaN, 3]],
    ['indexOf', [3], () => [3, 1, 3]], ['lastIndexOf', [3], () => [3, 1, 3]],
    ['sort', [(a, b) => a - b], () => [3, undefined, , 1]],
    ['slice', [1, 1]], ['fill', [8, 2, 2]],
]

function permutations(items) {
    if (!items.length) return [[]]
    return items.flatMap((item, i) => permutations(items.filter((_, j) => i !== j)).map(tail => [item, ...tail]))
}

function reference(method, args, makeSource, mutation) {
    const before = makeSource(), working = copy(before)
    const nativeResult = working[method](...copy(args))
    const changed = mutators.has(method)
    const after = mutation && changed ? working : copy(before)
    const result = !mutation && changed ? working : nativeResult
    const final = copy(after)
    final[0] = 99
    return [copy(before), copy(result), copy(after), final]
}

let executions = 0, snapshotChecks = 0
async function exercise(method, args, makeSource, mutation, delivery, order) {
    const label = `${method}/${mutation ? 'mutation' : 'copy'}/${delivery}/${order.join(',')}`
    const ctx = context(label), signals = []
    const receive = value => {
        if (delivery === 'ready') return value
        if (delivery === 'synchronous') return ready(value)
        const signal = Promise.withResolvers()
        signals.push({ ...signal, value })
        return signal.promise
    }
    const input = makeSource()
    for (const i of new Set([0, input.length - 1])) if (i in input) input[i] = receive(input[i])
    const actualArgs = copy(args).map(receive)
    const chain = new r.Chain(input, ctx)
    const before = r.export(chain, [], ctx)
    const direct = r.run(chain, [], method, actualArgs, ctx, mutation ? { mutationScopeDepth: 0 } : {})
    // Immediate supported receiving handoff protects a result that aliases the
    // receiver against the later overwrite, even when result delivery is pending.
    const holder = new r.Chain(direct, ctx)
    const result = r.export(holder, [], ctx)
    const after = r.export(chain, [], ctx)
    const overwrite = r.assignPath(chain, [0], 99, ctx)
    const final = r.export(chain, [], ctx)
    const outcomes = Promise.all([before, result, after, final])
    // Own a possible rejection while the controlled settlement schedule runs.
    outcomes.catch(() => {})
    if (delivery === 'deferred') {
        assert.equal(order.length, signals.length, label)
        for (const i of order) {
            signals[i].resolve(signals[i].value)
            await tick()
        }
    }
    await overwrite
    assert.deepEqual(await outcomes, reference(method, args, makeSource, mutation), label)
    assert.equal(ctx.execution.fatalError, null, label)
    snapshotChecks += 4
    executions++
}

for (const [method, args, makeSource = source] of cases) {
    for (const mutation of mutators.has(method) ? [false, true] : [false]) {
        await exercise(method, args, makeSource, mutation, 'ready', [])
        await exercise(method, args, makeSource, mutation, 'synchronous', [])
        const input = makeSource()
        const payloads = [...new Set([0, input.length - 1])].filter(i => i in input).length
        for (const order of permutations(Array.from({ length: payloads + args.length }, (_, i) => i))) {
            await exercise(method, args, makeSource, mutation, 'deferred', order)
        }
    }
}

let pendingMembershipChecks = 0
for (const count of [0, 1, 2]) {
    const ctx = context(`membership-${count}`), control = Promise.withResolvers()
    const chain = new r.Chain(['A', 'B', 'C', 'D'], ctx)
    const removal = r.run(chain, [], 'splice', [2, control.promise, 'X'], ctx, { mutationScopeDepth: 0 })
    const removedHolder = new r.Chain(removal, ctx)
    const found = r.run(chain, [], 'includes', ['D'], ctx, {})
    let settled = false
    Promise.resolve(found).then(() => { settled = true })
    await tick()
    assert.equal(settled, false, 'Membership uncertainty must not become false or Error')
    control.resolve(count)
    assert.equal(await found, count < 2)
    const expected = ['A', 'B', 'C', 'D']
    const removed = expected.splice(2, count, 'X')
    assert.deepEqual(await r.export(chain, [], ctx), expected)
    assert.deepEqual(await r.export(removedHolder, [], ctx), removed)
    pendingMembershipChecks++
}

// includes can finish on a definite witness, while a directional index must
// retain an earlier possible match. No timer is used to invent a dependency result.
{
    const ctx = context('definite-match'), first = Promise.withResolvers()
    const chain = new r.Chain([first.promise, 'B'], ctx)
    const found = r.run(chain, [], 'includes', ['B'], ctx, {})
    assert.equal(await found, true)
    const index = r.run(chain, [], 'indexOf', ['B'], ctx, {})
    let settled = false
    Promise.resolve(index).then(() => { settled = true })
    await tick()
    assert.equal(settled, false)
    first.resolve('B')
    assert.equal(await index, 0)
}

// Counterexample to treating the ready prefix as successful exhaustion.
const completions = [0, 1, 2].map(count => {
    const a = ['A', 'B', 'C', 'D']
    a.splice(2, count, 'X')
    return a
})
assert.equal(completions.every(a => a.includes('X')), true)
assert.equal(completions.every(a => a.includes('D')), false)
assert.equal(completions.some(a => a.includes('D')), true)
// Successful native completions alone do not certify an early negative result.
// The planned streaming evaluator must also exclude relevant structural failure;
// a rejected count produces structural Error slots, so includes('absent') waits.
assert.equal(completions.every(a => !a.includes('absent')), true)

// A committed append-only prefix does not make end-dependent transforms ready.
// These are independent successful native completions, not a failed-tail model.
const tails = [[], ['C'], ['0', 'C'], ['C', 'D', 'E']]
const extensions = tails.map(tail => ['A', 'B', ...tail])
for (const a of extensions) {
    assert.equal(a[0], 'A')
    assert.deepEqual(a.slice(0, 2), ['A', 'B'])
    assert.equal(a.includes('A'), true)
}
for (const query of [a => a.length, a => a.at(-1), a => a.toReversed()[0], a => a.toSorted()[0]]) {
    assert(new Set(extensions.map(query)).size > 1, 'A stable source prefix does not prove this result')
}
const contributions = tails.map(tail => ['A', ...tail, 'Z'])
assert(contributions.every(a => a.includes('Z') && a.at(-1) === 'Z'))
assert(new Set(contributions.map(a => a.indexOf('Z'))).size > 1)

// Native mapping witnesses for a certified prefix. Vary the inaccessible suffix
// independently; allowed edits must produce the same prefix and leave that
// suffix unchanged. This is not a production prefix-poison implementation.
let prefixEditMappings = 0
for (let p = 0; p <= 4; p++) {
    const prefix = Array.from({ length: p }, (_, i) => `p${i}`)
    if (p > 1) delete prefix[1]
    for (const tail of [[], ['t0'], ['t0', 't1'], new Array(2)]) {
        for (let start = 0; start <= p; start++) for (let count = 0; count <= p - start; count++) {
            for (const inserted of [[], ['x'], ['x', 'y']]) {
                const whole = prefix.concat(tail), expectedPrefix = prefix.slice()
                whole.splice(start, count, ...inserted)
                expectedPrefix.splice(start, count, ...inserted)
                const nextP = p - count + inserted.length
                assert.deepEqual(whole.slice(0, nextP), expectedPrefix)
                assert.deepEqual(whole.slice(nextP), tail)
                prefixEditMappings++
            }
        }
        const prepended = prefix.concat(tail)
        const returnedLength = prepended.unshift('new')
        assert.deepEqual(prepended.slice(0, p + 1), ['new'].concat(prefix))
        assert.deepEqual(prepended.slice(p + 1), tail)
        assert.equal(returnedLength, p + tail.length + 1)
        prefixEditMappings++
        for (let i = 0; i < p; i++) {
            const whole = prefix.concat(tail), expectedPrefix = prefix.slice()
            delete whole[i]
            delete expectedPrefix[i]
            assert.deepEqual(whole.slice(0, p), expectedPrefix)
            assert.deepEqual(whole.slice(p), tail)
            assert.equal(whole.length, p + tail.length)
            prefixEditMappings++
        }
        for (let target = 0; target <= p; target++) for (let start = 0; start <= p; start++) {
            for (let end = start; end <= p; end++) {
                if (target + end - start > p) continue
                const whole = prefix.concat(tail), expectedPrefix = prefix.slice()
                whole.copyWithin(target, start, end)
                expectedPrefix.copyWithin(target, start, end)
                assert.deepEqual(whole.slice(0, p), expectedPrefix)
                assert.deepEqual(whole.slice(p), tail)
                prefixEditMappings++
            }
        }
    }
}
const wholeCopy = ['A', 'B', 'C', 'D'].copyWithin(1, 0, 2)
assert.deepEqual(wholeCopy, ['A', 'A', 'B', 'D'])
assert.notDeepEqual(wholeCopy, ['A', 'B'].copyWithin(1, 0, 2).concat(['C', 'D']),
    'Prefix-only simulation would hide a write beyond the allowed destination range')

console.log(JSON.stringify({ controlledNames: new Set(cases.map(c => c[0])).size,
    executions, snapshotChecks, pendingMembershipChecks,
    openPrefixCompletions: extensions.length, prefixEditMappings,
    coverage: 'Current runtime successful mappings and captures; future partial-layout/iterator integration remains untested' }))
