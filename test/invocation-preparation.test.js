import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable, ready } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

function pendingAliasPair(ctx) {
    const source = new r.Chain([, 7, ,], ctx)
    const before = new r.Chain(r.lookupPath(source, [], ctx), ctx)
    const gate = Promise.withResolvers()
    const entry = r.enter(source, [0], ctx, true, () => gate.promise)
    r.run(source, [], "copyWithin", [0, 2, 3], ctx, { mutationScopeDepth: 0 })
    return { pair: [r.lookupPath(before, [], ctx), r.lookupPath(source, [], ctx)], gate, entry }
}

describe("invocation preparation boundaries", () => {
    for (const array of [false, true])
    for (const mode of ["store-only", "store-return", "store-wrapper", "mutation-return", "observation-return"])
    for (const pending of [false, true]) {
        it(`protects exported arguments after adoption: ${mode}, array=${array}, pending=${pending}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "argument adoption" }
            let held
            const original = array ? [1, { n: 1 }] : { n: 1, deep: { n: 1 } }
            const source = new r.Chain(original, ctx)
            const receiver = new r.Chain({ call(report, arg) {
                report(arg)
                if (mode.startsWith("store")) this.saved = arg
                const result = mode === "store-only" ? undefined : mode === "store-wrapper" ? { value: arg } : arg
                return pending ? Promise.resolve(result) : result
            } }, ctx)
            const result = r.run(receiver, [], "call", [value => { held = value }, r.lookupPath(source, [], ctx)], ctx,
                mode === "observation-return" ? {} : { mutationScopeDepth: 0 })
            const output = new r.Chain(result, ctx)
            await result
            const stored = mode.startsWith("store")
            if (stored) r.assignPath(output, [], undefined, ctx)
            const target = stored ? receiver : output, path = stored ? ["saved"] : []
            await new Promise(setImmediate)
            r.assignPath(target, [...path, array ? 0 : "n"], 2, ctx)
            r.assignPath(target, [...path, array ? 1 : "deep", "n"], 3, ctx)
            const before = array ? [1, { n: 1 }] : { n: 1, deep: { n: 1 } }
            assert.deepEqual(held, before)
            assert.deepEqual(original, before)
            assert.deepEqual(await r.export(target, path, ctx), array ? [2, { n: 3 }] : { n: 2, deep: { n: 3 } })
            verifyRefCounts(ctx, source._state, receiver._state, output._state)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const category of ["record", "class", "array"])
    for (const scenario of ["missing", "constructor", "poison argument", "success"])
    for (const pendingArgument of [false, true]) {
        it(`selects ${category} calls before snapshot identity: ${scenario}, pendingArgument=${pendingArgument}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "snapshot call" }
            const { pair: [a, b], gate, entry } = pendingAliasPair(ctx)
            class Pair { constructor() { this.a = a; this.b = b } read() { return this.a === this.b } }
            r.managedStateClass(Pair)
            const pair = category === "array" ? [a, b] : category === "class" ? new Pair() :
                { a, b, read() { return this.a === this.b } }
            const api = r.externalState({ pair, marker: 0 })
            const chain = new r.ContextChain({ api }, ctx, { api: {} })
            const poison = r.createPoisonError(new Error("argument"), ctx, r.ERROR_KIND.OperationInputFailed)
            const argument = new OrderedThenable()
            const method = scenario === "success" || scenario === "poison argument"
                ? category === "array" ? "join" : "read" : scenario
            const value = scenario === "poison argument" ? poison : ","
            const result = r.run(chain, ["api", "pair"], method,
                scenario === "missing" || scenario === "constructor" ? [] : [pendingArgument ? argument : value], ctx, {})
            if (pendingArgument) argument.resolve(value)
            if (scenario !== "success") {
                // Pending arguments can add a delivery microtask, but identity
                // remains pending and must not delay an already determined failure.
                const failure = await result
                assert(r.isPoisonError(failure))
                assert.equal(failure.kind, scenario === "poison argument" ? poison.kind :
                    scenario === "constructor" ? r.ERROR_KIND.NotAFunction : r.ERROR_KIND.MissingFunction)
            } else assert.equal(r.isPending(result, ctx), category !== "array" || pendingArgument,
                "Native receiver preparation still needs canonical aliases")
            assert.equal(r.assignPath(chain, ["api", "marker"], 1, ctx), undefined)
            assert.equal(api.marker, 1)
            gate.resolve()
            await entry
            if (scenario === "success") assert.equal(await result, category === "array" ? ",7,,,7," : true)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const method of ["with", "concat", "push", "unshift", "splice", "toSpliced"])
    for (const delivery of ["ready", "synchronous", "native", "ordered"])
    for (const index of method === "with" ? [2, -3, Infinity, -Infinity] : [0]) {
        it(`rejects ${method} from snapshot shape before identity: ${delivery}, index=${index}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "snapshot shape" }
            const { pair, gate, entry } = pendingAliasPair(ctx)
            if (method !== "with" && method !== "concat") pair.length = 0xffffffff
            const api = r.externalState({ pair, marker: 0 })
            const chain = new r.ContextChain({ api }, ctx, { api: {} })
            const unused = r.validationError("unused payload", ctx, r.ERROR_KIND.OperationInputFailed)
            const args = method === "with" ? [index, unused] : method === "concat" ? [new Array(0xffffffff)] :
                method === "splice" || method === "toSpliced" ? [0, 0, unused] : [unused]
            const value = args[0], signal = delivery === "ordered" ? new OrderedThenable() : Promise.withResolvers()
            if (delivery !== "ready") args[0] = delivery === "synchronous" ? ready(value) : signal.promise ?? signal
            const result = r.run(chain, ["api", "pair"], method, args, ctx, {})
            if (delivery === "native" || delivery === "ordered") signal.resolve(value)
            let delivered = false
            const completion = Promise.resolve(result).then(value => { delivered = true; return value })
            await new Promise(setImmediate)
            assert.equal(delivered, true, "Shape rejection must not await an unrelated alias decision")
            assert.equal((await completion).kind, method === "with" ? r.ERROR_KIND.InvalidArrayOperation : r.ERROR_KIND.InvalidArrayLength)
            assert.equal(r.assignPath(chain, ["api", "marker"], 1, ctx), undefined)
            assert.equal(api.marker, 1)
            gate.resolve()
            await entry
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const method of ["slice", "concat", "with"]) {
        it(`preserves canonical aliases after ${method} shape preparation succeeds`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "successful snapshot shape" }
            const { pair, gate, entry } = pendingAliasPair(ctx)
            if (method === "with") pair.push(0)
            const chain = new r.ContextChain({ api: r.externalState({ pair }) }, ctx, { api: {} })
            const result = r.run(chain, ["api", "pair"], method, method === "with" ? [2, 3] : [], ctx, {})
            assert(!r.isPending(result, ctx))
            const output = new r.Chain(result, ctx)
            gate.resolve()
            await entry
            const exported = await r.export(output, [], ctx)
            assert.equal(exported[0], exported[1])
            assert.deepEqual(exported[0], [, 7, ,])
            assert.equal(ctx.execution.fatalError, null)
        })
    }
})
