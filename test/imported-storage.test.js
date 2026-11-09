import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable } from "./ordered-thenable.js"

// Successful ordinary traps expose attempts as well as final changes. A write
// followed by restoration must not pass imported-data protection checks.
function watchStorage() {
    const writes = [], sources = []
    return {
        writes,
        watch(target) {
            const descriptors = Object.getOwnPropertyDescriptors(target)
            sources.push({ target, descriptors })
            return new Proxy(target, {
                set(target, key, value) {
                    writes.push(["set", key])
                    return Reflect.set(target, key, value, target)
                },
                defineProperty(target, key, descriptor) {
                    writes.push(["define", key])
                    return Reflect.defineProperty(target, key, descriptor)
                },
                deleteProperty(target, key) {
                    writes.push(["delete", key])
                    return Reflect.deleteProperty(target, key)
                },
            })
        },
        unchanged() {
            assert.deepEqual(writes, [], "No physical write may reach imported storage")
            for (const { target, descriptors } of sources)
                assert.deepEqual(Object.getOwnPropertyDescriptors(target), descriptors)
        },
    }
}

const context = () => ({ execution: new r.Execution(), errorContext: "imported storage" })
const mutate = (chain, path, method, args, ctx) =>
    r.run(chain, path, method, args, ctx, { mutationScopeDepth: path.length })

describe("imported storage protection", () => {
    it("detects successful physical set, definition and deletion attempts", () => {
        const storage = watchStorage(), source = storage.watch({ value: 1 })
        source.value = 2
        Object.defineProperty(source, "added", { value: 3, configurable: true })
        delete source.added
        assert.deepEqual(storage.writes, [["set", "value"], ["define", "added"], ["delete", "added"]])
        assert.throws(() => storage.unchanged(), assert.AssertionError)
    })

    for (const timing of ["ready", "native", "ordered"])
    for (const reception of ["import", "context", "property", "method result"])
    for (const retainedSource of [false, true])
    it(`protects source storage through ${reception}, delivery=${timing}, retained=${retainedSource}`, async () => {
        const ctx = context(), storage = watchStorage()
        const child = storage.watch({ n: 1 })
        const signal = timing === "ordered" ? new OrderedThenable() : Promise.withResolvers()
        const pending = timing === "ready" ? child : signal.promise ?? signal
        const branch = storage.watch({ value: 1, remove: 2 })
        const items = storage.watch([1, , 3])
        const source = storage.watch({ branch, alias: branch, items, pending })
        let received
        if (reception === "context") received = new r.ContextChain(source, ctx, {})
        else if (reception === "import") received = new r.Chain(r.import(source, ctx), ctx)
        else {
            const api = r.externalState({ data: source, read() { return source } })
            const native = new r.Chain(r.import(api, ctx), ctx)
            const value = reception === "property" ? r.lookupPath(native, ["data"], ctx) :
                r.run(native, [], "read", [], ctx, {})
            received = new r.Chain(value, ctx)
        }
        // Keep the source graph active after path COW so its original pending
        // producer must also settle; retired storage needs no cache refresh.
        const retained = retainedSource ? new r.Chain(r.lookupPath(received, [], ctx), ctx) : undefined

        // Issue through pending data before delivery; ready siblings must still
        // progress. Both the source Promise slot and its eventual child survive.
        const pendingWrite = r.assignPath(received, ["pending", "n"], 5, ctx)
        assert.equal(r.assignPath(received, ["branch", "value"], 8, ctx), undefined)
        assert.equal(r.deletePath(received, ["branch", "remove"], ctx), undefined)
        assert.equal(r.enter(received, ["branch"], ctx, true, inside =>
            r.assignPath(inside, ["added"], 9, ctx)), undefined)
        assert.equal(r.assignPath(received, ["items", 4], 5, ctx), undefined)
        assert.equal(r.assignPath(received, ["items", "length"], 3, ctx), undefined)
        await mutate(received, ["items"], "fill", [4, 1, 2], ctx)
        assert.equal(await mutate(received, ["items"], "push", [6], ctx), 4)
        await mutate(received, ["items"], "reverse", [], ctx)
        assert.equal(await mutate(received, ["items"], "pop", [], ctx), 1)
        storage.unchanged()

        signal.resolve(child)
        assert.equal(await pendingWrite, undefined)
        assert.deepEqual(await r.export(received, [], ctx), {
            branch: { value: 8, added: 9 }, alias: { value: 1, remove: 2 },
            items: [6, 3, 4], pending: { n: 5 },
        })
        if (retained) assert.deepEqual(await r.export(retained, [], ctx), {
            branch: { value: 1, remove: 2 }, alias: { value: 1, remove: 2 },
            items: [1, , 3], pending: { n: 1 },
        })
        storage.unchanged()
        assert.equal(ctx.execution.fatalError, null)
    })

    it("mutates a canonical external property's managed snapshot without writing its host source", () => {
        const ctx = context(), storage = watchStorage()
        const child = storage.watch({ n: 1 }), items = storage.watch([1, 2])
        const data = storage.watch({ child, items })
        const api = r.externalState({ data })
        const canonical = new r.ContextChain({ api }, ctx, { api: {} })
        const copy = new r.Chain(r.lookupPath(canonical, ["api", "data"], ctx), ctx)
        assert.equal(r.assignPath(copy, ["child", "n"], 3, ctx), undefined)
        assert.equal(mutate(copy, ["items"], "push", [4], ctx), 3)
        assert.deepEqual(r.export(copy, [], ctx), { child: { n: 3 }, items: [1, 2, 4] })
        storage.unchanged()
    })

    for (const fail of [false, true]) for (const pending of [false, true])
    it(`isolates native managed work and protects adopted host data: fail=${fail}, pending=${pending}`, async () => {
        const ctx = context(), storage = watchStorage(), signal = Promise.withResolvers()
        const originalChild = storage.watch({ n: 1 })
        const stored = storage.watch({ n: 10 })
        const failure = new Error("native failure")
        class Value {
            change(supply) {
                this.child.n = 2
                this.stored = supply()
                if (pending) return signal.promise.then(() => {
                    if (fail) throw failure
                    return this.child.n
                })
                if (fail) throw failure
                return this.child.n
            }
        }
        r.managedStateClass(Value)
        const original = storage.watch(Object.assign(new Value(), { child: originalChild }))
        const chain = new r.Chain(r.import(original, ctx), ctx)
        const result = mutate(chain, [], "change", [() => stored], ctx)
        signal.resolve()
        const completed = await result
        storage.unchanged()
        if (fail) {
            assert.equal(completed.kind, r.ERROR_KIND.InvocationFailed)
            assert.equal(r.repairPath(chain, [], ctx), undefined)
            assert.equal(r.lookupPath(chain, ["child", "n"], ctx), 1)
            assert.equal(r.lookupPath(chain, ["stored"], ctx), undefined)
        } else {
            assert.equal(completed, 2)
            assert.equal(r.assignPath(chain, ["stored", "n"], 11, ctx), undefined)
            assert.equal(r.lookupPath(chain, ["stored", "n"], ctx), 11)
        }
        storage.unchanged()
        assert.equal(ctx.execution.fatalError, null)
    })
})
