import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new r.Execution(), errorContext: "representation identity" })

class Receiver {
    self() { return this }
    selected() { return this.child }
    wrapped() { return { a: this.child, b: this.child, owner: this } }
}
r.managedStateClass(Receiver)

describe("native observation representation identity", () => {
    for (const klass of [false, true]) for (const imported of [false, true])
    for (const delivery of ["ready", "synchronous", "pending", "native"])
    for (const method of ["self", "selected", "wrapped"]) {
        it(`preserves identity: class=${klass}, imported=${imported}, ${delivery}, ${method}`, async () => {
            const ctx = context(), pending = delivery === "native" ? Promise.withResolvers() : new OrderedThenable()
            if (delivery === "synchronous") pending.resolve(1)
            const child = { k: delivery === "ready" ? 1 : pending.promise ?? pending }
            const input = Object.assign(klass ? new Receiver() : {
                self: Receiver.prototype.self, selected: Receiver.prototype.selected, wrapped: Receiver.prototype.wrapped,
            }, { child })
            input.cycle = input
            const source = new r.Chain(imported ? r.import(input, ctx) : input, ctx)
            const held = new r.Chain([r.lookupPath(source, [], ctx), r.lookupPath(source, ["child"], ctx)], ctx)
            const result = new r.Chain(r.run(source, [], method, [], ctx, {}), ctx)
            const selectedPath = method === "wrapped" ? ["a"] : []
            const comparisons = ["includes", "indexOf", "lastIndexOf"].map(search =>
                r.run(held, [], search, [r.lookupPath(result, selectedPath, ctx)], ctx, {}))
            const combined = new r.Chain({ original: r.lookupPath(source, method === "self" ? [] : ["child"], ctx),
                returned: r.lookupPath(result, selectedPath, ctx) }, ctx)
            const exported = r.export(combined, [], ctx)
            if (delivery === "pending" || delivery === "native") pending.resolve(1)
            assert.deepEqual(await Promise.all(comparisons), [true, method === "self" ? 0 : 1, method === "self" ? 0 : 1])
            const output = await exported
            assert.equal(output.original, output.returned)
            if (method === "self") assert.equal(output.original.cycle, output.original)
            if (method === "wrapped") {
                const wrapped = await r.export(result, [], ctx)
                assert.equal(wrapped.a, wrapped.b)
                assert.equal(wrapped.a, wrapped.owner.child)
                assert.equal(wrapped.owner.cycle, wrapped.owner)
            }
            r.assignPath(result, [...selectedPath, method === "self" ? "child" : "k", ...(method === "self" ? ["k"] : [])], 2, ctx)
            assert.equal(await r.lookupPath(source, ["child", "k"], ctx), 1)
            verifyRefCounts(ctx, source._state, held._state, result._state, combined._state)
        })
    }

    it("preserves aliases between original and materialized nodes inside later native calls", async () => {
        const ctx = context(), ready = new OrderedThenable()
        ready.resolve(1)
        const original = new r.Chain({ k: ready, self() { return this } }, ctx)
        const materialized = new r.Chain(r.run(original, [], "self", [], ctx, {}), ctx)
        const both = new r.Chain({
            a: r.lookupPath(original, [], ctx), b: r.lookupPath(materialized, [], ctx),
            same() { return this.a === this.b },
            sameArguments(a, b) { return a === b },
            update() { this.a.k = 2; return this.b.k },
        }, ctx)
        assert.equal(r.run(both, [], "same", [], ctx, {}), true)
        assert.equal(r.run(both, [], "sameArguments", [r.lookupPath(original, [], ctx),
            r.lookupPath(materialized, [], ctx)], ctx, {}), true)
        assert.equal(r.run(both, [], "update", [], ctx, { mutationScopeDepth: 0 }), 2)
        assert.equal(r.lookupPath(original, ["k"], ctx), 1)
        assert.equal(r.lookupPath(materialized, ["k"], ctx), 1)
        const output = await r.export(both, [], ctx)
        assert.equal(output.a, output.b)
    })

    for (const selected of [false, true]) for (const pendingResult of [false, true]) {
        it(`preserves the captured identity across later source mutation: child=${selected}, pending=${pendingResult}`, async () => {
            const ctx = context(), ready = new OrderedThenable(), pause = Promise.withResolvers()
            ready.resolve(1)
            const source = new r.Chain({ child: { k: ready }, read() {
                const value = selected ? this.child : this
                return pendingResult ? pause.promise.then(() => value) : value
            } }, ctx)
            const path = selected ? ["child"] : []
            const held = new r.Chain([r.lookupPath(source, path, ctx)], ctx)
            const result = new r.Chain(r.run(source, [], "read", [], ctx, {}), ctx)
            r.assignPath(source, ["child", "k"], 2, ctx)
            const same = r.run(held, [], "includes", [r.lookupPath(result, [], ctx)], ctx, {})
            pause.resolve()
            assert.equal(await same, true)
            assert.equal(r.run(held, [], "includes", [r.lookupPath(source, path, ctx)], ctx, {}), false)
            assert.equal(await r.lookupPath(result, selected ? ["k"] : ["child", "k"], ctx), 1)
            verifyRefCounts(ctx, source._state, held._state, result._state)
        })
    }

    for (const representation of ["view", "record order"]) {
        it(`preserves identity through ${representation} materialization`, async () => {
            const ctx = context(), pause = Promise.withResolvers()
            let child
            if (representation === "view") {
                const array = new r.Chain([1, 2, 3], ctx)
                child = new r.Chain(r.run(array, [], "slice", [1], ctx, {}), ctx)
            } else {
                child = new r.Chain({}, ctx)
                r.enter(child, ["first"], ctx, true, inside => pause.promise.then(() => r.assignPath(inside, [], 1, ctx)))
                r.assignPath(child, ["second"], 2, ctx)
            }
            const source = new r.Chain({ child: r.lookupPath(child, [], ctx), selected() { return this.child } }, ctx)
            const held = new r.Chain([r.lookupPath(child, [], ctx)], ctx)
            const result = new r.Chain(r.run(source, [], "selected", [], ctx, {}), ctx)
            const comparison = r.run(held, [], "includes", [r.lookupPath(result, [], ctx)], ctx, {})
            pause.resolve()
            assert.equal(await comparison, true)
            assert.deepEqual(await r.export(result, [], ctx), representation === "view" ? [2, 3] : { first: 1, second: 2 })
        })
    }

    for (const consume of ["export", "getErrors", "hasError", "native"]) {
        it(`still inspects required original storage after an equivalent copy: ${consume}`, () => {
            const ctx = context(), ready = new OrderedThenable(), cause = new Error("required reflection")
            ready.resolve(1)
            let fail = false
            const original = new r.Chain(new Proxy({ k: ready, self() { return this } }, {
                ownKeys(target) { if (fail) throw cause; return Reflect.ownKeys(target) },
            }), ctx)
            const copy = new r.Chain(r.run(original, [], "self", [], ctx, {}), ctx)
            const both = new r.Chain({ a: r.lookupPath(copy, [], ctx), b: r.lookupPath(original, [], ctx),
                same() { return this.a === this.b } }, ctx)
            fail = true
            const error = consume === "native" ? r.run(both, [], "same", [], ctx, {}) : r[consume](both, [], ctx)
            assert(r.isPoisonError(error))
            assert.equal(error.cause, cause)
            assert.equal(ctx.execution.fatalError, null)
        })
    }
})
