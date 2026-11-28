import assert from "node:assert/strict"
import * as r from "../../src/index.js"

const streaming = [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]

async function closedWindowPulls() {
    const ctx = { execution: new r.Execution(), errorContext: "closed window" }
    const source = new r.Chain(["A", "B", "optional"], ctx, r.CHAIN_MODE.Unordered)
    const width = Promise.withResolvers(), starts = []
    const mutate = { mutationScopeDepth: 0 }
    r.run(source, [], "splice", [2, width.promise], ctx, mutate)
    for (let i = 0; i < 12; i++) {
        const start = Promise.withResolvers()
        starts.push(start)
        r.run(source, [], "splice", [start.promise, 0, i], ctx, mutate)
    }
    r.run(source, [], "push", ["tail"], ctx, mutate)
    async function close(pull) {
        const cursor = r.iterate(source, [], ctx, { windowEnd: 3, metadata: ["index0"] })
        const ref = new WeakRef(cursor), result = pull && cursor.next()
        await cursor.return()
        return { ref, result }
    }
    async function collect() {
        for (let turn = 0; turn < 6; turn++) { await new Promise(setImmediate); global.gc() }
    }
    const idle = await close(false), pending = await close(true)
    let delivered = false
    pending.result.then(() => { delivered = true })
    await collect()
    assert.equal(idle.ref.deref(), undefined)
    assert.equal(delivered, false)
    for (const start of starts) start.resolve(0)
    const step = await pending.result
    const index = await step.metadata.index0
    assert(index >= 0 && index < 3)
    assert.equal(await r.lookupPath(step.value, [], ctx), starts.length - 1 - index)
    await collect()
    assert.equal(pending.ref.deref(), undefined)
    width.resolve(0)
}
await closedWindowPulls()

async function pendingPull(mode, keepSnapshot, close) {
    const ctx = { execution: new r.Execution(), errorContext: "pending cursor" }
    const tail = Promise.withResolvers(), prefix = [{ n: 1 }, { n: 2 }]
    const refs = prefix.map(value => new WeakRef(value))
    const wrap = value => new r.Chain(value, ctx, mode)
    const source = wrap(r.run(wrap(prefix), [], "concat", [tail.promise], ctx, {}))
    const snapshot = keepSnapshot && r.capturePath(source, [], ctx)
    const cursor = r.iterate(source, [], ctx, { metadata: ["index0", "last"] })
    for (let i = 0; i < prefix.length; i++) {
        const item = await cursor.next()
        assert.equal(item.metadata.index0, i)
        r.assignPath(item.value, [], null, ctx)
    }
    const pull = cursor.next()
    if (close) assert((await cursor.return()).done)
    r.assignPath(source, [], null, ctx)
    return { refs, tail, pull, snapshot, ctx }
}

function pendingSplice(mode, method, keep) {
    const ctx = { execution: new r.Execution(), errorContext: "pending splice" }
    const values = [{ n: 0 }, { n: 1 }, { n: 2 }], refs = values.map(value => new WeakRef(value))
    const chain = new r.Chain(values, ctx, mode), cut = Promise.withResolvers()
    const facts = method === "splice" ? { mutationScopeDepth: 0 } : {}
    const result = new r.Chain(r.run(chain, [], method, [2, cut.promise], ctx, facts), ctx, mode)
    r.assignPath(chain, [], null, ctx)
    assert.equal(r.lookupPath(chain, [], ctx), null)
    if (!keep) {
        r.assignPath(result, [], null, ctx)
        assert.equal(r.lookupPath(result, [], ctx), null)
    }
    return { refs, ctx, result, cut, method, keep }
}

function pendingFill(mode) {
    const ctx = { execution: new r.Execution(), errorContext: "fill result" }, end = Promise.withResolvers()
    const values = Array.from({ length: 4 }, (_, n) => ({ n })), refs = values.map(v => new WeakRef(v))
    const owner = new r.Chain(values, ctx, mode)
    const pending = r.run(owner, [], "fill", ["X", 3, end.promise], ctx, { mutationScopeDepth: 0 })
    const result = new r.Chain(pending, ctx, mode)
    r.assignPath(owner, [], null, ctx)
    return { ctx, end, refs, result }
}

