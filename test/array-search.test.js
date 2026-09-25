import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { hasReadLease, metaOf } from "../src/meta.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { ready } from "./ordered-thenable.js"

const context = () => ({ execution: new r.Execution(), errorContext: {} })
const tick = () => new Promise(resolve => setImmediate(resolve))

describe("Array searches with unfinished growth", () => {
    it("reads each immediate includes value once, including holes", () => {
        const ctx = context(), reads = new Map()
        const source = new Proxy([0, , 2], {
            getOwnPropertyDescriptor(target, key) {
                reads.set(key, (reads.get(key) ?? 0) + 1)
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        const chain = new r.Chain(source, ctx)
        reads.clear()
        assert.equal(r.run(chain, [], "includes", [9], ctx, {}), false)
        for (const key of ["0", "1", "2"]) assert.equal(reads.get(key), 1)
        assert.equal(r.run(chain, [], "includes", [undefined], ctx, {}), true)
        verifyRefCounts(ctx, chain._state)
    })

    for (const method of ["indexOf", "lastIndexOf"]) {
        it(`${method} uses captured absence after an entry deletes its element`, async () => {
            const ctx = context(), hold = Promise.withResolvers()
            let refuses = false
            const chain = new r.Chain(new Proxy([0], {
                getOwnPropertyDescriptor(target, key) {
                    if (refuses && key === "0") throw new Error("Captured placement was read again")
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            }), ctx)
            const entry = r.enter(chain, [0], ctx, true, inside => hold.promise.then(() => {
                r.deletePath(inside, [], ctx)
                refuses = true
            }))
            const result = r.run(chain, [], method, [undefined], ctx, {})
            hold.resolve()
            assert.equal(await result, -1)
            await entry
            assert.equal(ctx.execution.fatalError, null)
            refuses = false
            verifyRefCounts(ctx, chain._state)
        })
    }

    const prefixCases = [
        ["includes", [0]], ["includes", [2, 1]], ["includes", [undefined]],
        ["includes", [NaN]], ["includes", [0, -Infinity]],
        ["indexOf", [0]], ["indexOf", [2, 1]],
        ["lastIndexOf", [0, 2]], ["lastIndexOf", [2, 2]],
        ["lastIndexOf", [undefined, 2]], ["lastIndexOf", [9, 2]],
    ]
    for (const [method, args] of prefixCases) for (const delivery of ["ready", "synchronous", "pending"]) {
        it(`${method}(${args}) completes from the prefix with ${delivery} arguments`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), argument = Promise.withResolvers()
            const source = [0, , 2, NaN], chain = new r.Chain(source, ctx)
            const entry = r.enter(chain, [8], ctx, true, () => hold.promise)
            const expected = source[method](...args)
            const inputs = delivery === "ready" ? args : delivery === "synchronous" ? args.map(ready)
                : args.map(value => argument.promise.then(() => value))
            const result = r.run(chain, [], method, inputs, ctx, {})
            try {
                if (delivery === "pending") {
                    let outcome
                    result.then(value => { outcome = value })
                    argument.resolve()
                    await tick()
                    assert.equal(outcome, expected)
                } else assert.equal(result, expected)
            } finally { hold.resolve() }
            await entry
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const method of ["includes", "indexOf"]) for (const from of [0, 4]) {
        it(`${method} from ${from} reaches a new prefix without waiting for further growth`, async () => {
            const ctx = context(), first = Promise.withResolvers(), last = Promise.withResolvers()
            const chain = new r.Chain([0], ctx)
            const entries = [
                r.enter(chain, [5], ctx, true, inside => first.promise.then(() => r.assignPath(inside, [], 7, ctx))),
                r.enter(chain, [9], ctx, true, () => last.promise),
            ]
            const result = r.run(chain, [], method, [7, from], ctx, {})
            let outcome
            result.then(value => { outcome = value })
            // Later writes must neither supply a match nor change the captured range.
            r.assignPath(chain, [0], 7, ctx)
            r.assignPath(chain, [12], 7, ctx)
            try {
                await tick()
                assert.equal(outcome, undefined)
                first.resolve()
                await tick()
                assert.equal(outcome, method === "includes" ? true : 5)
            } finally { first.resolve(); last.resolve() }
            await Promise.all(entries)
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const method of ["includes", "indexOf", "lastIndexOf"]) {
        it(`${method} excludes later replacements and growth from an unsuccessful search`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), chain = new r.Chain([0], ctx)
            const entry = r.enter(chain, [5], ctx, true, () => hold.promise)
            const result = r.run(chain, [], method, [7], ctx, {})
            r.assignPath(chain, [0], 7, ctx)
            r.assignPath(chain, [9], 7, ctx)
            let outcome
            result.then(value => { outcome = value })
            await tick()
            assert.equal(outcome, undefined)
            hold.resolve()
            await entry
            assert.equal(await result, method === "includes" ? false : -1)
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("includes can match a pending prefix value before growth resolves and releases its length question", async () => {
        const ctx = context(), value = Promise.withResolvers(), hold = Promise.withResolvers()
        const chain = new r.Chain([value.promise], ctx)
        const entry = r.enter(chain, [5], ctx, true, () => hold.promise)
        const receiver = chain._state.value, length = metaOf(receiver, ctx).arrayView._lengthState
        const source = length.head.source
        const result = r.run(chain, [], "includes", [7], ctx, {})
        let outcome
        result.then(value => { outcome = value })
        assert(source.nodes.size > 0)
        try {
            value.resolve(7)
            await tick()
            assert.equal(outcome, true)
            assert.equal(source.nodes.size, 0)
            assert.equal(hasReadLease(receiver, ctx), false)
        } finally { hold.resolve() }
        await entry
        verifyRefCounts(ctx, chain._state)
    })

    it("releases includes' receiver after growth is decided even while captured comparisons are pending", async () => {
        const ctx = context(), value = Promise.withResolvers(), hold = Promise.withResolvers()
        const chain = new r.Chain([value.promise, 2], ctx)
        const entry = r.enter(chain, [5], ctx, true, () => hold.promise)
        const receiver = chain._state.value
        const result = r.run(chain, [], "includes", [7], ctx, {})
        hold.resolve()
        await entry
        await tick()
        assert.equal(hasReadLease(receiver, ctx), false)
        r.assignPath(chain, [1], 7, ctx)
        assert.equal(chain._state.value, receiver)
        value.resolve(0)
        assert.equal(await result, false)
        verifyRefCounts(ctx, chain._state)
    })

    it("distinguishes a newly in-range hole from a present undefined behind an open entry", async () => {
        const ctx = context(), create = Promise.withResolvers(), close = Promise.withResolvers()
        const chain = new r.Chain([0], ctx)
        const entry = r.enter(chain, [5], ctx, true, inside => create.promise.then(() => {
            r.assignPath(inside, [], undefined, ctx)
            return close.promise
        }))
        let included, index
        const includes = r.run(chain, [], "includes", [undefined], ctx, {})
        const indexOf = r.run(chain, [], "indexOf", [undefined], ctx, {})
        includes.then(value => { included = value })
        indexOf.then(value => { index = value })
        try {
            await tick()
            assert.equal(included, undefined)
            create.resolve()
            await tick()
            assert.equal(included, true)
            assert.equal(index, undefined)
        } finally { create.resolve(); close.resolve() }
        await entry
        assert.equal(await indexOf, 5)
        verifyRefCounts(ctx, chain._state)
    })

    for (const [method, args, expected] of [
        ["indexOf", [2], 1], ["lastIndexOf", [0], 5],
        ["includes", [0, -1], true], ["indexOf", [0, -1], 5],
    ]) {
        it(`${method}(${args}) still waits for values or relative bounds that can change its answer`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), first = Promise.withResolvers()
            const chain = new r.Chain([first.promise, 2], ctx)
            const entry = r.enter(chain, [5], ctx, true, inside => hold.promise.then(() => r.assignPath(inside, [], 0, ctx)))
            const result = r.run(chain, [], method, args, ctx, {})
            let outcome
            result.then(value => { outcome = value })
            await tick()
            assert.equal(outcome, undefined)
            hold.resolve()
            first.resolve(0)
            await entry
            assert.equal(await result, expected)
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const method of ["includes", "indexOf"]) {
        it(`${method} attributes reflection failure after growth resumes the scan`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), cause = new Error("tail descriptor")
            let fail = false
            const receiver = new Proxy([0], {
                getOwnPropertyDescriptor(target, key) {
                    if (fail && key === "2") throw cause
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const chain = new r.Chain(receiver, ctx)
            const entry = r.enter(chain, [5], ctx, true, inside => hold.promise.then(() => r.assignPath(inside, [], 7, ctx)))
            const result = r.run(chain, [], method, [7], ctx, {})
            fail = true
            hold.resolve()
            await entry
            const failure = await result
            assert.equal(failure.cause, cause)
            assert.equal(failure.kind, r.ERROR_KIND.InvocationFailed)
            assert.equal(failure.errorContext, ctx.errorContext)
            assert.equal(ctx.execution.fatalError, null)
            fail = false
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const representation of ["imported", "view"]) for (const method of ["includes", "indexOf", "lastIndexOf"]) {
        it(`${method} uses a bounded ${representation} prefix and preserves the original`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), source = [99, 0, , 2, 99]
            const imported = r.import(source, ctx)
            const initial = representation === "view"
                ? r.run(new r.Chain(imported, ctx), [], "slice", [1, 4], ctx, {}) : imported
            const chain = new r.Chain(initial, ctx), foundAt = representation === "view" ? 2 : 3
            const entry = r.enter(chain, [8], ctx, true, () => hold.promise)
            try {
                assert.equal(r.run(chain, [], method, [2, method === "lastIndexOf" ? foundAt : 0], ctx, {}),
                    method === "includes" ? true : foundAt)
            } finally { hold.resolve() }
            await entry
            assert.deepEqual(source, [99, 0, , 2, 99])
            verifyRefCounts(ctx, chain._state)
        })
    }
})
