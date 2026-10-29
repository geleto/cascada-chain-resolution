import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable, ready } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new r.Execution(), errorContext: {} })
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const repairCall = (chain, path, method, ctx, args = [], facts = {}) =>
    r.run(chain, path, method, args, ctx, { mutationScopeDepth: path.length, repair: true, ...facts })

function input(delivery, value) {
    const source = delivery.startsWith("ordered") ? new OrderedThenable() : Promise.withResolvers()
    return {
        value: delivery === "ready" ? value : delivery === "synchronous" ? ready(value) : source.promise ?? source,
        resolve() { source.resolve(value); if (delivery === "ordered fulfilled") source.flush() },
    }
}

describe("repair-and-call receiver recovery", () => {
    const deliveries = ["ready", "synchronous", "fulfilled", "native", "ordered", "ordered fulfilled"]
    const routes = [
        { name: "plain static" },
        { name: "plain computed child", dynamic: 1 },
        { name: "plain computed root", dynamic: 0 },
        { name: "off-tree static", contextual: true },
        { name: "off-tree computed", contextual: true, dynamic: 1 },
        { name: "entered parent", entry: ["P"] },
        { name: "entered target", entry: ["P", "then"] },
    ]

    for (const route of routes) for (const delivery of deliveries) {
        it(`consumes restored receivers in issue order: ${route.name}, ${delivery}`, async () => {
            const ctx = context(), method = Promise.withResolvers()
            let calls = 0
            const receiver = { n: 1, change() { calls++; this.n = 2; return method.promise } }
            const pending = input(delivery, receiver)
            const initial = { P: { then: pending.value, sibling: 3 }, far: 4 }
            if (route.contextual) initial.api = r.externalState({ m() { return 5 } })
            const chain = route.contextual ? new r.ContextChain(initial, ctx, { api: {} }) : new r.Chain(initial, ctx)
            const retained = new r.Chain(r.lookupPath(chain, ["P", "then"], ctx), ctx)
            const guard = r.assignPath(chain, ["P", "then"], () => 0, ctx)
            assert.equal(guard.kind, r.ERROR_KIND.PropertyValidation)
            if (delivery.endsWith("fulfilled")) { pending.resolve(); await flush() }

            const result = route.entry ? r.enter(chain, route.entry, ctx, true, inside =>
                repairCall(inside, route.entry.length === 1 ? ["then"] : [], "change", ctx)) :
                repairCall(chain, ["P", "then"], "change", ctx, [], { firstDynamicSegment: route.dynamic })
            const captured = r.lookupPath(chain, ["P", "then", "n"], ctx)
            const later = r.assignPath(chain, ["P", "then", "n"], 9, ctx)
            assert(result instanceof Promise)
            assert(captured instanceof Promise)
            if (!delivery.endsWith("fulfilled")) pending.resolve()
            await flush()
            assert.equal(calls, 1)
            method.resolve(7)
            assert.equal(await result, 7)
            assert.equal(await captured, 2)
            await later
            assert.equal(r.lookupPath(chain, ["P", "then", "n"], ctx), 9)
            assert.equal(r.lookupPath(retained, ["n"], ctx), 1)
            assert.equal(receiver.n, 1)
            assert.equal(r.lookupPath(chain, ["P", "sibling"], ctx), 3)
            if (route.contextual) assert.equal(r.run(chain, ["api"], "m", [], ctx, { mutationScopeDepth: 1 }), 5)
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state, retained._state)
        })
    }

    for (const delivery of deliveries) for (const method of ["fill", "copyWithin"]) {
        it(`protects the restored Array baseline: ${method}, ${delivery}`, async () => {
            const ctx = context(), receiver = [3, 2, 1], pending = input(delivery, receiver)
            const chain = new r.Chain({ then: pending.value, sibling: 4 }, ctx)
            r.assignPath(chain, ["then"], () => 0, ctx)
            if (delivery.endsWith("fulfilled")) { pending.resolve(); await flush() }
            const result = repairCall(chain, ["then"], method, ctx, method === "fill" ? [9, 0, 1] : [0, 1, 2])
            if (!delivery.endsWith("fulfilled")) pending.resolve()
            assert(!r.isPoisonError(await result))
            assert.deepEqual(r.export(chain, ["then"], ctx), method === "fill" ? [9, 2, 1] : [2, 2, 1])
            assert.deepEqual(receiver, [3, 2, 1])
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const delivery of ["ready", "native", "ordered fulfilled"]) for (const array of [false, true]) {
        it(`retains the repaired baseline after call failure: ${delivery}, array=${array}`, async () => {
            const ctx = context(), cause = new Error("new call failure")
            const receiver = array ? [5, 4, 3, 2, 1] : { n: 1, fail() { this.n = 9; throw cause } }
            const pending = input(delivery, receiver), chain = new r.Chain({ then: pending.value, sibling: 4 }, ctx)
            const guard = r.assignPath(chain, ["then"], () => 0, ctx)
            if (delivery.endsWith("fulfilled")) { pending.resolve(); await flush() }
            let comparisons = 0
            const result = repairCall(chain, ["then"], array ? "sort" : "fail", ctx,
                array ? [(a, b) => { if (++comparisons === 3) throw cause; return a - b }] : [])
            if (!delivery.endsWith("fulfilled")) pending.resolve()
            const failure = await result
            assert.equal(failure.cause, cause)
            assert.notEqual(failure, guard)
            assert.equal(r.lookupPath(chain, ["then"], ctx), failure)
            assert.equal(r.repairPath(chain, ["then"], ctx), undefined)
            assert.deepEqual(r.export(chain, ["then"], ctx), receiver)
            assert.equal(r.lookupPath(chain, ["sibling"], ctx), 4)
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const rejected of [false, true]) {
        it(`repair-only does not consume recovery; a call does: rejected=${rejected}`, async () => {
            const ctx = context(), pending = Promise.withResolvers(), cause = new Error("receiver")
            const chain = new r.Chain({ then: pending.promise, sibling: 3 }, ctx)
            r.assignPath(chain, ["then"], () => 0, ctx)
            assert.equal(r.repairPath(chain, ["then"], ctx), undefined)
            r.assignPath(chain, ["then"], () => 0, ctx)
            const result = repairCall(chain, ["then"], "m", ctx)
            assert(result instanceof Promise)
            assert.equal(r.lookupPath(chain, ["sibling"], ctx), 3)
            if (rejected) pending.reject(cause)
            else pending.resolve({ m() { return 7 } })
            const value = await result
            if (rejected) {
                assert.equal(value.cause, cause)
                assert.equal(r.lookupPath(chain, ["then"], ctx), value)
                assert.equal(r.repairPath(chain, ["then"], ctx), value)
            } else assert.equal(value, 7)
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const pending of [false, true]) for (const combined of [false, true]) {
        it(`preserves a restored guard without another recovery layer: pending=${pending}, combined=${combined}`, async () => {
            const ctx = context(), source = Promise.withResolvers()
            let calls = 0
            const receiver = { n: 1, m() { calls++; return ++this.n } }
            const chain = new r.Chain({ then: pending ? source.promise : receiver }, ctx)
            const inner = r.assignPath(chain, ["then"], () => 0, ctx)
            const outer = r.assignPath(chain, ["then"], () => 1, ctx)
            assert.equal(inner.kind, r.ERROR_KIND.PropertyValidation)
            assert.equal(outer.kind, r.ERROR_KIND.PropertyValidation)
            assert.notEqual(outer, inner)

            if (!combined) assert.equal(r.repairPath(chain, ["then"], ctx), undefined)
            const result = combined ? repairCall(chain, ["then"], "m", ctx) :
                r.run(chain, ["then"], "m", [], ctx, { mutationScopeDepth: 1 })
            // The available inner guard blocks immediately, even while its
            // own saved value is pending. Only the outer repair has occurred.
            assert.equal(result, inner)
            assert.equal(r.lookupPath(chain, ["then"], ctx), inner)
            assert.equal(calls, 0)
            assert.equal(r.repairPath(chain, ["then"], ctx), undefined)
            const restored = r.lookupPath(chain, ["then", "n"], ctx)
            if (pending) { assert(restored instanceof Promise); source.resolve(receiver) }
            assert.equal(await restored, 1)
            assert.equal(r.run(chain, ["then"], "m", [], ctx, { mutationScopeDepth: 1 }), 2)
            assert.equal(calls, 1)
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const registered of [false, true]) {
        it(`checks authority after restoring an external receiver: registered=${registered}`, async () => {
            const ctx = context(), pending = Promise.withResolvers()
            let calls = 0
            const api = r.externalState({ m() { calls++ } })
            const canonical = registered ? new r.ContextChain({ api }, ctx, { api: {} }) : undefined
            const chain = new r.Chain({ then: pending.promise }, ctx)
            const guard = r.assignPath(chain, ["then"], () => 0, ctx)
            const result = repairCall(chain, ["then"], "m", ctx)
            pending.resolve(api)
            const failure = await result
            assert.equal(failure.kind, r.ERROR_KIND.ExternalLocationConflict)
            assert.notEqual(failure, guard)
            assert.equal(r.lookupPath(chain, ["then"], ctx), failure)
            assert.equal(calls, 0)
            if (canonical) assert.equal(r.getErrors(canonical, ["api"], ctx), null)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const delivery of ["ready", "native", "ordered fulfilled"]) {
        it(`keeps final publication failure over the repaired baseline: ${delivery}`, async () => {
            const ctx = context(), method = Promise.withResolvers(), cause = new Error("storage refused")
            let calls = 0, refuse = false
            const pending = input(delivery, { n: 1, change() { calls++; this.n = 2; return method.promise } })
            const chain = new r.Chain(new Proxy({ then: pending.value }, {
                set(target, key, value) {
                    if (refuse && !(value instanceof Promise)) throw cause
                    return Reflect.set(target, key, value)
                },
            }), ctx)
            const guard = r.assignPath(chain, ["then"], () => 0, ctx)
            if (delivery.endsWith("fulfilled")) { pending.resolve(); await flush() }
            const result = repairCall(chain, ["then"], "change", ctx)
            if (!delivery.endsWith("fulfilled")) pending.resolve()
            await flush()
            assert.equal(calls, 1)
            refuse = true
            method.resolve(7)
            const failure = await result
            assert.equal(failure.kind, r.ERROR_KIND.PropertyMutationFailed)
            assert.equal(failure.cause, cause)
            assert.notEqual(failure, guard)
            assert.equal(r.lookupPath(chain, ["then"], ctx), failure)
            refuse = false
            assert.equal(r.repairPath(chain, ["then"], ctx), undefined)
            assert.equal(r.lookupPath(chain, ["then", "n"], ctx), 1)
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("consumes a deeper receiver within a restored scope", async () => {
        const ctx = context(), pending = Promise.withResolvers()
        const chain = new r.Chain({ then: pending.promise }, ctx)
        r.assignPath(chain, ["then"], () => 0, ctx)
        const result = repairCall(chain, ["then", "child"], "change", ctx, [], { mutationScopeDepth: 1 })
        pending.resolve({ sibling: 3, child: { n: 1, change() { return ++this.n } } })
        assert.equal(await result, 2)
        assert.equal(r.lookupPath(chain, ["then", "child", "n"], ctx), 2)
        assert.equal(r.lookupPath(chain, ["then", "sibling"], ctx), 3)
        assert.equal(ctx.execution.fatalError, null)
        verifyRefCounts(ctx, chain._state)
    })

    for (const route of ["static", "computed", "entered parent", "entered target"])
    for (const guards of [0, 1, 2]) {
        it(`rejects an invalid repair scope before clearing either store: ${route}, guards=${guards}`, async () => {
            const ctx = context()
            let calls = 0
            const api = r.externalState({ fail() { throw new Error("native poison") } })
            const chain = new r.ContextChain({ P: { api, n: 1, m() { calls++ } }, sibling: 3 }, ctx, { P: { api: {} } })
            const native = r.run(chain, ["P", "api"], "fail", [], ctx, { mutationScopeDepth: 2 })
            let guard
            for (let i = 0; i < guards; i++) guard = r.assignPath(chain, ["P"], 0, ctx)
            const before = r.getErrors(chain, [], ctx)
            const invoke = (owner, path) => repairCall(owner, path, "m", ctx, [],
                route === "computed" ? { firstDynamicSegment: 0 } : {})
            const result = route.startsWith("entered") ? await r.enter(chain,
                route === "entered parent" ? [] : ["P"], ctx, true,
                inside => invoke(inside, route === "entered parent" ? ["P"] : [])) : invoke(chain, ["P"])
            assert.equal(result.kind, r.ERROR_KIND.PropertyValidation)
            assert.notEqual(result, guard)
            assert.equal(calls, 0)
            if (guard) assert.equal(r.lookupPath(chain, ["P"], ctx), guard)
            else assert.equal(r.lookupPath(chain, ["P", "n"], ctx), 1)
            const after = r.getErrors(chain, [], ctx)
            assert.deepEqual(new Set(after.errors ?? [after]), new Set(before.errors ?? [before]))
            assert(new Set(after.errors ?? [after]).has(native))
            assert.equal(r.lookupPath(chain, ["sibling"], ctx), 3)
            // Explicit standalone repair remains valid, including through each
            // saved guard; the rejected combined command removed no layer.
            for (let i = 0; i < Math.max(guards, 1); i++) assert.equal(r.repairPath(chain, ["P"], ctx), undefined)
            assert.equal(r.lookupPath(chain, ["P", "n"], ctx), 1)
            assert.equal(r.getErrors(chain, [], ctx), null)
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const rejected of [false, true]) {
        it(`invalid repair scope preserves unfinished native outcomes: rejected=${rejected}`, async () => {
            const ctx = context(), pending = Promise.withResolvers(), cause = new Error("native failure")
            const api = r.externalState({ wait() { return pending.promise } })
            const chain = new r.ContextChain({ P: { api, n: 1 } }, ctx, { P: { api: {} } })
            const earlier = r.run(chain, ["P", "api"], "wait", [], ctx, { mutationScopeDepth: 2 })
            const result = repairCall(chain, ["P"], "missing", ctx)
            assert.equal(result.kind, r.ERROR_KIND.PropertyValidation)
            assert.equal(r.lookupPath(chain, ["P", "n"], ctx), 1)
            if (rejected) pending.reject(cause)
            else pending.resolve(7)
            const outcome = await earlier
            assert.equal(r.getErrors(chain, [], ctx), rejected ? outcome : null)
            if (rejected) assert.equal(outcome.cause, cause)
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("keeps an earlier ancestor blocker ahead of repair-scope preflight", () => {
        const ctx = context(), api = r.externalState({ m() {} })
        const chain = new r.ContextChain({ P: { branch: { api } } }, ctx, { P: { branch: { api: {} } } })
        const blocker = r.run(chain, ["P"], "missing", [], ctx, { mutationScopeDepth: 1 })
        assert.equal(repairCall(chain, ["P", "branch"], "m", ctx), blocker)
        assert.equal(r.lookupPath(chain, ["P"], ctx), blocker)
        assert.equal(ctx.execution.fatalError, null)
        verifyRefCounts(ctx, chain._state)
    })
})
