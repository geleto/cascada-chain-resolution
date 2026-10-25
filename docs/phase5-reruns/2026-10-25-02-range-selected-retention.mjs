// Review reproduction: selected values survive failed range construction.
// Run with --expose-gc --stack-trace-limit=10 (also 50 and 1000).
// --diagnostic-format-stacks demonstrates the retaining path, not a remedy.
import assert from 'node:assert/strict'
import * as r from '../../src/index.js'

assert(globalThis.gc)
const formatStacks = process.argv.includes('--diagnostic-format-stacks')

function issue(method, fresh, indexed, fails, live = false) {
    const label = `${method}/fresh=${fresh}/indexed=${indexed}/fails=${fails}/live=${live}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    const payload = { value: 7 }, first = { n: 1 }, second = { n: 2 }, tail = { n: 9 }
    const raw = [first, second, { n: 3 }, tail]
    const handler = {
        armed: false, hits: 0, cause: fresh ? undefined : new Error('prebuilt storage refusal'),
        set(target, key, value, receiver) {
            if (this.armed && key === (method === 'fill' ? '1' : '2')) {
                this.hits++
                this.cause ??= new Error('fresh storage refusal')
                throw this.cause // This primitive write has changed no storage.
            }
            return Reflect.set(target, key, value, receiver)
        },
    }
    const source = new Proxy(raw, handler), root = { array: source }
    const chain = new r.Chain(root, ctx)
    if (indexed) assert.equal(r.hasError(chain, [], ctx), false)
    const sourceRefs = [raw, source, root, tail].map(value => new WeakRef(value))
    const selectedRefs = (method === 'fill' ? [payload] : [first, second]).map(value => new WeakRef(value))
    handler.armed = fails
    let poison = r.run(chain, ['array'], method,
        method === 'fill' ? [payload, 0, 2] : [1, 0, 2], ctx, { mutationScopeDepth: 1 })
    handler.armed = false
    if (fails) {
        assert(r.isPoisonError(poison))
        assert.equal(poison.cause, handler.cause)
        assert.equal(poison.errorContext, label)
        assert.equal(handler.hits, 1)
    } else poison = undefined
    if (!live) r.assignPath(chain, [], null, ctx)
    assert.equal(ctx.execution.fatalError, null)
    return { label, ctx, chain, poison, sourceRefs, selectedRefs, live }
}

const rows = []
for (const method of ['fill', 'copyWithin']) {
    for (const fresh of [false, true]) for (const indexed of [false, true])
        rows.push(issue(method, fresh, indexed, true))
    rows.push(issue(method, true, false, false), issue(method, true, false, false, true))
}
if (formatStacks) for (const row of rows) if (row.poison) {
    void row.poison.stack
    void row.poison.cause.stack
}
for (let turn = 0; turn < 20; turn++) { await new Promise(setImmediate); globalThis.gc() }
const failures = []
for (const row of rows) {
    for (const weak of row.sourceRefs)
        assert.equal(weak.deref() !== undefined, row.live, `${row.label}: source lifetime control`)
    for (let index = 0; index < row.selectedRefs.length; index++) {
        const present = row.selectedRefs[index].deref() !== undefined
        if (row.live) assert(present, `${row.label}: retained value control`)
        else if (present) failures.push({ case: row.label, selectedValue: index })
    }
}
console.log(JSON.stringify({ cases: rows.length, liveControls: 2, formatStacks, failures }))
assert.deepEqual(failures, [], 'Failed range construction retained spent selected values')
