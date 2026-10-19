import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as r from "../src/index.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new r.Execution(), errorContext: "snapshot identity" })
const select = (route, chain, ctx) => (route === "lookup" ? r.lookupPath : r.export)(chain, ["api", "pair"], ctx)

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
            const api = r.externalState({ marker: 0, pair: work.pair })
            Object.defineProperty(work.pair, "captured", { enumerable: true, get() { reads++; return 9 } })
            chain = new r.ContextChain({ api }, ctx, { api: {} })
            const result = select(route, chain, ctx)
            assert(r.isPending(result, ctx))
            assert.equal(reads, 1)
            assert.equal(r.assignPath(chain, ["api", "pair"], null, ctx), undefined)
            assert.equal(api.pair, null)
            // Receive the eventual managed output through the ordinary holder.
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
            const pair = { ...work.pair, failure: cause }
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

    it("releases snapshot sources while identity grouping is pending", () => {
        const result = spawnSync(process.execPath, [...process.execArgv, "--expose-gc",
            fileURLToPath(new URL("./fixtures/snapshot-identity-lifetime.js", import.meta.url))],
        { encoding: "utf8", timeout: 20000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })
})
