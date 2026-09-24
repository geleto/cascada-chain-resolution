import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { metaOf } from "../src/meta.js"
import { TREE_NODE } from "../src/external-mutation-tree.js"

function setup(native, parent = false) {
    r.externalState(native)
    const ctx = { execution: new r.Execution(), errorContext: {} }
    const root = parent ? { group: { api: native, ordinary: 1 } } : { api: native, ordinary: 1 }
    const tree = parent ? { group: { api: {} } } : { api: {} }
    return { ctx, chain: new r.ContextChain(root, ctx, tree), path: parent ? ["group", "api"] : ["api"] }
}

describe("public external paths", () => {
    for (const deleting of [false, true]) for (const entered of [false, true]) {
        it(`orders a fixed-binding write at its containing external scope, delete=${deleting}, entered=${entered}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const hold = Promise.withResolvers(), calls = []
            const api = r.externalState({
                db: {},
                config: { wait() { return hold.promise }, read() { calls.push("read"); return 1 } },
            })
            const chain = new r.ContextChain({ api }, ctx, { api: { db: {}, config: {} } })
            const check = async (owner, prefix) => {
                const pending = r.run(owner, [...prefix, "config"], "wait", [], ctx,
                    { mutationScopeDepth: prefix.length + 1 })
                const result = deleting ? r.deletePath(owner, [...prefix, "db"], ctx)
                    : r.assignPath(owner, [...prefix, "db"], {}, ctx)
                assert.equal(result, undefined, "The containing scope must wait for its earlier child mutation")
                const observed = r.run(owner, [...prefix, "config"], "read", [], ctx, {})
                hold.resolve()
                await pending
                const failure = await observed
                assert.equal(failure.kind, r.ERROR_KIND.PropertyValidation)
                assert.deepEqual(calls, [])
                assert.equal(await r.getErrors(owner, prefix, ctx), failure)
                assert.equal(await r.repairPath(owner, [...prefix, "db"], ctx), failure,
                    "Repairing the target cannot clear its containing scope's poison")
                await r.repairPath(owner, prefix, ctx)
                assert.equal(await r.run(owner, [...prefix, "config"], "read", [], ctx, {}), 1)
            }
            if (entered) await r.enter(chain, ["api"], ctx, true, inner => check(inner, []))
            else await check(chain, ["api"])
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("keeps result validation after a borrowed gate is replaced, poisoned, and repaired", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const native = r.externalState({})
        const canonical = new r.ContextChain({ api: native }, ctx, { api: {} })
        const hold = Promise.withResolvers(), data = Promise.withResolvers()
        // The old data is already pending. A new assignment to `then` would
        // instead keep validation in the entry's unfinished transition.
        const source = new r.Chain({ then: data.promise }, ctx)
        const entry = r.enter(source, ["then"], ctx, true, () => hold.promise)
        const output = new r.Chain(r.importMethodResult(r.lookupPath(source, [], ctx), ctx), ctx)
        r.assignPath(output, ["then"], () => {}, ctx)
        let failure
        const lookup = Promise.resolve(r.lookupPath(output, ["then"], ctx)).then(value => { failure = value })
        hold.resolve()
        await entry
        await new Promise(setImmediate)
        assert.equal(failure?.kind, r.ERROR_KIND.PropertyValidation,
            "Replacement waits for publication, but does not consume the published pending data")
        assert.equal(r.repairPath(output, ["then"], ctx), undefined)
        data.resolve(native)
        await lookup
        assert.equal((await r.lookupPath(output, ["then"], ctx)).kind, r.ERROR_KIND.ExternalCapabilityEscape)
        assert.equal((await r.lookupPath(source, ["then"], ctx)).kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(r.getErrors(canonical, [], ctx), null)
        verifyRefCounts(ctx, canonical._state, source._state, output._state)
    })

    for (const pending of [false, true]) {
        it(`rejects native Array truncation before removing registered locations, pending=${pending}`, async () => {
            const worker = { work() { return 42 } }
            const api = r.externalState({ list: [0, 1, 2, worker] })
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const chain = new r.ContextChain({ api }, ctx, { api: { list: { 3: {} } } })
            const hold = Promise.withResolvers()
            r.assignPath(chain, ["api", "list", "length"], pending ? hold.promise : "0", ctx, 1)
            const blocked = r.run(chain, ["api", "list", 3], "work", [], ctx, { mutationScopeDepth: 3 })
            hold.resolve("0")
            const failure = await blocked
            assert.equal(failure.kind, r.ERROR_KIND.PropertyValidation)
            assert.equal(api.list.length, 4)
            assert.equal(api.list[3], worker)
            assert.equal(await r.getErrors(chain, ["api"], ctx), failure)
            await r.repairPath(chain, ["api"], ctx)
            assert.equal(await r.run(chain, ["api", "list", 3], "work", [], ctx, { mutationScopeDepth: 3 }), 42)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("uses native length conversion and preserves non-index external locations", () => {
        const api = r.externalState([1, 2, 3]), worker = { work() { return 42 } }
        api["01"] = worker
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const chain = new r.ContextChain({ api }, ctx, { api: { "01": {} } })
        let conversions = 0
        const length = { valueOf() { conversions++; return 1 } }
        assert.equal(r.assignPath(chain, ["api", "length"], length, ctx, 1), undefined)
        assert.equal(conversions, 2)
        assert.equal(api.length, 1)
        assert.equal(api["01"], worker)
        assert.equal(r.assignPath(chain, ["api", "length"], "4", ctx, 1), undefined)
        assert.equal(api.length, 4)
        const failure = r.assignPath(chain, ["api", "length"], 1.5, ctx, 1)
        assert.equal(failure.kind, r.ERROR_KIND.ExternalPropertyWriteFailed)
        assert.ok(failure.cause instanceof RangeError)
        assert.equal(api.length, 4)
        r.repairPath(chain, ["api"], ctx)
        assert.equal(r.run(chain, ["api", "01"], "work", [], ctx, {}), 42)
    })

    it("permits namespace Array property growth but rejects an Array-wide mutation scope", () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const api = r.externalState({ work() { return 42 } })
        const chain = new r.ContextChain({ list: [api] }, ctx, { list: { 0: {} } })
        assert.equal(r.assignPath(chain, ["list", 2], 5, ctx), undefined)
        assert.equal(r.assignPath(chain, ["list", "length"], 4, ctx), undefined)
        assert.equal(r.lookupPath(chain, ["list", 2], ctx), 5)
        const failure = r.run(chain, ["list"], "push", [6], ctx, { mutationScopeDepth: 1 })
        assert.equal(failure.kind, r.ERROR_KIND.PropertyValidation)
        assert.equal(r.run(chain, ["list", 0], "work", [], ctx, {}), failure)
        r.repairPath(chain, ["list"], ctx)
        assert.equal(r.lookupPath(chain, ["list", "length"], ctx), 4)
        assert.equal(r.run(chain, ["list", 0], "work", [], ctx, {}), 42)
    })

    it("does not coerce a refused native Array length write", () => {
        const api = r.externalState([{ work() { return 42 } }])
        Object.defineProperty(api, "length", { writable: false })
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const chain = new r.ContextChain({ api }, ctx, { api: { 0: {} } })
        const failure = r.assignPath(chain, ["api", "length"], {
            valueOf() { assert.fail("a read-only length must refuse the write before coercion") },
        }, ctx, 1)
        assert.equal(failure.kind, r.ERROR_KIND.ExternalPropertyWriteFailed)
        assert.equal(api.length, 1)
        r.repairPath(chain, ["api"], ctx)
        assert.equal(r.run(chain, ["api", 0], "work", [], ctx, {}), 42)
    })

    for (const key of [{}, null, undefined, true, Symbol("key"), () => "value"]) {
        it(`validates metadata-only external suffixes without coercion or native reads: ${typeof key}`, () => {
            const { ctx, chain } = setup({ get unused() { assert.fail("native property read") }, fail() { throw new Error("scope") } })
            const path = ["api", key]
            assert.equal(r.hasError(chain, path, ctx, 1), true)
            assert.equal(r.getErrors(chain, path, ctx, 1).kind, r.ERROR_KIND.InvalidPathSegment)
            assert.equal(r.getErrors(chain, ["api"], ctx), null)
            const original = r.run(chain, ["api"], "fail", [], ctx, { mutationScopeDepth: 1 })
            const invalid = r.repairPath(chain, path, ctx, 1)
            assert.equal(invalid.kind, r.ERROR_KIND.InvalidPathSegment)
            assert.equal(r.getErrors(chain, ["api"], ctx), original)
            assert.equal(r.getErrors(chain, path, ctx, 1), original)
            assert.equal(r.repairPath(chain, ["api", "unused"], ctx), undefined)
            assert.equal(r.getErrors(chain, ["api"], ctx), null)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("validates a queued external repair before clearing the preceding mutation's poison", async () => {
        const hold = Promise.withResolvers(), cause = new Error("scope")
        const { ctx, chain } = setup({ wait() { return hold.promise } })
        const mutation = r.run(chain, ["api"], "wait", [], ctx, { mutationScopeDepth: 1 })
        const query = r.getErrors(chain, ["api", {}], ctx, 1)
        const repair = r.repairPath(chain, ["api", {}], ctx, 1)
        assert(query instanceof Promise)
        assert(repair instanceof Promise)
        hold.reject(cause)
        const failure = await mutation
        assert.equal(await query, failure)
        assert.equal((await repair).kind, r.ERROR_KIND.InvalidPathSegment)
        assert.equal(r.getErrors(chain, ["api"], ctx), failure)
    })

    for (const array of [false, true]) for (const pending of [false, true]) {
        it(`preserves borrowed result recovery through copying, Array=${array}, pending=${pending}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }, hold = Promise.withResolvers()
            const item = { n: 1, fail() { throw new Error("scope") } }
            const root = array ? [item, pending ? hold.promise : 0] : { item, later: pending ? hold.promise : 0 }
            if (!array) root.self = root
            const key = array ? 0 : "item"
            const input = new r.Chain(r.import(root, ctx), ctx)
            const failure = r.run(input, [key], "fail", [], ctx, { mutationScopeDepth: 1 })
            const borrowed = r.lookupPath(input, [], ctx)
            const host = new r.Chain(r.externalState({ result() { return { borrowed, alias: borrowed } } }), ctx)
            const result = r.run(host, [], "result", [], ctx, {})
            assert.equal(result instanceof Promise, false)
            assert.equal(result.borrowed, result.alias)
            if (!array) assert.equal(result.borrowed.self.self, result.borrowed.self)
            const output = new r.Chain(result, ctx)
            assert.equal(r.repairPath(output, ["borrowed", key], ctx), undefined)
            r.assignPath(output, ["borrowed", key, "n"], 2, ctx)
            assert.equal(r.lookupPath(output, ["borrowed", key, "n"], ctx), 2)
            assert.equal(r.getErrors(input, [key], ctx), failure)
            assert.equal(r.repairPath(input, [key], ctx), undefined)
            assert.equal(r.lookupPath(input, [key, "n"], ctx), 1)
            const standalone = new r.Chain(failure, ctx)
            assert.equal(r.repairPath(standalone, [], ctx), failure)
            hold.resolve(0)
            await r.export(output, ["borrowed"], ctx)
            verifyRefCounts(ctx, input._state, output._state)
        })
    }

    it("preserves absence in a borrowed recovery baseline", () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }, hold = Promise.withResolvers()
        const input = new r.Chain(r.import({ later: hold.promise }, ctx), ctx)
        r.assignPath(input, ["missing", "child"], 1, ctx)
        const borrowed = r.lookupPath(input, [], ctx)
        const host = new r.Chain(r.externalState({ result() { return borrowed } }), ctx)
        const output = new r.Chain(r.run(host, [], "result", [], ctx, {}), ctx)
        assert.equal(r.repairPath(output, ["missing"], ctx), undefined)
        assert.deepEqual(Object.keys(r.lookupPath(output, [], ctx)), ["later"])
        assert.equal(r.getErrors(input, ["missing"], ctx).kind, r.ERROR_KIND.NullLookup)
        hold.resolve(0)
    })

    it("preserves recovery when a borrowed pending scope later fails", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }, hold = Promise.withResolvers()
        const input = new r.Chain(r.import({ item: { n: 1, fail() {
            return hold.promise.then(() => { throw new Error("late") })
        } } }, ctx), ctx)
        const mutation = r.run(input, ["item"], "fail", [], ctx, { mutationScopeDepth: 1 })
        const borrowed = r.lookupPath(input, [], ctx)
        const host = new r.Chain(r.externalState({ result() { return borrowed } }), ctx)
        const output = new r.Chain(r.run(host, [], "result", [], ctx, {}), ctx)
        const repair = r.repairPath(output, ["item"], ctx)
        hold.resolve()
        const failure = await mutation
        assert.equal(await repair, undefined)
        r.assignPath(output, ["item", "n"], 2, ctx)
        assert.equal(r.lookupPath(output, ["item", "n"], ctx), 2)
        assert.equal(r.getErrors(input, ["item"], ctx), failure)
        assert.equal(r.repairPath(input, ["item"], ctx), undefined)
        assert.equal(r.lookupPath(input, ["item", "n"], ctx), 1)
        verifyRefCounts(ctx, input._state, output._state)
    })

    for (const reflectionFailure of [false, true]) {
        it(`keeps an earlier capability Error in result data only, reflectionFailure=${reflectionFailure}`, async () => {
            let previous
            const cause = new Error("result reflection")
            const broken = new Proxy({ value: 1 }, { getOwnPropertyDescriptor(target, key) {
                if (key === "value") throw cause
                return Reflect.getOwnPropertyDescriptor(target, key)
            } })
            const { ctx, chain } = setup({ count: 0, result() {
                this.count++
                return reflectionFailure ? { previous, broken } : { previous }
            } })
            previous = r.lookupPath(chain, ["api"], ctx)
            assert.equal(previous.kind, r.ERROR_KIND.ExternalCapabilityEscape)
            const result = await r.run(chain, ["api"], "result", [], ctx, { mutationScopeDepth: 1 })
            const found = await r.getErrors(new r.Chain(result, ctx), [], ctx)
            if (reflectionFailure) {
                assert(found.errors.includes(previous))
                assert(found.errors.some(error => error.cause === cause))
            } else assert.equal(found, previous)
            assert.equal(await r.getErrors(chain, [], ctx), null)
            assert.equal(r.lookupPath(chain, ["api", "count"], ctx), 1)
        })
    }

    it("rejects extraction of registered descendants while allowing scalar reads and sibling snapshots", () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const api = r.externalState({ db: { config: { timeout: 4 }, other: { value: 7 } } })
        const chain = new r.ContextChain({ api }, ctx, { api: { db: { config: {} } } })
        assert.equal(r.lookupPath(chain, ["api", "db", "config"], ctx).kind, r.ERROR_KIND.ExternalCapabilityEscape)
        assert.equal(r.lookupPath(chain, ["api", "db", "config", "timeout"], ctx), 4)
        const snapshot = r.lookupPath(chain, ["api", "db", "other"], ctx)
        assert.deepEqual(snapshot, { value: 7 })
        assert.notEqual(snapshot, api.db.other)
        assert.equal(r.getErrors(chain, [], ctx), null)
    })

    for (const action of ["read", "call", "mutate", "assign", "delete"]) {
        it(`rejects ${action} through an inert alias before the canonical location is used`, async () => {
            let calls = 0
            const { ctx, chain } = setup({ value: 1, work() { calls++ } })
            const copy = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
            let failure
            if (action === "read") failure = r.lookupPath(copy, ["api", "value"], ctx)
            if (action === "call" || action === "mutate") failure = r.run(copy, ["api"], "work", [], ctx,
                action === "call" ? {} : { mutationScopeDepth: 1 })
            if (action === "assign") failure = r.assignPath(copy, ["api", "value"], 2, ctx)
            if (action === "delete") failure = r.deletePath(copy, ["api", "value"], ctx)
            assert.equal((await failure).kind, r.ERROR_KIND.ExternalLocationConflict)
            assert.equal(calls, 0)
            assert.equal(r.getErrors(chain, [], ctx), null)
            assert.equal(r.lookupPath(chain, ["api", "value"], ctx), 1)
            await r.run(chain, ["api"], "work", [], ctx, { mutationScopeDepth: 1 })
            assert.equal(calls, 1)
        })
    }

    it("finishes a parent query without joining a later parent mutation", async () => {
        const first = Promise.withResolvers(), later = Promise.withResolvers()
        let called = false, queried = false
        const { ctx, chain } = setup({ work() { return first.promise }, reset() { called = true; return later.promise } })
        const work = r.run(chain, ["api"], "work", [], ctx, { mutationScopeDepth: 1 })
        const query = r.getErrors(chain, [], ctx).then(value => { queried = true; return value })
        const reset = r.run(chain, ["api"], "reset", [], ctx, { mutationScopeDepth: 1 })
        first.resolve()
        for (let i = 0; i < 40; i++) await Promise.resolve()
        assert.equal(queried, true)
        assert.equal(called, true)
        assert.equal(await query, null)
        later.resolve()
        await Promise.all([work, reset])
    })

    for (const array of [false, true]) for (const create of [false, true]) {
        it(`preserves borrowed result presence after entry, Array=${array}, create=${create}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const source = new r.Chain(array ? new Array(1) : {}, ctx)
            const hold = Promise.withResolvers(), key = array ? 0 : "missing"
            const entry = r.enter(source, [key], ctx, true, async entered => {
                await hold.promise
                if (create) r.assignPath(entered, [], undefined, ctx)
            })
            const borrowed = r.lookupPath(source, [], ctx)
            const host = new r.Chain(r.externalState({ result() { return { borrowed, alias: borrowed } } }), ctx)
            const result = r.run(host, [], "result", [], ctx, {})
            assert.equal(result instanceof Promise, false)
            const output = new r.Chain(result, ctx)
            const exported = r.export(output, [], ctx)
            hold.resolve()
            await entry
            const copy = await exported
            assert.equal(copy.borrowed, copy.alias)
            assert.deepEqual(copy.borrowed, await r.export(source, [], ctx))
            assert.deepEqual(Object.keys(copy.borrowed), create ? [String(key)] : [])
            if (array) {
                assert.equal(copy.borrowed.length, 1)
                assert.equal(await r.run(output, ["borrowed"], "indexOf", [undefined], ctx, {}), create ? 0 : -1)
            }
        })
    }

    for (const action of ["call", "assign", "delete"]) {
        for (const gated of [false, true]) {
            it(`publishes and repairs a failed native mutation prefix, ${action}, gated=${gated}`, async () => {
                const ctx = { execution: new r.Execution(), errorContext: {} }
                const cause = new Error("prefix descriptor")
                let fail = false
                const api = r.externalState({ value: 1, write() { this.value++ } })
                const group = new Proxy({ api }, {
                    getOwnPropertyDescriptor(target, key) {
                        if (fail && key === "api") throw cause
                        return Reflect.getOwnPropertyDescriptor(target, key)
                    },
                })
                const chain = new r.ContextChain({ group, other: 0 }, ctx, { group: { api: {} } })
                const original = r.lookupPath(chain, [], ctx)
                const release = Promise.withResolvers()
                const entry = gated ? r.enter(chain, ["group"], ctx, true, async () => {
                    await release.promise
                    fail = true
                }) : undefined
                if (!gated) fail = true
                const result = action === "call"
                    ? r.run(chain, ["group", "api"], "write", [], ctx, { mutationScopeDepth: 2, repair: false })
                    : action === "assign" ? r.assignPath(chain, ["group", "api", "value"], 2, ctx)
                        : r.deletePath(chain, ["group", "api", "value"], ctx)
                const observed = r.lookupPath(chain, ["group"], ctx)
                r.assignPath(chain, ["other"], 3, ctx)
                release.resolve()
                await entry
                await result
                const failure = await observed
                fail = false
                assert.equal(failure.kind, r.ERROR_KIND.PropertyMutationFailed)
                assert.equal(failure.cause, cause)
                assert.equal(await r.getErrors(chain, [], ctx), failure)
                assert.equal(chain._externalMutationTree.group[TREE_NODE].ownPoison, undefined)
                assert.equal(chain._externalMutationTree.group.api[TREE_NODE].ownPoison, undefined)
                assert.equal(await r.lookupPath(chain, ["other"], ctx), 3)
                assert.equal(original.group, group)
                assert.equal(api.value, 1)
                await r.repairPath(chain, ["group"], ctx)
                assert.equal(await r.lookupPath(chain, ["group", "api", "value"], ctx), 1)
                assert.equal(await r.getErrors(chain, [], ctx), null)
                verifyRefCounts(ctx, chain._state)
            })
        }
    }

    it("keeps predecessor ordering when a reserved mutation fails before native access", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const held = Promise.withResolvers(), cause = new Error("prefix failed"), events = []
        let fail = false
        const api = r.externalState({ work(label) {
            events.push(label)
            return label === "first" ? held.promise : label
        } })
        const group = new Proxy({ api }, { getOwnPropertyDescriptor(target, key) {
            if (fail && key === "api") { fail = false; throw cause }
            return Reflect.getOwnPropertyDescriptor(target, key)
        } })
        const chain = new r.ContextChain({ group }, ctx, { group: { api: {} } })
        const first = r.run(chain, ["group", "api"], "work", ["first"], ctx, { mutationScopeDepth: 2 })
        fail = true
        const failed = r.run(chain, ["group", "api"], "work", ["skipped"], ctx, { mutationScopeDepth: 2 })
        assert.equal(failed.cause, cause)
        assert.equal(r.lookupPath(chain, ["group"], ctx), failed)
        const repair = r.repairPath(chain, ["group"], ctx)
        const last = r.run(chain, ["group", "api"], "work", ["last"], ctx, { mutationScopeDepth: 2 })
        await new Promise(setImmediate)
        assert.deepEqual(events, ["first"])
        held.resolve()
        await Promise.all([first, repair, last])
        assert.deepEqual(events, ["first", "last"])
        assert.equal(r.getErrors(chain, [], ctx), null)
        verifyRefCounts(ctx, chain._state)
    })

    for (const observe of ["lookup", "export", "method"]) {
        it(`does not reserve native descendants for managed ${observe}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const held = Promise.withResolvers()
            const left = r.externalState({ work() { return held.promise } })
            const right = r.externalState({ work() { return 2 } })
            const chain = new r.ContextChain({ left, right }, ctx, { left: {}, right: {} })
            const pending = r.run(chain, ["left"], "work", [], ctx, { mutationScopeDepth: 1 })
            if (observe === "lookup") r.lookupPath(chain, [], ctx)
            if (observe === "export") r.export(chain, [], ctx)
            if (observe === "method") r.run(chain, [], "missing", [], ctx, {})
            assert.equal(r.run(chain, ["right"], "work", [], ctx, { mutationScopeDepth: 1 }), 2)
            held.resolve()
            await pending
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("keeps healthy managed prefixes unchanged during native mutation selection", async () => {
        const { ctx, chain } = setup({ value: 0 }, true)
        const root = chain._state.value
        const group = root.group
        r.assignPath(chain, ["group", "api", "value"], 2, ctx)
        assert.equal(await r.lookupPath(chain, ["group", "api", "value"], ctx), 2)
        assert.equal(chain._state.value, root)
        assert.equal(chain._state.value.group, group)
    })

    it("orders known dynamic-route failure after an earlier child entry", async () => {
        let writes = 0
        const { ctx, chain } = setup({ write() { writes++ } })
        const release = Promise.withResolvers()
        const entry = r.enter(chain, ["api"], ctx, true, async entered => {
            await release.promise
            assert.equal(await r.run(entered, [], "write", [], ctx,
                { mutationScopeDepth: 0, repair: false }), undefined)
        })
        const failure = r.run(chain, ["api"], "write", [], ctx,
            { mutationScopeDepth: 1, firstDynamicSegment: 0, repair: false })
        assert.ok(failure instanceof Promise)
        release.resolve()
        await entry
        assert.equal(writes, 1)
        const error = await failure
        assert.equal(error.kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(await r.lookupPath(chain, [], ctx), error)
        await r.repairPath(chain, [], ctx)
        assert.equal(await r.hasError(chain, [], ctx), false)
    })

    it("collects accessible snapshot Errors after prototype reflection fails", async () => {
        const first = new Error("first")
        const second = new Error("second")
        const reflection = new Error("prototype")
        const source = new Proxy({ first, second }, { getPrototypeOf() { throw reflection } })
        const { ctx, chain } = setup({ source })
        const failure = await r.lookupPath(chain, ["api", "source"], ctx)
        assert.deepEqual(new Set(failure.errors.map(error => error.cause)), new Set([reflection, first, second]))
        assert.equal(metaOf(source, ctx), undefined)
        assert.equal(await r.hasError(chain, ["api"], ctx), false)
    })

    for (const pending of [false, true]) {
        it(`poisons a dynamic-only mutation's captured static prefix, pending=${pending}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const native = r.externalState({ write() { assert.fail("unauthorized call") } })
            const deferred = Promise.withResolvers()
            const chain = new r.ContextChain({ group: { api: pending ? deferred.promise : native }, sibling: 1 }, ctx)
            const result = r.run(chain, ["group", "api"], "write", [], ctx,
                { mutationScopeDepth: 2, repair: false, firstDynamicSegment: 1 })
            deferred.resolve(native)
            const failure = await result
            assert.equal(failure.kind, r.ERROR_KIND.ExternalLocationConflict)
            assert.equal(await r.lookupPath(chain, ["group"], ctx), failure)
            assert.equal(r.lookupPath(chain, ["sibling"], ctx), 1)
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("keeps successful and failed computed managed mutations at their selected scope", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const root = r.import({ group: { list: [1], other: 2 } }, ctx)
        const chain = new r.Chain(root, ctx)
        assert.equal(r.run(chain, ["group", "list"], "push", [2], ctx,
            { mutationScopeDepth: 2, repair: false, firstDynamicSegment: 1 }), 2)
        const failure = r.run(chain, ["group", "list"], "badMethod", [], ctx,
            { mutationScopeDepth: 2, repair: false, firstDynamicSegment: 1 })
        assert.equal(r.lookupPath(chain, ["group", "list"], ctx), failure)
        assert.equal(r.lookupPath(chain, ["group", "other"], ctx), 2)
        r.assignPath(chain, ["group", "list"], [3], ctx, 2, 1)
        assert.deepEqual(r.lookupPath(chain, ["group", "list"], ctx), [3])
    })

    it("does not hold a computed prefix for an independent removed-element result", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const pending = Promise.withResolvers()
        const chain = new r.ContextChain({ group: { list: [pending.promise], other: 2 } }, ctx)
        const removed = r.run(chain, ["group", "list"], "pop", [], ctx,
            { mutationScopeDepth: 2, repair: false, firstDynamicSegment: 1 })
        assert.equal(r.lookupPath(chain, ["group", "other"], ctx), 2)
        assert.equal(r.lookupPath(chain, ["group", "list", "length"], ctx), 0)
        pending.resolve(3)
        assert.equal(await removed, 3)
    })

    it("rejects computed mutable selection but permits computed native suffixes and managed siblings", async () => {
        const native = { value: 1, read() { return this.value } }
        const { ctx, chain } = setup(native)
        const error = r.lookupPath(chain, ["api", "value"], ctx, 0)
        assert.equal(error.kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(r.lookupPath(chain, ["ordinary"], ctx, 0), 1)
        assert.equal(await r.lookupPath(chain, ["api", "value"], ctx, 1), 1)
        r.assignPath(chain, ["api", "value"], 2, ctx, 2, 1)
        assert.equal(await r.lookupPath(chain, ["api", "value"], ctx), 2)
        const failure = await r.run(chain, ["api"], "read", [], ctx,
            { mutationScopeDepth: 1, repair: false, firstDynamicSegment: 0 })
        assert.equal(failure.kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(r.lookupPath(chain, [], ctx), failure)
        await r.repairPath(chain, [], ctx)
        assert.equal(await r.lookupPath(chain, ["api", "value"], ctx), 2)
    })

    it("captures native entry targets without inspecting unused children", () => {
        const native = { get child() { assert.fail("selection must not inspect native state") } }
        const { ctx, chain } = setup(native)
        assert.equal(r.enter(chain, ["api", "child", "value"], ctx, true, () => "done", 2), "done")
        assert.equal(r.enter(chain, ["ordinary", "child"], ctx, false, () => "done"), "done")
    })

    describe("invalid dynamic external observations", () => {
        function scopes() {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const calls = []
            const child = () => r.externalState({
                items: [],
                read() { calls.push("read"); return this.items.length },
                fail() { throw new Error("child failed") },
            })
            const api = r.externalState({ db: child(), config: child(), fail() { throw new Error("api failed") } })
            const chain = new r.ContextChain({ api }, ctx, { api: { db: {}, config: {} } })
            return { ctx, chain, api, calls }
        }
        const observations = {
            lookup: (c, p, ctx, d) => r.lookupPath(c, [...p, "db", "items", "length"], ctx, d),
            expression: (c, p, ctx, d) => r.lookupPathForExpression(c, [...p, "db", "items", "length"], ctx, d),
            export: (c, p, ctx, d) => r.export(c, [...p, "db", "items", "length"], ctx, d),
            getErrors: (c, p, ctx, d) => r.getErrors(c, [...p, "db"], ctx, d),
            run: (c, p, ctx, d) => r.run(c, [...p, "db"], "read", [], ctx, { firstDynamicSegment: d }),
        }
        const readyError = result => r.isPoisonedValue(result) ? result.error : result
        const outcome = result => Promise.resolve(result).catch(error => {
            assert(r.isPoisonError(error))
            return error
        })

        for (const [name, observe] of Object.entries(observations)) {
            for (const state of ["own poison", "binding conflict", "child poison", "child conflict", "healthy"]) {
                it(`${name} checks only the reached prefix with ${state}`, () => {
                    const { ctx, chain, api, calls } = scopes()
                    let expected
                    if (state === "own poison") expected = r.run(chain, ["api"], "fail", [], ctx, { mutationScopeDepth: 1 })
                    if (state === "binding conflict") {
                        new r.ContextChain({ api }, ctx, { api: {} })
                        expected = r.getErrors(chain, ["api"], ctx)
                    }
                    if (state === "child poison") r.run(chain, ["api", "db"], "fail", [], ctx, { mutationScopeDepth: 2 })
                    if (state === "child conflict") new r.ContextChain({ db: api.db }, ctx, { db: {} })
                    const before = r.getErrors(chain, ["api"], ctx)
                    const result = readyError(observe(chain, ["api"], ctx, 1))
                    assert(!(result instanceof Promise))
                    if (expected) assert.equal(result, expected)
                    else {
                        assert.equal(result.kind, r.ERROR_KIND.ExternalLocationConflict)
                        assert.notEqual(result, before)
                        assert.equal(result.errorContext, ctx.errorContext)
                    }
                    // A dynamic first crossing reaches no registered prefix.
                    const first = readyError(observe(chain, ["api"], ctx, 0))
                    assert.equal(first.kind, r.ERROR_KIND.ExternalLocationConflict)
                    assert.notEqual(first, before)
                    assert.equal(r.hasError(chain, ["api", "db"], ctx, 1), true)
                    assert.equal(r.getErrors(chain, ["api"], ctx), before)
                    assert.deepEqual(calls, [])
                    verifyRefCounts(ctx, chain._state)
                })
            }

            for (const entered of [false, true]) {
                it(`${name} waits for prefix failure and captures it before later repair, entered=${entered}`, async () => {
                    const { ctx, chain, calls } = scopes()
                    async function check(owner, prefix) {
                        const hold = Promise.withResolvers()
                        const entry = r.enter(owner, prefix, ctx, true, () => hold.promise)
                        const failed = r.run(owner, prefix, "fail", [], ctx, { mutationScopeDepth: prefix.length })
                        const result = observe(owner, prefix, ctx, prefix.length)
                        const captured = outcome(result)
                        const repair = r.repairPath(owner, prefix, ctx)
                        const after = outcome(observe(owner, prefix, ctx, prefix.length))
                        hold.resolve()
                        const error = await failed
                        await Promise.all([entry, repair])
                        return { pending: result instanceof Promise, captured: await captured, error, later: await after }
                    }
                    const result = entered ? await r.enter(chain, ["api"], ctx, true, inner => check(inner, []))
                        : await check(chain, ["api"])
                    assert(result.pending)
                    assert.equal(result.captured, result.error)
                    assert.equal(result.later.kind, r.ERROR_KIND.ExternalLocationConflict)
                    assert.notEqual(result.later, result.error)
                    assert.equal(await r.getErrors(chain, ["api"], ctx), null)
                    assert.deepEqual(calls, [])
                    verifyRefCounts(ctx, chain._state)
                })
            }

            it(`${name} does not wait for an unreached child mutation`, async () => {
                const { ctx, chain } = scopes()
                const hold = Promise.withResolvers()
                const entry = r.enter(chain, ["api", "db"], ctx, true, () => hold.promise)
                const result = readyError(observe(chain, ["api"], ctx, 1))
                assert.equal(result.kind, r.ERROR_KIND.ExternalLocationConflict)
                assert.equal(r.run(chain, ["api", "config"], "read", [], ctx, { mutationScopeDepth: 2 }), 0)
                hold.resolve()
                await entry
                assert.equal(await r.getErrors(chain, ["api"], ctx), null)
                verifyRefCounts(ctx, chain._state)
            })
        }

        for (const poisoned of [false, true]) {
            it(`keeps dynamic provenance after entry rebases the reference, poisoned=${poisoned}`, async () => {
                const { ctx, chain } = scopes()
                const expected = poisoned ? r.run(chain, ["api"], "fail", [], ctx, { mutationScopeDepth: 1 }) : undefined
                const results = await r.enter(chain, ["api", "db"], ctx, false, inside => [
                    r.lookupPath(inside, ["items", "length"], ctx),
                    r.getErrors(inside, [], ctx),
                ], 1)
                for (const result of results) {
                    if (poisoned) assert.equal(result, expected)
                    else assert.equal(result.kind, r.ERROR_KIND.ExternalLocationConflict)
                }
                verifyRefCounts(ctx, chain._state)
            })
        }

        it("orders prefix validation behind strict-ancestor mutations", async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const api = r.externalState({ db: { leaf: { value: 1 } }, fail() { throw new Error("ancestor failed") } })
            const chain = new r.ContextChain({ api }, ctx, { api: { db: { leaf: {} } } })
            const hold = Promise.withResolvers()
            const entry = r.enter(chain, ["api"], ctx, true, () => hold.promise)
            const failure = r.run(chain, ["api"], "fail", [], ctx, { mutationScopeDepth: 1 })
            const observed = r.lookupPath(chain, ["api", "db", "leaf", "value"], ctx, 2)
            const repair = r.repairPath(chain, ["api"], ctx)
            assert(observed instanceof Promise)
            hold.resolve()
            assert.equal(await observed, await failure)
            await Promise.all([entry, repair])
            assert.equal(r.getErrors(chain, ["api"], ctx), null)
            verifyRefCounts(ctx, chain._state)
        })
    })

    it("preserves namespace indexes through Array length and remap mutations", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const native = r.externalState({ value: 1 })
        const chain = new r.ContextChain({ list: [native, 2] }, ctx, { list: { 0: {} } })
        r.assignPath(chain, ["list", "length"], 3, ctx)
        assert.equal(r.lookupPath(chain, ["list", "length"], ctx), 3)
        const failure = r.assignPath(chain, ["list", "length"], 0, ctx)
        assert.equal(failure.kind, r.ERROR_KIND.PropertyValidation)
        assert.equal(r.lookupPath(chain, ["list"], ctx), failure)
        await r.repairPath(chain, ["list"], ctx)
        assert.equal(await r.lookupPath(chain, ["list", 0, "value"], ctx), 1)
        const moved = r.run(chain, ["list"], "unshift", [0], ctx,
            { mutationScopeDepth: 1, repair: false })
        assert.equal(moved.kind, r.ERROR_KIND.PropertyValidation)
        await r.repairPath(chain, ["list"], ctx)
        assert.equal(r.lookupPath(chain, ["list", 1], ctx), 2)
        verifyRefCounts(ctx, chain._state)
    })

    for (const nested of [false, true]) {
        it(`retains a fixed Array namespace through pending length conversion, nested=${nested}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const native = r.externalState({ value: 1 })
            const chain = new r.ContextChain({ list: [native, 2] }, ctx, { list: { 0: {} } })
            const pending = Promise.withResolvers()
            const length = nested ? r.import([pending.promise], ctx) : pending.promise
            r.assignPath(chain, ["list", "length"], length, ctx)
            const read = r.lookupPath(chain, ["list", 0, "value"], ctx)
            assert.ok(read instanceof Promise)
            pending.resolve(0)
            const failure = await read
            assert.equal(failure.kind, r.ERROR_KIND.PropertyValidation)
            assert.equal(await r.lookupPath(chain, ["list"], ctx), failure)
            await r.repairPath(chain, ["list"], ctx)
            assert.equal(await r.lookupPath(chain, ["list", 0, "value"], ctx), 1)
            assert.equal(await r.lookupPath(chain, ["list", "length"], ctx), 2)
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const mutable of [false, true]) {
        it(`protects an unused native property reference without reflection, mutable=${mutable}`, async () => {
            const { ctx, chain } = setup({ get child() { assert.fail("native reflection") } })
            const result = await r.enter(chain, ["api", "child"], ctx, mutable, () => "done")
            assert.equal(result, "done")
            assert.equal(await r.hasError(chain, ["api"], ctx), false)
            await r.repairPath(chain, ["api"], ctx)
            assert.equal(await r.hasError(chain, [], ctx), false)
        })

        it(`orders whole native entry without holding a phase, mutable=${mutable}`, async () => {
            const { ctx, chain } = setup({ value: 1 })
            const release = Promise.withResolvers()
            let outside = false
            const entry = r.enter(chain, ["api"], ctx, mutable, async entered => {
                await release.promise
                assert.equal(await r.lookupPath(entered, ["value"], ctx), 1)
                if (mutable) r.assignPath(entered, ["value"], 2, ctx)
                assert.equal(outside, !mutable)
            })
            const later = Promise.resolve(r.lookupPath(chain, ["api", "value"], ctx)).then(value => {
                outside = true
                return value
            })
            release.resolve()
            await entry
            assert.equal(await later, mutable ? 2 : 1)
        })
    }

    it("publishes ready managed siblings while issued native writes keep their order", async () => {
        const effects = []
        const { ctx, chain, path } = setup({ write(value) { effects.push(value) } }, true)
        const argument = Promise.withResolvers()
        const issued = []
        const parent = r.enter(chain, ["group"], ctx, true, inside => {
            issued.push(r.run(inside, ["api"], "write", [argument.promise], ctx, { mutationScopeDepth: 1 }))
            issued.push(r.run(inside, ["api"], "write", [2], ctx, { mutationScopeDepth: 1 }))
        })
        let siblingReady = false
        const sibling = Promise.resolve(r.lookupPath(chain, ["group", "ordinary"], ctx)).then(value => {
            siblingReady = true
            return value
        })
        const outside = r.run(chain, path, "write", [3], ctx, { mutationScopeDepth: 2 })
        await new Promise(resolve => setImmediate(resolve))
        const wasReady = siblingReady
        const beforeRelease = [...effects]
        argument.resolve(1)
        await Promise.all([parent, ...issued, outside])
        assert.equal(await sibling, 1)
        assert.equal(wasReady, true)
        assert.deepEqual(beforeRelease, [])
        assert.deepEqual(effects, [1, 2, 3])
        verifyRefCounts(ctx, chain._state)
    })

    it("keeps a nested native entry ordered after its parent publishes", async () => {
        const effects = []
        const { ctx, chain, path } = setup({ write(value) { effects.push(value) } }, true)
        const release = Promise.withResolvers()
        let nested
        await r.enter(chain, ["group"], ctx, true, inside => {
            nested = r.enter(inside, ["api"], ctx, true, async leaf => {
                await release.promise
                await r.run(leaf, [], "write", [1], ctx, { mutationScopeDepth: 0 })
            })
        })
        // Issuing after parent publication must still find the open child.
        const outside = r.run(chain, path, "write", [2], ctx, { mutationScopeDepth: 2 })
        await new Promise(resolve => setImmediate(resolve))
        const beforeRelease = [...effects]
        release.resolve()
        await Promise.all([nested, outside])
        assert.deepEqual(beforeRelease, [])
        assert.deepEqual(effects, [1, 2])
        verifyRefCounts(ctx, chain._state)
    })

    it("does not make an earlier argument-waiting mutation wait for a later entry", async () => {
        const { ctx, chain } = setup({ value: 0, write(value) { this.value = value } })
        const argument = Promise.withResolvers()
        const call = r.run(chain, ["api"], "write", [argument.promise], ctx,
            { mutationScopeDepth: 1, repair: false })
        const entry = r.enter(chain, ["api"], ctx, true, async entered => {
            assert.equal(await r.lookupPath(entered, ["value"], ctx), 3)
        })
        argument.resolve(3)
        await Promise.all([call, entry])
    })

    it("orders invalid managed scopes after an earlier external entry", async () => {
        const { ctx, chain, path } = setup({ value: 0, write() { assert.fail("invalid mixed call") } }, true)
        const release = Promise.withResolvers()
        const entry = r.enter(chain, path, ctx, true, async entered => {
            await release.promise
            assert.equal(await r.lookupPath(entered, ["value"], ctx), 0)
        })
        const middle = r.run(chain, path, "write", [], ctx, { mutationScopeDepth: 1 })
        const outer = r.run(chain, path, "write", [], ctx, { mutationScopeDepth: 0 })
        release.resolve()
        await entry
        assert.equal((await middle).kind, r.ERROR_KIND.PropertyValidation)
        assert.equal((await outer).kind, r.ERROR_KIND.PropertyValidation)
        await r.repairPath(chain, [], ctx)
        await r.repairPath(chain, ["group"], ctx)
        assert.equal(await r.lookupPath(chain, [...path, "value"], ctx), 0)
        verifyRefCounts(ctx, chain._state)
    })

    it("holds mixed observation coverage until its callback closes", async () => {
        const { ctx, chain, path } = setup({ value: 0, write() { this.value++ } }, true)
        const release = Promise.withResolvers()
        let invoked = false
        const captured = r.enter(chain, [], ctx, false, async entered => {
            await release.promise
            assert.equal(await r.lookupPath(entered, [...path, "value"], ctx), 0)
        })
        const active = r.enter(chain, ["group"], ctx, true, entered => {
            invoked = true
            return r.run(entered, ["api"], "write", [], ctx, { mutationScopeDepth: 1 })
        })
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(invoked, false)
        release.resolve()
        await Promise.all([captured, active])
        assert.equal(await r.lookupPath(chain, [...path, "value"], ctx), 1)
        verifyRefCounts(ctx, chain._state)
    })

    it("allows outside observations during nested readonly entry", async () => {
        const { ctx, chain, path } = setup({ value: 1 }, true)
        const ready = Promise.withResolvers()
        const finish = Promise.withResolvers()
        const captured = r.enter(chain, [], ctx, false, entered =>
            r.enter(entered, path, ctx, false, async () => {
                ready.resolve()
                await finish.promise
            }))
        await ready.promise
        let delivered = false
        const outside = Promise.resolve(r.lookupPath(chain, [...path, "value"], ctx)).then(value => {
            delivered = true
            assert.equal(value, 1)
        })
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(delivered, true)
        finish.resolve()
        await Promise.all([captured, outside])
    })

    it("retains fixed bindings when COW reflection poisons a managed prefix", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const native = r.externalState({ value: 1 })
        let failCopy = false
        const cause = new Error("copy failed")
        const group = new Proxy({ api: native, ordinary: 1 }, {
            ownKeys(target) { if (failCopy) throw cause; return Reflect.ownKeys(target) },
        })
        const chain = new r.ContextChain({ group }, ctx, { group: { api: {} } })
        const start = Promise.withResolvers()
        const captured = r.enter(chain, [], ctx, false, async entered => {
            await start.promise
            return r.lookupPath(entered, ["group", "api", "value"], ctx)
        })
        failCopy = true
        r.assignPath(chain, ["group", "ordinary"], 2, ctx)
        const failed = r.lookupPath(chain, ["group"], ctx)
        // Failed copying changes this managed placement, not the native resource
        // still observed through the earlier entry's captured namespace.
        assert.equal(failed.cause, cause)
        start.resolve()
        assert.equal(await captured, 1)
        const failure = await failed
        assert.equal(failure.cause, cause)
        failCopy = false
        await r.repairPath(chain, ["group"], ctx)
        assert.equal(await r.lookupPath(chain, ["group", "api", "value"], ctx), 1)
        assert.equal(r.lookupPath(chain, ["group", "ordinary"], ctx), 1)
        verifyRefCounts(ctx, chain._state)
    })

    for (const pending of [false, true]) {
        it(`repairs managed namespace poison before a separately authorized native call, pending=${pending}`, async () => {
            const { ctx, chain, path } = setup({ value: 0, repair() { this.value++; return this.value } }, true)
            const failure = r.run(chain, path, "repair", [], ctx, { mutationScopeDepth: 1 })
            assert.equal(failure.kind, r.ERROR_KIND.PropertyValidation)
            await r.repairPath(chain, ["group"], ctx)
            const arg = pending ? Promise.resolve(1) : 1
            assert.equal(await r.run(chain, path, "repair", [arg], ctx, { mutationScopeDepth: 2 }), 1)
            assert.equal(await r.lookupPath(chain, [...path, "value"], ctx), 1)
            verifyRefCounts(ctx, chain._state)
        })
    }
    it("repairs an external scope after its pending predecessor publishes poison", async () => {
        const failed = Promise.withResolvers()
        const { ctx, chain, path } = setup({ fail() { return failed.promise }, repair() { return 2 } }, true)
        const first = r.run(chain, path, "fail", [], ctx, { mutationScopeDepth: 2 })
        const repaired = r.run(chain, path, "repair", [], ctx, { mutationScopeDepth: 2, repair: true })
        failed.reject(new Error("failed"))
        assert.equal((await first).kind, r.ERROR_KIND.InvocationFailed)
        assert.equal(await repaired, 2)
        assert.equal(await r.hasError(chain, ["group"], ctx), false)
    })

    for (const entry of [false, true]) {
        it(`orders an earlier child entry before a later ancestor scope, entry=${entry}`, async () => {
            const effects = []
            const { ctx, chain, path } = setup({ write() { effects.push("inner") } }, true)
            const start = Promise.withResolvers()
            const inner = r.enter(chain, path, ctx, true, async entered => {
                await start.promise
                await r.run(entered, [], "write", [], ctx, { mutationScopeDepth: 0, repair: false })
            })
            const fail = target => r.assignPath(target, [], 1, ctx)
            const outer = entry
                ? r.enter(chain, ["group"], ctx, true, entered => { effects.push("outer"); return fail(entered) })
                : r.assignPath(chain, ["group"], 1, ctx)
            start.resolve()
            await Promise.all([inner, outer])
            const failure = await r.lookupPath(chain, ["group"], ctx)
            assert.equal(failure.kind, r.ERROR_KIND.PropertyValidation)
            assert.deepEqual(effects, entry ? ["inner", "outer"] : ["inner"])
            assert.equal(r.lookupPath(chain, ["group"], ctx), failure)
            await r.repairPath(chain, ["group"], ctx)
            assert.equal(await r.run(chain, path, "write", [], ctx, { repair: false }), undefined)
        })
    }

    it("retains contextual query poison across a later repair and unrelated pending data", async () => {
        const { ctx, chain } = setup({ fail() { throw new Error("old") } })
        const pending = Promise.withResolvers()
        r.assignPath(chain, ["ordinary"], pending.promise, ctx)
        const failure = await r.run(chain, ["api"], "fail", [], ctx,
            { mutationScopeDepth: 1, repair: false })
        const queried = r.getErrors(chain, [], ctx)
        await r.repairPath(chain, ["api"], ctx)
        pending.resolve(1)
        assert.equal(await queried, failure)
        assert.equal(await r.getErrors(chain, [], ctx), null)
        verifyRefCounts(ctx, chain._state)
    })

    it("orders namespace poison after previously captured managed entries", async () => {
        const { ctx, chain, path } = setup({ value: 1 }, true)
        const release = Promise.withResolvers()
        const entry = r.enter(chain, ["group"], ctx, false, async entered => {
            await release.promise
            assert.equal(await r.lookupPath(entered, ["api", "value"], ctx), 1)
            assert.equal(r.lookupPath(entered, ["ordinary"], ctx), 1)
        })
        const failed = r.run(chain, path, "unused", [], ctx, { mutationScopeDepth: 1 })
        release.resolve()
        await entry
        const failure = await failed
        assert.equal(failure.kind, r.ERROR_KIND.PropertyValidation)
        assert.equal(await r.repairPath(chain, path, ctx), failure)
        await r.repairPath(chain, ["group"], ctx)
        assert.equal(await r.lookupPath(chain, [...path, "value"], ctx), 1)
    })

    it("preserves valid native mutation when independent result admission fails", async () => {
        const cause = new Error("result reflection")
        const bad = new Proxy({ nested: 1 }, { ownKeys() { throw cause } })
        const { ctx, chain } = setup({ value: 0, change() { this.value++; return bad } })
        const failure = await r.run(chain, ["api"], "change", [], ctx,
            { mutationScopeDepth: 1, repair: false })
        assert.equal(failure.cause, cause)
        assert.equal(failure.kind, r.ERROR_KIND.ImportReflectionFailed)
        assert.equal(await r.hasError(chain, [], ctx), false)
        assert.equal(await r.lookupPath(chain, ["api", "value"], ctx), 1)
    })

    it("collects result Errors on both sides of a failing property descriptor", async () => {
        const first = new Error("first")
        const cause = new Error("descriptor")
        const last = new Error("last")
        const data = new Proxy({ first, bad: 1, last }, {
            getOwnPropertyDescriptor(target, key) {
                if (key === "bad") throw cause
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        const { ctx, chain } = setup({ value: 0, change() { this.value++; return data } })
        const failure = await r.run(chain, ["api"], "change", [], ctx,
            { mutationScopeDepth: 1, repair: false })
        assert.equal(failure.kind, r.ERROR_KIND.Multiple)
        assert.equal(failure.errors.length, 3)
        for (const error of [first, cause, last]) assert(failure.errors.some(item => item.cause === error))
        assert.equal(failure.errors.find(item => item.cause === cause).kind, r.ERROR_KIND.ImportReflectionFailed)
        assert.equal(metaOf(data, ctx), undefined)
        assert.equal(await r.getErrors(chain, [], ctx), null)
        assert.equal(await r.lookupPath(chain, ["api", "value"], ctx), 1)
    })

    it("retains independent ready result Errors when capability validation also fails", async () => {
        const first = new Error("first")
        const second = new Error("second")
        const { ctx, chain } = setup({ result() { return { first, self: this, second } } })
        const failure = await r.run(chain, ["api"], "result", [], ctx,
            { mutationScopeDepth: 1, repair: false })
        assert.equal(failure.kind, r.ERROR_KIND.Multiple)
        assert.equal(failure.errors.length, 3)
        assert(failure.errors.some(error => error.cause === first))
        assert(failure.errors.some(error => error.cause === second))
        assert.equal(await r.getErrors(chain, [], ctx),
            failure.errors.find(error => error.kind === r.ERROR_KIND.ExternalCapabilityEscape))
    })

    it("rejects pending outward work on fatal native re-entry without running successors", async () => {
        const reports = []
        const ctx = { execution: new r.Execution(error => reports.push(error)), errorContext: {} }
        let chain
        let later = false
        const native = r.externalState({
            invalid() { return r.lookupPath(chain, [], ctx) },
            later() { later = true },
        })
        chain = new r.ContextChain({ api: native }, ctx, { api: {} })
        const start = Promise.withResolvers()
        const first = r.run(chain, ["api"], "invalid", [start.promise], ctx, { mutationScopeDepth: 1, repair: false })
        const second = r.run(chain, ["api"], "later", [], ctx, { mutationScopeDepth: 1, repair: false })
        start.resolve()
        const results = await Promise.allSettled([first, second])
        for (const result of results) {
            assert.equal(result.status, "rejected")
            assert.equal(result.reason, ctx.execution.fatalError)
        }
        assert.equal(reports.length, 1)
        assert.equal(later, false)
    })

    it("drains reserved query observations after a managed Error proves hasError", async () => {
        const { ctx, chain } = setup({ value: 0 })
        r.assignPath(chain, ["ordinary"], new Error("managed"), ctx)
        assert.equal(await r.hasError(chain, [], ctx), true)
        r.assignPath(chain, ["api", "value"], 2, ctx)
        assert.equal(await r.lookupPath(chain, ["api", "value"], ctx), 2)
    })

    for (const deferredProof of [false, true]) {
        it(`stops unreserved query selection after completion, deferred proof=${deferredProof}`, async () => {
            const { ctx, chain } = setup({ value: 0 })
            const proof = Promise.withResolvers()
            r.assignPath(chain, ["ordinary"], deferredProof ? proof.promise : new Error("known"), ctx)
            const started = Promise.withResolvers()
            const release = Promise.withResolvers()
            const entry = r.enter(chain, ["api"], ctx, false, async () => {
                started.resolve()
                await release.promise
            })
            await started.promise
            const result = r.hasError(chain, [], ctx)
            if (deferredProof) proof.reject(new Error("known later"))
            assert.equal(await result, true)
            release.resolve()
            await entry
            await new Promise(resolve => setImmediate(resolve))
            r.assignPath(chain, ["api", "value"], 2, ctx)
            assert.equal(await r.lookupPath(chain, ["api", "value"], ctx), 2)
        })
    }

    it("drains an already reserved query phase after its predecessor completes", async () => {
        const release = Promise.withResolvers()
        const started = Promise.withResolvers()
        const { ctx, chain } = setup({ value: 0, async write() {
            started.resolve()
            await release.promise
            this.value = 1
        } })
        const mutation = r.run(chain, ["api"], "write", [], ctx,
            { mutationScopeDepth: 1, repair: false })
        await started.promise
        r.assignPath(chain, ["ordinary"], new Error("known"), ctx)
        assert.equal(r.hasError(chain, [], ctx), true)
        r.assignPath(chain, ["api", "value"], 2, ctx)
        release.resolve()
        await mutation
        assert.equal(await r.lookupPath(chain, ["api", "value"], ctx), 2)
    })

    it("stops unreserved external selection after a query reflection failure", async () => {
        const { ctx, chain } = setup({ value: 0 })
        let fail = false
        const cause = new Error("query reflection")
        const data = r.import(new Proxy({ value: 1 }, {
            ownKeys(target) { if (fail) throw cause; return Reflect.ownKeys(target) },
        }), ctx)
        r.assignPath(chain, ["ordinary"], data, ctx)
        const release = Promise.withResolvers()
        const entry = r.enter(chain, ["api"], ctx, false, () => release.promise)
        fail = true
        const result = r.getErrors(chain, [], ctx)
        assert.equal(result.kind, r.ERROR_KIND.QueryReflectionFailed)
        assert.equal(result.cause, cause)
        release.resolve()
        await entry
        await new Promise(resolve => setImmediate(resolve))
    })

    for (const parent of [false, true]) {
        it(`poisons the selected scope on failed argument/write export, parent=${parent}`, async () => {
            let calls = 0
            const { ctx, chain, path } = setup({ value: 0, write() { calls++ } }, parent)
            const cause = new Error("argument")
            const failure = await r.run(chain, path, "write", [cause], ctx,
                { mutationScopeDepth: path.length, repair: false })
            assert.equal(failure.cause, cause)
            assert.equal(calls, 0)
            assert.equal(await r.getErrors(chain, [], ctx), failure)
            await r.repairPath(chain, path, ctx)
            r.assignPath(chain, [...path, "value"], cause, ctx, path.length)
            const written = await r.getErrors(chain, [], ctx)
            assert.equal(written.cause, cause)
            await r.repairPath(chain, path, ctx)
            assert.equal(await r.lookupPath(chain, [...path, "value"], ctx), 0)
        })
    }

    for (const deleting of [false, true]) {
        it(`poisons refused native storage effects, deleting=${deleting}`, async () => {
            const native = new Proxy({ value: 1 }, {
                set() { return false }, deleteProperty() { return false },
            })
            const { ctx, chain } = setup(native)
            if (deleting) r.deletePath(chain, ["api", "value"], ctx)
            else r.assignPath(chain, ["api", "value"], 2, ctx)
            const failure = await r.getErrors(chain, [], ctx)
            assert.equal(failure.kind, deleting ? r.ERROR_KIND.ExternalPropertyDeleteFailed : r.ERROR_KIND.ExternalPropertyWriteFailed)
            await r.repairPath(chain, ["api"], ctx)
            assert.equal(await r.lookupPath(chain, ["api", "value"], ctx), 1)
        })
    }

    it("rejects intermediate thenables without subscribing, but consumes a direct property result", async () => {
        let subscriptions = 0
        const thenable = { then(resolve) { subscriptions++; return resolve({ value: 1 }) } }
        const { ctx, chain } = setup({ child: thenable })
        const lookup = await r.lookupPath(chain, ["api", "child", "value"], ctx)
        assert.equal(lookup.kind, r.ERROR_KIND.ExternalPropertyReadFailed)
        assert.equal(subscriptions, 0)
        assert.deepEqual(await r.lookupPath(chain, ["api", "child"], ctx), { value: 1 })
        assert.equal(subscriptions, 1)
        r.assignPath(chain, ["api", "child", "value"], 2, ctx)
        assert.equal((await r.getErrors(chain, [], ctx)).kind, r.ERROR_KIND.ExternalPropertyReadFailed)
        assert.equal(subscriptions, 1)
    })

    it("copies mixed raw and managed snapshots through logical versions with aliases and cycles", async () => {
        class Data { read() { return this.value } }
        const { ctx, chain } = setup({ data: undefined })
        const pending = Promise.withResolvers()
        const source = { value: pending.promise }
        const managed = r.import(source, ctx)
        pending.resolve(4)
        const managedChain = new r.Chain(managed, ctx)
        assert.equal(await r.lookupPath(managedChain, ["value"], ctx), 4)
        const array = new Array(3)
        array[2] = managed
        const host = Object.assign(new Data(), { value: 2, managed, array })
        host.self = host
        const native = chain._state.value.api
        native.data = host
        const copy = await r.lookupPath(chain, ["api", "data"], ctx)
        assert(copy instanceof Data)
        assert.equal(r.run(new r.Chain(copy, ctx), [], "read", [], ctx, { repair: false }), 2)
        assert.equal(copy.self, copy)
        assert.equal(copy.array[2], copy.managed)
        assert.notEqual(copy.managed, managed)
        assert.equal(copy.managed.value, 4)
        assert.equal(0 in copy.array, false)
        assert.equal(metaOf(host, ctx), undefined)
        verifyRefCounts(ctx, chain._state, managedChain._state)
    })

    it("preserves snapshot Functions and copies logical ArrayViews", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const input = new r.Chain(r.import([0, { value: 1 }, 2], ctx), ctx)
        const view = r.run(input, [], "slice", [1], ctx, { repair: false })
        const fn = () => 1
        const native = r.externalState({ view, fn })
        const chain = new r.ContextChain({ api: native }, ctx, { api: {} })
        assert.equal(await r.lookupPath(chain, ["api", "fn"], ctx), fn)
        const copy = await r.lookupPath(chain, ["api", "view"], ctx)
        assert.deepEqual(copy, [{ value: 1 }, 2])
        assert.notEqual(copy[0], r.lookupPath(input, [1], ctx))
    })

    it("reads logical Array lengths through native aliases without consuming pending elements", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const pending = Promise.withResolvers()
        const array = r.import([0, pending.promise, 2], ctx)
        const source = new r.Chain(array, ctx)
        const view = r.run(source, [], "slice", [1], ctx, { repair: false })
        const native = r.externalState({ array, view })
        const chain = new r.ContextChain({ api: native }, ctx, { api: {} })
        assert.equal(await r.lookupPath(chain, ["api", "array", "length"], ctx), 3)
        assert.equal(await r.lookupPath(chain, ["api", "view", "length"], ctx), 2)
        assert.equal(await r.lookupPath(chain, ["api", "array", "custom"], ctx), undefined)
        pending.resolve(1)
        assert.deepEqual(await r.export(source, [], ctx), [0, 1, 2])
    })

    for (const mutable of [false, true]) {
        it(`exports native properties without admitting host-owned output, mutable=${mutable}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const source = r.import({ nested: { value: 1 } }, ctx)
            const native = r.externalState({ source })
            const chain = new r.ContextChain({ api: native }, ctx, mutable ? { api: {} } : undefined)
            const output = await r.export(chain, ["api", "source"], ctx)
            assert.deepEqual(output, { nested: { value: 1 } })
            assert.notEqual(output, source)
            assert.equal(metaOf(output, ctx), undefined)
            assert.equal(metaOf(output.nested, ctx), undefined)
            output.nested.value = 2
            assert.equal(source.nested.value, 1)
            const returned = new r.Chain(r.import(output, ctx), ctx)
            assert.equal(r.lookupPath(returned, ["nested", "value"], ctx), 2)
        })
    }

    it("rejects pending managed snapshot sources and native writes or calls through managed aliases", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const pending = Promise.withResolvers()
        let called = false
        const source = r.import({ pending: pending.promise, value: 1, call() { called = true } }, ctx)
        const native = r.externalState({ source })
        const chain = new r.ContextChain({ api: native }, ctx, { api: {} })
        assert.equal((await r.lookupPath(chain, ["api", "source"], ctx)).kind, r.ERROR_KIND.InvalidExternalSnapshot)
        assert.equal((await r.lookupPath(chain, ["api", "source", "pending"], ctx)).kind, r.ERROR_KIND.InvalidExternalSnapshot)
        r.assignPath(chain, ["api", "source", "value"], 2, ctx)
        assert.equal((await r.getErrors(chain, [], ctx)).kind, r.ERROR_KIND.UnsupportedMutation)
        await r.repairPath(chain, ["api"], ctx)
        const failure = await r.run(chain, ["api", "source"], "call", [], ctx, { repair: false })
        assert.equal(failure.kind, r.ERROR_KIND.InvocationFailed)
        assert.equal(called, false)
        assert.equal(source.value, 1)
        pending.resolve(3)
        await pending.promise
        assert.deepEqual(await r.lookupPath(chain, ["api", "source", "pending"], ctx), 3)
    })

    for (const deep of [false, true]) for (const action of ["assign", "delete", "call"]) {
        it(`does not regain native mutation authority after managed storage, deep=${deep}, ${action}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            let calls = 0, reads = 0
            const observationOnly = r.externalState({ x: 1, data: { value: 1 }, bump() { calls++; this.x++ }, read() { return this.x } })
            const holder = { ext: deep ? r.externalState({ get child() { reads++; return observationOnly } }) : observationOnly }
            const api = r.externalState({ holder })
            const chain = new r.ContextChain({ api, holder, observationOnly }, ctx, { api: {} })
            const path = ["api", "holder", "ext", ...(deep ? ["child"] : [])]
            const snapshot = r.lookupPath(chain, [...path, "data"], ctx)
            assert.deepEqual(snapshot, { value: 1 })
            assert.notEqual(snapshot, observationOnly.data)
            assert.equal(r.run(chain, path, "read", [], ctx, {}), 1)
            reads = 0
            const result = action === "assign" ? r.assignPath(chain, [...path, "x"], 9, ctx, 1)
                : action === "delete" ? r.deletePath(chain, [...path, "x"], ctx, 1)
                    : r.run(chain, path, "bump", [], ctx, { mutationScopeDepth: 1 })
            const failure = await result
            assert.equal(failure.kind, action === "call" ? r.ERROR_KIND.InvocationFailed : r.ERROR_KIND.UnsupportedMutation)
            assert.equal(r.getErrors(chain, ["api"], ctx), failure)
            assert.equal(observationOnly.x, 1)
            assert.equal(calls, 0)
            assert.equal(reads, 0)
            assert.equal(r.lookupPath(chain, ["observationOnly", "x"], ctx), 1)
            await r.repairPath(chain, ["api"], ctx)
            assert.equal(r.lookupPath(chain, [...path, "x"], ctx), 1)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("rejects nested snapshot availability without subscribing and keeps all ready Errors", async () => {
        let subscriptions = 0
        const first = new Error("first")
        const second = new Error("second")
        const data = { a: first, pending: { then() { subscriptions++ } }, b: second }
        const { ctx, chain } = setup({ data })
        const failure = await r.lookupPath(chain, ["api", "data"], ctx)
        assert.equal(failure.kind, r.ERROR_KIND.Multiple)
        assert.equal(failure.errors.length, 3)
        assert(failure.errors.some(error => error.cause === first))
        assert(failure.errors.some(error => error.cause === second))
        assert.equal(subscriptions, 0)
        assert.equal(metaOf(data, ctx), undefined)
        assert.equal(await r.hasError(chain, [], ctx), false)
    })

    it("rejects a snapshot with an inherited thenable without subscribing", async () => {
        const data = Object.create({ then() { assert.fail("snapshot must not subscribe") } })
        const { ctx, chain } = setup({ data: { nested: data } })
        const failure = await r.lookupPath(chain, ["api", "data"], ctx)
        assert.equal(failure.kind, r.ERROR_KIND.InvalidExternalSnapshot)
        assert.equal(await r.hasError(chain, [], ctx), false)
    })

    for (const accessor of [false, true]) {
        it(`validates snapshot prototype then safety beneath a shadowing value, accessor=${accessor}`, async () => {
            class Base {}
            class Data extends Base {}
            const unexpected = () => assert.fail("snapshot must not invoke prototype then")
            Object.defineProperty(Base.prototype, "then", accessor ? { get: unexpected } : { value: unexpected })
            const data = new Data()
            Object.defineProperty(data, "then", { value: 0, enumerable: true })
            const cause = new Error("other snapshot data failed")
            const { ctx, chain } = setup({ data: { child: data, error: cause } })
            const failure = await r.lookupPath(chain, ["api", "data"], ctx)
            assert.equal(failure.errors.length, 2)
            assert(failure.errors.some(error => error.kind === r.ERROR_KIND.InvalidExternalSnapshot))
            assert(failure.errors.some(error => error.cause === cause))
            assert.equal(metaOf(data, ctx), undefined)
            assert.equal(await r.hasError(chain, [], ctx), false)
        })
    }

    it("admits observation-only properties as exact external identities and permits self-return", () => {
        const native = r.externalState({ child: { value: 1 }, self() { return this } })
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const chain = new r.Chain(native, ctx)
        assert.equal(r.lookupPath(chain, ["child"], ctx), native.child)
        assert.equal(r.run(chain, [], "self", [], ctx, { repair: false }), native)
        assert.equal(r.lookupPath(chain, ["child", "value"], ctx), 1)
    })

    it("rejects receiver and registered-identity escape in call results, including deferred nested data", async () => {
        const pending = Promise.withResolvers()
        const native = { self() { return this }, nested() { return { pending: pending.promise } } }
        const { ctx, chain } = setup(native)
        const failure = await r.run(chain, ["api"], "self", [], ctx,
            { mutationScopeDepth: 1, repair: false })
        assert.equal(failure.kind, r.ERROR_KIND.ExternalCapabilityEscape)
        assert.equal(await r.getErrors(chain, [], ctx), failure)
        await r.repairPath(chain, ["api"], ctx)
        const result = await r.run(chain, ["api"], "nested", [], ctx, { repair: false })
        const output = new r.Chain(result, ctx)
        pending.resolve(native)
        assert.equal((await r.lookupPath(output, ["pending"], ctx)).kind, r.ERROR_KIND.ExternalCapabilityEscape)
    })

    for (const registered of [false, true]) {
        it(`validates borrowed pending results without changing their source, registered=${registered}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const pending = Promise.withResolvers()
            const stable = { value: 3 }
            const data = { child: { pending: pending.promise }, stable }
            data.self = data
            const source = r.import(data, ctx)
            const input = new r.Chain(source, ctx)
            const version = metaOf(source.child, ctx).placementVersions.pending
            const receiver = r.externalState({ value: 0, result() { this.value++; return { source, alias: source } } })
            const native = registered ? receiver : r.externalState({ receiver })
            const chain = new r.ContextChain({ api: native }, ctx, { api: {} })
            const path = registered ? ["api"] : ["api", "receiver"]
            const result = await r.run(chain, path, "result", [], ctx,
                { mutationScopeDepth: 1, repair: false })
            const output = new r.Chain(result, ctx)
            const copy = r.lookupPath(output, ["source"], ctx)
            assert.notEqual(copy, source)
            assert.equal(r.lookupPath(output, ["alias"], ctx), copy)
            assert.equal(r.lookupPath(output, ["source", "self"], ctx), copy)
            assert.equal(r.lookupPath(output, ["source", "stable"], ctx), stable)
            assert.equal(metaOf(source.child, ctx).placementVersions.pending, version)
            r.assignPath(chain, [...path, "value"], 2, ctx)
            assert.equal(await r.lookupPath(chain, [...path, "value"], ctx), 2)
            pending.resolve(receiver)
            const failure = await r.lookupPath(output, ["source", "child", "pending"], ctx)
            assert.equal(failure.kind, r.ERROR_KIND.ExternalCapabilityEscape)
            const sourceValue = await r.lookupPath(input, ["child", "pending"], ctx)
            if (registered) assert.equal(sourceValue.kind, r.ERROR_KIND.ExternalLocationConflict)
            else assert.equal(sourceValue, receiver)
            assert.equal(version.value, receiver)
            assert.equal(metaOf(source.child, ctx).placementVersions.pending, version)
            assert.equal(await r.getErrors(chain, [], ctx), null)
            verifyRefCounts(ctx, chain._state, input._state, output._state)
        })
    }

    it("preserves the source version's rejection attribution in a borrowed result", async () => {
        const execution = new r.Execution()
        const importedAt = { execution, errorContext: { operation: "import" } }
        const calledAt = { execution, errorContext: { operation: "call" } }
        const pending = Promise.withResolvers()
        const graph = r.import({ pending: pending.promise }, importedAt)
        const input = new r.Chain(graph, importedAt)
        const native = r.externalState({ result() { return graph } })
        const chain = new r.ContextChain({ api: native }, calledAt, { api: {} })
        const result = await r.run(chain, ["api"], "result", [], calledAt, { repair: false })
        const output = new r.Chain(result, calledAt)
        const cause = new Error("source rejection")
        pending.reject(cause)
        const failure = await r.lookupPath(output, ["pending"], calledAt)
        assert.equal(failure, await r.lookupPath(input, ["pending"], importedAt))
        assert.equal(failure.kind, r.ERROR_KIND.ContextValueFailed)
        assert.equal(failure.errorContext, importedAt.errorContext)
        assert.equal(failure.cause, cause)
        verifyRefCounts(calledAt, chain._state, input._state, output._state)
    })

    it("borrows an unconsumed Chain placement through its ordinary source settlement", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const pending = Promise.withResolvers()
        const graph = { pending: pending.promise }
        const input = new r.Chain(graph, ctx)
        const native = r.externalState({ result() { return graph } })
        const chain = new r.ContextChain({ api: native }, ctx, { api: {} })
        const result = await r.run(chain, ["api"], "result", [], ctx, { repair: false })
        const output = new r.Chain(result, ctx)
        const cause = new Error("source")
        pending.reject(cause)
        const failure = await r.lookupPath(input, ["pending"], ctx)
        assert.equal(failure.kind, r.ERROR_KIND.OperationInputFailed)
        assert.equal(await r.lookupPath(output, ["pending"], ctx), failure)
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const boundary of ["import", "call"]) for (const outcome of ["value", "capability", "rejection"])
    for (const shape of ["direct", "alias-first", "alias-last"]) {
        it(`borrows lazy descendants without publishing result validation into the source: ${boundary}, ${outcome}, ${shape}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }, pending = Promise.withResolvers()
            const child = shape === "alias-first" ? { parent: undefined, pending: pending.promise } : { pending: pending.promise }
            const graph = { child, alias: child, stable: { n: 1 } }
            child.parent = graph
            const input = new r.Chain({ graph }, ctx)
            const borrowed = r.lookupPath(input, ["graph"], ctx)
            const payload = shape === "direct" ? borrowed : shape === "alias-first"
                ? { alias: child, borrowed } : { borrowed, alias: child }
            const native = r.externalState({ result() { return payload } })
            const host = new r.ContextChain({ api: native }, ctx, { api: {} })
            const result = boundary === "import" ? r.importMethodResult(payload, ctx)
                : r.run(host, ["api"], "result", [], ctx, {})
            assert.equal(result instanceof Promise, false)
            const resultChain = new r.Chain(result, ctx)
            const copy = r.lookupPath(resultChain, shape === "direct" ? [] : ["borrowed"], ctx)
            assert.notEqual(copy, borrowed)
            assert.equal(copy.child, copy.alias)
            assert.equal(copy.child.parent, copy)
            assert.equal(copy.stable, graph.stable)
            if (shape !== "direct") assert.equal(r.lookupPath(resultChain, ["alias"], ctx), copy.child)
            const output = new r.Chain(copy, ctx)
            const value = { n: 2 }, cause = new Error("source")
            if (outcome === "rejection") pending.reject(cause)
            else pending.resolve(outcome === "capability" ? native : value)
            const sourceValue = await r.lookupPath(input, ["graph", "child", "pending"], ctx)
            const resultValue = await r.lookupPath(output, ["child", "pending"], ctx)
            if (outcome === "capability") {
                assert.equal(sourceValue.kind, r.ERROR_KIND.ExternalLocationConflict)
                assert.equal(resultValue.kind, r.ERROR_KIND.ExternalCapabilityEscape)
            } else {
                assert.equal(resultValue, sourceValue)
                if (outcome === "rejection") {
                    assert.equal(sourceValue.kind, r.ERROR_KIND.OperationInputFailed)
                    assert.equal(sourceValue.cause, cause)
                } else assert.deepEqual(sourceValue, value)
            }
            assert.equal(r.getErrors(host, [], ctx), null)
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, host._state, input._state, output._state, resultChain._state)
        })
    }
    it("orders native mutation, overlapping observations, and a later mutation", async () => {
        const first = Promise.withResolvers()
        const left = Promise.withResolvers()
        const right = Promise.withResolvers()
        const events = []
        const native = {
            value: 0,
            async write() { events.push("write"); await first.promise; this.value = 1 },
            async left() { events.push("left"); await left.promise; return this.value },
            async right() { events.push("right"); await right.promise; return this.value },
            close() { events.push("close"); this.value = 2 },
        }
        const { ctx, chain, path } = setup(native)
        const write = r.run(chain, path, "write", [], ctx, { mutationScopeDepth: 1, repair: false })
        const a = r.run(chain, path, "left", [], ctx, { repair: false })
        const b = r.run(chain, path, "right", [], ctx, { repair: false })
        const close = r.run(chain, path, "close", [], ctx, { mutationScopeDepth: 1, repair: false })
        first.resolve()
        await write
        await new Promise(resolve => setImmediate(resolve))
        assert.deepEqual(events, ["write", "left", "right"])
        left.resolve()
        assert.equal(await a, 1)
        assert(!events.includes("close"))
        right.resolve()
        assert.equal(await b, 1)
        assert.equal(await close, undefined)
        assert.deepEqual(events, ["write", "left", "right", "close"])
    })

    it("exports writes, snapshots reads, and replaces Promise-valued native targets without reading them", async () => {
        const native = { value: new Promise(() => {}) }
        const { ctx, chain, path } = setup(native)
        const data = { nested: { value: 1 } }
        const input = r.import(data, ctx)
        assert.equal(r.assignPath(chain, [...path, "value"], input, ctx), undefined)
        const snapshot = await r.lookupPath(chain, [...path, "value"], ctx)
        assert.deepEqual(snapshot, data)
        assert.notEqual(native.value, data)
        assert.notEqual(snapshot, native.value)
        r.assignPath(chain, [...path, "value", "nested", "value"], 2, ctx)
        assert.equal(await r.lookupPath(chain, [...path, "value", "nested", "value"], ctx), 2)
        assert.equal(snapshot.nested.value, 1)
        r.deletePath(chain, [...path, "value"], ctx)
        assert.equal(await r.lookupPath(chain, [...path, "value"], ctx), undefined)
    })

    for (const parent of [false, true]) {
        it(`poisons only the selected scope and repairs retained state, parent=${parent}`, async () => {
            const cause = new Error("failed")
            const native = { value: 0, fail() { this.value++; throw cause }, read() { return this.value } }
            const { ctx, chain, path } = setup(native, parent)
            const scope = path
            assert.equal(await r.hasError(chain, [], ctx), false)
            const failure = await r.run(chain, path, "fail", [], ctx, { mutationScopeDepth: path.length, repair: false })
            assert.equal(failure.cause, cause)
            assert.equal(await r.hasError(chain, scope, ctx), true)
            assert.equal(await r.getErrors(chain, [], ctx), failure)
            assert.equal(await r.lookupPath(chain, [...path, "value"], ctx), failure)
            assert.equal(await r.run(chain, path, "read", [], ctx, { repair: false }), failure)
            assert.equal(native.value, 1)
            assert.equal(await r.repairPath(chain, scope, ctx), undefined)
            assert.equal(await r.getErrors(chain, [], ctx), null)
            assert.equal(await r.run(chain, path, "read", [], ctx, { repair: false }), 1)
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("keeps observation failures local and rejects mutable capabilities on every export", async () => {
        const native = { get bad() { throw new Error("getter") }, read() { return 1 } }
        const { ctx, chain, path } = setup(native)
        assert.equal((await r.lookupPath(chain, [...path, "bad"], ctx)).kind, r.ERROR_KIND.ExternalPropertyReadFailed)
        assert.equal(await r.hasError(chain, path, ctx), false)
        assert.equal((await r.lookupPath(chain, path, ctx)).kind, r.ERROR_KIND.ExternalCapabilityEscape)
        assert.equal(r.export(chain, [], ctx).kind, r.ERROR_KIND.ExternalCapabilityEscape)
        assert.equal(await r.run(chain, path, "read", [], ctx, { repair: false }), 1)
    })
})
