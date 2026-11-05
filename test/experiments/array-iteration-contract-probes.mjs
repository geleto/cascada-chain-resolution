// Run: node --unhandled-rejections=strict test/experiments/array-iteration-contract-probes.mjs
// Specification probes: not a production iterator, layout, or failure evaluator.
import assert from 'node:assert/strict'
import { Chain, Execution, lookupPath, assignPath, export as exportValue,
    isPoisonError, validationError, ERROR_KIND } from '../../src/index.js'

const report = {}
const deferred = () => {
    let resolve, reject
    const promise = new Promise((a, b) => { resolve = a; reject = b })
    return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
const context = name => ({ execution: new Execution(), errorContext: name })
const clear = (chain, ctx) => assignPath(chain, [], undefined, ctx)
const HOLE = Symbol('hole')
const signature = a => Array.from({ length: a.length }, (_, i) => i in a ? a[i] : HOLE)

// One failed splice's fallback uses an admissible normalized mapping skeleton,
// then removes candidate payloads whose survival is uncertain. It never invokes
// the user's operation with a fabricated argument or treats failure as success.
function spliceFallback(source, insertions, sLo, sHi, cLo, cHi, sequential) {
    const length = source.length, k = insertions.length
    const sourceRecords = source.map((value, index) => ({ value, source: index, poison: false, flag: false }))
    const insertedRecords = insertions.map(value => ({ value, inserted: true, poison: false, flag: sequential && sLo !== sHi }))
    const output = sourceRecords.slice()
    output.splice(sHi, Math.min(cLo, length - sHi), ...insertedRecords)
    for (const record of output) {
        if (record.inserted) continue
        const i = record.source
        const maybeDeleted = cHi > 0 && i >= sLo && i < Math.min(length, sHi + cHi)
        if (maybeDeleted) {
            record.poison = true
            record.value = undefined // No candidate payload survives for repair.
        } else if (sequential) {
            record.flag = cHi === 0
                ? k > 0 && i >= sLo && i < sHi
                : i >= sLo && cLo !== cHi
        }
    }
    return output
}

let layouts = 0, queries = 0
for (let length = 0; length <= 6; length++) {
    const source = Array.from({ length }, (_, i) => `a${i}`)
    for (let sLo = 0; sLo <= length; sLo++) for (let sHi = sLo; sHi <= length; sHi++) {
        for (let cLo = 0; cLo <= length; cLo++) for (let cHi = cLo; cHi <= length; cHi++) {
            for (let k = 0; k <= 2; k++) {
                const inserted = Array.from({ length: k }, (_, i) => `x${i}`)
                const worlds = []
                for (let s = sLo; s <= sHi; s++) for (let c = cLo; c <= cHi; c++) {
                    const a = source.slice(); a.splice(s, c, ...inserted); worlds.push(a)
                }
                const seq = spliceFallback(source, inserted, sLo, sHi, cLo, cHi, true)
                const unordered = spliceFallback(source, inserted, sLo, sHi, cLo, cHi, false)
                const lo = length - Math.min(cHi, length - sLo) + k
                const hi = length - Math.min(cLo, length - sHi) + k
                assert.equal(lo, Math.min(...worlds.map(a => a.length)))
                assert.equal(hi, Math.max(...worlds.map(a => a.length)))
                assert.equal(seq.length, hi)
                for (const value of [...source, ...inserted]) {
                    const survives = worlds.every(a => a.includes(value))
                    const occurrence = unordered.find(r => !r.poison && r.value === value)
                    assert.equal(Boolean(occurrence), survives)
                    if (survives) {
                        const fixed = worlds.every(a => a.indexOf(value) === worlds[0].indexOf(value))
                        const record = seq.find(r => !r.poison && r.value === value)
                        assert.equal(!record.flag, fixed)
                        if (fixed) assert.equal(seq.indexOf(record), worlds[0].indexOf(value))
                    }
                    queries++
                }
                for (let i = 0; i < lo; i++) {
                    if (worlds.every(a => a[i] === worlds[0][i])) {
                        assert.equal(seq[i].poison, false)
                        assert.equal(seq[i].flag, false)
                        assert.equal(seq[i].value, worlds[0][i])
                    }
                }
                layouts++
            }
        }
    }
}

// Regression: always appending violates an established suffix under tighter bounds.
{
    const a = ['A', 'B', 'C', 'D']
    const alternatives = [1, 2].map(s => { const b = a.slice(); b.splice(s, 0, 'X'); return b })
    assert(alternatives.every(b => b[3] === 'C' && b[4] === 'D'))
    assert.notEqual([...a, 'X'][3], 'C')
    assert.deepEqual(spliceFallback(a, ['X'], 1, 2, 0, 0, false).map(r => r.value), ['A', 'B', 'X', 'C', 'D'])
}

// Failure is a per-operation boundary. Do not search successful final layouts
// to erase an earlier non-positional failure: content restoration is a new write.
{
    const source = ['A', 'B', 'C', 'D']
    const first = spliceFallback(source, ['X'], 2, 2, 0, 2, true)
    assert.deepEqual(first.map(r => r.poison ? 'Error' : r.value), ['A', 'B', 'X', 'Error', 'Error'])
    first.push({ value: 'Z', poison: false, flag: false })
    first.reverse()
    assert.equal(first[0].value, 'Z')
    assert.equal(first[0].poison, false)
    first.fill({ value: 'Y', poison: false, flag: false })
    assert(first.every(r => !r.poison && !r.flag && r.value === 'Y'))
}
report.splice = { layouts, occurrenceChecks: queries, boundedFallbackRegression: 'passes' }

// The same interval selection rules cover fixed-shape slice and fill.
// Enumeration is only the reference oracle; the projectors use endpoint bounds.
let rangeChecks = 0
for (let length = 0; length <= 5; length++) {
    const source = Array.from({ length }, (_, i) => `a${i}`)
    for (let a = 0; a <= length; a++) for (let b = a; b <= length; b++) {
        for (let c = 0; c <= length; c++) for (let d = c; d <= length; d++) {
            const slices = [], fills = []
            for (let s = a; s <= b; s++) for (let e = c; e <= d; e++) {
                slices.push(source.slice(s, e))
                fills.push(source.slice().fill('X', s, e))
            }
            assert.equal(Math.min(...slices.map(x => x.length)), Math.max(c - b, 0))
            assert.equal(Math.max(...slices.map(x => x.length)), Math.max(d - a, 0))
            const fallback = source.slice(a, d).map((value, j) => {
                const i = a + j, survives = i >= b && i < c
                return { value: survives ? value : undefined, poison: !survives, flag: survives && a !== b }
            })
            for (let i = 0; i < length; i++) {
                assert.equal(slices.every(x => x.includes(source[i])), i >= b && i < c)
                const filled = i >= b && i < c
                const unaffected = i < a || i >= d
                const fixed = fills.every(x => x[i] === fills[0][i])
                assert.equal(fixed, filled || unaffected)
                if (fixed) assert.equal(fills[0][i], filled ? 'X' : source[i])
                rangeChecks++
            }
            for (let j = 0; j < Math.min(...slices.map(x => x.length)); j++) {
                if (slices.every(x => x[j] === slices[0][j])) {
                    assert.equal(fallback[j].poison, false)
                    assert.equal(fallback[j].flag, false)
                    assert.equal(fallback[j].value, slices[0][j])
                }
            }
        }
    }
}
report.ranges = { occurrenceChecks: rangeChecks, methods: ['slice', 'fill'] }

// A fixed-slot cursor uses current public ownership APIs, not layout internals.
// Capturing a Chain eagerly protects unread items against subsequent mutations.
function heldCursor(source, ctx, length) {
    let snapshot = new Chain(lookupPath(source, [], ctx), ctx), index = 0
    return {
        [Symbol.asyncIterator]() { return this },
        next() {
            if (!snapshot) return { done: true, value: undefined }
            if (index === length) return this.return()
            const item = new Chain(lookupPath(snapshot, [index++], ctx), ctx)
            return { done: false, value: item }
        },
        return() {
            if (snapshot) { clear(snapshot, ctx); snapshot = undefined }
            return { done: true, value: undefined }
        },
    }
}

let holderChecks = 0
for (const delivery of ['ready', 'pending', 'rejection', 'ready-poison']) {
    const ctx = context(`holder-${delivery}`), d = deferred()
    const poison = validationError('payload failure', ctx, ERROR_KIND.OperationInputFailed)
    const initial = delivery === 'ready' ? { n: 1 } : delivery === 'ready-poison' ? poison : d.promise
    const source = new Chain([initial, { n: 2 }], ctx)
    const cursor = heldCursor(source, ctx, 2)
    const first = await cursor.next()
    const second = await cursor.next()
    assert(first.value instanceof Chain && second.value instanceof Chain)
    // Both steps finish before the pending payload has any outcome.
    assert.deepEqual(await exportValue(second.value, [], ctx), { n: 2 })
    assignPath(source, [1, 'n'], 99, ctx)
    assert.deepEqual(await exportValue(second.value, [], ctx), { n: 2 })
    cursor.return()
    if (delivery === 'pending') d.resolve({ n: 1 })
    if (delivery === 'rejection') d.reject(new Error('payload failed'))
    const value = await exportValue(first.value, [], ctx)
    assert.equal(isPoisonError(value), delivery === 'rejection' || delivery === 'ready-poison')
    if (delivery === 'ready' || delivery === 'pending') assert.deepEqual(value, { n: 1 })
    clear(first.value, ctx); clear(second.value, ctx); clear(source, ctx)
    holderChecks++
}

// for-await awaits the step Promise but does not unwrap a Chain's pending root.
{
    const ctx = context('for-await'), d = deferred()
    const source = new Chain([d.promise, 'B'], ctx), cursor = heldCursor(source, ctx, 2), items = []
    for await (const item of cursor) items.push(item)
    assert.equal(items.length, 2)
    d.resolve('A')
    assert.equal(await exportValue(items[0], [], ctx), 'A')
    for (const item of items) clear(item, ctx)
    clear(source, ctx)
    holderChecks++
}

// Body writes cannot change unread source occurrences or pending nested versions.
for (const edit of ['next', 'nested', 'truncate', 'replace']) {
    const ctx = context(`self-modification-${edit}`), d = deferred()
    const source = new Chain([{ n: 1 }, { n: d.promise }, { n: 3 }], ctx)
    const cursor = heldCursor(source, ctx, 3), first = await cursor.next()
    if (edit === 'next') assignPath(source, [1], { n: 99 }, ctx)
    if (edit === 'nested') assignPath(source, [1, 'n'], 99, ctx)
    if (edit === 'truncate') assignPath(source, ['length'], 1, ctx)
    if (edit === 'replace') assignPath(source, [], [], ctx)
    const second = await cursor.next(), third = await cursor.next()
    d.resolve(2)
    assert.deepEqual(await exportValue(second.value, [], ctx), { n: 2 })
    assert.deepEqual(await exportValue(third.value, [], ctx), { n: 3 })
    cursor.return()
    for (const step of [first, second, third]) clear(step.value, ctx)
    clear(source, ctx)
    holderChecks++
}

// A pending step owns its capture independently of cursor closure. This model
// intentionally does not cancel an issued next or implement production guards.
for (const timing of ['before-return', 'after-return']) {
    const ctx = context(`pending-step-${timing}`), gate = deferred()
    const source = new Chain([{ n: 7 }], ctx)
    let cursorCapture = new Chain(lookupPath(source, [], ctx), ctx), closed = false
    const stepCapture = new Chain(lookupPath(cursorCapture, [], ctx), ctx)
    const next = gate.promise.then(() => {
        const item = new Chain(lookupPath(stepCapture, [0], ctx), ctx)
        clear(stepCapture, ctx)
        return { done: false, value: item }
    })
    if (timing === 'before-return') { gate.resolve(); await flush() }
    closed = true; clear(cursorCapture, ctx); cursorCapture = undefined
    assignPath(source, [0, 'n'], 99, ctx)
    if (timing === 'after-return') gate.resolve()
    const result = await next
    assert(closed && !result.done)
    assert.deepEqual(await exportValue(result.value, [], ctx), { n: 7 })
    clear(result.value, ctx); clear(source, ctx)
    holderChecks++
}

// Holes and duplicate aliases are retained through the ordinary lookup boundary.
{
    const ctx = context('sparse-aliases'), shared = { n: 1 }
    const source = new Chain([shared, , shared], ctx), cursor = heldCursor(source, ctx, 3)
    const items = []; for await (const item of cursor) items.push(item)
    assert.equal(await exportValue(items[1], [], ctx), undefined)
    assignPath(items[0], ['n'], 2, ctx)
    assert.deepEqual(await exportValue(items[2], [], ctx), { n: 1 })
    assert.deepEqual(signature(await exportValue(source, [], ctx)), [{ n: 1 }, HOLE, { n: 1 }])
    for (const item of items) clear(item, ctx)
    clear(source, ctx)
    holderChecks++
}
report.handoff = { cases: holderChecks, pendingPayloads: 'not awaited', selfModification: 'captured source preserved' }
console.log(JSON.stringify(report, null, 2))
