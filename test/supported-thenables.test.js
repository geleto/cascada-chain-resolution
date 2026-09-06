import assert from "node:assert/strict"
import * as runtime from "../src/index.js"
import * as errors from "../src/error.js"
import * as values from "../src/language-values.js"
import * as resolution from "../src/resolution.js"
import * as lifecycle from "../src/operation-lifecycle.js"
import * as properties from "../src/property-versions.js"
import * as metadata from "../src/meta.js"
import { ready, rejected, OrderedThenable } from "./ordered-thenable.js"

const context = (reporter = () => {}) => ({ execution: new runtime.Execution(reporter), errorContext: {} })
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

// ResolvedValue-style direct return and the conforming rejecting protocol.
// Cascada's legacy PoisonedValue catches callback throws; it is intentionally
// not used as a fixture for the replacement contract.
describe("supported thenables", () => {
    it("uses direct transitions for ready inputs and nested continuation work", () => {
        const ctx = context()
        assert.equal(resolution.continueInitialValue(ready(2), ctx, value =>
            resolution.continueInitialValue(ready(3), ctx, next => value + next)), 5)
        const owner = new lifecycle.OperationOwner(ctx)
        const result = lifecycle.continueAllInternalResultsOrFatal(owner, [ready(1), 2, ready(3)], items => items)
        assert.deepEqual(result, [1, 2, 3])
        assert.equal(owner.releases, undefined)
        assert.equal(lifecycle.closeWhenDone(owner, ready("done")), "done")
        assert.equal(owner.open, false)
    })

    it("returns synchronous boundary rejections as ready poison", () => {
        const ctx = context()
        const reason = new Error("rejected")
        const imported = runtime.import(rejected(reason), ctx)
        assert.equal(imported.cause, reason)
        assert.equal(imported.errorContext, ctx.errorContext)
        assert.equal(values.isPending(imported, ctx), false)
        const chain = new runtime.Chain(rejected(reason), ctx)
        assert.equal(runtime.lookupPath(chain, [], ctx).cause, reason)
        assert.equal(ctx.execution.fatalError, null)
    })

    it("keeps FIFO across settlement before queued notifications run", async () => {
        const ctx = context()
        const source = new OrderedThenable()
        const order = []
        const first = resolution.continueInitialValue(source, ctx, () => order.push(1))
        source.resolve("ready")
        const second = resolution.continueInitialValue(source, ctx, () => order.push(2))
        assert.equal(values.isPending(second, ctx), true)
        assert.deepEqual(order, [])
        await Promise.all([first, second])
        assert.deepEqual(order, [1, 2])
        assert.equal(resolution.continueInitialValue(source, ctx, () => 3), 3)
        assert.equal(source.subscriptions, 3)
    })

    for (const pending of [false, true]) {
        it("reports a callback failure from " + (pending ? "pending" : "ready") + " delivery", async () => {
            const reports = []
            const ctx = context(error => reports.push(error))
            const source = pending ? new OrderedThenable() : ready(1)
            const cause = new Error("transition failed")
            const run = () => resolution.continueInternalResultOrFatal(source, ctx, () => { throw cause })
            if (pending) {
                const result = run()
                source.resolve(1)
                await assert.rejects(result, error => error === ctx.execution.fatalError)
            } else {
                assert.throws(run, error => error === ctx.execution.fatalError)
            }
            assert.equal(ctx.execution.fatalError.cause, cause)
            assert.deepEqual(reports, [ctx.execution.fatalError])
        })
    }

    it("does not redeliver a ready rejection when its continuation throws", () => {
        const ctx = context()
        const reason = new Error("rejected")
        let calls = 0
        assert.throws(
            () => values.thenValue(
                rejected(reason),
                value => value,
                error => {
                    calls++
                    throw error
                },
                ctx,
            ),
            error => error === reason,
        )
        assert.equal(calls, 1)
        assert.equal(ctx.execution.fatalError, null)
    })

    it("normalizes ready root and property values without changing mirrors", () => {
        const ctx = context()
        const root = { count: ready(1) }
        const chain = new runtime.Chain(ready(root), ctx)
        assert.equal(chain._state.value, root)
        assert.equal(runtime.lookupPath(chain, ["count"], ctx), 1)
        assert.equal(root.count, 1)
        assert.equal(properties.getPromiseMirror(root, "count", ctx), undefined)
        runtime.assignPath(chain, ["count"], ready(2), ctx)
        assert.equal(chain._state.value.count, 2)
        assert.equal(properties.getPromiseMirror(chain._state.value, "count", ctx), undefined)
        assert.equal(ctx.execution._thenables, undefined)
    })

    it("preserves imported storage with a fixed logical version", () => {
        const ctx = context()
        const source = ready({ count: 1 })
        const root = Object.freeze({ child: source })
        assert.equal(runtime.import(root, ctx), root)
        assert.equal(root.child, source)
        const version = metadata.metaOf(root, ctx).placementVersions.child
        assert.deepEqual(version.value, { count: 1 })
        assert.equal(version.promise, undefined)
        assert.equal(runtime.lookupPath(new runtime.Chain(root, ctx), ["child", "count"], ctx), 1)
    })

    it("reports callable then publication from synchronous fulfillment", () => {
        const ctx = context()
        const chain = new runtime.Chain({}, ctx)
        const failure = runtime.assignPath(chain, ["then"], ready(() => {}), ctx)
        assert.equal(failure.kind, errors.ERROR_KIND.PropertyValidation)
        assert.equal(chain._state.value.then, failure)
        const storedError = errors.validationError("stored", ctx, errors.ERROR_KIND.PropertyValidation)
        assert.equal(runtime.assignPath(chain, ["then"], ready(storedError), ctx), undefined)
        assert.equal(chain._state.value.then, storedError)
    })

    it("retains only pending aggregate work and releases it on completion", async () => {
        const ctx = context()
        const source = new OrderedThenable()
        const owner = new lifecycle.OperationOwner(ctx)
        const result = lifecycle.continueAllInternalResultsOrFatal(owner, [ready(1), source], items => items)
        assert.equal(values.isPending(result, ctx), true)
        assert.equal(owner.releases.size, 1)
        source.resolve(2)
        assert.deepEqual(await result, [1, 2])
        assert.equal(owner.releases, undefined)
    })

    it("keeps the ready argument captured while its receiver is pending", async () => {
        const ctx = context()
        const receiver = new OrderedThenable()
        const argument = { value: 1 }
        const chain = new runtime.Chain(receiver, ctx)
        const result = runtime.run(chain, [], "read", [ready(argument)], ctx, {})
        assert.equal(metadata.hasReadLease(argument, ctx), true)
        runtime.assignPath(new runtime.Chain(argument, ctx), ["value"], 2, ctx)
        receiver.resolve({ read(value) { return value.value } })
        assert.equal(await result, 1)
        assert.equal(metadata.hasReadLease(argument, ctx), false)
    })

    for (const pending of [false, true]) {
        it("reports fatal data through a fire-and-register " + (pending ? "pending" : "ready") + " assignment", async () => {
            const reports = []
            const ctx = context(error => reports.push(error))
            let fatal
            try { errors.runContextlessFatal(() => { throw new Error("fatal payload") }) }
            catch (error) { fatal = error }
            const chain = new runtime.Chain({}, ctx)
            if (pending) {
                const source = new OrderedThenable()
                assert.equal(runtime.assignPath(chain, ["value"], source, ctx), undefined)
                source.resolve(fatal)
                await flush()
            } else {
                assert.throws(() => runtime.assignPath(chain, ["value"], ready(fatal), ctx), error => error === fatal)
            }
            assert.equal(ctx.execution.fatalError, fatal)
            assert.deepEqual(reports, [fatal])
        })
    }

    it("keeps ready Array, query, export, and host-call routes direct", () => {
        const ctx = context()
        const chain = new runtime.Chain([ready(1), ready(2)], ctx)
        assert.equal(runtime.run(chain, [], "includes", [ready(2)], ctx, {}), true)
        assert.deepEqual(runtime.export(chain, [], ctx), [1, 2])
        assert.equal(runtime.hasError(chain, [], ctx), false)
        assert.deepEqual(runtime.getErrors(chain, [], ctx), [])
        const failed = new runtime.Chain({ a: rejected(new Error("bad")) }, ctx)
        assert.equal(runtime.hasError(failed, [], ctx), true)
        assert.equal(runtime.getErrors(failed, [], ctx).length, 1)
        const host = new runtime.Chain({ call() { return ready({ answer: 42 }) } }, ctx)
        assert.deepEqual(runtime.run(host, [], "call", [], ctx, {}), { answer: 42 })
        const nested = new runtime.Chain([ready([1]), ready([2])], ctx)
        assert.deepEqual(runtime.export(new runtime.Chain(runtime.run(nested, [], "flat", [], ctx, {}), ctx), [], ctx), [1, 2])
    })

    it("does not keep an independent removed result behind a mutation gate", () => {
        const ctx = context()
        const never = new OrderedThenable()
        const chain = new runtime.Chain({ items: ready([1, never]) }, ctx)
        const removed = runtime.run(chain, ["items"], "pop", [], ctx, { mutationScopeDepth: 1 })
        assert.equal(values.isPending(removed, ctx), true)
        resolution.markPromiseHandled(removed)
        assert.deepEqual(runtime.lookupPath(chain, ["items"], ctx), [1])
        assert.equal(runtime.run(chain, ["items"], "push", [2], ctx, { mutationScopeDepth: 1 }), 2)
    })

    it("captures entry state before a source drains earlier callbacks inside then", async () => {
        const ctx = context()
        const source = new OrderedThenable()
        source.flushOnSubscribe = true
        const chain = new runtime.Chain({ child: source }, ctx)
        runtime.assignPath(chain, ["child", "first"], 1, ctx)
        source.resolve({})
        const entered = runtime.enter(chain, ["child"], ctx, true, privateChain => {
            assert.equal(runtime.lookupPath(privateChain, ["first"], ctx), 1)
            runtime.assignPath(privateChain, ["second"], ready(2), ctx)
            return ready("done")
        })
        assert.equal(entered, "done")
        assert.deepEqual(await runtime.export(chain, [], ctx), { child: { first: 1, second: 2 } })
    })

    it("publishes enclosing COW after synchronous continuation handoff", async () => {
        const ctx = context()
        const source = new OrderedThenable()
        source.flushOnSubscribe = true
        const root = { child: source }
        runtime.import(root, ctx)
        const chain = new runtime.Chain(root, ctx)
        runtime.assignPath(chain, ["child", "first"], 1, ctx)
        source.resolve({})
        runtime.assignPath(chain, ["child", "second"], 2, ctx)
        assert.deepEqual(await runtime.export(chain, [], ctx), { child: { first: 1, second: 2 } })
        assert.equal(root.child, source)
    })

    it("returns a ready mutation failure after queued delivery inside then", async () => {
        const ctx = context()
        const source = new OrderedThenable()
        source.flushOnSubscribe = true
        const chain = new runtime.Chain({ child: source }, ctx)
        const earlier = runtime.lookupPath(chain, ["child"], ctx)
        source.resolve(null)
        const failure = runtime.assignPath(chain, ["child", "value"], 1, ctx)
        assert.equal(failure.kind, errors.ERROR_KIND.NullLookup)
        assert.equal(runtime.lookupPath(chain, ["child"], ctx), failure)
        assert.equal(await earlier, null)
    })

    it("protects read-only entry before its ready callback and releases directly", () => {
        const ctx = context()
        const value = { count: 1 }
        const chain = new runtime.Chain({ child: ready(value) }, ctx)
        const result = runtime.enter(chain, ["child"], ctx, false, entered => {
            assert.equal(metadata.hasReadLease(value, ctx), true)
            assert.equal(runtime.lookupPath(entered, ["count"], ctx), 1)
            return ready(42)
        })
        assert.equal(result, 42)
        assert.equal(metadata.hasReadLease(value, ctx), false)
    })

    it("uses staged ready outcomes for every finite external-tree occurrence", () => {
        const ctx = context()
        class External {}
        const shared = { resource: new External() }
        let subscriptions = 0
        const source = { then(onReady) { subscriptions++; return onReady(shared) } }
        const root = { a: source, b: shared }
        // Phase 9E will reject distinct candidate paths. The addendum preserves
        // inert discovery and must not hide either occurrence.
        const chain = new runtime.ContextChain(root, ctx, [[]], [])
        assert.equal(subscriptions, 1)
        assert.equal(root.a, source)
        const paths = chain._externalMutationTree.findDescendantBoundaries([]).map(leaf => leaf.path)
        assert.deepEqual(paths, [["a", "resource"], ["b", "resource"]])
        assert.equal(ctx.execution._externalIdentities.get(shared.resource).binding, undefined)
    })

    it("adds no external authority after pending delivery", async () => {
        const ctx = context()
        class External {}
        const source = new OrderedThenable()
        const chain = new runtime.ContextChain({ child: source }, ctx, [[]], [])
        source.resolve(new External())
        await flush()
        assert.equal(chain._externalMutationTree, undefined)
        assert.equal(ctx.execution._externalIdentities.has(runtime.lookupPath(chain, ["child"], ctx)), false)
    })

    for (const reject of [false, true]) {
        it("abandons staged subscriptions before late " + (reject ? "rejection" : "fulfillment"), async () => {
            const ctx = context()
            const pending = new OrderedThenable()
            const staged = {}
            const failure = new Error("validation failed")
            const invalid = new Proxy({}, { ownKeys() { throw failure } })
            const root = { pending, child: ready(staged), invalid }
            const result = runtime.import(root, ctx)
            assert.equal(result.cause, failure)
            for (const value of [root, staged, invalid]) assert.equal(metadata.metaOf(value, ctx), undefined)
            const late = {}
            if (reject) pending.reject(late)
            else pending.resolve(late)
            await flush()
            assert.equal(metadata.metaOf(late, ctx), undefined)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("abandons staged graph and discovery together", async () => {
        const ctx = context()
        const pending = new OrderedThenable()
        class External {}
        const external = new External()
        let discovering = false
        const failure = new Error("discovery failed")
        const root = new Proxy({ pending, resource: external, last: {
            then(onReady) { discovering = true; return onReady(1) },
        } }, {
            getOwnPropertyDescriptor(target, key) {
                if (discovering) throw failure
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        const chain = new runtime.ContextChain(root, ctx, [[]], [])
        assert.equal(chain._state.value.cause, failure)
        assert.equal(metadata.metaOf(root, ctx), undefined)
        assert.equal(ctx.execution._externalIdentities.has(external), false)
        const late = {}
        pending.resolve(late)
        await flush()
        assert.equal(metadata.metaOf(late, ctx), undefined)
    })

    it("rejects forbidden thenables without invoking their protocol", () => {
        const ctx = context()
        let calls = 0
        const source = { then(onReady) { calls++; return onReady(0) } }
        assert.ok(runtime.managedState({ source }) instanceof Error)
        const sorted = runtime.run(new runtime.Chain([2, 1], ctx), [], "sort", [() => source], ctx, {})
        assert.equal(sorted.kind, errors.ERROR_KIND.AsyncCallback)
        const receiver = { update() { this.child = source } }
        const changed = runtime.run(new runtime.Chain(receiver, ctx), [], "update", [], ctx, { mutationScopeDepth: 0 })
        assert.equal(changed.kind, errors.ERROR_KIND.InvalidManagedReceiver)
        assert.equal(calls, 0)
    })

    it("preserves Error, Function, and admitted category before then access", () => {
        const ctx = context()
        const fail = () => { throw new Error("then must not be read") }
        const error = Object.defineProperty(new Error("data"), "then", { get: fail })
        const fn = Object.defineProperty(() => {}, "then", { get: fail })
        class External {}
        const external = new External()
        new runtime.Chain(external, ctx)
        Object.defineProperty(external, "then", { get: fail })
        for (const value of [error, fn, external]) {
            assert.equal(resolution.continueInitialValue(value, ctx), value)
        }
    })

    it("observes custom derived rejection and exposes pending fatal delivery", async () => {
        const ctx = context()
        const pending = Promise.withResolvers()
        const source = { then: (f, r) => pending.promise.then(f, r) }
        resolution.markPromiseHandled(source)
        const result = runtime.import(source, ctx)
        const observed = assert.rejects(result, error => error === ctx.execution.fatalError)
        assert.throws(() => errors.runInternalStep(ctx, () => { throw new Error("fatal") }), runtime.isFatalError)
        await observed
        pending.reject(new Error("late rejection"))
        await flush()
        resolution.markPromiseHandled(rejected(new Error("ready rejection")))
    })
})
