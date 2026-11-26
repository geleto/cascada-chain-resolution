import assert from "node:assert/strict"
import * as r from "../../src/index.js"

const streaming = [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]

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
