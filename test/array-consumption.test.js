import assert from "node:assert/strict"
import * as r from "cascada-chain-resolution"
import { ready, OrderedThenable, ChainedThenable } from "./ordered-thenable.js"

describe("Array consumption across suspension", () => {
    for (const method of ["includes", "indexOf", "lastIndexOf"]) {
        it(`captures the bound before later mutation while the search key is pending: ${method}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "search input order" }
            const pending = new ChainedThenable()
            const bound = new r.Chain([0], ctx)
            const result = r.run(new r.Chain([1, 0, 1], ctx), [], method,
                [pending, r.lookupPath(bound, [], ctx)], ctx, {})
            r.assignPath(bound, [0], 3, ctx)
            pending.resolve(1)
            assert.equal(await result, method === "includes" ? true : 0)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    async function inspect(method, delivery, mutation = false) {
        const ctx = { execution: new r.Execution(), errorContext: "Array consumption order" }
        const make = value => r.lookupPath(new r.Chain([value], ctx), [], ctx)
        const first = make(method === "slice" ? 0 : "first")
        const second = make(method === "slice" ? 2 : "second")
        const gate = delivery === "ordered" ? new OrderedThenable() : Promise.withResolvers()
        const input = delivery === "ready" ? first : delivery === "synchronous" ? ready(first) : gate.promise ?? gate
        const sorting = method === "sort" || method === "toSorted"
        const root = new r.Chain(method === "slice" ? [0, 1, 2] : sorting ? [[input], [second]] : [input, second], ctx)
        const result = r.run(root, [], method, method === "slice" ? [[input], second] : [], ctx,
            mutation ? { mutationScopeDepth: 0 } : {})
        const pending = delivery === "native" || delivery === "ordered"
        assert.equal(r.isPending(result, ctx), pending)
        if (pending) {
            gate.resolve(first)
        }
        const value = await result
        const output = await r.export(new r.Chain(value, ctx), [], ctx)
        assert.deepEqual(output, method === "slice" ? [0, 1] : method === "flat" ? ["first", "second"]
            : sorting ? [[["first"]], [["second"]]] : "first,second")
        assert.equal(ctx.execution.fatalError, null)
        return output
    }

    for (const method of ["flat", "join", "toString", "sort", "toSorted", "slice"])
    for (const delivery of ["synchronous", "native", "ordered"]) {
        it(`matches the all-ready result: ${method}, ${delivery}`, async () => {
            assert.deepEqual(await inspect(method, delivery), await inspect(method, "ready"))
        })
    }
    for (const delivery of ["native", "ordered"]) {
        it(`matches the all-ready sort mutation: ${delivery}`, async () => {
            assert.deepEqual(await inspect("sort", delivery, true), await inspect("sort", "ready", true))
        })
    }

    for (const method of ["flat", "join", "toSorted"])
    for (const failed of [false, true]) {
        it(`protects captured values across later mutation: ${method}, failed=${failed}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "unread Array input" }
            const pause = Promise.withResolvers()
            const second = new r.Chain(["original"], ctx)
            const cause = new Error("earlier input")
            const input = [pause.promise, r.lookupPath(second, [], ctx)]
            const root = new r.Chain(method === "toSorted" ? input.map(value => [value]) : input, ctx)
            const result = r.run(root, [], method, [], ctx, {})
            r.assignPath(second, [0], "changed", ctx)
            r.assignPath(root, [1], ["replacement"], ctx)
            if (failed) pause.reject(cause)
            else pause.resolve(["first"])
            const output = await result
            if (failed) assert.equal((method === "flat"
                ? await r.export(new r.Chain(output, ctx), [], ctx) : output).cause, cause)
            else assert.deepEqual(await r.export(new r.Chain(output, ctx), [], ctx),
                method === "flat" ? ["first", "original"] : method === "join" ? "first,original"
                    : [[["first"]], [["original"]]])
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const method of ["flat", "join", "toSorted"]) {
        it(`collects later required poison after failure: ${method}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "ordered Array failures" }
            const pause = Promise.withResolvers(), later = Promise.withResolvers()
            const causes = [new Error("first"), new Error("reflection"), new Error("last")]
            let armed = false
            const unreadableArray = cause => r.lookupPath(new r.Chain(new Proxy([], {
                ownKeys() { if (armed) throw cause; return ["length"] },
            }), ctx), [], ctx)
            const unreadable = unreadableArray(causes[1])
            const first = method === "flat" ? unreadableArray(causes[0]) : undefined
            const last = method === "flat" ? unreadableArray(causes[2]) : undefined
            const inputs = [pause.promise, unreadable, later.promise]
            const root = new r.Chain(method === "toSorted" ? inputs.map(value => [value]) : inputs, ctx)
            armed = true
            const result = r.run(root, [], method, [], ctx, {})
            if (method === "flat") { later.resolve(last); pause.resolve(first) }
            else { later.reject(causes[2]); pause.reject(causes[0]) }
            const poison = await result
            assert.deepEqual(new Set(poison.errors.map(error => error.cause)), new Set(causes))
            assert.equal(ctx.execution.fatalError, null)
        })
    }
})
