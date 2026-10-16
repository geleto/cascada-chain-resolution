import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { metaOf } from "../src/meta.js"
import { lengthNotificationCount } from "./support.js"

const context = () => ({ execution: new r.Execution(), errorContext: "captured shape" })
const tick = () => new Promise(setImmediate)
const readers = {
    export: (source, ctx) => r.export(source, ["b"], ctx),
    join: (source, ctx) => r.run(source, ["b"], "join", [], ctx, {}),
    toString: (source, ctx) => r.run(source, ["b"], "toString", [], ctx, {}),
    sort: (source, ctx) => r.run(source, ["b"], "sort", [], ctx, {}),
    toSorted: (source, ctx) => r.run(source, ["b"], "toSorted", [], ctx, {}),
    receiver: (source, ctx) => r.run(new r.Chain({ data: r.lookupPath(source, ["b"], ctx),
        read() { return this.data } }, ctx), [], "read", [], ctx, {}),
}

describe("captured Array shape", () => {
    for (const mode of ["native", "ordered"]) for (const scope of [0, 1])
    for (const created of [false, true]) for (const [reader, read] of Object.entries(readers))
    it(`finishes deleted growth independently: ${reader}, ${mode}, scope=${scope}, created=${created}`, async () => {
        const ctx = context(), source = new r.Chain({ b: [1, , 3] }, ctx)
        const signal = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
        const gate = signal.promise ?? signal
        // The deleted payload never settles. Only creation affects final shape.
        const entry = r.enter(source, ["b", 5], ctx, true, inside => gate.then(() => {
            if (created) r.assignPath(inside, [], new Promise(() => {}), ctx)
        }))
        r.deletePath(source, ["b", 5], ctx, scope)
        assert.equal(r.lookupPath(source, ["b", 5], ctx), undefined)
        assert.equal(r.run(source, ["b"], "includes", [3], ctx, {}), true)
        const output = read(source, ctx)
        let settled = false
        Promise.resolve(output).then(() => { settled = true })
        await tick()
        assert.equal(settled, false)
        // Neither the later value nor its larger length belongs to the capture.
        r.assignPath(source, ["b", 0], 9, ctx)
        r.assignPath(source, ["b", 9], 9, ctx)
        signal.resolve()
        await entry
        const expected = [1, , 3]
        if (created) expected.length = 6
        const actual = await output
        assert.deepEqual(actual, reader === "join" || reader === "toString" ? expected.join()
            : reader === "sort" ? expected.sort() : reader === "toSorted" ? expected.toSorted() : expected)
        const current = await r.export(source, ["b"], ctx)
        assert.equal(current.length, 10)
        assert.equal(current[0], 9)
        assert.equal(current[9], 9)
        assert.equal(5 in current, false)
        assert.equal(ctx.execution.fatalError, null)
        verifyRefCounts(ctx, source._state)
    })

    for (const depth of [0, 1, 2, Infinity])
    it(`flat ignores unresolved trailing holes at flattened levels: depth=${depth}`, async () => {
        const ctx = context(), source = new r.Chain({ b: [1, , [2, , 3]] }, ctx)
        const hold = Promise.withResolvers()
        const entry = r.enter(source, ["b", 5], ctx, true, () => hold.promise)
        r.deletePath(source, ["b", 5], ctx, 1)
        const output = r.run(source, ["b"], "flat", [depth], ctx, {})
        try {
            assert(!(output instanceof Promise))
            assert.deepEqual(r.export(new r.Chain(output, ctx), [], ctx), [1, , [2, , 3]].flat(depth))
        } finally { hold.resolve(); await entry }
    })

    for (const reader of ["export", "receiver", "arguments", "join", "sort"])
    it(`collects required Errors without discarded shape: ${reader}`, async () => {
        const ctx = context(), hold = Promise.withResolvers(), later = Promise.withResolvers()
        const first = r.validationError("first", ctx), second = r.validationError("second", ctx)
        const source = new r.Chain({ b: [first, later.promise] }, ctx)
        const entry = r.enter(source, ["b", 5], ctx, true, () => hold.promise)
        r.deletePath(source, ["b", 5], ctx, 1)
        let called = false
        const data = r.lookupPath(source, ["b"], ctx)
        const growth = metaOf(data, ctx).arrayRange.lengthState.head.source
        const receiver = new r.Chain({ data: reader === "receiver" ? data : null,
            read() { called = true } }, ctx)
        const result = reader === "arguments" ? r.run(receiver, [], "read", [data], ctx, {})
            : reader === "receiver" ? r.run(receiver, [], "read", [], ctx, {}) : readers[reader](source, ctx)
        let settled = false
        Promise.resolve(result).then(() => { settled = true })
        await tick()
        assert.equal(settled, false, "The later Error is required")
        later.resolve(second)
        try {
            const failure = await result
            assert.deepEqual(new Set(failure.errors), new Set([first, second]))
            assert.equal(called, false)
            assert.equal(lengthNotificationCount(growth), 0, "Discarded output releases its shape question")
            assert.equal(ctx.execution.fatalError, null)
        } finally { hold.resolve(); await entry }
    })
})
