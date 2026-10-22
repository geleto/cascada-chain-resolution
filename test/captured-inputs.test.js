import assert from "node:assert/strict"
import * as r from "cascada-chain-resolution"
import { OrderedThenable } from "./ordered-thenable.js"

describe("managed input capture", () => {
    for (const route of ["export", "receiver", "argument", "roots"])
    for (const delivery of ["ready", "synchronous", "native", "ordered"]) {
        it(`preserves logical input across delivery modes: ${route}, ${delivery}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "capture order" }
            const make = name => new r.Chain({ value: name }, ctx)
            const first = make("first"), second = make("second")
            const firstValue = r.lookupPath(first, [], ctx), secondValue = r.lookupPath(second, [], ctx)
            const gate = delivery === "native" ? Promise.withResolvers() : new OrderedThenable()
            if (delivery === "synchronous") gate.resolve(firstValue)
            const input = delivery === "ready" ? firstValue : gate.promise ?? gate
            const root = new r.Chain({ first: input, second: secondValue,
                inspect() { return [this.first.value, this.second.value] },
            }, ctx)
            const api = new r.Chain(r.externalState({ inspect(a, b) {
                return b ? [a.value, b.value] : [a.first.value, a.second.value]
            } }), ctx)
            const result = route === "export" ? r.export(root, [], ctx)
                : route === "receiver" ? r.run(root, [], "inspect", [], ctx, {})
                : r.run(api, [], "inspect", route === "roots" ? [input, secondValue]
                    : [r.lookupPath(root, [], ctx)], ctx, {})
            const pending = delivery === "native" || delivery === "ordered"
            assert.equal(r.isPending(result, ctx), pending)
            if (pending) gate.resolve(firstValue)
            const output = await result
            assert.deepEqual(route === "export" ? [output.first.value, output.second.value] : output,
                ["first", "second"])
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const roots of [false, true]) for (const deferredSecond of [false, true]) {
        it(`protects captured input from later mutation: roots=${roots}, deferredSecond=${deferredSecond}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "unread capture" }
            const first = Promise.withResolvers(), second = Promise.withResolvers()
            const source = new r.Chain({ value: 1 }, ctx)
            const value = r.lookupPath(source, [], ctx)
            const input = deferredSecond ? second.promise : value
            const root = roots ? undefined : new r.Chain({ first: first.promise, second: input }, ctx)
            const api = new r.Chain(r.externalState({ inspect(first, second) { return { first, second } } }), ctx)
            const result = roots ? r.run(api, [], "inspect", [first.promise, input], ctx, {}) : r.export(root, [], ctx)
            second.resolve(value)
            await new Promise(setImmediate)
            r.assignPath(source, ["value"], 2, ctx)
            if (root) r.assignPath(root, ["second"], { value: 3 }, ctx)
            first.resolve("ready")
            assert.deepEqual(await result, { first: "ready", second: { value: 1 } })
            assert.equal(r.lookupPath(source, ["value"], ctx), 2)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("captures ready arguments while receiver data remains pending", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "receiver before arguments" }
        const pending = Promise.withResolvers()
        const child = new r.Chain({ value: 1 }, ctx)
        const argument = new r.Chain({ value: 2 }, ctx)
        const receiver = new r.Chain({ read(arg) { return this.child.value + arg.value }, child: pending.promise }, ctx)
        const result = r.run(receiver, [], "read", [r.lookupPath(argument, [], ctx)], ctx, {})
        r.assignPath(argument, ["value"], 4, ctx)
        pending.resolve(r.lookupPath(child, [], ctx))
        assert.equal(await result, 3)
        assert.equal(r.lookupPath(argument, ["value"], ctx), 4)
    })

    it("collects reflection and rejection poison across independent branches", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "ordered collection" }
        const first = Promise.withResolvers(), last = Promise.withResolvers()
        const reflection = new Error("inspection"), rejection = new Error("late rejection")
        let armed = false, reads = 0
        const child = new r.Chain(new Proxy({}, {
            ownKeys() { if (armed) { reads++; throw reflection }; return [] },
        }), ctx)
        const root = new r.Chain({ first: first.promise, middle: r.lookupPath(child, [], ctx), last: last.promise }, ctx)
        armed = true
        const result = r.export(root, [], ctx)
        last.reject(rejection)
        first.resolve(1)
        const error = await result
        assert.equal(reads, 1)
        assert.deepEqual(new Set(error.errors.map(leaf => leaf.cause)), new Set([reflection, rejection]))
        assert.equal(ctx.execution.fatalError, null)
    })

    it("completes a later back-reference without waiting on its own capture", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "ordered cycle" }
        const pending = Promise.withResolvers()
        const source = { first: pending.promise, last: { value: 1 } }
        const root = new r.Chain(source, ctx)
        const result = r.export(root, [], ctx)
        pending.resolve(source)
        const output = await result
        assert.equal(output.first, output)
        assert.deepEqual(output.last, { value: 1 })
        assert.equal(ctx.execution.fatalError, null)
    })

    it("reports a resumed fatal even while a later argument root is unavailable", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "ordered fatal" }
        const first = Promise.withResolvers(), last = Promise.withResolvers()
        let armed = false
        const cause = new Error("capture defect")
        const child = new r.Chain(new Proxy({ value: 2 }, {
            getOwnPropertyDescriptor(target, key) {
                if (armed && key === "value") r.failExecution(ctx, cause)
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        }), ctx)
        const api = new r.Chain(r.externalState({ inspect() { assert.fail("Must not invoke") } }), ctx)
        armed = true
        const result = r.run(api, [], "inspect", [first.promise, last.promise], ctx, {})
        const failed = assert.rejects(result, error => error === ctx.execution.fatalError && error.cause === cause)
        first.resolve(r.lookupPath(child, [], ctx))
        await failed
        // Another pending root cannot delay fatal delivery or leave an
        // unhandled internal rejection.
        await new Promise(setImmediate)
    })
})