function closedSplicePoint(mode, keepSnapshot, startValue, segmented) {
    const ctx = { execution: new r.Execution(), errorContext: "closed splice point" }
    const values = [{ n: 0 }, { n: 1 }, { n: 2 }], refs = values.map(value => new WeakRef(value))
    const source = new r.Chain(values, ctx, r.CHAIN_MODE.Sequential), start = Promise.withResolvers()
    const tail = new Promise(() => {})
    const captured = segmented ? new r.Chain(r.run(source, [], "concat", [tail], ctx, {}), ctx, r.CHAIN_MODE.Sequential) : source
    const output = new r.Chain(r.run(captured, [], "toSpliced", [start.promise, 1, "X"], ctx, {}), ctx, mode)
    const snapshot = keepSnapshot && r.capturePath(output, [], ctx)
    const cursor = r.iterate(output, [], ctx, { metadata: ["last"] })
    const pull = cursor.next()
    const closed = cursor.return()
    r.assignPath(captured, [], null, ctx)
    r.assignPath(source, [], null, ctx)
    r.assignPath(output, [], null, ctx)
    return { ctx, refs, start, startValue, snapshot, pull, closed, tail }
}

function readSplicePoint(name, startValue) {
    const ctx = { execution: new r.Execution(), errorContext: name }
    const values = [{ n: 0 }, { n: 1 }, { n: 2 }], refs = values.map(value => new WeakRef(value))
    const source = new r.Chain(values, ctx, r.CHAIN_MODE.Sequential), start = Promise.withResolvers()
    const output = new r.Chain(r.run(source, [], "toSpliced", [start.promise, 1, "X"], ctx, {}), ctx, r.CHAIN_MODE.Sequential)
    let selected
    if (name === "lookup") selected = r.lookupPath(output, [0], ctx)
    else if (name === "export") selected = r.export(output, [0], ctx)
    else if (name === "errors") selected = r.getErrors(output, [0], ctx)
    else if (name === "capture") selected = r.lookupPath(r.capturePath(output, [0], ctx), [], ctx)
    else selected = r.run(output, [], "at", [name === "last" ? -1 : 0], ctx, {})
    r.assignPath(source, [], null, ctx)
    r.assignPath(output, [], null, ctx)
    return { ctx, name, refs, selected, start, startValue }
}

function interiorSplicePoint(back, count, keep, startValue) {
    const ctx = { execution: new r.Execution(), errorContext: "segmented interior splice point" }
    const wrap = value => new r.Chain(value, ctx, r.CHAIN_MODE.Sequential)
    const values = Array.from({ length: 6 }, (_, n) => ({ n })), refs = values.map(value => new WeakRef(value))
    const known = wrap(values), open = Promise.withResolvers(), start = Promise.withResolvers()
    const variable = wrap(r.run(wrap(["?"]), [], "slice", [0, open.promise], ctx, {}))
    const input = back ? wrap(r.run(variable, [], "concat", [values], ctx, {})) :
        wrap(r.run(known, [], "concat", [r.lookupPath(variable, [], ctx)], ctx, {}))
    const output = wrap(r.run(input, [], "toSpliced", [start.promise, count, "X"], ctx, {}))
    const snapshot = keep && r.capturePath(output, [], ctx)
    const selected = back ? r.run(output, [], "at", [-2], ctx, {}) : r.lookupPath(output, [1], ctx)
    for (const holder of [known, variable, input, output]) r.assignPath(holder, [], null, ctx)
    return { ctx, refs, selected, snapshot, start, startValue, open, back, count }
}

async function failedRange(mode, method) {
    const ctx = { execution: new r.Execution(), errorContext: method }
    const values = [{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }], refs = values.map(v => new WeakRef(v))
    const chain = new r.Chain(values, ctx, mode), cut = Promise.withResolvers()
    const args = method === "splice" ? [2, cut.promise, "X"] : method === "fill" ? ["X", 2, cut.promise] : [2, 0, cut.promise]
    const result = r.run(chain, [], method, args, ctx, { mutationScopeDepth: 0 })
    cut.reject(new Error("count"))
    const failure = await result
    assert(r.isPoisonError(failure))
    assert.equal(await r.getErrors(chain, [], ctx), failure)
    return { refs, ctx, chain, failure, mode }
}

const pulls = await Promise.all(streaming.flatMap(mode => [false, true].flatMap(keep =>
    [false, true].map(close => pendingPull(mode, keep, close)))))
const failed = await Promise.all(Object.values(r.CHAIN_MODE).flatMap(mode =>
    ["splice", "fill", "copyWithin"].map(method => failedRange(mode, method))))
