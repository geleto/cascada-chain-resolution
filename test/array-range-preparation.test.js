import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable, ready, rejected } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new r.Execution(), errorContext: "range preparation" })
const turn = () => new Promise(setImmediate)
const poison = (message, ctx) => r.validationError(message, ctx, r.ERROR_KIND.OperationInputFailed)
const noopCases = [
    ["empty fill", "fill", [], p => [p, p, p]],
    ["empty copy", "copyWithin", [], p => [p, p, p]],
    ["zero fill end", "fill", [1, 2], p => [p, p, 0]],
    ["fill start at length", "fill", [1, 2], p => [p, Infinity, p]],
    ["zero copy end", "copyWithin", [1, 2], p => [p, 0, 0]],
    ["copy target at length", "copyWithin", [1, 2], p => [2, p, p]],
    ["copy start at length", "copyWithin", [1, 2], p => [p, 2, p]],
    ["self copy", "copyWithin", [1, 2], p => [0, 0, p]],
    ["normalized self copy", "copyWithin", [1, 2], p => [-1, 1, p]],
]

describe("Array range argument relevance", () => {
    for (const method of ["fill", "copyWithin"]) for (const length of [0, 1, 2, 3])
    it(`matches all normalized ${method} control completions at length ${length}`, function () {
        this.timeout(10000)
        const unknown = Symbol("unknown"), domain = Array.from({ length: length + 1 }, (_, index) => index)
        const product = (options, count) => count === 0 ? [[]] :
            product(options, count - 1).flatMap(prefix => options.map(value => [...prefix, value]))
        const initial = Array.from({ length }, (_, index) => index)
        const apply = controls => {
            const output = [...initial]
            output[method](...(method === "fill" ? [9, ...controls] : controls))
            return output
        }
        for (const controls of product([...domain, unknown], method === "fill" ? 2 : 3)) {
            const unknownCount = controls.filter(value => value === unknown).length
            // Enumerate independent successful values for each unknown position.
            // On these dense, distinct payloads, a changed native result proves
            // a write; unchanged results cover precisely the specified no-ops.
            const unchanged = product(domain, unknownCount).every(completion => {
                let index = 0
                return JSON.stringify(apply(controls.map(value => value === unknown ? completion[index++] : value))) ===
                    JSON.stringify(initial)
            })
            for (const pending of [false, true]) {
                const ctx = context(), chain = new r.Chain([...initial], ctx)
                const unavailable = pending ? new OrderedThenable() : poison("unknown control", ctx)
                const args = controls.map(value => value === unknown ? unavailable : value)
                const result = r.run(chain, [], method, method === "fill" ? [9, ...args] : args, ctx, {})
                const label = `${method}/${length}/${controls.map(String)}/${pending}`
                if (unknownCount && !unchanged) {
                    assert.equal(pending ? r.isPending(result, ctx) : r.isPoisonError(result), true, label)
                } else {
                    assert.equal(r.isPending(result, ctx), false, label)
                    assert.deepEqual(r.export(new r.Chain(result, ctx), [], ctx), unknownCount ? initial : apply(controls), label)
                }
                assert.deepEqual(r.export(chain, [], ctx), initial, label)
            }
        }
    })

    for (const [name, method, initial, args] of noopCases)
    for (const mutation of [false, true]) for (const delivery of ["poison", "invalid", "sync", "native", "ordered"])
    it(`${name} ignores unused ${delivery} inputs, mutation=${mutation}`, async () => {
        const ctx = context(), chain = new r.Chain([...initial], ctx)
        const failure = poison("unused", ctx)
        const signal = delivery === "ordered" ? new OrderedThenable() : Promise.withResolvers()
        signal.promise?.catch(() => {}) // An unconsumed argument remains host-owned.
        const unused = delivery === "poison" ? failure : delivery === "invalid" ? Symbol("unused") :
            delivery === "sync" ? rejected(failure) : signal.promise ?? signal
        const result = r.run(chain, [], method, args(unused), ctx, mutation ? { mutationScopeDepth: 0 } : {})
        assert.equal(r.isPending(result, ctx), false, "The determined result must be synchronous")
        const output = new r.Chain(result, ctx)
        assert.deepEqual(await r.export(output, [], ctx), initial)
        assert.deepEqual(await r.export(chain, [], ctx), initial)
        const identities = new r.Chain([r.lookupPath(chain, [], ctx)], ctx)
        assert.equal(r.run(identities, [], "includes", [r.lookupPath(output, [], ctx)], ctx, {}), mutation)
        if (delivery === "ordered" && !mutation) assert.equal(signal.subscriptions, 0)
        signal.reject(failure)
        await turn()
        assert.equal(r.hasError(chain, [], ctx), false)
        verifyRefCounts(ctx, chain._state, output._state, identities._state)
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const method of ["fill", "copyWithin"]) for (const mutation of [false, true])
    for (const empty of [false, true]) for (const errorFirst of [false, true])
    for (const ordered of [false, true])
    it(`keeps ${method} failure conditional, mutation=${mutation}, empty=${empty}, errorFirst=${errorFirst}, ordered=${ordered}`, async () => {
        const ctx = context(), chain = new r.Chain([1, 2], ctx)
        const first = ordered ? new OrderedThenable() : Promise.withResolvers()
        const end = ordered ? new OrderedThenable() : Promise.withResolvers()
        const failure = poison("conditional control", ctx)
        const args = method === "fill" ? [9, first.promise ?? first, end.promise ?? end] :
            [first.promise ?? first, 0, end.promise ?? end]
        const result = r.run(chain, [], method, args, ctx, mutation ? { mutationScopeDepth: 0 } : {})
        let settled = false
        Promise.resolve(result).then(() => { settled = true })
        if (errorFirst) first.resolve(failure)
        else end.resolve(empty ? 0 : 1)
        await turn()
        assert.equal(settled, !errorFirst && empty)
        if (errorFirst) end.resolve(empty ? 0 : 1)
        else first.resolve(failure)
        const value = await result
        if (empty) assert.deepEqual(await r.export(new r.Chain(value, ctx), [], ctx), [1, 2])
        else assert.equal(value, failure)
        assert.equal(r.hasError(chain, [], ctx), mutation && !empty)
        if (mutation && !empty) r.repairPath(chain, [], ctx)
        assert.deepEqual(await r.export(chain, [], ctx), [1, 2])
        verifyRefCounts(ctx, chain._state)
    })

    for (const ordered of [false, true]) for (const mutation of [false, true])
    it(`discards an unfinished end after normalized self-copy, ordered=${ordered}, mutation=${mutation}`, async () => {
        const ctx = context(), chain = new r.Chain([1, , 3], ctx)
        const target = ordered ? new OrderedThenable() : Promise.withResolvers()
        const start = ordered ? new OrderedThenable() : Promise.withResolvers()
        const end = new OrderedThenable()
        const result = r.run(chain, [], "copyWithin", [target.promise ?? target, start.promise ?? start, end],
            ctx, mutation ? { mutationScopeDepth: 0 } : {})
        target.resolve(-2)
        start.resolve(1)
        assert.deepEqual(await r.export(new r.Chain(await result, ctx), [], ctx), [1, , 3])
        assert.deepEqual(await r.export(chain, [], ctx), [1, , 3])
        end.reject(new Error("irrelevant end"))
        await turn()
        assert.equal(r.hasError(chain, [], ctx), false)
    })

    for (const created of [false, true])
    it(`waits for captured shape before deciding range failure, growth=${created}`, async () => {
        const ctx = context(), chain = new r.Chain({ a: [] }, ctx), gate = Promise.withResolvers()
        const entry = r.enter(chain, ["a", 1], ctx, true, inside => gate.promise.then(() => {
            if (created) r.assignPath(inside, [], 7, ctx)
        }))
        const failure = poison("range control", ctx)
        const result = r.run(chain, ["a"], "fill", [9, failure, 2], ctx, {})
        let settled = false
        Promise.resolve(result).then(() => { settled = true })
        await turn()
        assert.equal(settled, false)
        gate.resolve()
        await entry
        const value = await result
        if (created) assert.equal(value, failure)
        else assert.deepEqual(await r.export(new r.Chain(value, ctx), [], ctx), [])
        verifyRefCounts(ctx, chain._state)
    })

    for (const method of ["fill", "copyWithin"]) for (const ordered of [false, true])
    it(`collects every required ${method} control failure, ordered=${ordered}`, async () => {
        const ctx = context(), chain = new r.Chain([1, 2], ctx)
        const end = ordered ? new OrderedThenable() : Promise.withResolvers()
        const first = poison("first", ctx), last = poison("last", ctx)
        const result = r.run(chain, [], method,
            method === "fill" ? [9, first, end.promise ?? end] : [first, 0, end.promise ?? end], ctx, {})
        end.resolve(last)
        const value = await result
        assert.deepEqual(new Set(value.errors), new Set([first, last]))
        assert.deepEqual(await r.export(chain, [], ctx), [1, 2])
    })

    it("protects a borrowed fill payload while range selection waits", async () => {
        const ctx = context(), source = new r.Chain({ x: 1 }, ctx), chain = new r.Chain([0], ctx)
        const end = Promise.withResolvers()
        const result = r.run(chain, [], "fill", [r.lookupPath(source, [], ctx), 0, end.promise], ctx, {})
        r.assignPath(source, ["x"], 2, ctx)
        end.resolve(1)
        assert.deepEqual(await r.export(new r.Chain(await result, ctx), [], ctx), [{ x: 1 }])
        assert.deepEqual(await r.export(source, [], ctx), { x: 2 })
    })

    it("does not infer equal starts from a shared failed argument", async () => {
        const ctx = context(), chain = new r.Chain([1, 2], ctx), input = new OrderedThenable()
        const result = r.run(chain, [], "copyWithin", [input, input, 2], ctx, {})
        const failure = poison("independent controls", ctx)
        input.resolve(failure)
        assert.equal(await result, failure)
    })

    it("normalizes synchronous controls and retains fill payload poison as data", async () => {
        const ctx = context(), chain = new r.Chain([1, 2], ctx), failure = poison("payload", ctx)
        const output = new r.Chain(r.run(chain, [], "fill", [failure, ready(1), ready(2)], ctx, {}), ctx)
        assert.equal(r.lookupPath(output, [0], ctx), 1)
        assert.equal(r.lookupPath(output, [1], ctx), failure)
        assert.deepEqual(await r.export(chain, [], ctx), [1, 2])
    })
})
