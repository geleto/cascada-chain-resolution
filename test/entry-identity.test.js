import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable, ready } from "./ordered-thenable.js"
import { assertGraph } from "./graph-oracle.js"

const context = () => ({ execution: new r.Execution(), errorContext: "entry identity" })
const turn = () => new Promise(setImmediate)

describe("entry identity conformance", () => {
    for (const timing of ["ready", "synchronous", "native", "ordered"])
    for (const method of ["join", "toString"])
    for (const command of ["none", "empty entry", "effective write"]) {
        it(`N1 preserves cyclic conversion: ${timing}, ${method}, ${command}`, async () => {
            const ctx = context(), initial = ["x"]
            initial.push(initial)
            const pending = timing === "native" ? Promise.withResolvers()
                : timing === "ordered" ? new OrderedThenable() : undefined
            const input = timing === "synchronous" ? ready(initial) : pending?.promise ?? pending ?? initial
            const source = new r.Chain(input, ctx)
            const entry = command === "none" ? undefined : r.enter(source, [0], ctx, true, () => undefined)
            if (command === "effective write") r.assignPath(source, [0], "y", ctx)
            const result = r.run(source, [], method, [], ctx, {})
            pending?.resolve(initial)
            await entry
            // A real write separates the outer Array from the preserved cycle;
            // protection alone must not add another traversal of that cycle.
            assert.equal(await result, command === "effective write" ? "y,x," : "x,")
        })
    }

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

})


describe("identity completion at managed publication", () => {
    for (const pending of [false, true]) for (const nativeWrite of [false, true])
    it(`finishes managed identity after an external-scope entry: pending=${pending}, nativeWrite=${nativeWrite}`, async () => {
        const ctx = context(), gate = Promise.withResolvers()
        const service = r.externalState({ n: 0, bump() { this.n++ } })
        const source = new r.ContextChain({ box: { service } }, ctx, { box: { service: {} } })
        const before = new r.Chain(r.lookupPath(source, [], ctx), ctx)
        let inner
        const outer = r.enter(source, ["box"], ctx, true, box => {
            inner = r.enter(box, ["service"], ctx, true, svc => {
                if (nativeWrite) r.run(svc, [], "bump", [], ctx, { mutationScopeDepth: 0 })
                return pending ? gate.promise : undefined
            })
        })
        const result = r.run(new r.Chain([r.lookupPath(source, [], ctx)], ctx), [], "includes",
            [r.lookupPath(before, [], ctx)], ctx, {})
        try {
            assert.equal(outer, undefined)
            assert.equal(result, true)
            assert.equal(service.n, nativeWrite ? 1 : 0)
        } finally { gate.resolve(); await inner }
    })

    for (const method of ["includes", "indexOf", "lastIndexOf"])
    for (const backwards of [false, true]) for (const matched of [false, true]) {
        it(`decides available primitive searches: ${method}, backwards=${backwards}, matched=${matched}`, async () => {
            for (const needle of [undefined, null, false, 0, -0, NaN, 5, 5n, "x", Symbol("x")]) {
                const ctx = context(), gate = Promise.withResolvers()
                const array = [{ box: {} }, matched ? needle : 17]
                if (backwards) array.reverse()
                const expected = array[method](needle)
                const source = new r.Chain(array, ctx)
                const entry = r.enter(source, [backwards ? 1 : 0, "box"], ctx, true, () => gate.promise)
                const result = r.run(source, [], method, [needle], ctx, {})
                gate.resolve()
                await entry
                assert.equal(result, expected)
            }
        })
    }

    for (const mutation of [false, true]) for (const timing of ["ready", "fulfill", "reject", "never"])
    for (const managedWrite of [false, true]) {
        it(`separates native result delivery: mutation=${mutation}, ${timing}, write=${managedWrite}`, async () => {
            const ctx = context(), gate = Promise.withResolvers(), cause = new Error("native failure")
            const service = r.externalState({ work() { return timing === "ready" ? 7 : gate.promise } })
            const source = new r.ContextChain({ box: { service, n: 0 } }, ctx, { box: { service: {} } })
            const read = chain => r.lookupPath(chain, [], ctx)
            const before = new r.Chain(read(source), ctx)
            let native
            const entry = r.enter(source, ["box"], ctx, true, box => {
                native = r.run(box, ["service"], "work", [], ctx, mutation ? { mutationScopeDepth: 1 } : {})
                if (managedWrite) r.assignPath(box, ["n"], 1, ctx)
            })
            const result = r.run(new r.Chain([read(source)], ctx), [], "includes", [read(before)], ctx, {})
            assert.equal(entry, undefined)
            assert.equal(result, !managedWrite)
            if (timing === "never") return
            if (timing === "reject") gate.reject(cause)
            else gate.resolve(7)
            const delivered = await native
            if (timing === "reject") {
                assert(r.isPoisonError(delivered))
                assert.equal(delivered.cause, cause)
            } else assert.equal(delivered, 7)
        })
    }
})


