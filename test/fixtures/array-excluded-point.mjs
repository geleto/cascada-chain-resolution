import assert from "node:assert/strict"
import * as r from "../../src/index.js"

const streams = [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]
function issue(method, mode, route, snapshot) {
    const ctx = { execution: new r.Execution(), errorContext: method }
    const wrap = value => new r.Chain(value, ctx, mode)
    const count = Promise.withResolvers(), tail = Promise.withResolvers()
    const x = { id: "X" }, y = { id: "Y" }
    const raw = method === "concat" ? [x] : method === "join then splice" ? ["A", x] : ["A", x, y]
    const source = wrap(r.import(raw, ctx)), saved = snapshot && r.capturePath(source, [], ctx, mode)
    const joined = method === "splice" ? source : wrap(r.run(source, [], "concat", [tail.promise], ctx, {}))
    const result = method === "concat" ? joined : wrap(r.run(joined, [], "toSpliced", [1, count.promise], ctx, {}))
    const index = method === "concat" ? 1 : 2
    const point = route === "capture" ? r.capturePath(result, [index], ctx, mode) :
        wrap(route === "lookup" ? r.lookupPath(result, [index], ctx) : r.run(result, [], "at", [index], ctx, {}))
    const other = wrap(y)
    for (const h of new Set([source, joined, result])) r.assignPath(h, [], undefined, ctx)
    return { count, tail, ctx, saved, point, x: new WeakRef(x), other }
}

const cases = []
for (const mode of streams) for (const method of ["concat", "splice", "join then splice"])
for (const route of ["at", "lookup", "capture"]) for (const snapshot of [false, true])
    cases.push({ mode, method, route, snapshot, ...issue(method, mode, route, snapshot) })
for (let i = 0; i < 6; ++i) { await new Promise(setImmediate); global.gc() }
const retained = []
for (const { mode, method, route, snapshot, count, tail, ctx, saved, point, x, other } of cases) {
    if (Boolean(x.deref()) !== snapshot) retained.push([method, route, mode, snapshot])
    if (saved) assert.equal(r.lookupPath(saved, [method === "concat" ? 0 : 1], ctx), x.deref())
    tail.resolve([r.lookupPath(other, [], ctx)])
    await new Promise(setImmediate)
    r.assignPath(other, ["id"], "changed", ctx)
    count.resolve(0)
    assert.equal(await r.lookupPath(point, ["id"], ctx), "Y")
}
assert.deepEqual(retained, [], "excluded point candidates while controls are open")
console.log(cases.length + " excluded-child and live-snapshot cases")
