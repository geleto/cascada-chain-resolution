import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { metaOf } from "../src/meta.js"
import { getParentPlacements, visitParentPlacements } from "../src/parent-placements.js"
import { verifyParents } from "./verify-parents.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { OrderedThenable, ready } from "./ordered-thenable.js"

const context = () => ({ execution: new r.Execution(), errorContext: {} })
const pairs = (child, ctx) => getParentPlacements(child, ctx)

describe("complete incoming placements", () => {
    it("keeps observation materializations private until a result escapes", async () => {
        const ctx = context(), child = { k: 1 }
        const receiver = r.import({ child: Promise.resolve(child), read() { return this.child.k }, self() { return this } }, ctx)
        const chain = new r.Chain(receiver, ctx)
        await r.lookupPath(chain, ["child"], ctx)
        const baseline = pairs(child, ctx).length
        for (let i = 0; i < 100; i++) assert.equal(r.run(chain, [], "read", [], ctx, {}), 1)
        assert.equal(pairs(child, ctx).length, baseline)
        const escaped = r.run(chain, [], "self", [], ctx, {})
        assert(pairs(child, ctx).some(p => p.parent === escaped && p.key === "child"))
        verifyRefCounts(ctx, receiver, escaped)
    })

    for (const operation of ["assign", "delete", "enter", "readonly entry"]) {
        it(`releases completed holders after repeated ${operation}`, () => {
            const ctx = context(), child = {}, chain = new r.Chain({ child }, ctx)
            for (let i = 0; i < 100; i++) {
                if (operation === "enter" || operation === "readonly entry")
                    r.enter(chain, ["child"], ctx, operation === "enter", () => undefined)
                else {
                    r.assignPath(chain, ["child"], child, ctx)
                    if (operation === "delete") r.deletePath(chain, ["child"], ctx)
                }
                assert.deepEqual(pairs(child, ctx), operation === "delete" ? [] : [{ parent: chain._state.value, key: "child" }])
            }
            verifyRefCounts(ctx, chain._state, child)
        })
    }

    for (const imported of [false, true]) {
        it(`records roots, repeated keys, aliases and cycles before queries, imported=${imported}`, () => {
            const ctx = context(), child = {}, root = { a: child, b: child }
            child.self = child
            child.root = root
            const chain = imported ? new r.ContextChain(root, ctx) : new r.Chain(root, ctx)
            assert.equal(pairs(child, ctx).length, 3)
            assert(pairs(root, ctx).some(p => p.parent === chain._state && p.key === "value"))
            assert.equal(metaOf(root, ctx).parents, undefined)
            verifyParents(ctx, chain._state)
            r.assignPath(chain, ["a"], {}, ctx)
            verifyParents(ctx, root, chain._state)
            r.deletePath(chain, ["b"], ctx)
            verifyParents(ctx, root, chain._state)
        })
    }

    it("merges attachments without rescanning a prepared graph", () => {
        const ctx = context()
        let scans = 0
        const child = {}, root = new Proxy({ child }, {
            ownKeys(target) { scans++; return Reflect.ownKeys(target) },
        })
        const a = new r.Chain(root, ctx)
        const baseline = scans
        const b = new r.Chain(r.lookupPath(a, [], ctx), ctx)
        r.assignPath(b, [], root, ctx)
        assert.equal(scans, baseline)
        assert(pairs(root, ctx).some(p => p.parent === a._state && p.key === "value"))
        assert(pairs(root, ctx).some(p => p.parent === b._state && p.key === "value"))
        verifyParents(ctx, a._state, b._state)
    })

    it("retires descendant placements after removing their last root", () => {
        const ctx = context(), child = {}, root = { child }, chain = new r.Chain(root, ctx)
        r.assignPath(chain, [], null, ctx)
        assert.deepEqual(pairs(root, ctx), [])
        assert.deepEqual(pairs(child, ctx), [])
        verifyParents(ctx, root, chain._state)
    })

    for (const replace of [false, true]) {
        it(`publishes pending child preparation with current authority, replace=${replace}`, async () => {
            const ctx = context(), pending = Promise.withResolvers(), child = { inner: {} }
            const chain = new r.Chain({ child: pending.promise }, ctx)
            const root = chain._state.value
            const captured = r.lookupPath(chain, ["child"], ctx)
            if (replace) r.assignPath(chain, ["child"], 3, ctx)
            pending.resolve(child)
            assert.equal(await captured, child)
            assert.equal(pairs(child, ctx).some(p => p.parent === root && p.key === "child"), !replace)
            assert.equal(metaOf(child, ctx).placementsInitialized, true)
            verifyParents(ctx, chain._state, child)
        })
    }

    it("unpublishes a child while an entry gate owns the placement", async () => {
        const ctx = context(), child = {}, chain = new r.Chain({ child }, ctx), hold = Promise.withResolvers()
        const root = chain._state.value
        const entered = r.enter(chain, ["child"], ctx, true, () => hold.promise)
        assert(!pairs(child, ctx).some(p => p.parent === root))
        verifyParents(ctx, chain._state)
        hold.resolve()
        await entered
        verifyParents(ctx, chain._state)
    })

    for (const method of ["slice", "concat", "push", "shift", "toReversed", "with"]) {
        it(`keeps Array backing and overlay placements complete through ${method}`, async () => {
            const ctx = context(), child = {}, source = [child, , child]
            const chain = new r.Chain(source, ctx)
            const args = method === "slice" ? [1] : method === "concat" || method === "push" ? [{ child }] : method === "with" ? [1, child] : []
            const value = await r.run(chain, [], method, args, ctx, {})
            assert(!r.isPoisonError(value), value?.message)
            verifyParents(ctx, source, value)
            const output = new r.Chain(value, ctx)
            r.assignPath(output, [0], null, ctx)
            verifyParents(ctx, source, output._state, value)
        })
    }

    it("shares backing occurrences without an overlay for every ready element", () => {
        const ctx = context(), child = {}, source = [child, child], chain = new r.Chain(source, ctx)
        const view = r.run(chain, [], "slice", [1], ctx, {})
        assert.equal(metaOf(view, ctx).placementVersions, undefined)
        assert(pairs(child, ctx).some(p => p.parent === view && p.key === "0"))
        assert.equal(pairs(child, ctx).length, 3)
        verifyParents(ctx, source, view)
    })

    it("stops parent enumeration without reading backing properties", () => {
        const ctx = context(), child = {}
        let reads = 0
        const source = new Proxy([child, child, child], {
            get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver) },
            getOwnPropertyDescriptor(target, key) { reads++; return Reflect.getOwnPropertyDescriptor(target, key) },
        })
        const chain = new r.Chain(source, ctx)
        const view = r.run(chain, [], "slice", [1, 3], ctx, {})
        const baseline = reads, selected = []
        visitParentPlacements(child, ctx, (parent, key) => {
            selected.push({ parent, key })
            return false
        })
        assert.equal(selected.length, 1)
        const snapshot = pairs(child, ctx)
        assert.equal(snapshot.length, 5)
        assert.equal(reads, baseline)
        snapshot.pop()
        assert.equal(pairs(child, ctx).length, 5, "Snapshots do not expose the stored index")
        verifyParents(ctx, chain._state, view)
    })

    it("keeps imported backing and parent facts execution-local", () => {
        const first = context(), second = context(), child = {}, source = [child]
        const a = new r.ContextChain(source, first), b = new r.ContextChain(source, second)
        const view = r.run(a, [], "slice", [], first, {})
        assert.notEqual(metaOf(source, first).arrayBacking, metaOf(source, second).arrayBacking)
        assert(pairs(child, first).some(p => p.parent === view))
        assert.deepEqual(pairs(child, second), [{ parent: source, key: "0" }])
        verifyParents(first, a._state, view)
        verifyParents(second, b._state)
    })

    it("discards a failed append view without undoing successful shared backing writes", () => {
        const ctx = context(), child = {}, other = {}, cause = new Error("second write")
        let armed = false
        const source = new Proxy([0], { defineProperty(target, key, descriptor) {
            if (armed && key === "2") throw cause
            return Reflect.defineProperty(target, key, descriptor)
        } })
        const chain = new r.Chain(source, ctx)
        armed = true
        const result = r.run(chain, [], "concat", [[child, other]], ctx, {})
        armed = false
        assert(r.isPoisonError(result))
        assert.equal(source[1], child, "Earlier physical storage maintenance survives failure")
        assert(!pairs(child, ctx).some(p => p.parent !== source && metaOf(p.parent, ctx)?.arrayRange))
        assert.deepEqual(r.export(chain, [], ctx), [0])
        verifyParents(ctx, chain._state, child)
    })

    it("does not retain a deleted private native receiver edge on its returned child", async () => {
        const ctx = context()
        const chain = new r.Chain({ child: {}, take() { const child = this.child; delete this.child; return child } }, ctx)
        const child = await r.run(chain, [], "take", [], ctx, { mutationScopeDepth: 0 })
        assert(!r.isPoisonError(child), child?.message)
        assert(!pairs(child, ctx).some(p => p.parent === chain._state.value))
        verifyParents(ctx, chain._state, child)
    })

    it("continues pending argument delivery after an Array mutation has published", async () => {
        const ctx = context(), receiver = Promise.withResolvers(), argument = Promise.withResolvers()
        const chain = new r.Chain(receiver.promise, ctx)
        const result = r.run(chain, [], "push", [argument.promise], ctx, { mutationScopeDepth: 0 })
        receiver.resolve([])
        assert.equal(await result, 1)
        const child = { inner: {} }
        argument.resolve(child)
        assert.deepEqual(await r.export(chain, [], ctx), [child])
        verifyParents(ctx, chain._state)
    })

    for (const kind of ["initialization", "assignment", "argument"]) {
        it(`atomically fails fresh structural preparation at ${kind}`, async () => {
            const ctx = context(), cause = new Error("inspection"), good = {}
            const bad = new Proxy({}, { ownKeys() { throw cause } })
            const value = { good, bad }
            let result
            if (kind === "initialization") result = new r.Chain(value, ctx)._state.value
            else if (kind === "assignment") {
                const chain = new r.Chain(0, ctx)
                assert.equal(r.assignPath(chain, [], value, ctx), undefined)
                result = chain._state.value
            } else result = await r.run(new r.Chain({ accept(x) { return x } }, ctx), [], "accept", [value], ctx, {})
            assert(r.isPoisonError(result))
            assert.equal(result.cause, cause)
            assert.equal(metaOf(good, ctx), undefined)
            assert.equal(metaOf(value, ctx), undefined)
        })
    }

    it("ignores non-index Array data during staged admission", () => {
        const ctx = context(), child = {}
        let calls = 0
        const source = [child]
        const excluded = new Set(["extra", "01", "-0", "4294967295"])
        for (const key of excluded)
            source[key] = { then(resolve) { calls++; resolve({}) } }
        const chain = new r.ContextChain(new Proxy(source, { getOwnPropertyDescriptor(target, key) {
            if (excluded.has(key)) throw new Error("Excluded Array field inspected")
            return Reflect.getOwnPropertyDescriptor(target, key)
        } }), ctx)
        assert.equal(calls, 0)
        verifyParents(ctx, chain._state)
    })

    for (const pending of [false, true]) {
        it(`rejects delivered callable then before export, pending=${pending}`, async () => {
            const ctx = context(), delivery = Promise.withResolvers()
            let calls = 0
            const fn = resolve => { calls++; resolve(7) }
            const source = { then: pending ? delivery.promise : ready(fn), good: {} }
            const chain = new r.ContextChain(source, ctx)
            const result = r.export(chain, [], ctx)
            delivery.resolve(fn)
            assert.equal((await result).kind, r.ERROR_KIND.PropertyValidation)
            assert.equal(calls, 0)
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const inherited of [false, true]) for (const pending of [false, true])
        for (const boundary of ["root", "record", "array", "import", "assignment", "method-result"]) {
            it(`verifies a stable then getter at ${boundary}, inherited=${inherited}, pending=${pending}`, async () => {
                const ctx = context(), delivery = new OrderedThenable(), child = { n: 1 }
                const then = delivery.then.bind(delivery)
                let reads = 0
                const descriptor = { get() { reads++; return then } }
                const source = inherited
                    ? Object.create(Object.defineProperty({}, "then", descriptor))
                    : Object.defineProperty({}, "then", descriptor)
                if (!pending) delivery.resolve(child)
                let input = boundary === "root" ? source : boundary === "array" ? [source] : { child: source }
                if (boundary === "import") input = r.import(input, ctx)
                if (boundary === "method-result") input = r.importMethodResult(input, ctx)
                const chain = new r.Chain(boundary === "assignment" ? null : input, ctx)
                if (boundary === "assignment") r.assignPath(chain, [], input, ctx)

                const previousReads = reads, previousSubscriptions = delivery.subscriptions
                verifyParents(ctx, chain._state)
                assert.equal(reads, previousReads, "Parent verification must not invoke then getters")
                assert.equal(delivery.subscriptions, previousSubscriptions, "Parent verification must not consume pending values")
                verifyRefCounts(ctx, chain._state)
                const exported = r.export(chain, [], ctx)
                if (pending) delivery.resolve(child)
                assert.deepEqual(await exported, boundary === "root" ? child : boundary === "array" ? [child] : { child })
                verifyRefCounts(ctx, chain._state)
                assert.equal(ctx.execution.fatalError, null)
            })
        }

    it("the admission oracle checks delivered children even when their versions remain Promise-backed", async () => {
        const ctx = context(), delivery = Promise.withResolvers(), child = {}
        const chain = new r.Chain({ child: delivery.promise }, ctx)
        delivery.resolve(child)
        await r.lookupPath(chain, ["child"], ctx)
        ctx.execution._metadata.delete(child)
        assert.throws(() => verifyParents(ctx, chain._state), /Published child was not admitted/)
    })

    it("the independent oracle detects a missing occurrence", () => {
        const ctx = context(), child = {}, chain = new r.Chain({ child }, ctx)
        delete metaOf(child, ctx).incomingParents
        assert.throws(() => verifyParents(ctx, chain._state), /Missing incoming parent placement/)
    })

    it("the independent oracle detects missing child admission before any repairing read", () => {
        const ctx = context(), child = {}, chain = new r.Chain({ child }, ctx)
        ctx.execution._metadata.delete(child)
        assert.throws(() => verifyParents(ctx, chain._state), /Published child was not admitted/)
    })

    for (const corruption of ["missing", "stale", "owner"]) {
        it(`the independent oracle detects ${corruption} backing facts hidden by an overlay`, async () => {
            const ctx = context(), child = {}, pending = Promise.withResolvers(), source = [pending.promise]
            const chain = new r.Chain(source, ctx)
            pending.resolve(child)
            await r.lookupPath(chain, [0], ctx)
            const backing = metaOf(source, ctx).arrayBacking
            const incoming = metaOf(child, ctx).incomingParents
            assert(incoming instanceof Map)
            if (corruption === "missing") incoming.delete(backing)
            else if (corruption === "stale") incoming.get(backing).add(1)
            else backing.owners.delete(source)
            assert.throws(() => verifyParents(ctx, chain._state), corruption === "missing"
                ? /Missing physical backing occurrence/ : corruption === "stale"
                    ? /Physical backing occurrence does not hold its child/ : /Missing Array backing owner/)
        })
    }

    it("the admission oracle never invokes an unknown child's then getter", () => {
        const ctx = context(), child = {}, chain = new r.Chain({ child }, ctx)
        let calls = 0
        // Deliberately corrupt only the test oracle's witness.
        ctx.execution._metadata.delete(child)
        Object.defineProperty(child, "then", { get() { calls++; return undefined } })
        assert.throws(() => verifyParents(ctx, chain._state), /Published child was not admitted/)
        assert.equal(calls, 0)
    })
})