describe("publication completion dependencies", () => {
    for (const array of [false, true])
    it(`deletes an absent completed transition before copied value delivery: array=${array}`, async () => {
        const ctx = context(), source = new r.Chain(array ? new Array(2) : {}, ctx)
        const key = array ? 0 : "k", sibling = array ? 1 : "other"
        let retained
        r.enter(source, [key], ctx, true, leaf => {
            retained = new r.Chain(r.lookupPath(source, [], ctx), ctx)
            r.assignPath(source, [sibling], 1, ctx)
            r.deletePath(leaf, [], ctx)
        })
        const before = new r.Chain(r.lookupPath(source, [], ctx), ctx)
        r.deletePath(source, [key], ctx, 0)
        assert.equal(await r.run(new r.Chain([r.lookupPath(source, [], ctx)], ctx), [], "includes",
            [r.lookupPath(before, [], ctx)], ctx, {}), true)
        assert.deepEqual(await r.export(source, [], ctx), array ? [, 1] : { other: 1 })
        assert.deepEqual(await r.export(retained, [], ctx), array ? new Array(2) : {})
    })

    for (const scope of [0, 1, 2]) for (const present of [false, true]) {
        it(`deletes settled presence without consuming its payload: scope=${scope}, present=${present}`, async () => {
            const ctx = context(), gate = Promise.withResolvers(), payload = Promise.withResolvers()
            const source = new r.Chain({ box: {} }, ctx)
            const read = chain => r.lookupPath(chain, [], ctx)
            const entry = r.enter(source, ["box", "k"], ctx, true, async leaf => {
                await gate.promise
                if (present) r.assignPath(leaf, [], payload.promise, ctx)
            })
            const afterEntry = new r.Chain(read(source), ctx)
            r.deletePath(source, ["box", "k"], ctx, scope)
            const result = r.run(new r.Chain([read(source)], ctx), [], "includes", [read(afterEntry)], ctx, {})
            const output = r.export(source, [], ctx)
            gate.resolve()
            await entry
            await turn()
            // The payload remains unresolved until both obligations have finished.
            assert.deepStrictEqual(await output, { box: {} })
            assert.equal(await result, !present)
            payload.resolve(9)
        })
    }

    it("does not extend identity through queued native work", async () => {
        const ctx = context(), gate = Promise.withResolvers(), calls = []
        const service = r.externalState({
            async hold() { calls.push("hold"); await gate.promise; calls.push("done"); return 1 },
            next() { calls.push("next"); return 2 },
        })
        const source = new r.ContextChain({ box: { service } }, ctx, { box: { service: {} } })
        const read = chain => r.lookupPath(chain, [], ctx)
        const before = new r.Chain(read(source), ctx)
        let first, second
        r.enter(source, ["box"], ctx, true, box => {
            first = r.run(box, ["service"], "hold", [], ctx, { mutationScopeDepth: 1 })
            second = r.run(box, ["service"], "next", [], ctx, { mutationScopeDepth: 1 })
        })
        assert.equal(r.run(new r.Chain([read(source)], ctx), [], "includes", [read(before)], ctx, {}), true)
        assert.deepStrictEqual(calls, ["hold"])
        gate.resolve()
        assert.deepStrictEqual(await Promise.all([first, second]), [1, 2])
        assert.deepStrictEqual(calls, ["hold", "done", "next"])
    })

    for (const gated of [false, true]) {
        it(`finishes binding recovery before a pending native result: gated=${gated}`, async () => {
            const ctx = context(), gate = Promise.withResolvers(), native = Promise.withResolvers()
            let calls = 0
            const service = r.externalState({ work() { calls++; return native.promise } })
            const source = new r.ContextChain({ box: { service } }, ctx, { box: { service: {} } })
            const read = chain => r.lookupPath(chain, [], ctx)
            const before = new r.Chain(read(source), ctx)
            let call
            const entry = r.enter(source, ["box"], ctx, true, async box => {
                if (gated) await gate.promise
                // A fixed binding cannot be overwritten; its managed placement
                // is poisoned and then restored by the repairing call.
                const failure = r.assignPath(box, ["service"], {}, ctx)
                assert.equal(failure.kind, r.ERROR_KIND.PropertyValidation)
                call = r.run(box, ["service"], "work", [], ctx, { mutationScopeDepth: 1, repair: true })
            })
            if (gated) assert.equal(calls, 0)
            gate.resolve()
            await entry
            assert.equal(calls, 1)
            const errors = r.hasError(source, [], ctx)
            assert.equal(r.run(new r.Chain([read(source)], ctx), [], "includes", [read(before)], ctx, {}), false)
            native.resolve(7)
            assert.equal(await call, 7)
            assert.equal(await errors, false)
        })
    }
})


describe("deletion value progress", () => {
    for (const present of [false, true]) for (const nested of [false, true]) {
        it(`releases the scope while identity presence is pending: present=${present}, nested=${nested}`, async () => {
            const ctx = context(), gate = Promise.withResolvers()
            const source = new r.Chain(present ? { a: { x: 1 }, b: 2 } : { b: 2 }, ctx)
            const before = new r.Chain(r.lookupPath(source, [], ctx), ctx)
            let entry, same
            const issue = chain => {
                entry = r.enter(chain, ["a"], ctx, true, () => gate.promise)
                r.deletePath(chain, ["a"], ctx, 0)
                assert.equal(r.lookupPath(chain, ["b"], ctx), 2)
                assert.equal(r.lookupPath(chain, ["a"], ctx), undefined)
                const after = new r.Chain([r.lookupPath(chain, [], ctx)], ctx)
                same = r.run(after, [], "includes", [r.lookupPath(before, [], ctx)], ctx, {})
                assert(same instanceof Promise)
            }
            const outer = nested ? r.enter(source, [], ctx, true, issue) : issue(source)
            gate.resolve()
            await Promise.all([entry, outer])
            assert.equal(await same, !present)
        })
    }
})
