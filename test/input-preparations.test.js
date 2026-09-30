import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { metaOf } from "../src/meta.js"
import { getParentPlacements } from "../src/parent-placements.js"
import { verifyParents } from "./verify-parents.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { OrderedThenable, ChainedThenable, ready } from "./ordered-thenable.js"

const context = () => ({ execution: new r.Execution(), errorContext: {} })

describe("shared input preparation", () => {
    it("does not normalize an admitted control input while staging a fallible result", () => {
        const ctx = context(), child = {}, cause = new Error("later inspection")
        const delivery = ready(child)
        const input = { good: delivery, bad: new Proxy({}, { ownKeys() { throw cause } }) }
        assert.equal(r.run(new r.Chain([], ctx), [], "includes", [input], ctx, {}), false)
        const result = r.importMethodResult(input, ctx)
        assert.equal(result.kind, r.ERROR_KIND.ImportReflectionFailed)
        assert.equal(result.cause, cause)
        assert.equal(input.good, delivery)
        assert.equal(metaOf(input, ctx).placementVersions, undefined)
        assert.equal(metaOf(input, ctx).placementsInitialized, undefined)
        assert.equal(metaOf(child, ctx), undefined)
    })

    for (const route of ["chain", "assignment", "argument", "outward", "import", "method-result"]) for (const array of [false, true]) {
        it(`keeps reception atomic at each failing graph read, route=${route}, array=${array}`, () => {
            let readsRequired
            for (let failAt = 0; failAt === 0 || failAt <= readsRequired; failAt++) {
                const ctx = context(), cause = new Error(`read ${failAt}`), nodes = []
                let reads = 0
                const inspect = () => { if (++reads === failAt) throw cause }
                const proxy = target => {
                    const value = new Proxy(target, {
                        ownKeys(target) { inspect(); return Reflect.ownKeys(target) },
                        getOwnPropertyDescriptor(target, key) { inspect(); return Reflect.getOwnPropertyDescriptor(target, key) },
                    })
                    nodes.push(value)
                    return value
                }
                const childStorage = { leaf: proxy({}) }, child = proxy(childStorage)
                const root = proxy(array ? [child, child] : { a: child, b: child })
                childStorage.self = child
                childStorage.root = root
                let result
                if (route === "chain") result = new r.Chain(root, ctx)._state.value
                else if (route === "assignment") {
                    const chain = new r.Chain(null, ctx)
                    r.assignPath(chain, [], root, ctx)
                    result = chain._state.value
                } else if (route === "argument") {
                    const chain = new r.Chain([], ctx)
                    r.run(chain, [], "push", [root], ctx, { mutationScopeDepth: 0 })
                    result = r.lookupPath(chain, [0], ctx)
                } else if (route === "outward") {
                    const api = r.externalState({}), chain = new r.ContextChain({ api }, ctx, { api: {} })
                    r.assignPath(chain, ["api", "value"], root, ctx)
                    result = r.lookupPath(chain, ["api"], ctx)
                } else result = route === "import" ? r.import(root, ctx) : r.importMethodResult(root, ctx)
                if (!failAt) {
                    // Later processing may inspect the prepared graph again.
                    // Sweep reception only, measured in a fresh execution.
                    reads = 0
                    r.import(root, context())
                    readsRequired = reads
                    assert(readsRequired > 0)
                    verifyParents(ctx, root)
                } else {
                    assert.equal(result.cause, cause, `failure ${failAt}`)
                    assert.equal(result.kind, route === "chain" ? r.ERROR_KIND.ChainValueFailed :
                        route === "assignment" ? r.ERROR_KIND.AssignmentValueFailed :
                            route === "argument" || route === "outward" ? r.ERROR_KIND.OperationInputFailed :
                                r.ERROR_KIND.ImportReflectionFailed)
                    for (const node of nodes) assert.equal(metaOf(node, ctx), undefined, `partial admission at ${failAt}`)
                    assert.equal(ctx.execution.fatalError, null)
                }
            }
        })
    }

    for (const boundary of ["import", "chain", "assignment"]) for (const nested of [false, true]) {
        it(`preserves aliases around superseded initialization, boundary=${boundary}, nested=${nested}`, async () => {
            const ctx = context(), trigger = new ChainedThenable(), pending = Promise.withResolvers()
            const earlier = r.import(trigger, ctx), derived = trigger.then(() => "drained")
            const shared = { p: pending.promise }
            shared.self = shared
            trigger.resolve(shared)
            const input = { before: nested ? { shared } : shared, derived, after: shared }
            const chain = new r.Chain(boundary === "import" ? r.import(input, ctx) : boundary === "chain" ? input : null, ctx)
            if (boundary === "assignment") r.assignPath(chain, [], input, ctx)
            const exported = r.export(chain, [], ctx)
            pending.resolve(7)
            const output = await exported, before = nested ? output.before.shared : output.before
            assert.equal(before.p, 7)
            assert.equal(before, output.after)
            assert.equal(before.self, before)
            assert.equal(output.derived, "drained")
            assert.equal(await earlier, shared)
            verifyRefCounts(ctx, chain._state, shared)
        })
    }

    for (const route of ["with", "fill", "splice", "unshift", "push", "pending receiver", "pending target"]) {
        it(`does not inspect an admitted input's then again through ${route}`, async () => {
            const ctx = context(), hold = Promise.withResolvers()
            let reads = 0
            const input = r.import(new Proxy({}, { get(target, key, receiver) {
                if (key === "then") reads++
                return Reflect.get(target, key, receiver)
            } }), ctx)
            assert.equal(reads, 1)
            let result
            if (route === "pending target") {
                const chain = new r.Chain(hold.promise, ctx)
                r.assignPath(chain, ["item"], input, ctx)
                hold.resolve({})
                result = r.export(chain, ["item"], ctx)
            } else {
                const chain = new r.Chain(route === "pending receiver" ? hold.promise : [0], ctx)
                const method = route === "pending receiver" ? "push" : route
                const args = method === "with" ? [0, input] : method === "splice" ? [0, 0, input] : [input]
                result = r.run(chain, [], method, args, ctx, method === "with" ? {} : { mutationScopeDepth: 0 })
                hold.resolve([])
            }
            assert.equal(reads, 1)
            assert(!r.isPoisonError(await result))
        })
    }

    for (const busy of [false, true]) {
        it(`does not consume input for a rejected route, busy=${busy}`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), api = r.externalState({ value: 1 })
            const chain = new r.ContextChain({ api }, ctx, { api: {} })
            const entered = busy ? r.enter(chain, [], ctx, true, () => hold.promise) : undefined
            let subscriptions = 0
            const input = { then(resolve) { subscriptions++; return resolve(9) } }
            r.assignPath(chain, ["api", "value"], input, ctx, 1, 0)
            assert.equal(subscriptions, 0)
            hold.resolve()
            await entered
            assert.equal((await r.lookupPath(chain, [], ctx)).kind, r.ERROR_KIND.ExternalLocationConflict)
            assert.equal(subscriptions, 0)
        })
    }

    for (const array of [false, true]) for (const delivered of [false, true]) {
        it(`isolates an already validated result when late adoption publishes a different Error, array=${array}, delivered=${delivered}`, async () => {
            const ctx = context(), resultContext = { ...ctx, errorContext: {} }
            const trigger = new ChainedThenable(), cause = new Error("shared input")
            const earlier = r.import(trigger, ctx)
            const input = delivered ? ready(cause) : cause
            const shared = array ? [input] : { bad: input }, key = array ? "0" : "bad"
            let originalError
            const later = trigger.then(() => {
                originalError = metaOf(shared, ctx).placementVersions[key].value
                return 1
            })
            trigger.resolve(shared)
            const result = r.importMethodResult({ shared, alias: shared, later }, resultContext)
            const source = new r.Chain(await earlier, ctx), output = new r.Chain(result, resultContext)
            assert.equal(r.lookupPath(source, [key], ctx), originalError)
            assert.equal(originalError.kind, r.ERROR_KIND.ContextValueFailed)
            assert.equal(originalError.errorContext, ctx.errorContext)
            const resultError = r.lookupPath(output, ["shared", key], resultContext)
            assert.equal(resultError.kind, r.ERROR_KIND.InvocationFailed)
            assert.equal(resultError.errorContext, resultContext.errorContext)
            assert.equal(resultError.cause, cause)
            assert.notEqual(r.lookupPath(output, ["shared"], resultContext), shared)
            assert.equal(r.lookupPath(output, ["shared"], resultContext), r.lookupPath(output, ["alias"], resultContext))
            assert.equal(r.getErrors(source, [], ctx), originalError)
            assert.equal(r.getErrors(output, [], resultContext), resultError)
            verifyRefCounts(ctx, source._state, output._state)
        })
    }

    for (const array of [false, true]) for (const nested of [false, true]) {
        it(`finishes late source adoption before remapping aliases and cycles, array=${array}, nested=${nested}`, async () => {
            const ctx = context(), trigger = new ChainedThenable(), pending = Promise.withResolvers()
            const earlier = r.import(trigger, ctx)
            const later = trigger.then(() => 1)
            const child = nested ? { value: pending.promise } : pending.promise
            const shared = array ? [child] : { pending: child }
            if (array) shared.push(shared)
            else shared.self = shared
            trigger.resolve(shared)
            const input = { shared, alias: shared, wrapper: { shared }, later }
            const result = r.importMethodResult(input, ctx)
            assert.equal(await earlier, shared)
            const chain = new r.Chain(result, ctx), copy = r.lookupPath(chain, ["shared"], ctx)
            assert.notEqual(copy, shared)
            assert.equal(copy, r.lookupPath(chain, ["alias"], ctx))
            assert.equal(copy, r.lookupPath(chain, ["wrapper", "shared"], ctx))
            assert.equal(array ? copy[1] : copy.self, copy)
            pending.resolve({ done: true })
            const output = await r.export(chain, [], ctx)
            assert.deepEqual(array ? output.shared[0] : output.shared.pending,
                nested ? { value: { done: true } } : { done: true })
            assert.equal(output.shared, output.alias)
            assert.equal(output.shared, output.wrapper.shared)
            assert.equal(array ? output.shared[1] : output.shared.self, output.shared)
            verifyParents(ctx, shared, result)
            verifyRefCounts(ctx, shared, result)
        })
    }

    it("returns late adoption reflection failure before publishing the result segment", async () => {
        const ctx = context(), trigger = new ChainedThenable(), cause = new Error("late reflection failure")
        let armed = false, failures = 0
        const shared = new Proxy({ child: {} }, { getOwnPropertyDescriptor(target, key) {
            if (armed && key === "child") { armed = false; failures++; throw cause }
            return Reflect.getOwnPropertyDescriptor(target, key)
        } })
        const earlier = r.import(trigger, ctx)
        const later = trigger.then(() => { armed = true; return 1 })
        trigger.resolve(shared)
        const input = { shared, later }
        const result = r.importMethodResult(input, ctx)
        assert.equal(failures, 1)
        assert.equal(result.cause, cause)
        assert.equal(result.kind, r.ERROR_KIND.ImportReflectionFailed)
        assert.equal(metaOf(input, ctx), undefined)
        assert.equal(await earlier, shared)
        assert.equal(ctx.execution.fatalError, null)
        verifyParents(ctx, shared)
    })

    it("preserves result validation and source isolation when initialization is superseded", async () => {
        const ctx = context(), trigger = new OrderedThenable(), pending = new OrderedThenable()
        const resource = {}
        r.externalState(resource)
        const authority = new r.ContextChain({ resource }, ctx, { resource: {} })
        const earlier = r.import(trigger, ctx)
        const shared = { pending, trigger }
        trigger.flushOnSubscribe = true
        trigger.resolve(shared)
        const result = r.importMethodResult(shared, ctx)
        assert.equal(await earlier, shared)
        assert.notEqual(result, shared)
        pending.resolve(resource)
        assert.equal((await r.lookupPath(new r.Chain(shared, ctx), ["pending"], ctx)).kind,
            r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(metaOf(shared, ctx).placementVersions.pending.value, resource)
        const rejected = await r.lookupPath(new r.Chain(result, ctx), ["pending"], ctx)
        assert.equal(rejected.kind, r.ERROR_KIND.ExternalCapabilityEscape)
        verifyParents(ctx, shared, result, authority._state)
    })

    for (const fail of [false, true]) {
        it(`stops superseded initialization while preserving independently committed work, fail=${fail}`, async () => {
            const ctx = context(), trigger = new OrderedThenable(), pending = new OrderedThenable()
            const earlier = r.import(trigger, ctx)
            let restSubscriptions = 0, childScans = 0
            const child = new Proxy({}, { ownKeys(target) { childScans++; return Reflect.ownKeys(target) } })
            const shared = { pending, trigger, rest: { then(deliver) { restSubscriptions++; return deliver(1) } } }
            trigger.flushOnSubscribe = true
            trigger.resolve(shared)
            const other = { inner: {} }
            const root = { shared, other }
            if (fail) root.bad = new Proxy({}, { ownKeys() { throw new Error("later failure") } })
            const result = r.import(root, ctx)
            assert.equal(await earlier, shared)
            assert.equal(r.isPoisonError(result), fail)
            assert.equal(restSubscriptions, 1, "The losing walk stops before the next placement")
            assert.equal(metaOf(shared, ctx).placementsInitialized, true)
            assert.equal(metaOf(other, ctx)?.placementsInitialized, fail ? undefined : true)
            pending.resolve(child)
            await r.lookupPath(new r.Chain(shared, ctx), ["pending"], ctx)
            assert.equal(childScans, 1, "Discarded subscriptions do no later discovery")
            verifyParents(ctx, shared, ...(fail ? [] : [root]))
        })
    }

    it("prepares an admitted control input when it first becomes managed data", () => {
        const ctx = context(), child = {}, input = { child }
        const array = new r.Chain([1], ctx)
        assert.equal(r.run(array, [], "includes", [input], ctx, {}), false)
        assert.equal(metaOf(input, ctx).placementsInitialized, undefined)
        const chain = new r.Chain(input, ctx)
        assert.equal(metaOf(input, ctx).placementsInitialized, true)
        verifyParents(ctx, chain._state)
    })

    for (const pending of [false, true]) for (const remove of [false, true]) {
        it(`initializes Array backing from physical storage after control conversion, pending=${pending}, remove=${remove}`, async () => {
            const ctx = context(), child = {}, delivery = Promise.withResolvers()
            const raw = pending ? delivery.promise : ready(child)
            const input = new Proxy([raw], { set(target, key, value) {
                if (value === child) throw new Error("Optional cache write refused")
                return Reflect.set(target, key, value)
            } })
            const converted = r.run(new r.Chain([1, 2], ctx), [], "join", [input], ctx, {})
            delivery.resolve(child)
            assert.equal(await converted, "1[object Object]2")
            assert.equal(input[0], raw)
            assert.equal(metaOf(input, ctx).placementsInitialized, undefined)
            const chain = new r.Chain(input, ctx)
            verifyParents(ctx, chain._state)
            if (remove) r.deletePath(chain, [0], ctx)
            else r.assignPath(chain, [0], 9, ctx)
            assert.equal(chain._state.value, input)
            assert.equal(getParentPlacements(child, ctx).some(p => p.parent === input), false)
            verifyRefCounts(ctx, child, chain._state)
        })
    }

    it("finishes overlaid Array storage inspection before publishing fresh containers", () => {
        const ctx = context(), child = {}, cause = new Error("Backing inspection failed")
        let failRead = false
        const input = new Proxy([ready(child)], {
            set() { throw new Error("Optional cache write refused") },
            getOwnPropertyDescriptor(target, key) {
                if (failRead && key === "0") throw cause
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        assert.equal(r.run(new r.Chain([1, 2], ctx), [], "join", [input], ctx, {}), "1[object Object]2")
        const fresh = {}, root = { fresh, input }
        failRead = true
        const result = new r.Chain(root, ctx)._state.value
        assert.equal(result.kind, r.ERROR_KIND.ChainValueFailed)
        assert.equal(result.cause, cause)
        assert.equal(metaOf(root, ctx), undefined)
        assert.equal(metaOf(fresh, ctx), undefined)
        assert.equal(metaOf(input, ctx).placementsInitialized, undefined)
        assert.equal(getParentPlacements(child, ctx).some(p => p.parent === input), false)
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const delayedTarget of [false, true]) {
        it(`starts assignment input preparation before target delivery, delayed=${delayedTarget}`, async () => {
            const ctx = context(), target = Promise.withResolvers(), payload = Promise.withResolvers()
            const chain = new r.Chain(delayedTarget ? target.promise : {}, ctx)
            const input = { good: 1, bad: payload.promise }, cause = new Error("nested inspection")
            r.assignPath(chain, ["x"], input, ctx)
            assert.equal(metaOf(input, ctx).placementsInitialized, true)
            payload.resolve(new Proxy({}, { ownKeys() { throw cause } }))
            await Promise.resolve()
            target.resolve({})
            assert.equal(await r.lookupPath(chain, ["x", "good"], ctx), 1)
            const failure = await r.lookupPath(chain, ["x", "bad"], ctx)
            assert.equal(failure.cause, cause)
            assert.equal(failure.kind, r.ERROR_KIND.AssignmentValueFailed)
            verifyParents(ctx, chain._state)
        })
    }

    it("prepares fresh argument wrappers before a receiver wait", async () => {
        const ctx = context(), pending = Promise.withResolvers()
        const source = new r.Chain({ child: { k: 1 } }, ctx)
        const child = r.lookupPath(source, ["child"], ctx), argument = { child }
        const receiver = new r.Chain(pending.promise, ctx)
        const result = r.run(receiver, [], "read", [argument], ctx, {})
        assert(getParentPlacements(child, ctx).some(p => p.parent === argument && p.key === "child"))
        r.assignPath(source, ["child", "k"], 2, ctx)
        pending.resolve({ read(value) { return value.child.k } })
        assert.equal(await result, 1)
        assert.equal(r.lookupPath(source, ["child", "k"], ctx), 2)
        verifyParents(ctx, source._state, argument)
    })

    it("exports an outward assignment's prepared pending outcome instead of its raw input", async () => {
        const ctx = context(), pending = Promise.withResolvers(), cause = new Error("input inspection")
        let written = false, scans = 0
        const resource = { set item(value) { written = true } }
        r.externalState(resource)
        const chain = new r.ContextChain({ resource }, ctx, { resource: {} })
        r.assignPath(chain, ["resource", "item"], pending.promise, ctx)
        const bad = new Proxy({}, { ownKeys() { scans++; throw cause } })
        pending.resolve(bad)
        const failure = await r.lookupPath(chain, ["resource"], ctx)
        assert.equal(failure.cause, cause)
        assert.equal(failure.kind, r.ERROR_KIND.OperationInputFailed)
        assert.equal(scans, 1)
        assert.equal(written, false)
        assert.equal(metaOf(bad, ctx), undefined)
    })

    it("captures outward export before a predecessor finishes", async () => {
        const ctx = context(), hold = Promise.withResolvers()
        const resource = { wait() { return hold.promise } }
        r.externalState(resource)
        const chain = new r.ContextChain({ resource }, ctx, { resource: {} })
        const preceding = r.run(chain, ["resource"], "wait", [], ctx, { mutationScopeDepth: 1 })
        let scans = 0, rejectLaterRead = false
        const child = { k: 1 }, source = new r.Chain({ child }, ctx)
        const input = new Proxy({ child: r.lookupPath(source, ["child"], ctx) }, { ownKeys(target) {
            if (rejectLaterRead) throw new Error("late export")
            scans++
            return Reflect.ownKeys(target)
        } })
        r.assignPath(chain, ["resource", "item"], input, ctx)
        assert.equal(scans, 2, "Preparation and export both capture before the predecessor wait")
        assert.equal(resource.item, undefined)
        rejectLaterRead = true
        r.assignPath(source, ["child", "k"], 2, ctx)
        hold.resolve()
        await preceding
        assert.deepEqual(await r.lookupPath(chain, ["resource", "item"], ctx), { child: { k: 1 } })
        assert.notEqual(resource.item.child, child)
        verifyParents(ctx, source._state)
    })

    it("records prepared export sources without registering detached output parents", () => {
        const ctx = context(), child = {}, input = { child }
        let output
        const chain = new r.Chain({ consume(value) { output = value; return 1 } }, ctx)
        assert.equal(r.run(chain, [], "consume", [input], ctx, {}), 1)
        assert.notEqual(output, input)
        assert.equal(metaOf(output, ctx), undefined)
        assert.deepEqual(getParentPlacements(child, ctx), [{ parent: input, key: "child" }])
        verifyParents(ctx, input)
    })

    for (const imported of [false, true]) for (const pending of [false, true]) {
        it(`validates delivered callable then at reception, imported=${imported}, pending=${pending}`, async () => {
            const ctx = context(), delivery = Promise.withResolvers()
            let called = false
            const callable = () => { called = true }
            const source = { then: pending ? delivery.promise : ready(callable), good: {} }
            const physical = source.then
            const chain = imported ? new r.ContextChain(source, ctx) : new r.Chain(source, ctx)
            const result = r.export(chain, [], ctx)
            delivery.resolve(callable)
            assert.equal((await result).kind, r.ERROR_KIND.PropertyValidation)
            assert.equal(called, false)
            if (imported) assert.equal(source.then, physical)
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("records materialized result-copy elements when the borrowed source is an ArrayView", async () => {
        const ctx = context(), delivery = Promise.withResolvers(), child = {}
        const source = new r.Chain([child, delivery.promise], ctx)
        const view = r.run(source, [], "slice", [], ctx, {})
        const result = r.importMethodResult(view, ctx)
        assert.notEqual(result, view)
        assert(getParentPlacements(child, ctx).some(p => p.parent === result && p.key === "0"))
        delivery.resolve({ done: true })
        assert.deepEqual(await r.export(new r.Chain(result, ctx), [], ctx), [child, { done: true }])
        verifyParents(ctx, view, result)
    })

    for (const failRead of [1, 2, 3]) {
        it(`finishes copied Array shape preparation before committing admission, failed read=${failRead}`, () => {
            const ctx = context(), pending = new OrderedThenable(), cause = new Error("shape inspection")
            let armed = false, reads = 0
            const array = new Proxy([pending], { get(target, key, receiver) {
                if (armed && key === "length" && ++reads === failRead) throw cause
                return Reflect.get(target, key, receiver)
            } })
            new r.Chain(array, ctx)
            const fresh = {}, wrapper = { array, fresh }
            armed = true
            const outcome = r.importMethodResult(wrapper, ctx)
            armed = false
            assert.equal(outcome.kind, r.ERROR_KIND.ImportReflectionFailed)
            assert.equal(outcome.cause, cause)
            assert.equal(metaOf(fresh, ctx), undefined)
            assert.equal(metaOf(wrapper, ctx), undefined)
            assert.equal(ctx.execution.fatalError, null)
            verifyParents(ctx, array)
        })
    }

    for (const created of [false, true]) {
        it(`result copies retain earlier Array growth and exclude later growth, created=${created}`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), chain = new r.Chain([], ctx)
            const entered = r.enter(chain, [4], ctx, true, inside => hold.promise.then(() => {
                if (created) r.assignPath(inside, [], 7, ctx)
            }))
            const result = r.importMethodResult(r.lookupPath(chain, [], ctx), ctx)
            const exported = r.export(new r.Chain(result, ctx), [], ctx)
            r.assignPath(chain, [8], 9, ctx)
            hold.resolve()
            await entered
            const expected = []
            if (created) expected[4] = 7
            assert.deepEqual(await exported, expected)
            assert.equal(await r.lookupPath(chain, ["length"], ctx), 9)
            verifyRefCounts(ctx, result, chain._state)
        })
    }
})
