import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable, ready } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { assertGraph } from "./graph-oracle.js"

const context = () => ({ execution: new r.Execution(), errorContext: "ownership isolation" })
const turn = () => new Promise(setImmediate)

describe("ownership isolation across pending work", () => {
    it("distinguishes duplicated aliases and collapsed generations in the topology oracle", () => {
        const child = { k: 1 }; child.self = child
        const copy = { k: 1 }; copy.self = copy
        assertGraph([child, child], [copy, copy])
        assert.throws(() => assertGraph([child, copy], [child, child]))
        assert.throws(() => assertGraph([child, child], [child, copy]))
    })

    for (const imported of [false, true]) for (const delivery of ["ready", "synchronous", "native", "ordered"])
    for (const entered of [false, true]) for (const indexed of [false, true]) {
        it(`preserves cyclic aliases and captured search generations across both owners, imported=${imported}, ${delivery}, entry=${entered}, indexed=${indexed}`, async () => {
            const ctx = context(), child = { k: 1 }; child.self = child
            const host = [child, child]
            const signal = delivery === "native" ? Promise.withResolvers()
                : delivery === "ordered" ? new OrderedThenable() : undefined
            const input = delivery === "synchronous" ? ready(host) : signal?.promise ?? signal ?? host
            const a = new r.Chain(imported ? r.import(input, ctx) : input, ctx)
            const b = new r.Chain(r.run(a, [], "slice", [], ctx, {}), ctx)
            const owners = [a, b], holders = [...owners], checks = []
            const keep = (value, verify = () => {}) => {
                const check = Promise.resolve(value).then(verify)
                check.catch(() => {})
                checks.push(check)
                return check
            }

            // The model shares its original child across both owners. An
            // effective path write copies only its selected slot/child; self
            // still denotes the prior child, unlike receiver-wide native mutation.
            const original = { k: 1 }; original.self = original
            const model = [[original, original], [original, original]]
            const needles = [], expectedNeedles = []
            function captureNeedle(owner, index) {
                const needle = new r.Chain(r.lookupPath(owners[owner], [index], ctx), ctx)
                holders.push(needle)
                needles.push(needle)
                expectedNeedles.push(model[owner][index])
            }
            function capture() {
                for (const [owner, chain] of owners.entries()) for (const method of ["includes", "indexOf", "lastIndexOf"])
                for (const [index, needle] of needles.entries()) {
                    const expected = model[owner][method](expectedNeedles[index])
                    keep(r.run(chain, [], method, [r.lookupPath(needle, [], ctx)], ctx, {}),
                        actual => assert.equal(actual, expected))
                }
                const pair = new r.Chain({ a: r.lookupPath(a, [], ctx), b: r.lookupPath(b, [], ctx) }, ctx)
                holders.push(pair)
                const expected = { a: model[0], b: model[1] }
                keep(r.export(pair, [], ctx), actual => assertGraph(actual, expected))
            }
            function mutate(owner, index, value) {
                const chain = owners[owner]
                keep(entered ? r.enter(chain, [index], ctx, true, inside => r.assignPath(inside, ["k"], value, ctx))
                    : r.assignPath(chain, [index, "k"], value, ctx))
                model[owner] = model[owner].with(index, { ...model[owner][index], k: value })
            }

            if (indexed) for (const chain of owners) keep(r.hasError(chain, [], ctx),
                actual => assert.equal(actual, false))
            captureNeedle(1, 0)
            capture()
            mutate(0, 0, 2)
            captureNeedle(0, 0)
            capture()
            mutate(1, 1, 3)
            captureNeedle(1, 1)
            capture()
            // Delivery and observations must survive release of all sources,
            // including when both mutations issued before root availability.
            for (const holder of holders) keep(r.assignPath(holder, [], null, ctx))
            signal?.resolve(host)
            await Promise.all(checks)
            await turn()
            for (const holder of holders) assert.equal(r.lookupPath(holder, [], ctx), null)
            if (indexed) verifyRefCounts(ctx, ...holders.map(holder => holder._state))
            assert.equal(ctx.execution.fatalError, null)
            if (imported) {
                assert.equal(child.k, 1)
                assert.equal(host[0], child)
                assert.equal(host[1], child)
                assert.equal(child.self, child)
            }
        })
    }

    for (const indexed of [false, true]) for (const ordered of [false, true])
    for (const replacement of ["delete", "replace", "clear"])
    for (const command of ["assign", "delete"]) {
        it(`protects another owner from a displaced ${command}, ${replacement}, indexed=${indexed}, ordered=${ordered}`, async () => {
            const ctx = context(), gate = ordered ? new OrderedThenable() : Promise.withResolvers()
            const source = new r.Chain({ items: [{ k: "orig" }] }, ctx)
            const retained = new r.Chain(r.lookupPath(source, ["items", 0], ctx), ctx)
            if (indexed) r.hasError(source, [], ctx)
            const entry = r.enter(source, ["items", 0], ctx, true, () => ordered ? gate : gate.promise)
            const writer = command === "assign"
                ? r.assignPath(source, ["items", 0, "k"], "later", ctx)
                : r.deletePath(source, ["items", 0, "k"], ctx)
            if (replacement === "delete") r.deletePath(source, ["items", 0], ctx)
            else r.assignPath(source, replacement === "clear" ? [] : ["items", 0], null, ctx)
            gate.resolve()
            await Promise.all([entry, writer])
            assert.deepEqual(await r.export(retained, [], ctx), { k: "orig" })
            assert.deepEqual(await r.export(source, [], ctx), replacement === "clear" ? null :
                { items: replacement === "delete" ? new Array(1) : [null] })
            verifyRefCounts(ctx, source._state, retained._state)
        })
    }

    for (const ticks of [false, true]) it(`preserves a read-only entry across displaced writers, ticks=${ticks}`, async () => {
        const ctx = context(), before = Promise.withResolvers(), read = Promise.withResolvers()
        const source = new r.Chain([{ k: "orig" }], ctx)
        const entry = r.enter(source, [0], ctx, true, () => before.promise)
        const noop = r.deletePath(source, [0, "missing"], ctx)
        if (ticks) await turn()
        const observation = r.enter(source, [0], ctx, false, inside => read.promise.then(() => r.export(inside, [], ctx)))
        if (ticks) await turn()
        const writer = r.assignPath(source, [0, "k"], "later", ctx)
        r.deletePath(source, [0], ctx)
        before.resolve()
        await Promise.all([entry, noop, writer])
        read.resolve()
        assert.deepEqual(await observation, { k: "orig" })
        verifyRefCounts(ctx, source._state)
    })

    for (const offset of [0, 1]) for (const indexed of [false, true])
    for (const ordered of [false, true]) for (const outcome of ["create", "noop", "delete"])
    for (const method of ["push", "assign", "concat"]) {
        it(`isolates sibling extension from pending growth, ${method}, ${outcome}, offset=${offset}, indexed=${indexed}, ordered=${ordered}`, async () => {
            const ctx = context(), gate = ordered ? new OrderedThenable() : Promise.withResolvers()
            const initial = ["a0", "a1", "a2"]
            const source = new r.Chain([...initial], ctx)
            const sibling = new r.Chain(r.run(source, [], "slice", [offset], ctx, {}), ctx)
            if (indexed) r.hasError(source, [], ctx)
            const entry = r.enter(source, [5], ctx, true, inside => (ordered ? gate : gate.promise).then(() => {
                if (outcome === "create") return r.assignPath(inside, [], "v5", ctx)
                if (outcome === "delete") return r.deletePath(inside, [], ctx)
            }))
            const expectedSibling = initial.slice(offset)
            const writer = method !== "assign"
                ? r.run(sibling, [], method, method === "concat" ? [["x", "y", "z"]] : ["x", "y", "z"], ctx,
                    method === "concat" ? {} : { mutationScopeDepth: 0 })
                : r.assignPath(sibling, [5 - offset], "z", ctx)
            const output = method === "concat" ? new r.Chain(writer, ctx) : sibling
            if (method !== "assign") expectedSibling.push("x", "y", "z")
            else expectedSibling[5 - offset] = "z"
            gate.resolve()
            await Promise.all([entry, writer])
            if (outcome === "create") initial[5] = "v5"
            assert.deepEqual(await r.export(source, [], ctx), initial)
            assert.deepEqual(await r.export(output, [], ctx), expectedSibling)
            if (method === "concat") assert.deepEqual(await r.export(sibling, [], ctx), ["a0", "a1", "a2"].slice(offset))
            verifyRefCounts(ctx, source._state, sibling._state, output._state)
        })
    }

    for (const reverse of [false, true]) for (const ordered of [false, true]) {
        it(`preserves holes across overlapping growth reservations and detached publication, reverse=${reverse}, ordered=${ordered}`, async () => {
            const ctx = context(), gates = [0, 1].map(() => ordered ? new OrderedThenable() : Promise.withResolvers())
            const source = new r.Chain(["a"], ctx)
            const sibling = new r.Chain(r.run(source, [], "slice", [], ctx, {}), ctx)
            const entries = [3, 6].map((key, index) => r.enter(source, [key], ctx, true, inside =>
                (ordered ? gates[index] : gates[index].promise).then(() => {
                    // Creation followed by deletion still commits length 7.
                    if (index === 1) {
                        r.assignPath(inside, [], "temporary", ctx)
                        r.deletePath(inside, [], ctx)
                    }
                })))
            const earlierLength = r.lookupPath(source, ["length"], ctx)
            const earlier = r.export(source, [], ctx)
            r.assignPath(source, [], null, ctx)
            r.run(sibling, [], "push", ["b", "c", "d"], ctx, { mutationScopeDepth: 0 })
            for (const index of reverse ? [1, 0] : [0, 1]) {
                gates[index].resolve()
                await turn()
            }
            await Promise.all(entries)
            const expected = ["a"]; expected.length = 7
            assert.equal(await earlierLength, 7)
            assert.deepEqual(await earlier, expected)
            assert.deepEqual(await r.export(sibling, [], ctx), ["a", "b", "c", "d"])
            assert.equal(r.lookupPath(source, [], ctx), null)
            verifyRefCounts(ctx, source._state, sibling._state)
        })
    }
})
