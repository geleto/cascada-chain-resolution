import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as r from "../src/index.js"
import { OrderedThenable, ready } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new r.Execution(), errorContext: "snapshot identity" })
const select = (route, chain, ctx) => (route === "lookup" ? r.lookupPath : r.export)(chain, ["api", "pair"], ctx)
function snapshot(value, ctx) {
    const host = new r.ContextChain({ api: r.externalState({ pair: value }) }, ctx, { api: {} })
    const result = select("lookup", host, ctx)
    assert(!r.isPending(result, ctx))
    r.assignPath(host, [], undefined, ctx)
    return result
}

// copyWithin removes the pending destination using a known hole. Contents and
// length become ready; only whether the earlier entry wrote remains undecided.
function pendingPair(ctx, write = false, onResume = () => {}) {
    const source = new r.Chain([, 7, ,], ctx)
    const before = new r.Chain(r.lookupPath(source, [], ctx), ctx)
    const gate = Promise.withResolvers()
    const entry = r.enter(source, [0], ctx, true, inside => gate.promise.then(() => {
        onResume()
        if (write) r.assignPath(inside, [], 8, ctx)
    }))
    r.run(source, [], "copyWithin", [0, 2, 3], ctx, { mutationScopeDepth: 0 })
    const pair = { a: r.lookupPath(before, [], ctx), b: r.lookupPath(source, [], ctx) }
    return { source, before, gate, entry, pair }
}

