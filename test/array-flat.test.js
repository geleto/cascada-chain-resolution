import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import * as r from "../src/index.js"
import { OrderedThenable, ready } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

describe("finite cyclic Array flattening", function () {
    this.timeout(15000)

    it("bounds finite expansion by captured structure and output", () => {
        const child = spawnSync(process.execPath, [...process.execArgv,
            "--unhandled-rejections=strict", "--max-old-space-size=128",
            "test/fixtures/finite-flat.mjs"], { encoding: "utf8", timeout: 10000 })
        assert.equal(child.status, 0, child.error?.message ?? child.stderr)
        assert.match(child.stdout, /finite flattening cases passed/)
    })

    for (const mode of ["ready", "sync", "native", "ordered"]) for (const view of [false, true]) {
        it(`preserves sparse cycle depth and source identity: ${mode}, view=${view}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "finite flat" }
            const rings = Array.from({ length: 3 }, (_, i) => new Array(i + 1))
            for (let i = 0; i < 3; i++) rings[i][i] = rings[(i + 1) % 3]
            const source = new r.Chain(rings[0], ctx)
            const receiver = view ? new r.Chain(r.run(source, [], "slice", [], ctx, {}), ctx) : source
            const depth = 2 ** 54
            const signal = mode === "native" ? Promise.withResolvers() : mode === "ordered" ? new OrderedThenable() : undefined
            const input = signal?.promise ?? signal ?? (mode === "sync" ? ready(depth) : depth)
            const result = new r.Chain(r.run(receiver, [], "flat", [input], ctx, {}), ctx)
            signal?.resolve(depth)
            assert.equal(await r.lookupPath(result, ["length"], ctx), 1)
            // Increment the residue: depth+1 itself is not exactly representable.
            assert.equal(await r.lookupPath(result, [0, "length"], ctx), (depth % 3 + 1) % 3 + 1)
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, source._state, receiver._state, result._state)
        })
    }

    for (const mode of ["native", "ordered"]) it(`captures a delayed cycle before a later write: ${mode}`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: "pending finite flat" }
        const signal = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
        const array = [signal.promise ?? signal], source = new r.Chain(array, ctx)
        const result = new r.Chain(r.run(source, [], "flat", [4096], ctx, {}), ctx)
        r.assignPath(source, [0], 99, ctx)
        signal.resolve(array)
        const output = await r.export(result, [], ctx)
        assert.equal(output.length, 1)
        assert.equal(output[0][0], output[0])
        assert.deepEqual(await r.export(source, [], ctx), [99])
        assert.equal(ctx.execution.fatalError, null)
        verifyRefCounts(ctx, source._state, result._state)
    })

    for (const mode of ["native", "ordered"]) for (const order of [[0, 1, 2], [1, 0, 2], [2, 1, 0]]) {
        it(`joins first captures without cross-branch cycle waits: ${mode}, order=${order}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "flat shared pending cycle" }
            const signals = Array.from({ length: 3 }, () => mode === "native" ? Promise.withResolvers() : new OrderedThenable())
            const input = signals.map(signal => signal.promise ?? signal)
            const b = [input[2]], c = [b], source = new r.Chain([input[0], input[1]], ctx)
            const result = new r.Chain(r.run(source, [], "flat", [2 ** 54], ctx, {}), ctx)
            const exported = r.export(result, [], ctx)
            const values = [b, c, c]
            for (const index of order) {
                signals[index].resolve(values[index])
                await new Promise(setImmediate)
            }
            const output = await exported
            assert.equal(output.length, 2)
            assert.equal(output[0][0], output[1])
            assert.equal(output[1][0], output[0])
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("does not consume a retained depth-zero payload", () => {
        const ctx = { execution: new r.Execution(), errorContext: "flat depth zero" }
        const source = new r.Chain([[new Promise(() => {})]], ctx)
        const result = r.run(source, [], "flat", [0], ctx, {})
        assert(!(result instanceof Promise))
        const held = new r.Chain(result, ctx)
        assert.equal(r.lookupPath(held, ["length"], ctx), 1)
        assert.equal(r.lookupPath(held, [0, "length"], ctx), 1)
    })

    for (const mode of ["native", "ordered"]) for (const payloadFirst of [false, true]) {
        it(`extends an existing boundary capture for a later shorter alias: ${mode}, payloadFirst=${payloadFirst}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "flat depth upgrade" }
            const signal = () => mode === "native" ? Promise.withResolvers() : new OrderedThenable()
            const payload = signal(), alias = signal()
            const shared = [payload.promise ?? payload]
            const source = new r.Chain([[shared], alias.promise ?? alias], ctx)
            const result = new r.Chain(r.run(source, [], "flat", [2], ctx, {}), ctx)
            r.assignPath(source, [0, 0, 0], 99, ctx)
            for (const deliverPayload of [payloadFirst, !payloadFirst]) {
                if (deliverPayload) payload.resolve([7])
                else alias.resolve(shared)
                await new Promise(setImmediate)
            }
            assert.deepEqual(await r.export(result, [], ctx), [[7], 7])
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, source._state, result._state)
        })
    }

    for (const mode of ["ready", "sync", "native", "ordered"]) for (const failureFirst of [false, true]) {
        it(`collects a cycle and an independent reflection failure: ${mode}, failureFirst=${failureFirst}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "flat cycle and reflection" }
            const cycle = []; cycle.push(cycle)
            const cause = new Error("flat sibling inspection")
            let broken = false
            const sibling = new Proxy([1], {
                ownKeys(target) { if (broken) throw cause; return Reflect.ownKeys(target) },
            })
            // A deferred delivery reuses prepared input. Its later flat capture,
            // rather than initial admission, owns the supported inspection failure.
            r.import(sibling, ctx)
            const signal = mode === "native" ? Promise.withResolvers() : mode === "ordered" ? new OrderedThenable() : undefined
            const input = signal?.promise ?? signal ?? (mode === "sync" ? ready(sibling) : sibling)
            const source = new r.Chain(failureFirst ? [input, cycle] : [cycle, input], ctx)
            broken = true
            const result = r.run(source, [], "flat", [Infinity], ctx, {})
            signal?.resolve(sibling)
            const failure = await result
            const leaves = failure.errors ?? [failure]
            assert.equal(leaves.length, 2)
            assert(leaves.some(error => error.kind === r.ERROR_KIND.InvalidArrayOperation))
            assert(leaves.some(error => error.kind === r.ERROR_KIND.InvocationFailed && error.cause === cause))
            assert(leaves.every(error => error.errorContext === ctx.errorContext))
            assert.equal(ctx.execution.fatalError, null)
        })
    }
})