const pending = streaming.flatMap(mode => ["splice", "toSpliced"].flatMap(method =>
    [pendingSplice(mode, method, true), pendingSplice(mode, method, false)]))
const fills = Object.values(r.CHAIN_MODE).map(pendingFill)
const closedPoints = [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Complete].flatMap(mode =>
    [false, true].flatMap(held => [0, 1].flatMap(start => [false, true].map(segmented => closedSplicePoint(mode, held, start, segmented)))))
const observedPoints = ["lookup", "export", "errors", "capture", "first", "last"].flatMap(name =>
    [0, 3, undefined].map(start => readSplicePoint(name, start)))
const interiorPoints = [false, true].flatMap(back => [0, 1, 2].flatMap(count =>
    [false, true].map(keep => interiorSplicePoint(back, count, keep, back ? -2 : 1))))
for (let i = 0; i < 20; i++) { await new Promise(setImmediate); global.gc() }
for (const { refs, snapshot, tail, pull, ctx } of pulls) {
    for (const ref of refs) assert.equal(Boolean(ref.deref()), Boolean(snapshot))
    tail.resolve(["last"])
    const item = await pull
    assert.equal(await r.lookupPath(item.value, [], ctx), "last")
    assert.equal(await item.metadata.index0, 2)
    assert.equal(await item.metadata.last, true)
}
for (const { refs, ctx, chain, mode } of failed) {
    const rollback = mode === r.CHAIN_MODE.Complete
    assert.deepEqual(refs.map(ref => Boolean(ref.deref())), [true, true, rollback, rollback])
    if (rollback) {
        r.repairPath(chain, [], ctx)
        assert.deepEqual(r.export(chain, [], ctx), [0, 1, 2, 3].map(n => ({ n })))
    }
}
for (const { refs, ctx, result, cut, method, keep } of pending) {
    const prefixRetained = keep && method === "toSpliced"
    assert.deepEqual(refs.slice(0, 2).map(ref => Boolean(ref.deref())), [prefixRetained, prefixRetained])
    cut.resolve(1)
    assert.deepEqual(await r.export(result, [], ctx), !keep ? null : method === "splice" ? [{ n: 2 }] : [{ n: 0 }, { n: 1 }])
}
for (const { ctx, end, refs, result } of fills) {
    assert(refs.every(ref => ref.deref()))
    end.resolve(3)
    assert.deepEqual(await r.export(result, [], ctx), [0, 1, 2, 3].map(n => ({ n })))
}
for (const { ctx, refs, start, startValue, snapshot, pull, closed } of closedPoints) {
    assert((await closed).done)
    assert.deepEqual(refs.map(ref => Boolean(ref.deref())), [true, Boolean(snapshot), Boolean(snapshot)])
    start.resolve(startValue)
    const item = await pull
    assert.equal(item.done, false)
    assert.equal(await item.metadata.last, false)
    assert.deepEqual(await r.export(item.value, [], ctx), startValue ? { n: 0 } : "X")
}
for (const { ctx, name, refs, start, startValue, selected } of observedPoints) {
    const last = name === "last"
    assert.deepEqual(refs.map(ref => Boolean(ref.deref())), [!last, false, last], name)
    if (startValue === undefined) {
        const failure = r.validationError("start", ctx, r.ERROR_KIND.OperationInputFailed)
        start.reject(failure)
        assert.equal(await selected, failure)
    } else {
        start.resolve(startValue)
        const expected = name === "errors" ? null : last ? (startValue === 0 ? { n: 2 } : "X") :
            startValue === 0 ? "X" : { n: 0 }
        assert.deepEqual(await selected, expected)
    }
}

for (const { ctx, refs, selected, snapshot, start, startValue, open, back, count } of interiorPoints) {
    // From the front a clipped deletion leaves no old suffix. From the
    // rear it can shift the opposite candidate by any count up to the cut.
    const expected = refs.map((_, index) => Boolean(snapshot) || (back ?
        index === 4 || index >= 5 - count : index === 1 || index === count))
    assert.deepEqual(refs.map(ref => Boolean(ref.deref())), expected, `interior candidates ${back}/${count}`)
    start.resolve(startValue)
    const native = Array.from({ length: 6 }, (_, n) => ({ n })).toSpliced(startValue, count, "X")
    assert.deepEqual(await selected, native.at(back ? -2 : 1))
    open.resolve(0)
    if (snapshot) assert.deepEqual(await r.export(snapshot, [], ctx), native)
}