describe("snapshot canonical identity", () => {
    for (const route of ["lookup", "export"]) {
        it(`preserves original/observation-copy aliases and cycles: ${route}`, async () => {
            const ctx = context()
            const raw = { value: 7, self() { return this } }
            raw.cycle = raw
            const source = new r.Chain(r.import(raw, ctx), ctx)
            const observed = new r.Chain(r.run(source, [], "self", [], ctx, {}), ctx)
            assert.notEqual(r.lookupPath(source, [], ctx), r.lookupPath(observed, [], ctx))
            const api = r.externalState({ pair: {
                a: r.lookupPath(source, [], ctx), b: r.lookupPath(observed, [], ctx),
            } })
            const chain = new r.ContextChain({ api }, ctx, { api: {} })
            const result = select(route, chain, ctx)
            assert(!r.isPending(result, ctx))
            const held = route === "lookup" ? new r.Chain(result, ctx) : undefined
            const output = held ? await r.export(held, [], ctx) : result
            assert.equal(output.a, output.b)
            assert.equal(output.a.cycle, output.a)
            assert.equal(output.a.self, raw.self)
            if (held) {
                const originals = new r.Chain([r.lookupPath(source, [], ctx)], ctx)
                assert.equal(r.run(originals, [], "includes", [r.lookupPath(held, ["a"], ctx)], ctx, {}), false)
                verifyRefCounts(ctx, source._state, observed._state, chain._state, held._state, originals._state)
            }
        })

        for (const write of [false, true]) it(`waits only for aliases and releases native access: ${route}, write=${write}`, async () => {
            const ctx = context()
            let chain, reads = 0
            const work = pendingPair(ctx, write, () => {
                assert.equal(r.assignPath(chain, ["api", "marker"], 2, ctx), undefined,
                    "Earlier managed completion must not wait behind the snapshot's old reservation")
            })
            const pair = new Proxy({ ...work.pair, captured: 9 }, {
                getOwnPropertyDescriptor(target, key) {
                    if (key === "captured") reads++
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const api = r.externalState({ marker: 0, pair })
            chain = new r.ContextChain({ api }, ctx, { api: {} })
            const result = select(route, chain, ctx)
            assert.equal(r.isPending(result, ctx), route === "export")
            assert.equal(reads, 1)
            assert.equal(r.assignPath(chain, ["api", "pair"], null, ctx), undefined)
            assert.equal(api.pair, null)
            // Managed output is usable before its aliases are decided.
            const held = route === "lookup" ? new r.Chain(result, ctx) : undefined
            work.gate.resolve()
            await work.entry
            const output = held ? await r.export(held, [], ctx) : await result
            assert.equal(api.marker, 2)
            assert.equal(reads, 1, "Identity completion must not reread the external source")
            assert.equal(output.captured, 9)
            assert.equal(output.a === output.b, !write)
            assert.deepEqual(output.a, [, 7, ,])
            assert.deepEqual(output.b, [, 7, ,])
            if (held) verifyRefCounts(ctx, work.source._state, work.before._state, chain._state, held._state)
        })

        for (const distinct of [false, true]) it(`does not await a settled partition with pending keys: ${route}, distinct=${distinct}`, async () => {
            const ctx = context(), work = pendingPair(ctx)
            const other = new r.Chain([, 7, ,], ctx)
            const pair = { a: work.pair.b, b: distinct ? r.lookupPath(other, [], ctx) : work.pair.b }
            const chain = new r.ContextChain({ api: r.externalState({ pair }) }, ctx, { api: {} })
            const result = select(route, chain, ctx)
            assert(!r.isPending(result, ctx))
            assert(!r.isPoisonError(result))
            assert.equal(result.a === result.b, !distinct)
            work.gate.resolve()
            await work.entry
        })

        it(`reports data failure without waiting for unrelated identity: ${route}`, async () => {
            const ctx = context(), work = pendingPair(ctx)
            const cause = new Error("snapshot data failure")
            const pair = { ...work.pair, failure: r.createPoisonError(cause, ctx, r.ERROR_KIND.ExternalPropertyReadFailed) }
            const chain = new r.ContextChain({ api: r.externalState({ pair }) }, ctx, { api: {} })
            const result = select(route, chain, ctx)
            assert(!r.isPending(result, ctx))
            assert.equal(result.cause, cause)
            assert.equal(result.kind, r.ERROR_KIND.ExternalPropertyReadFailed)
            assert.equal(r.assignPath(chain, ["api", "pair"], null, ctx), undefined)
            work.gate.resolve()
            await work.entry
        })

        it(`inspects an equivalent representation even after capturing its alias: ${route}`, () => {
            const ctx = context(), cause = new Error("required inspection")
            let armed = false
            const raw = new Proxy({ value: 1, self() { return this } }, {
                ownKeys(target) { if (armed) throw cause; return Reflect.ownKeys(target) },
            })
            const source = new r.Chain(r.import(raw, ctx), ctx)
            const observed = new r.Chain(r.run(source, [], "self", [], ctx, {}), ctx)
            const pair = { a: r.lookupPath(observed, [], ctx), b: r.lookupPath(source, [], ctx) }
            const chain = new r.ContextChain({ api: r.externalState({ pair }) }, ctx, { api: {} })
            armed = true
            const result = select(route, chain, ctx)
            armed = false
            assert.equal(result.cause, cause)
            assert.equal(result.kind, r.ERROR_KIND.ExternalPropertyReadFailed)
        })
    }

    const completionCases = [
        ["at", [0], 7],
        ["includes", [7], true],
        ["indexOf", [7], 0],
        ["lastIndexOf", [7], 2, true],
        ["at", [3], undefined],
        ["includes", [7, 3], false],
        ["indexOf", [7, 3], -1],
        ["lastIndexOf", [7, -4], -1, true],
        ["slice", [0, 0], []],
    ]
    for (const identityReady of [true, false])
    for (const [method, args, expected, reverse] of completionCases) {
        it(`finishes determined Array results before unrelated aliases: ${method}(${args}), ready=${identityReady}`, async () => {
            const ctx = context(), work = pendingPair(ctx)
            if (identityReady) { work.gate.resolve(); await work.entry; await new Promise(setImmediate) }
            const aliases = [work.pair.a, work.pair.b]
            const pair = reverse ? [...aliases, 7] : [7, ...aliases]
            const api = r.externalState({ pair, marker: 0 })
            const chain = new r.ContextChain({ api }, ctx, { api: {} })
            const result = r.run(chain, ["api", "pair"], method, args, ctx, {})
            assert(!r.isPending(result, ctx))
            const held = method === "slice" ? new r.Chain(result, ctx) : undefined
            assert.deepEqual(held ? r.export(held, [], ctx) : result, expected)
            assert.equal(r.assignPath(chain, ["api", "marker"], 1, ctx), undefined)
            assert.equal(api.marker, 1)
            work.gate.resolve()
            await work.entry
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const delivery of ["ready", "synchronous", "native", "ordered"]) {
        it(`keeps snapshot identities fresh regardless of source admission: ${delivery}`, async () => {
            const ctx = context(), shared = { n: 1 }
            const gate = delivery === "ordered" ? new OrderedThenable() : Promise.withResolvers()
            const input = delivery === "ready" ? shared : delivery === "synchronous" ? ready(shared) : gate.promise ?? gate
            const source = new r.Chain(input, ctx)
            const chain = new r.ContextChain({ api: r.externalState({ items: [shared] }) }, ctx, { api: {} })
            const result = r.run(chain, ["api", "items"], "includes", [r.lookupPath(source, [], ctx)], ctx, {})
            if (delivery === "native" || delivery === "ordered") gate.resolve(shared)
            assert.equal(await result, false)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const identityReady of [true, false]) for (const write of [false, true]) {
        it(`selects managed objects before native alias assembly: ready=${identityReady}, write=${write}`, async () => {
            const ctx = context(), work = pendingPair(ctx, write)
            if (identityReady) { work.gate.resolve(); await work.entry; await new Promise(setImmediate) }
            const selected = { left: work.pair.a, right: work.pair.b }
            selected.self = selected
            const chain = new r.ContextChain({ api: r.externalState({ items: [0, selected] }) }, ctx, { api: {} })
            const result = r.run(chain, ["api", "items"], "at", [1], ctx, {})
            assert(!r.isPending(result, ctx))
            const held = new r.Chain(result, ctx)
            assert.equal(r.lookupPath(held, ["left", 1], ctx), 7)
            const exported = r.export(held, [], ctx)
            assert.equal(r.isPending(exported, ctx), !identityReady)
            work.gate.resolve()
            await work.entry
            const output = await exported
            assert.equal(output.left === output.right, !write)
            assert.equal(output.self, output)
            const originals = new r.Chain([r.lookupPath(work.before, [], ctx)], ctx)
            assert.equal(r.run(originals, [], "includes", [r.lookupPath(held, ["left"], ctx)], ctx, {}), false)
            verifyRefCounts(ctx, work.source._state, work.before._state, chain._state, held._state, originals._state)
        })
    }

    for (const write of [false, true]) {
        it(`preserves independent snapshot identities through repeated recapture: write=${write}`, async () => {
            const ctx = context(), work = pendingPair(ctx, write)
            const first = new r.Chain(snapshot([work.pair.a, work.pair.b], ctx), ctx)
            const second = new r.Chain(snapshot([work.pair.a, work.pair.b], ctx), ctx)
            const held = new r.Chain(snapshot([work.pair.a, work.pair.b,
                r.lookupPath(first, [0], ctx), r.lookupPath(first, [1], ctx),
                r.lookupPath(second, [0], ctx), r.lookupPath(second, [1], ctx)], ctx), ctx)
            for (let round = 0; round < 8; round++)
                r.assignPath(held, [], snapshot(r.lookupPath(held, [], ctx), ctx), ctx)
            const output = r.export(held, [], ctx)
            assert(r.isPending(output, ctx))
            work.gate.resolve()
            await work.entry
            const values = await output
            for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++)
                assert.equal(values[i] === values[j], i === j || (!write && Math.floor(i / 2) === Math.floor(j / 2)))
            verifyRefCounts(ctx, work.source._state, work.before._state, first._state, second._state, held._state)
        })

        for (const identityReady of [true, false])
        it(`selects recaptured snapshots while preserving an earlier output: ready=${identityReady}, write=${write}`, async () => {
            const ctx = context(), work = pendingPair(ctx, write)
            if (identityReady) { work.gate.resolve(); await work.entry; await new Promise(setImmediate) }
            const first = new r.Chain(snapshot([work.pair.a, work.pair.b], ctx), ctx)
            const second = new r.Chain(snapshot([work.pair.a, work.pair.b], ctx), ctx)
            const selected = { first: r.lookupPath(first, [], ctx), second: r.lookupPath(second, [], ctx) }
            selected.self = selected
            const held = new r.Chain(snapshot([selected], ctx), ctx)
            for (let round = 0; round < 4; round++)
                r.assignPath(held, [], snapshot(r.lookupPath(held, [], ctx), ctx), ctx)

            const result = r.run(held, [], "at", [0], ctx, {})
            assert(!r.isPending(result, ctx), "Selecting a recaptured object needs no descendant alias partition")
            const chosen = new r.Chain(result, ctx)
            const earlier = r.export(chosen, [], ctx)
            assert.equal(r.isPending(earlier, ctx), !identityReady)
            assert.equal(r.assignPath(chosen, ["first", 0, 1], 9, ctx), undefined)
            assert.equal(r.lookupPath(chosen, ["first", 0, 1], ctx), 9)
            assert.equal(r.lookupPath(held, [0, "first", 0, 1], ctx), 7)
            work.gate.resolve()
            await work.entry

            const before = await earlier, after = await r.export(chosen, [], ctx)
            for (const value of [before, after]) {
                assert.equal(value.second[0] === value.second[1], !write)
                assert.notEqual(value.first[1], value.second[1], "Independent snapshot domains remain distinct after recapture")
            }
            assert.equal(before.self, before)
            // Path copying changes the selected occurrence; the off-path cycle
            // continues to reference its captured pre-write value.
            assert.notEqual(after.self, after)
            assert.equal(after.self.self, after.self)
            assert.deepEqual(after.self.first[0], [, 7, ,])
            assert.equal(after.first[1], after.self.first[1])
            assert.equal(before.first[0] === before.first[1], !write)
            assert.deepEqual(before.first[0], [, 7, ,])
            assert.notEqual(after.first[0], after.first[1])
            assert.deepEqual(after.first[0], [, 9, ,])
            assert.deepEqual(after.first[1], [, 7, ,])
            verifyRefCounts(ctx, work.source._state, work.before._state, first._state,
                second._state, held._state, chosen._state)
        })

        it(`isolates mutation of a snapshot before source identity completion: write=${write}`, async () => {
            const ctx = context(), work = pendingPair(ctx, write)
            const held = new r.Chain(snapshot(work.pair, ctx), ctx)
            const retained = new r.Chain(r.lookupPath(held, [], ctx), ctx)
            assert.equal(r.assignPath(held, ["a", 1], 9, ctx), undefined)
            const updated = r.export(held, [], ctx)
            assert(!r.isPending(updated, ctx), "A write establishes distinct snapshot identity immediately")
            assert.notEqual(updated.a, updated.b)
            assert.deepEqual(updated.a, [, 9, ,])
            assert.deepEqual(updated.b, [, 7, ,])
            work.gate.resolve()
            await work.entry
            const original = await r.export(retained, [], ctx)
            assert.equal(original.a === original.b, !write)
            assert.deepEqual(original.a, [, 7, ,])
            assert.deepEqual(await r.export(work.before, [], ctx), [, 7, ,])
            assert.deepEqual(await r.export(work.source, [], ctx), [, 7, ,])
            verifyRefCounts(ctx, work.source._state, work.before._state, held._state, retained._state)
        })
    }

    it("selects an ordinary managed object before its child data settles", async () => {
        const ctx = context(), gate = Promise.withResolvers()
        const source = new r.Chain([{ value: gate.promise }], ctx)
        const result = r.run(source, [], "at", [0], ctx, {})
        assert(!r.isPending(result, ctx))
        const held = new r.Chain(result, ctx), exported = r.export(held, [], ctx)
        assert(r.isPending(exported, ctx))
        gate.resolve(7)
        assert.deepEqual(await exported, { value: 7 })
    })

    it("releases snapshot sources while identity grouping is pending", () => {
        const result = spawnSync(process.execPath, [...process.execArgv, "--expose-gc",
            fileURLToPath(new URL("./fixtures/snapshot-identity-lifetime.js", import.meta.url))],
        { encoding: "utf8", timeout: 20000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })
})
