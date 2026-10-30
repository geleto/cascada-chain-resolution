import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { ready, rejected, OrderedThenable } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new r.Execution(), errorContext: "path input" })
function input(timing, value, rejects = false) {
    const pending = timing === "native" ? Promise.withResolvers() : timing === "ordered" ? new OrderedThenable() : undefined
    if (rejects && pending?.promise) pending.promise.catch(() => {}) // A failed prefix can leave this key unused.
    return { key: pending?.promise ?? pending ?? (rejects ? rejected(value) : timing === "synchronous" ? ready(value) : value),
        resolve: () => rejects ? pending?.reject(value) : pending?.resolve(value) }
}

describe("Promise path segments", () => {
    for (const timing of ["ready", "synchronous", "native", "ordered"])
    for (const action of ["lookup", "expression", "export", "index", "length", "call-array", "call-external", "read-entry", "mutable-entry"])
    it(`${action} consumes a ${timing} key inside a mutable snapshot`, async () => {
        const ctx = context(), key = input(timing, action === "index" ? 1 : action === "length" ? "length" :
            action === "call-array" ? "list" : action === "call-external" ? "leaf" : "v")
        const leaf = r.externalState({ read() { return 9 } })
        const data = { v: 7, list: [2, 3], leaf }
        const api = r.externalState({ data })
        const source = new r.ContextChain({ api }, ctx, { api: {} })
        const path = ["api", "data", ...(["index", "length"].includes(action) ? ["list"] : []), key.key]
        const result = action === "expression" ? r.lookupPathForExpression(source, path, ctx) :
            action === "export" ? r.export(source, path, ctx) :
            action === "call-array" ? r.run(source, path, "join", [","], ctx, {}) :
            action === "call-external" ? r.run(source, path, "read", [], ctx, {}) :
            action.endsWith("entry") ? r.enter(source, path, ctx, action === "mutable-entry", inside => r.lookupPath(inside, [], ctx)) :
                r.lookupPath(source, path, ctx)
        key.resolve()
        assert.equal(await result, action === "index" ? 3 : action === "length" ? 2 : action === "call-array" ? "2,3" : action === "call-external" ? 9 : 7)
        assert.equal(ctx.execution.fatalError, null)
        assert.equal(ctx.execution._metadata.has(data), false, "Snapshot traversal must not admit raw host storage")
        assert.equal(r.lookupPath(source, ["api", "data", "v"], ctx), 7)
    })

    for (const timing of ["native", "ordered"])
    it(`preserves an admitted snapshot parent across a ${timing} key wait`, async () => {
        const ctx = context(), key = input(timing, "v"), data = { v: 1 }
        const managed = new r.Chain(data, ctx)
        const source = new r.ContextChain({ api: r.externalState({ data }) }, ctx, { api: {} })
        const before = r.lookupPath(source, ["api", "data", key.key], ctx)
        r.assignPath(managed, ["v"], 2, ctx)
        key.resolve()
        assert.equal(await before, 1)
        assert.equal(r.lookupPath(managed, ["v"], ctx), 2)
        verifyRefCounts(ctx, source._state, managed._state)
    })

    for (const timing of ["ready", "synchronous", "native", "ordered"])
    for (const name of ["then", "__proto__", "constructor"])
    it(`treats ${name} as an ordinary ${timing} path key`, async () => {
        const ctx = context(), key = input(timing, name)
        const source = new r.Chain({ [name]: 1 }, ctx)
        const before = r.lookupPath(source, [key.key], ctx)
        r.assignPath(source, [key.key], 2, ctx)
        const after = r.lookupPath(source, [key.key], ctx)
        r.deletePath(source, [key.key], ctx)
        const absent = r.lookupPath(source, [key.key], ctx)
        key.resolve()
        assert.equal(await before, 1)
        assert.equal(await after, 2)
        assert.equal(await absent, undefined)
        assert.deepEqual(await r.export(source, [], ctx), {})
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const timing of ["ready", "synchronous", "native", "ordered"])
    for (const action of ["lookup", "expression", "export", "assign", "delete", "run", "mutate", "hasError", "getErrors", "repair", "repair-call"])
    it(`${action} consumes a ${timing} key`, async () => {
        const ctx = context(), source = new r.Chain({ a: [2], b: 7 }, ctx), key = input(timing, "a")
        if (action.startsWith("repair")) r.run(source, ["a"], "missing", [], ctx, { mutationScopeDepth: 1 })
        const path = [key.key]
        const result = action === "lookup" ? r.lookupPath(source, [...path, 0], ctx) :
            action === "expression" ? r.lookupPathForExpression(source, [...path, 0], ctx) :
            action === "export" ? r.export(source, path, ctx) :
            action === "assign" ? r.assignPath(source, [...path, 0], 9, ctx) :
            action === "delete" ? r.deletePath(source, [...path, 0], ctx) :
            action === "run" ? r.run(source, path, "join", [","], ctx, {}) :
            action === "mutate" || action === "repair-call" ? r.run(source, path, "push", [3], ctx, { mutationScopeDepth: 1, repair: action === "repair-call" }) :
            action === "hasError" ? r.hasError(source, path, ctx) :
            action === "getErrors" ? r.getErrors(source, path, ctx) : r.repairPath(source, path, ctx)
        key.resolve()
        const value = await result
        const after = await r.export(source, [], ctx)
        if (["lookup", "expression", "mutate", "repair-call"].includes(action)) assert.equal(value, 2)
        else if (action === "export") assert.deepEqual(value, [2])
        else if (action === "run") assert.equal(value, "2")
        else assert.equal(value, action === "hasError" ? false : action === "getErrors" ? null : undefined)
        assert.equal(after.b, 7)
        assert.deepEqual(after.a, action === "assign" ? [9] : action === "delete" ? Array(1) :
            ["mutate", "repair-call"].includes(action) ? [2, 3] : [2])
        verifyRefCounts(ctx, source._state)
    })

    for (const action of ["lookup", "assign", "delete", "repair", "run"])
    it(`${action} never consumes a suffix after a failed prefix`, () => {
        const ctx = context(), chain = new r.Chain({ a: null }, ctx), key = new OrderedThenable()
        const path = ["a", key]
        const result = action === "lookup" ? r.lookupPath(chain, path, ctx) :
            action === "assign" ? r.assignPath(chain, path, 9, ctx) :
            action === "delete" ? r.deletePath(chain, path, ctx) :
            action === "repair" ? r.repairPath(chain, path, ctx) : r.run(chain, path, "x", [], ctx, {})
        assert.equal(result.kind, r.ERROR_KIND.NullLookup)
        assert.equal(key.subscriptions, 0)
    })

    it("hands a pending selection to its selected child and preserves intervening siblings", async () => {
        const ctx = context(), first = Promise.withResolvers(), second = Promise.withResolvers()
        const source = new r.Chain({ a: { x: 1 }, b: { y: 2 } }, ctx)
        const retained = new r.Chain(r.lookupPath(source, [], ctx), ctx)
        r.assignPath(source, [first.promise, second.promise], 9, ctx)
        r.assignPath(source, ["b", "y"], 3, ctx)
        const sibling = r.lookupPath(source, ["b", "y"], ctx)
        first.resolve("a")
        assert.equal(await sibling, 3)
        second.resolve("x")
        assert.deepEqual(await r.export(source, [], ctx), { a: { x: 9 }, b: { y: 3 } })
        assert.deepEqual(await r.export(retained, [], ctx), { a: { x: 1 }, b: { y: 2 } })
        verifyRefCounts(ctx, source._state, retained._state)
    })

    it("captures observations before later writes while a key is unavailable", async () => {
        const ctx = context(), key = Promise.withResolvers(), source = new r.Chain({ a: { x: 1 } }, ctx)
        const observed = r.lookupPath(source, [key.promise, "x"], ctx)
        r.assignPath(source, ["a", "x"], 9, ctx)
        key.resolve("a")
        assert.equal(await observed, 1)
        assert.equal(r.lookupPath(source, ["a", "x"], ctx), 9)
    })

    for (const timing of ["synchronous", "native", "ordered"]) for (const dynamic of [undefined, 0, 2])
    it(`never promotes a ${timing} key to native authority, provenance=${dynamic}`, async () => {
        const ctx = context(), key = input(timing, "api")
        const api = r.externalState({ read() { assert.fail("forbidden native dispatch") } })
        const source = new r.ContextChain({ api }, ctx, { api: {} })
        const result = r.run(source, [key.key], "read", [], ctx, { firstDynamicSegment: dynamic })
        key.resolve()
        assert.equal((await result).kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(r.getErrors(source, [], ctx), null)
    })

    it("distinguishes rejected keys from successful invalid Error data", async () => {
        const ctx = context(), source = new r.Chain({ a: 1 }, ctx), cause = new Error("key")
        const invalid = r.lookupPath(source, [ready(cause)], ctx)
        assert.equal(invalid.kind, r.ERROR_KIND.InvalidPathSegment)
        const failure = r.lookupPath(source, [rejected(cause)], ctx)
        assert.equal(failure.kind, r.ERROR_KIND.PathSegmentFailed)
        assert.equal(failure.cause, cause)
        assert.equal(r.lookupPath(source, [r.createPoisonedValue(failure)], ctx), failure)
    })

    for (const timing of ["ready", "synchronous", "native", "ordered"])
    for (const failure of ["rejected", "invalid", "array-key"])
    for (const action of ["assign", "delete", "call"])
    for (const entered of [false, true])
    it(`preserves a failed-key repair baseline: ${timing}, ${failure}, ${action}, entered=${entered}`, async () => {
        const ctx = context(), cause = new Error("key failed")
        const key = input(timing, failure === "rejected" ? cause : failure === "invalid" ? {} : "bad", failure === "rejected")
        const initial = failure === "array-key" ? [1, , 3] : { x: 1, list: [1, 2] }
        const source = new r.Chain({ a: initial, b: 2 }, ctx)
        const retained = new r.Chain(r.lookupPath(source, ["a"], ctx), ctx)
        let command
        const issue = (chain, prefix) => {
            const path = [...prefix, key.key, "y"]
            command = action === "assign" ? r.assignPath(chain, path, 9, ctx) :
                action === "delete" ? r.deletePath(chain, path, ctx) :
                    r.run(chain, path, "missing", [], ctx, { mutationScopeDepth: path.length })
        }
        const entry = entered ? r.enter(source, ["a"], ctx, true, inside => issue(inside, [])) : issue(source, ["a"])
        const poisoned = r.lookupPath(source, ["a"], ctx)
        // Repair is issued before key delivery; it must consume the failure's
        // preserved placement and publish before the following write.
        const repaired = r.repairPath(source, ["a"], ctx)
        r.assignPath(source, ["a", failure === "array-key" ? 0 : "x"], 7, ctx)
        r.assignPath(source, ["b"], 4, ctx)
        assert.equal(r.lookupPath(source, ["b"], ctx), 4)
        key.resolve()
        const poison = await poisoned
        assert.equal(poison.kind, r.ERROR_KIND[failure === "rejected" ? "PathSegmentFailed" : failure === "invalid" ? "InvalidPathSegment" : "PropertyValidation"])
        assert.equal(poison.errorContext, ctx.errorContext)
        if (failure === "rejected") assert.equal(poison.cause, cause)
        assert.equal(await repaired, undefined)
        await entry
        await command
        assert.deepEqual(await r.export(source, ["a"], ctx), failure === "array-key" ? [7, , 3] : { x: 7, list: [1, 2] })
        assert.deepEqual(await r.export(retained, [], ctx), initial)
        verifyRefCounts(ctx, source._state, retained._state)
    })

    for (const timing of ["ready", "synchronous", "native", "ordered"])
    for (const broad of [false, true])
    it(`repairs a failed ${timing} key before native selection, broad=${broad}`, async () => {
        const ctx = context(), key = input(timing, new Error("key failed"), true)
        const svc = r.externalState({ run() { assert.fail("must not call native code") } })
        const source = new r.ContextChain({ P: { x: 1, g: { svc } } }, ctx, { P: { g: { svc: {} } } })
        const result = r.run(source, ["P", key.key, "svc"], "run", [], ctx,
            { mutationScopeDepth: broad ? 1 : 3, firstDynamicSegment: 1 })
        const repair = r.repairPath(source, ["P"], ctx)
        key.resolve()
        assert.equal((await result).kind, r.ERROR_KIND[broad ? "PropertyValidation" : "PathSegmentFailed"])
        assert.equal(await repair, undefined)
        assert.equal(await r.lookupPath(source, ["P", "x"], ctx), 1)
        assert.equal(await r.getErrors(source, [], ctx), null)
        verifyRefCounts(ctx, source._state)
    })

    for (const timing of ["ready", "synchronous", "native", "ordered"])
    for (const entered of [false, true])
    for (const scope of [1, 3])
    for (const repair of [false, true])
    it(`orders scope validation before a deeper ${timing} crossing: entered=${entered}, scope=${scope}, repair=${repair}`, async () => {
        const ctx = context(), key = input(timing, "svc")
        const svc = r.externalState({ fail() { assert.fail("must not call native code") } })
        const source = new r.ContextChain({ P: { x: 1, g: { svc } } }, ctx, { P: { g: { svc: {} } } })
        let result
        const issue = (chain, prefix, offset) => {
            result = r.run(chain, [...prefix, "g", key.key], "fail", [], ctx,
                { mutationScopeDepth: scope - offset, firstDynamicSegment: 2 - offset, repair })
        }
        const entry = entered ? r.enter(source, ["P"], ctx, true, inside => issue(inside, [], 1)) : issue(source, ["P"], 0)
        key.resolve()
        await entry
        assert.equal((await result).kind, r.ERROR_KIND[scope === 1 ? "PropertyValidation" : "ExternalLocationConflict"])
        if (repair) assert.equal(await r.getErrors(source, [], ctx), null)
        else {
            assert.equal((await r.getErrors(source, [], ctx)).kind, (await result).kind)
            assert.equal(await r.repairPath(source, ["P"], ctx), undefined)
        }
        assert.equal(await r.lookupPath(source, ["P", "x"], ctx), 1)
        verifyRefCounts(ctx, source._state)
    })
})
