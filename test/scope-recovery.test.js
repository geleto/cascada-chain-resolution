import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { TREE_NODE } from "../src/external-mutation-tree.js"
import { ExternalEffect } from "../src/external-operation.js"

const context = () => ({ execution: new r.Execution(), errorContext: {} })
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const mutate = (chain, path, method, ctx, args = [], scope = path.length) => r.run(chain, path, method, args, ctx, { mutationScopeDepth: scope })
function fixture() {
    const events = []
    const make = name => ({ count: 0, work(wait) { events.push(name); this.count++; return wait }, fail() { throw new Error(name) } })
    const api = r.externalState({ db: make("db"), config: make("config"), reset() { events.push("reset") } })
    const ctx = context()
    const chain = new r.ContextChain({ api }, ctx, { api: { db: {}, config: {} } })
    return { events, api, ctx, chain }
}

describe("hierarchical scopes and placement recovery", () => {
    for (const conflictDuringArguments of [false, true]) {
        it(`keeps descendant binding conflicts authoritative after repair, deferred=${conflictDuringArguments}`, async () => {
            const { api, ctx, chain, events } = fixture(), hold = Promise.withResolvers()
            mutate(chain, ["api", "config"], "fail", ctx)
            const compete = () => new r.ContextChain({ db: api.db }, ctx, { db: {} })
            if (!conflictDuringArguments) compete()
            const reset = r.run(chain, ["api"], "reset", conflictDuringArguments ? [hold.promise] : [], ctx,
                { mutationScopeDepth: 1, repair: true })
            if (conflictDuringArguments) compete()
            hold.resolve()
            const failure = await reset
            assert.equal(failure.kind, r.ERROR_KIND.ExternalLocationConflict)
            assert.deepEqual(events, [])
            assert.equal(r.getErrors(chain, ["api"], ctx), failure)
            assert.equal(r.getErrors(chain, ["api", "config"], ctx), null)
            mutate(chain, ["api", "config"], "work", ctx)
            assert.deepEqual(events, ["config"])
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("does not retain a mixed entry's native reservation for an unrelated managed lookup", async () => {
        const ctx = context(), hold = Promise.withResolvers()
        let calls = 0, reading
        const api = r.externalState({ db: { work() { calls++ } } })
        const chain = new r.ContextChain({ api, pending: hold.promise }, ctx, { api: { db: {} } })
        r.enter(chain, [], ctx, true, inside => {
            reading = r.lookupPath(inside, ["pending"], ctx)
        })
        const work = mutate(chain, ["api", "db"], "work", ctx)
        await flush()
        assert.equal(calls, 1)
        hold.resolve(7)
        assert.equal(await reading, 7)
        await work
    })

    for (const action of ["call-parent", "call-child", "assign", "delete", "enter", "repair"]) {
        it(`repairs dynamic native selection at its static external prefix: ${action}`, async () => {
            const { events, api, ctx, chain } = fixture()
            let failure
            if (action.startsWith("call")) failure = r.run(chain, ["api", "db"], "work", [], ctx,
                { mutationScopeDepth: action === "call-parent" ? 1 : 2, firstDynamicSegment: 1 })
            if (action === "assign") failure = r.assignPath(chain, ["api", "db", "count"], 5, ctx, 2, 1)
            if (action === "delete") failure = r.deletePath(chain, ["api", "db", "count"], ctx, 2, 1)
            if (action === "enter") failure = r.enter(chain, ["api", "db"], ctx, true, () => assert.fail("callback"), 1)
            if (action === "repair") failure = r.repairPath(chain, ["api", "db"], ctx, 1)
            failure = await failure
            assert.equal(failure.kind, r.ERROR_KIND.ExternalLocationConflict)
            assert.equal(await r.getErrors(chain, [], ctx), failure)
            assert.equal(await r.lookupPath(chain, ["api", "db", "count"], ctx), failure)
            assert.deepEqual(events, [])
            assert.equal(api.db.count, 0)
            assert.equal(await r.repairPath(chain, ["api"], ctx), undefined)
            assert.equal(await r.getErrors(chain, [], ctx), null)
            await mutate(chain, ["api", "db"], "work", ctx)
            assert.deepEqual(events, ["db"])
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("orders an invalid dynamic mutation after earlier native work", async () => {
        const { events, ctx, chain } = fixture(), hold = Promise.withResolvers()
        const first = mutate(chain, ["api", "db"], "work", ctx, [hold.promise])
        const invalid = r.run(chain, ["api", "db"], "work", [], ctx,
            { mutationScopeDepth: 2, firstDynamicSegment: 1, repair: true })
        assert(invalid instanceof Promise)
        hold.resolve()
        await first
        const failure = await invalid
        assert.equal(failure.kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.deepEqual(events, ["db"])
        assert.equal(await r.getErrors(chain, [], ctx), failure)
        assert.equal(await r.repairPath(chain, ["api"], ctx), undefined)
    })

    for (const pending of [false, true]) {
        it(`keeps failed Array entry mutation recoverable, pending=${pending}`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), cause = new Error("copy failed")
            let fail = false
            const source = new Proxy([], { ownKeys(target) {
                if (fail) throw cause
                return Reflect.ownKeys(target)
            } })
            const chain = new r.Chain(r.import(source, ctx), ctx)
            r.enter(chain, [3], ctx, true, element => {
                fail = true
                r.assignPath(element, [], pending ? hold.promise : 4, ctx)
            })
            fail = false
            hold.resolve(4)
            const failure = await r.lookupPath(chain, [], ctx)
            assert.equal(failure.kind, r.ERROR_KIND.PropertyMutationFailed)
            assert.equal(failure.cause, cause)
            assert.equal(ctx.execution.fatalError, null)
            await r.repairPath(chain, [], ctx)
            assert.deepEqual(await r.export(chain, [], ctx), [])
            assert.equal(source.length, 0)
        })
    }

    for (const array of [false, true]) {
        it(`repairs an absent placement after a deferred failed prefix, Array=${array}`, async () => {
            const ctx = context(), hold = Promise.withResolvers()
            const chain = new r.Chain(array ? new Array(1) : {}, ctx)
            const key = array ? 0 : "missing"
            const entry = r.enter(chain, [key], ctx, true, () => hold.promise)
            r.assignPath(chain, [key, "child"], 1, ctx)
            const observed = r.lookupPath(chain, [key], ctx)
            observed.catch(() => {})
            hold.resolve()
            await entry
            const poison = await observed
            assert.equal(poison.kind, r.ERROR_KIND.NullLookup)
            assert.equal(await r.getErrors(chain, [], ctx), poison)
            await r.repairPath(chain, [key], ctx)
            const restored = await r.export(chain, [], ctx)
            assert.deepEqual(Object.keys(restored), [])
            if (array) assert.equal(restored.length, 1)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const imported of [false, true]) for (const rejected of [false, true]) {
        it(`restores a pending baseline without waiting for its value, imported=${imported}, rejected=${rejected}`, async () => {
            const ctx = context(), old = Promise.withResolvers(), hold = Promise.withResolvers()
            const introduced = { ...ctx, errorContext: { operation: "original import" } }
            const data = { then: old.promise }
            const chain = new r.Chain(imported ? r.import(data, introduced) : data, ctx)
            assert.equal(r.assignPath(chain, ["then"], () => 1, ctx).kind, r.ERROR_KIND.PropertyValidation)
            const entry = r.enter(chain, ["then"], ctx, true, () => hold.promise)
            const repair = r.repairPath(chain, ["then"], ctx)
            let repaired = false
            repair.then(() => { repaired = true }, () => {})
            hold.resolve()
            await entry
            await flush()
            assert.equal(repaired, true)
            assert.equal(await repair, undefined)
            const restored = r.lookupPath(chain, ["then"], ctx)
            assert.ok(restored instanceof Promise)
            if (rejected) {
                const cause = new Error("old input")
                old.reject(cause)
                const poison = await restored
                assert.equal(poison.cause, cause)
                if (imported) {
                    assert.equal(poison.errorContext, introduced.errorContext)
                    assert.equal(poison.kind, r.ERROR_KIND.ContextValueFailed)
                }
            } else {
                old.resolve(7)
                assert.equal(await restored, 7)
            }
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("keeps cleared poison out of a failed repair-and-call publication", async () => {
        const ctx = context(), pending = Promise.withResolvers()
        const cause = new Error("new publication failure")
        let refuse = false
        const source = new Proxy({ item: {
            value: 1,
            fail() { throw new Error("cleared") },
            change() { this.value = 2; return pending.promise },
        } }, {
            set(target, key, value) {
                if (refuse && !(value instanceof Promise)) throw cause
                return Reflect.set(target, key, value)
            },
        })
        const chain = new r.Chain(source, ctx)
        const cleared = mutate(chain, ["item"], "fail", ctx)
        const result = r.run(chain, ["item"], "change", [], ctx, { mutationScopeDepth: 1, repair: true })
        refuse = true
        pending.resolve(3)
        const failure = await result
        assert.equal(failure.cause, cause)
        assert.notEqual(failure, cleared)
        assert.equal(r.lookupPath(chain, ["item"], ctx), failure)
        refuse = false
        r.repairPath(chain, ["item"], ctx)
        assert.equal(r.lookupPath(chain, ["item", "value"], ctx), 1)
    })

    for (const pending of [false, true]) {
        it(`preserves the original poison when restoration storage fails, pending=${pending}`, async () => {
            const ctx = context(), hold = Promise.withResolvers()
            const cause = new Error("restore refused")
            let refuse = false
            const source = new Proxy({ item: { value: 1, fail() { this.value = 2; throw new Error("original") } } }, {
                set(target, key, value) {
                    if (refuse && key === "item" && value && typeof value === "object" &&
                        !Error.isError(value) && !(value instanceof Promise)) throw cause
                    return Reflect.set(target, key, value)
                },
            })
            const chain = new r.Chain(source, ctx)
            const poison = mutate(chain, ["item"], "fail", ctx)
            const entry = pending ? r.enter(chain, ["item"], ctx, true, () => hold.promise) : undefined
            refuse = true
            const repair = r.repairPath(chain, ["item"], ctx)
            hold.resolve()
            await entry
            assert.equal((await repair).cause, cause)
            assert.equal(await r.lookupPath(chain, ["item"], ctx), poison)
            refuse = false
            await r.repairPath(chain, ["item"], ctx)
            assert.equal(await r.lookupPath(chain, ["item", "value"], ctx), 1)
        })
    }

    it("publishes a sparse intrinsic remap without filling unrelated holes", () => {
        const ctx = context()
        const source = new Array(100_000)
        source[1] = 2
        source[99_999] = 3
        const chain = new r.Chain(source, ctx)
        mutate(chain, [], "copyWithin", ctx, [0, 1, 2])
        const result = r.export(chain, [], ctx)
        assert.deepEqual(Object.keys(result), ["0", "1", "99999"])
        assert.equal(result.length, source.length)
        assert.equal(result[0], 2)
        assert.equal(Object.hasOwn(source, 0), false)
    })

    it("does no native storage work when repairing healthy or absent managed placements", () => {
        const ctx = context()
        let writes = 0
        const source = new Proxy({ present: 1 }, {
            set() { writes++; throw new Error("Unexpected write") },
            deleteProperty() { writes++; throw new Error("Unexpected deletion") },
        })
        const chain = new r.Chain(source, ctx)
        assert.equal(r.repairPath(chain, ["present"], ctx), undefined)
        assert.equal(r.repairPath(chain, ["absent"], ctx), undefined)
        assert.equal(writes, 0)
        assert.equal(r.lookupPath(chain, ["present"], ctx), 1)
        assert.equal(Object.hasOwn(source, "absent"), false)
    })
    it("keeps invalid dynamic repair at its static prefix and preserves an existing blocker", () => {
        const ctx = context()
        const api = r.externalState({})
        const chain = new r.ContextChain({ apis: { db: api } }, ctx, { apis: { db: {} } })
        const failure = r.repairPath(chain, ["apis", "db"], ctx, 1)
        assert.equal(failure.kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(r.getErrors(chain, ["apis"], ctx), failure)
        assert.equal(r.repairPath(chain, ["apis", "db"], ctx, 1), failure)
        assert.equal(r.repairPath(chain, ["apis"], ctx), undefined)
        assert.equal(r.getErrors(chain, [], ctx), null)
    })
    it("repairs only the requested absent Array placement, without waiting for or clearing siblings", async () => {
        const ctx = context(), wait = Promise.withResolvers()
        const api = r.externalState({ fail() { throw new Error("native failure") }, hold() { return wait.promise } })
        const other = r.externalState({ hold() { return wait.promise } })
        const chain = new r.ContextChain({ items: [api, other] }, ctx, { items: { 0: {}, 1: {} } })
        const poison = mutate(chain, ["items", 0], "fail", ctx)
        const pending = mutate(chain, ["items", 1], "hold", ctx)
        assert.equal(r.repairPath(chain, ["items", 5], ctx), undefined)
        assert.equal(r.repairPath(chain, ["items", "length"], ctx), undefined)
        assert.equal(r.getErrors(chain, ["items", 0], ctx), poison)
        assert.equal(r.lookupPath(chain, ["items", "length"], ctx), 2)
        assert.equal(r.lookupPath(chain, ["items", 5], ctx), undefined)
        wait.resolve()
        await pending
    })
    for (const relation of ["same", "ancestor", "descendant", "sibling"]) {
        for (const firstMutation of [false, true]) for (const secondMutation of [false, true])
            it(`orders ${relation} scopes, mutations=${firstMutation}/${secondMutation}`, async () => {
                const ctx = context(), events = [], wait = Promise.withResolvers()
                const methods = () => ({ hold() { events.push("first"); return wait.promise }, next() { events.push("second"); return 2 } })
                const api = r.externalState({ ...methods(), db: methods(), config: methods() })
                const chain = new r.ContextChain({ api }, ctx, { api: { db: {}, config: {} } })
                const firstPath = relation === "ancestor" ? ["api"] : ["api", "db"]
                const secondPath = relation === "descendant" ? ["api"] : relation === "sibling" ? ["api", "config"] : ["api", "db"]
                const first = r.run(chain, firstPath, "hold", [], ctx, firstMutation ? { mutationScopeDepth: firstPath.length } : {})
                const second = r.run(chain, secondPath, "next", [], ctx, secondMutation ? { mutationScopeDepth: secondPath.length } : {})
                const blocked = relation !== "sibling" && (firstMutation || secondMutation)
                assert.deepEqual(events, blocked ? ["first"] : ["first", "second"])
                wait.resolve(1)
                assert.deepEqual(await Promise.all([first, second]), [1, 2])
                assert.deepEqual(events, ["first", "second"])
            })
    }
    it("registers nested native scopes and keeps ready sibling work synchronous", () => {
        const { chain, api, ctx, events } = fixture()
        assert.equal(mutate(chain, ["api", "db"], "work", ctx), undefined)
        assert.equal(mutate(chain, ["api", "config"], "work", ctx), undefined)
        assert.deepEqual(events, ["db", "config"])
        assert.equal(ctx.execution._externalIdentities.get(api.db).binding, chain._externalMutationTree.api.db)
    })
    it("waits for children at a parent and prevents later children from overtaking it", async () => {
        const { chain, ctx, events } = fixture()
        const db = Promise.withResolvers(), config = Promise.withResolvers()
        const first = mutate(chain, ["api", "db"], "work", ctx, [db.promise])
        const second = mutate(chain, ["api", "config"], "work", ctx, [config.promise])
        const parent = mutate(chain, ["api"], "reset", ctx)
        const last = mutate(chain, ["api", "db"], "work", ctx)
        config.resolve(); await second
        assert.deepEqual(events, ["config"])
        db.resolve(); await Promise.all([first, parent, last])
        assert.deepEqual(events, ["config", "db", "reset", "db"])
    })
    it("collects child poison at a parent, leaves siblings usable, and repairs the subtree", () => {
        const { chain, ctx, events } = fixture()
        const db = mutate(chain, ["api", "db"], "fail", ctx)
        assert.equal(mutate(chain, ["api", "config"], "work", ctx), undefined)
        const config = mutate(chain, ["api", "config"], "fail", ctx)
        const collected = r.getErrors(chain, ["api"], ctx)
        assert.deepEqual(new Set(collected.errors), new Set([db, config]))
        assert.deepEqual(new Set(mutate(chain, ["api"], "reset", ctx).errors), new Set(collected.errors))
        assert.deepEqual(events, ["config"])
        assert.equal(r.repairPath(chain, ["api"], ctx), undefined)
        assert.equal(r.getErrors(chain, [], ctx), null)
        mutate(chain, ["api"], "reset", ctx)
        assert.deepEqual(events, ["config", "reset"])
    })
    it("keeps queued frontier work linear and removes finished memberships", async () => {
        const { chain, ctx } = fixture()
        const node = chain._externalMutationTree.api.db
        const works = []
        for (let i = 0; i < 1000; i++) {
            const work = new ExternalEffect(node, true, undefined, ctx)
            works.push(work)
            assert.equal(node[TREE_NODE].frontier.subtreeWrites.size, 1)
        }
        for (const work of works) work.complete()
        await new Promise(setImmediate)
        assert.equal(chain._externalMutationTree[TREE_NODE].frontier.subtreeWrites.size, 0)
    })
    for (const pending of [false, true]) it("restores complete managed state after failure, pending=" + pending, async () => {
        const ctx = context()
        const receiver = { child: { x: 1 }, fail() { this.child.x = 9; this.extra = true; if (pending) return Promise.reject(Error("failed")); throw Error("failed") } }
        receiver.alias = receiver.child
        receiver.self = receiver
        const chain = new r.Chain({ receiver }, ctx)
        const error = await mutate(chain, ["receiver"], "fail", ctx)
        assert.equal(r.lookupPath(chain, ["receiver"], ctx), error)
        assert.equal(receiver.child.x, 1)
        assert.equal(mutate(chain, ["receiver"], "fail", ctx), error)
        assert.equal(r.repairPath(chain, ["receiver"], ctx), undefined)
        const restored = r.lookupPath(chain, ["receiver"], ctx)
        assert.equal(restored.child.x, 1)
        assert.equal(restored.extra, undefined)
        assert.equal(restored.alias, restored.child)
        assert.equal(restored.self, restored)
    })
    it("preserves a failed child's baseline through COW and entry publication", async () => {
        const ctx = context()
        const chain = new r.Chain({ item: { x: 1, fail() { this.x++; throw Error("bad") } } }, ctx)
        r.enter(chain, ["item"], ctx, true, inner => mutate(inner, [], "fail", ctx))
        const copy = new r.Chain(await r.lookupPath(chain, [], ctx), ctx)
        await r.repairPath(chain, ["item"], ctx)
        r.assignPath(chain, ["item", "x"], 8, ctx)
        await r.repairPath(copy, ["item"], ctx)
        assert.equal(r.lookupPath(copy, ["item", "x"], ctx), 1)
        assert.equal(r.lookupPath(chain, ["item", "x"], ctx), 8)
    })
    it("preserves missing entry targets through pending publication and export", async () => {
        const ctx = context()
        for (const root of [{}, new Array(3)]) {
            const chain = new r.Chain(root, ctx), key = Array.isArray(root) ? 1 : "absent"
            const delay = Promise.withResolvers()
            const entry = r.enter(chain, [key], ctx, true, () => delay.promise)
            const output = r.export(chain, [], ctx)
            delay.resolve(); await entry
            assert.equal(Object.hasOwn(await output, key), false)
            assert.equal(Object.hasOwn(await r.export(chain, [], ctx), key), false)
        }
    })
    it("does not grow an Array for an out-of-range no-op entry", async () => {
        const ctx = context(), chain = new r.Chain([1], ctx)
        const delay = Promise.withResolvers()
        const entry = r.enter(chain, [5], ctx, true, () => delay.promise)
        const output = r.export(chain, [], ctx)
        delay.resolve(); await entry
        assert.deepEqual(await output, [1])
    })
    it("keeps failed structural writes recoverable at the Array", () => {
        const ctx = context(), chain = new r.Chain({ list: [1], other: 2 }, ctx)
        const failure = r.assignPath(chain, ["list", 4, "missing"], 3, ctx)
        assert.equal(r.lookupPath(chain, ["list"], ctx), failure)
        assert.equal(r.lookupPath(chain, ["other"], ctx), 2)
        r.repairPath(chain, ["list"], ctx)
        assert.deepEqual(r.lookupPath(chain, ["list"], ctx), [1])
    })
    it("waits for outside predecessors before activating an entry's private view", async () => {
        const { chain, ctx, events } = fixture()
        const delay = Promise.withResolvers()
        const first = mutate(chain, ["api", "db"], "work", ctx, [delay.promise])
        const entered = r.enter(chain, ["api"], ctx, true, inner => {
            events.push("entry")
            return mutate(inner, ["config"], "work", ctx)
        })
        assert.deepEqual(events, [])
        delay.resolve(); await Promise.all([first, entered])
        assert.deepEqual(events, ["db", "entry", "config"])
    })
    it("keeps contained native work covered after callback closure", async () => {
        const { chain, ctx, events } = fixture()
        const delay = Promise.withResolvers()
        assert.equal(r.enter(chain, [], ctx, true, inner => { mutate(inner, ["api", "db"], "work", ctx, [delay.promise]) }), undefined)
        const reset = mutate(chain, ["api"], "reset", ctx)
        await flush(); assert.deepEqual(events, [])
        delay.resolve(); await reset
        assert.deepEqual(events, ["db", "reset"])
    })

    for (const method of ["indexOf", "lastIndexOf", "flat", "sort", "toSorted", "toReversed", "toSpliced", "with"]) {
        for (const action of ["keep", "create", "delete"]) it(`preserves pending entry presence in ${method}, action=${action}`, async () => {
            const ctx = context()
            const original = [, 2, undefined, 1]
            if (action === "delete") original[0] = 3
            const chain = new r.Chain(original.slice(), ctx)
            const wait = Promise.withResolvers()
            const entry = r.enter(chain, [0], ctx, true, async inner => {
                await wait.promise
                if (action === "create") r.assignPath(inner, [], undefined, ctx)
                if (action === "delete") r.deletePath(inner, [], ctx)
            })
            const args = method === "indexOf" || method === "lastIndexOf" ? [undefined] : method === "with" ? [3, 9] : []
            const result = r.run(chain, [], method, args, ctx, {})
            wait.resolve()
            await entry
            if (action === "create") original[0] = undefined
            if (action === "delete") delete original[0]
            const expected = original[method](...args)
            const actual = await result
            assert.deepEqual(typeof actual === "number" ? actual : await r.export(new r.Chain(actual, ctx), [], ctx), expected)
        })
    }

    for (const nested of [false, true]) for (const key of ["x", 0, 4]) {
        it(`deletes the placement represented by an entered root, key=${key}, nested=${nested}`, async () => {
            const ctx = context(), original = typeof key === "string" ? { x: 1, y: 2 } : [1, 2]
            const chain = new r.Chain(r.import({ item: original }, ctx), ctx)
            await r.enter(chain, ["item", key], ctx, true, inner => nested
                ? r.enter(inner, [], ctx, true, deeper => r.deletePath(deeper, [], ctx))
                : r.deletePath(inner, [], ctx))
            const expected = typeof key === "string" ? { y: 2 } : original.slice()
            if (typeof key === "number") delete expected[key]
            assert.deepEqual(await r.export(chain, ["item"], ctx), expected)
            assert.equal(Object.hasOwn(original, key), key !== 4)
            const root = new r.Chain(1, ctx)
            r.deletePath(root, [], ctx)
            assert.equal(r.lookupPath(root, [], ctx), null)
        })
    }

    it("preserves Array shape when an out-of-range entered mutation fails and is repaired", async () => {
        const ctx = context()
        const chain = new r.Chain([1, , 3], ctx)
        const failure = await r.enter(chain, [8], ctx, true, inner => mutate(inner, [], "push", ctx))
        assert.equal(await r.lookupPath(chain, [], ctx), failure)
        assert.equal(await r.repairPath(chain, [], ctx), undefined)
        assert.deepEqual(r.export(chain, [], ctx), [1, , 3])
    })

    for (const nested of [false, true]) for (const pending of [false, true]) {
        it(`keeps Array growth after creating and deleting an entered index, nested=${nested}, pending=${pending}`, async () => {
            const ctx = context(), chain = new r.Chain([1, 2], ctx), hold = Promise.withResolvers()
            const change = inner => {
                r.assignPath(inner, [], pending ? hold.promise : 3, ctx)
                r.deletePath(inner, [], ctx)
            }
            const entry = r.enter(chain, [4], ctx, true, inner => nested
                ? r.enter(inner, [], ctx, true, change) : change(inner))
            const output = r.export(chain, [], ctx)
            hold.resolve(3)
            await entry
            const expected = [1, 2]
            expected[4] = 3
            delete expected[4]
            assert.deepEqual(await output, expected)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const pending of [false, true]) it(`keeps Array growth and poisons only the created element when a later entered mutation fails, pending=${pending}`, async () => {
        const ctx = context()
        const chain = new r.Chain([], ctx)
        let issued
        await r.enter(chain, [4], ctx, true, inner => {
            r.assignPath(inner, [], { n: 1, fail() { this.n++; if (pending) return Promise.reject(new Error("later")); throw new Error("later") } }, ctx)
            issued = mutate(inner, [], "fail", ctx)
        })
        const failure = await issued
        assert.equal(await r.lookupPath(chain, [4], ctx), failure)
        assert.equal(r.lookupPath(chain, [0], ctx), undefined)
        await r.repairPath(chain, [4], ctx)
        assert.equal(r.lookupPath(chain, ["length"], ctx), 5)
        assert.equal(r.lookupPath(chain, [4, "n"], ctx), 1)
        assert.equal(Object.hasOwn(r.export(chain, [], ctx), 0), false)
    })

    for (const pending of [false, true]) it(`repair-and-call starts a fresh managed baseline, pending=${pending}`, async () => {
        const ctx = context()
        const first = new Error("first"), second = new Error("second")
        const chain = new r.Chain({ n: 1, fail(reason) { this.n++; if (pending) return Promise.resolve().then(() => { throw new Error(reason) }); throw new Error(reason) } }, ctx)
        const old = await mutate(chain, [], "fail", ctx, [first.message])
        const next = await r.run(chain, [], "fail", [second.message], ctx, { mutationScopeDepth: 0, repair: true })
        assert.notEqual(next, old)
        assert.equal(next.cause.message, second.message)
        await r.repairPath(chain, [], ctx)
        assert.equal(r.lookupPath(chain, ["n"], ctx), 1)
    })

    it("preserves managed recovery and external child poison when repair preparation fails", () => {
        const ctx = context()
        let fail = false
        const cause = new Error("repair preparation")
        const native = r.externalState({ fail() { throw new Error("native") } })
        const root = new Proxy({ group: { api: native } }, { ownKeys(target) { if (fail) throw cause; return Reflect.ownKeys(target) } })
        const chain = new r.ContextChain(root, ctx, { group: { api: {} } })
        const child = mutate(chain, ["group", "api"], "fail", ctx)
        const old = mutate(chain, ["group", "api"], "fail", ctx, [], 1)
        // Retain an independently shared ancestor whose COW can fail.
        const holder = new Proxy({ chain: r.lookupPath(chain, [], ctx) }, { ownKeys(target) { if (fail) throw cause; return Reflect.ownKeys(target) } })
        const outer = new r.Chain(r.import(holder, ctx), ctx)
        fail = true
        const failure = r.repairPath(outer, ["chain", "group"], ctx)
        assert.equal(failure.cause, cause)
        fail = false
        assert.equal(r.lookupPath(outer, ["chain", "group"], ctx), old)
        assert.equal(chain._externalMutationTree.group.api[TREE_NODE].ownPoison, child)
        assert.equal(r.repairPath(chain, ["group"], ctx), undefined)
        assert.equal(r.getErrors(chain, [], ctx), null)
    })

    it("rejects a registered capability returned by a controlled element observation", () => {
        const { api, ctx } = fixture()
        const copy = new r.Chain([api.db], ctx)
        const result = r.run(copy, [], "at", [0], ctx, {})
        assert.equal(result.kind, r.ERROR_KIND.ExternalCapabilityEscape)
    })

    it("discovers nested native scopes without running accessors or synchronous thenables", () => {
        const ctx = context()
        let called = 0
        const api = r.externalState({
            get skipped() { called++; return {} },
            accessor: { get then() { called++; return undefined } },
            synchronous: { then(resolve) { called++; resolve({}) } },
            ready: {},
        })
        const requests = { api: { skipped: {}, accessor: {}, synchronous: {}, ready: {} } }
        const chain = new r.ContextChain({ api }, ctx, requests)
        assert.equal(called, 0)
        assert.deepEqual(Object.keys(chain._externalMutationTree.api), ["ready"])
        assert.deepEqual(Object.keys(requests.api), ["skipped", "accessor", "synchronous", "ready"])
    })

    it("collects permanent descendant conflicts behind parent-owned poison and keeps them after repair", () => {
        const { chain, ctx, api } = fixture()
        const old = mutate(chain, ["api"], "missing", ctx)
        new r.ContextChain({ db: api.db }, ctx, { db: {} })
        const conflict = ctx.execution._externalIdentities.get(api.db).binding
        const collected = r.getErrors(chain, ["api"], ctx)
        assert.deepEqual(new Set(collected.errors), new Set([old, conflict]))
        r.repairPath(chain, ["api"], ctx)
        assert.equal(r.getErrors(chain, ["api"], ctx), conflict)
    })

    it("keeps pending sibling frontier storage bounded while unrelated work finishes", () => {
        const { chain, ctx } = fixture()
        const pending = new ExternalEffect(chain._externalMutationTree.api.db, false, undefined, ctx)
        for (let i = 0; i < 2000; i++) {
            const work = new ExternalEffect(chain._externalMutationTree.api.config, i % 2 === 0, undefined, ctx)
            assert.equal(work.readiness, undefined)
            work.complete()
        }
        const frontier = chain._externalMutationTree.api[TREE_NODE].frontier
        assert.equal(frontier.subtreeReads.size, 1)
        assert.equal(frontier.subtreeWrites.size, 0)
        pending.complete()
        assert.equal(frontier.subtreeReads.size, 0)
    })

    it("publishes invalid dynamic mutating entry at the known managed prefix", () => {
        const { chain, ctx } = fixture()
        const failure = r.enter(chain, ["api", "db"], ctx, true, () => assert.fail("entry callback"), 0)
        assert.equal(failure.kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(r.lookupPath(chain, [], ctx), failure)
        assert.equal(r.repairPath(chain, [], ctx), undefined)
        assert.equal(r.lookupPath(chain, ["api", "db", "count"], ctx), 0)
    })
})
