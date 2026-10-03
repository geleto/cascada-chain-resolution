// Strict conformance witnesses for the deferred N1/N2 findings. Run explicitly
// with Mocha; they intentionally fail until Phase 4 supplies the identity proof.
// Keep ready/pending controls and never assert today's incorrect result.
import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { OrderedThenable, ready } from "../ordered-thenable.js"
import { assertGraph } from "../graph-oracle.js"

const context = () => ({ execution: new r.Execution(), errorContext: "deferred identity" })
const turn = () => new Promise(setImmediate)

describe("Phase 4 identity conformance", () => {
    for (const timing of ["ready", "synchronous", "native", "ordered"])
    for (const consumer of ["search", "export"]) {
        it(`N1 preserves identity after empty entry: ${timing}, ${consumer}`, async () => {
            const ctx = context(), initial = [{ k: 1 }]
            const pending = timing === "native" ? Promise.withResolvers()
                : timing === "ordered" ? new OrderedThenable() : undefined
            const input = timing === "synchronous" ? ready(initial) : pending?.promise ?? pending ?? initial
            const source = new r.Chain(input, ctx)
            const retained = new r.Chain(r.run(source, [], "slice", [], ctx, {}), ctx)
            const entry = r.enter(source, [0, "k"], ctx, true, () => undefined)
            let result
            if (consumer === "search") {
                result = Promise.all(["includes", "indexOf", "lastIndexOf"].map(method =>
                    r.run(source, [], method, [r.lookupPath(retained, [0], ctx)], ctx, {})))
            } else {
                const both = new r.Chain({ a: r.lookupPath(source, [0], ctx), b: r.lookupPath(retained, [0], ctx) }, ctx)
                result = r.export(both, [], ctx)
            }
            pending?.resolve(initial)
            await entry
            const output = await result
            if (consumer === "search") assert.deepEqual(output, [true, 0, 0])
            else {
                const node = { k: 1 }
                assertGraph(output, { a: node, b: node })
            }
        })
    }

    for (const boundary of ["import", "method result", "host call"])
    for (const ordered of [false, true]) for (const early of [false, true])
    for (const consumer of ["search", "export", "receiver", "arguments"]) {
        it(`N2 preserves cached result identity: ${boundary}, ordered=${ordered}, early=${early}, ${consumer}`, async () => {
            const ctx = context(), pending = ordered ? new OrderedThenable() : Promise.withResolvers()
            const cached = { k: 1, p: ordered ? pending : pending.promise }
            cached.self = cached
            const service = new r.Chain(r.externalState({ get() { return cached } }), ctx)
            const receive = () => new r.Chain(boundary === "import" ? r.import(cached, ctx)
                : boundary === "method result" ? r.importMethodResult(cached, ctx)
                : r.run(service, [], "get", [], ctx, {}), ctx)
            const first = receive()
            const list = new r.Chain([r.lookupPath(first, [], ctx)], ctx)
            if (early) { pending.resolve(7); await turn() }
            const second = receive()
            const same = function () { return this.a === this.b }
            let result
            if (consumer === "search") {
                result = Promise.all(["includes", "indexOf", "lastIndexOf"].map(method =>
                    r.run(list, [], method, [r.lookupPath(second, [], ctx)], ctx, {})))
            } else if (consumer === "arguments") {
                const native = new r.Chain(r.externalState({ same(a, b) { return a === b } }), ctx)
                result = r.run(native, [], "same", [r.lookupPath(first, [], ctx), r.lookupPath(second, [], ctx)], ctx, {})
            } else {
                const both = new r.Chain({ a: r.lookupPath(first, [], ctx), b: r.lookupPath(second, [], ctx), same }, ctx)
                result = consumer === "receiver" ? r.run(both, [], "same", [], ctx, {}) : r.export(both, [], ctx)
            }
            if (!early) pending.resolve(7)
            const output = await result
            if (consumer === "search") assert.deepEqual(output, [true, 0, 0])
            else if (consumer !== "export") assert.equal(output, true)
            else {
                const node = { k: 1, p: 7 }
                node.self = node
                assertGraph(output, { a: node, b: node, same })
            }
        })
    }
})
