import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as runtime from "../src/index.js"
import { metaOf } from "../src/meta.js"
import { getParentPlacements } from "../src/parent-placements.js"
import { verifyParents } from "./verify-parents.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { ChainedThenable, OrderedThenable } from "./ordered-thenable.js"
import { createRandom, randomInteger } from "./native-equivalence-support.js"

const context = () => ({ execution: new runtime.Execution(), errorContext: "ownership" })

describe("bounded graph ownership", () => {
    for (const route of ["then", "await", "async-return", "adoption", "join"]) {
        it("protects pending delivery through " + route, async () => {
            const ctx = context(), pending = Promise.withResolvers(), pause = Promise.withResolvers()
            const source = new runtime.Chain(pending.promise, ctx)
            const lookup = runtime.lookupPath(source, [], ctx)
            let held
            const receive = value => held = new runtime.Chain(value, ctx)
            const forwarding = route === "await" ? (async () => receive(await lookup))() :
                route === "async-return" ? lookup.then(async value => { receive(value); await pause.promise; return value }) :
                route === "adoption" ? lookup.then(value => { receive(value); return Promise.resolve(value) }) :
                route === "join" ? Promise.all([lookup.then(value => { receive(value); return value }), pause.promise]) :
                lookup.then(receive)
            pending.resolve({ k: 1 })
            // Wait until direct reception, then allow the forwarding/join to
            // remain pending across a writer. Raw Promise forwarding alone is
            // outside the immediate-handoff contract.
            await new Promise(setImmediate)
            assert(held)
            runtime.assignPath(source, ["k"], 2, ctx)
            pause.resolve()
            await forwarding
            assert.deepEqual(await runtime.export(held, [], ctx), { k: 1 })
            assert.deepEqual(await runtime.export(source, [], ctx), { k: 2 })
            const retained = held._state.value
            runtime.assignPath(held, [], null, ctx)
            assert.equal(metaOf(retained, ctx).relationshipsActive, false)
            verifyRefCounts(ctx, source._state, held._state)
        })
    }

    it("distinguishes export generations when a mutable entry installs its gate", async () => {
        const ctx = context(), later = Promise.withResolvers()
        const source = new runtime.Chain({ x: { k: 1 } }, ctx)
        const input = new runtime.Chain({ first: runtime.lookupPath(source, [], ctx), second: later.promise }, ctx)
        const output = runtime.export(input, [], ctx)
        runtime.assignPath(input, [], null, ctx)
        runtime.enter(source, ["x"], ctx, true, entered => runtime.assignPath(entered, ["k"], 2, ctx))
        later.resolve(runtime.lookupPath(source, [], ctx))
        const result = await output
        assert.deepEqual(result, { first: { x: { k: 1 } }, second: { x: { k: 2 } } })
        assert.notEqual(result.first, result.second)
        verifyRefCounts(ctx, source._state, input._state)
    })

    it("advances every ancestor generation when a nested entry installs its gate", async () => {
        const ctx = context(), later = Promise.withResolvers()
        const root = { inner: { x: { k: 1 } } }
        const source = new runtime.Chain(root, ctx)
        const input = new runtime.Chain({ first: runtime.lookupPath(source, [], ctx), second: later.promise }, ctx)
        const output = runtime.export(input, [], ctx)
        runtime.assignPath(input, [], null, ctx)
        runtime.enter(source, ["inner", "x"], ctx, true, entered => runtime.assignPath(entered, ["k"], 2, ctx))
        assert.equal(source._state.value, root, "Exercise generation changes with reused ancestor storage")
        later.resolve(runtime.lookupPath(source, [], ctx))
        const result = await output
        assert.deepEqual(result, { first: { inner: { x: { k: 1 } } }, second: { inner: { x: { k: 2 } } } })
        assert.notEqual(result.first, result.second)
        assert.notEqual(result.first.inner, result.second.inner)
        verifyRefCounts(ctx, source._state, input._state)
    })

    for (const method of ["includes", "indexOf", "lastIndexOf"]) for (const ordered of [false, true]) {
        it(`distinguishes a retained generation from an unfinished effective entry in ${method}, ordered=${ordered}`, async () => {
            const ctx = context(), gate = ordered ? new OrderedThenable() : Promise.withResolvers()
            const source = new runtime.Chain({ x: { k: 1 } }, ctx)
            const retained = new runtime.Chain([runtime.lookupPath(source, [], ctx)], ctx)
            const mutation = runtime.enter(source, ["x", "k"], ctx, true, inside =>
                (ordered ? gate : gate.promise).then(() => runtime.assignPath(inside, [], 2, ctx)))
            // Capture before the callback changes anything. A later comparison
            // alone would miss speculative equality that already escaped.
            const result = runtime.run(retained, [], method, [runtime.lookupPath(source, [], ctx)], ctx, {})
            gate.resolve()
            await mutation
            assert.equal(await result, method === "includes" ? false : -1)
            assert.deepEqual(await runtime.export(retained, [], ctx), [{ x: { k: 1 } }])
            assert.deepEqual(await runtime.export(source, [], ctx), { x: { k: 2 } })
            verifyRefCounts(ctx, source._state, retained._state)
        })
    }

    it("keeps before/after entry export captures distinct until delayed effects finish", async () => {
        const ctx = context(), gate = Promise.withResolvers(), later = Promise.withResolvers()
        const source = new runtime.Chain({ x: { k: 1 } }, ctx)
        const both = new runtime.Chain({ before: runtime.lookupPath(source, [], ctx), after: later.promise }, ctx)
        const output = runtime.export(both, [], ctx)
        runtime.assignPath(both, [], null, ctx)
        const mutation = runtime.enter(source, ["x", "k"], ctx, true, inside =>
            gate.promise.then(() => runtime.assignPath(inside, [], 2, ctx)))
        later.resolve(runtime.lookupPath(source, [], ctx))
        await new Promise(setImmediate)
        gate.resolve()
        await mutation
        const result = await output
        assert.deepEqual(result, { before: { x: { k: 1 } }, after: { x: { k: 2 } } })
        assert.notEqual(result.before, result.after)
        assert.notEqual(result.before.x, result.after.x)
        verifyRefCounts(ctx, source._state, both._state)
    })

    it("restores recovery descendants before another owner can mutate them", () => {
        const ctx = context(), leaf = { k: 1 }, baseline = { leaf }
        const source = new runtime.Chain({ branch: baseline }, ctx)
        const survivor = new runtime.Chain(leaf, ctx)
        runtime.assignPath(source, ["branch", "absent", "k"], 0, ctx, 1)
        const cached = source._state.value
        runtime.assignPath(source, [], null, ctx)
        assert.equal(metaOf(baseline, ctx).relationshipsActive, false)
        const restored = new runtime.Chain(cached, ctx)
        runtime.assignPath(survivor, ["k"], 2, ctx)
        runtime.repairPath(restored, ["branch"], ctx)
        assert.deepEqual(runtime.export(restored, [], ctx), { branch: { leaf: { k: 1 } } })
        assert.deepEqual(runtime.export(survivor, [], ctx), { k: 2 })
        verifyRefCounts(ctx, source._state, survivor._state, restored._state)
    })

    it("retires fresh delivery into an already retired destination", async () => {
        const ctx = context(), pending = Promise.withResolvers(), child = { k: 1 }
        const survivor = new runtime.Chain(child, ctx)
        const source = new runtime.Chain({ x: pending.promise }, ctx)
        runtime.assignPath(source, [], null, ctx)
        const delivered = { child: runtime.lookupPath(survivor, [], ctx) }
        pending.resolve(delivered)
        await new Promise(setImmediate)
        assert.equal(metaOf(delivered, ctx).relationshipsActive, false)
        assert.deepEqual(getParentPlacements(child, ctx), [{ parent: survivor._state, key: "value" }])
        runtime.assignPath(survivor, ["k"], 2, ctx)
        assert.equal(survivor._state.value, child, "Discarded delivery leaves no COW protection")
        verifyRefCounts(ctx, source._state, survivor._state, delivered)
    })

    it("releases path-copy protection at attachment before waiting on a child", async () => {
        const ctx = context(), pending = Promise.withResolvers()
        const source = new runtime.Chain({ p: pending.promise, s: 0 }, ctx)
        const fork = new runtime.Chain(runtime.lookupPath(source, [], ctx), ctx)
        const mutation = runtime.assignPath(source, ["p", "k"], 2, ctx)
        // Inspect identity without creating a retained reader of this generation.
        const attached = source._state.value
        runtime.assignPath(source, ["s"], 1, ctx)
        assert.equal(source._state.value, attached, "An attached path copy needs no working read lease")
        pending.resolve({ k: 0 })
        await mutation
        assert.deepEqual(await runtime.export(source, [], ctx), { p: { k: 2 }, s: 1 })
        assert.deepEqual(await runtime.export(fork, [], ctx), { p: { k: 0 }, s: 0 })
        verifyRefCounts(ctx, source._state, fork._state)
    })

    it("rejects imported Array storage reuse before probing extensibility", () => {
        const ctx = context()
        let probes = 0
        const host = new Proxy([1], { isExtensible() { probes++; throw new Error("unused storage probe") } })
        const source = new runtime.Chain(runtime.import(host, ctx), ctx)
        assert.equal(runtime.run(source, [], "push", [2], ctx, { mutationScopeDepth: 0 }), 2)
        assert.equal(probes, 0)
        assert.deepEqual(runtime.export(source, [], ctx), [1, 2])
        assert.deepEqual(host, [1])
        verifyRefCounts(ctx, source._state)
    })

    for (const mutable of [false, true]) for (const array of [false, true]) {
        it(`prepares a fresh pending entry result before releasing its source, mutable=${mutable}, Array=${array}`, async () => {
            const ctx = context(), signal = Promise.withResolvers()
            const source = new runtime.Chain({ child: { k: 1 } }, ctx)
            let callbackResult
            const output = runtime.enter(source, [], ctx, mutable, entered => callbackResult = (async () => {
                await signal.promise
                const child = runtime.lookupPath(entered, ["child"], ctx)
                return array ? [child] : { child }
            })())
            const receiver = new runtime.Chain(output, ctx)
            const writer = callbackResult.then(() => runtime.assignPath(source, ["child", "k"], 2, ctx))
            signal.resolve()
            assert.deepEqual(await runtime.export(receiver, [], ctx), array ? [{ k: 1 }] : { child: { k: 1 } })
            await writer
            assert.deepEqual(await runtime.export(source, [], ctx), { child: { k: 2 } })
            verifyRefCounts(ctx, source._state, receiver._state)
        })
    }

    it("keeps a borrowed entry-result child active through synchronous handoff", () => {
        const ctx = context(), child = { k: 1 }, source = new runtime.Chain({ child }, ctx)
        const result = runtime.enter(source, [], ctx, false, entered => {
            const wrapper = { child: runtime.lookupPath(entered, ["child"], ctx) }
            runtime.assignPath(source, [], null, ctx)
            return wrapper
        })
        assert.equal(metaOf(child, ctx).relationshipsActive, true)
        const received = new runtime.Chain(result, ctx)
        assert.deepEqual(runtime.export(received, [], ctx), { child: { k: 1 } })
        runtime.assignPath(received, [], null, ctx)
        assert.equal(metaOf(child, ctx).relationshipsActive, false)
        verifyRefCounts(ctx, source._state, received._state)
    })

    for (const pending of [false, true]) {
        it("publishes contained work when entry-result preparation fails, pending=" + pending, async () => {
            const ctx = context(), source = new runtime.Chain({ k: 1 }, ctx)
            const failure = new Error("cannot inspect result"), signal = Promise.withResolvers()
            const result = new Proxy({}, { ownKeys() { throw failure } })
            let reference
            const output = runtime.enter(source, [], ctx, true, entered => {
                reference = entered
                runtime.assignPath(entered, ["k"], 2, ctx)
                return pending ? signal.promise : result
            })
            signal.resolve(result)
            const error = await output
            assert(runtime.isPoisonError(error))
            assert.equal(error.cause, failure)
            assert.equal(error.kind, runtime.ERROR_KIND.OperationInputFailed)
            assert.equal(reference._closed, true)
            assert.deepEqual(await runtime.export(source, [], ctx), { k: 2 })
            assert.equal(metaOf(source._state.value, ctx).readLeaseCount ?? 0, 0)
            verifyRefCounts(ctx, source._state)
        })
    }

    for (const indexed of [false, true]) for (const shape of ["record", "array", "view"]) {
        for (const keepOriginal of [false, true]) {
            it(`preserves recovery introduced after a copied capture, ${shape}, indexed=${indexed}, original=${keepOriginal}`, async () => {
                const ctx = context(), child = { k: 1 }, survivor = new runtime.Chain(child, ctx)
                const hold = Promise.withResolvers()
                const key = shape === "record" ? "child" : 0, sibling = shape === "record" ? "sibling" : 1
                let root
                if (shape === "view") {
                    const backing = new runtime.Chain([0, child, 9], ctx)
                    root = new runtime.Chain(runtime.run(backing, [], "slice", [1, 2], ctx, { repair: false }), ctx)
                    runtime.assignPath(backing, [], null, ctx)
                } else root = new runtime.Chain(shape === "record" ? { child } : [child], ctx)
                if (indexed) assert.equal(runtime.hasError(root, [], ctx), false)
                const entry = runtime.enter(root, [key], ctx, true, entered => {
                    assert(runtime.isPoisonError(runtime.assignPath(entered, ["absent", "x"], 0, ctx, 0)))
                    return hold.promise
                })
                const original = new runtime.Chain(runtime.lookupPath(root, [], ctx), ctx)
                runtime.assignPath(root, [sibling], 99, ctx)
                if (!keepOriginal) runtime.assignPath(original, [], null, ctx)
                const later = hold.promise.then(() => runtime.assignPath(survivor, ["k"], 2, ctx))
                hold.resolve()
                await Promise.all([entry, later])
                assert(runtime.isPoisonError(await runtime.lookupPath(root, [key], ctx)))
                await runtime.repairPath(root, [key], ctx)
                assert.equal(runtime.lookupPath(root, [key, "k"], ctx), 1)
                assert.equal(runtime.lookupPath(survivor, ["k"], ctx), 2)
                verifyRefCounts(ctx, root._state, original._state, survivor._state)
                for (const holder of [root, original, survivor]) runtime.assignPath(holder, [], null, ctx)
                await new Promise(setImmediate)
                assert.equal(metaOf(child, ctx).readLeaseCount ?? 0, 0)
                assert.equal(metaOf(child, ctx).preservationParents, undefined)
                assert.equal(metaOf(child, ctx).relationshipsActive, false)
            })
        }
    }

    for (const nested of [false, true]) for (const discarded of [false, true]) {
        it(`follows newly introduced pending recovery and detaches it, nested=${nested}, discarded=${discarded}`, async () => {
            const ctx = context(), pending = new OrderedThenable(), hold = Promise.withResolvers()
            const child = { k: 1 }, survivor = new runtime.Chain(child, ctx)
            const source = new runtime.Chain({ then: pending }, ctx)
            // Callable then is an invalid placement value. Failed replacement
            // retains the old pending value without awaiting it; a second failure
            // makes that recovery a nested obligation of the later capture.
            if (nested) assert(runtime.isPoisonError(runtime.assignPath(source, ["then"], () => {}, ctx)))
            const entry = runtime.enter(source, ["then"], ctx, true, entered => {
                assert(runtime.isPoisonError(runtime.assignPath(entered, [], () => {}, ctx)))
                return hold.promise
            })
            const original = new runtime.Chain(runtime.lookupPath(source, [], ctx), ctx)
            runtime.assignPath(source, ["sibling"], 9, ctx)
            runtime.assignPath(original, [], null, ctx)
            if (discarded) runtime.assignPath(source, [], null, ctx)
            const deliver = () => {
                pending.resolve(child)
                pending.flush()
            }
            // Deliver at the gap between gate publication and copied delivery.
            const later = discarded ? undefined : hold.promise.then(() => {
                deliver()
                runtime.assignPath(survivor, ["k"], 2, ctx)
            })
            hold.resolve()
            await Promise.all([entry, later])
            if (discarded) {
                await new Promise(setImmediate)
                deliver()
                // Detached versions still finish shared settlement. Once its
                // temporary handoffs end, no discarded recovery may retain child.
                await new Promise(setImmediate)
                runtime.assignPath(survivor, ["k"], 2, ctx)
                assert.equal(survivor._state.value, child, "Detached captures leave no read protection")
            } else {
                for (let i = 0; i < (nested ? 2 : 1); i++) await runtime.repairPath(source, ["then"], ctx)
                assert.equal(await runtime.lookupPath(source, ["then", "k"], ctx), 1)
            }
            assert.equal(runtime.lookupPath(survivor, ["k"], ctx), 2)
            for (const holder of [source, survivor]) runtime.assignPath(holder, [], null, ctx)
            await new Promise(setImmediate)
            assert.equal(metaOf(child, ctx).readLeaseCount ?? 0, 0)
            assert.equal(metaOf(child, ctx).preservationParents, undefined)
            assert.equal(metaOf(child, ctx).relationshipsActive, false)
            verifyRefCounts(ctx, source._state, original._state, survivor._state)
        })
    }

    for (const entry of [false, true]) for (const timing of ["ready", "fulfilled", "pending", "ordered"])
    for (const nested of [false, true]) {
        it(`preserves detached writer descendants through a cycle, entry=${entry}, timing=${timing}, nested=${nested}`, async () => {
            const ctx = context(), signal = timing === "ordered" ? new OrderedThenable() : Promise.withResolvers()
            const item = { k: 1 }, root = { items: [item] }
            root.pending = timing === "ready" ? root : timing === "ordered" ? signal : signal.promise
            if (timing === "fulfilled") signal.resolve(root)
            const source = new runtime.Chain(nested ? { branch: root } : root, ctx)
            const prefix = nested ? ["branch"] : []
            const alias = new runtime.Chain(runtime.lookupPath(source, [...prefix, "items", 0], ctx), ctx)
            const selected = [...prefix, "pending"]
            const outcome = entry
                ? runtime.enter(source, selected, ctx, true, entered =>
                    runtime.run(entered, ["items"], "pop", [], ctx, { mutationScopeDepth: 1 }))
                : runtime.run(source, [...selected, "items"], "pop", [], ctx, { mutationScopeDepth: selected.length + 1 })
            const removed = new runtime.Chain(outcome, ctx)
            runtime.assignPath(source, prefix, null, ctx)
            // The pending cycle can still reach root.items. Keeping only the
            // captured pending version would let this alias change it in place.
            runtime.assignPath(alias, ["k"], 2, ctx)
            if (timing === "pending" || timing === "ordered") signal.resolve(root)
            assert.deepEqual(await runtime.export(removed, [], ctx), { k: 1 })
            assert.deepEqual(runtime.export(alias, [], ctx), { k: 2 })
            assert.equal(runtime.lookupPath(source, prefix, ctx), null)
            for (const holder of [source, alias, removed]) runtime.assignPath(holder, [], null, ctx)
            await new Promise(setImmediate)
            for (const value of [root, root.items, item]) {
                assert.equal(metaOf(value, ctx).pinCount ?? 0, 0)
                assert.equal(metaOf(value, ctx).relationshipsActive, false)
                assert.deepEqual(getParentPlacements(value, ctx), [])
            }
            verifyRefCounts(ctx, source._state, alias._state, removed._state, root)
        })
    }

    for (const reverse of [false, true]) {
        it("keeps overlapping writers alive until their publications finish, reverse=" + reverse, async () => {
            const ctx = context(), original = { k: 0 }, source = new runtime.Chain(original, ctx)
            const first = Promise.withResolvers(), second = Promise.withResolvers()
            const a = runtime.enter(source, [], ctx, true, entered => {
                runtime.assignPath(entered, ["k"], 1, ctx)
                return first.promise
            })
            const b = runtime.enter(source, [], ctx, true, entered => {
                runtime.assignPath(entered, ["k"], 2, ctx)
                return second.promise
            })
            const received = new runtime.Chain(runtime.lookupPath(source, [], ctx), ctx)
            runtime.assignPath(source, [], null, ctx)
            const signals = reverse ? [second, first] : [first, second]
            signals[0].resolve()
            await new Promise(setImmediate)
            signals[1].resolve()
            await Promise.all([a, b])
            assert.deepEqual(await runtime.export(received, [], ctx), { k: 2 })
            assert.equal(await runtime.export(source, [], ctx), null)
            const receivedValue = received._state.value
            runtime.assignPath(received, [], null, ctx)
            await new Promise(setImmediate)
            for (const value of [original, receivedValue]) {
                assert.equal(metaOf(value, ctx).relationshipsActive, false)
                assert.deepEqual(getParentPlacements(value, ctx), [])
            }
            // Finishing writers must preserve the source Chain's independent hold.
            runtime.assignPath(source, [], { k: 3 }, ctx)
            const fork = new runtime.Chain(runtime.lookupPath(source, [], ctx), ctx)
            runtime.assignPath(source, ["k"], 4, ctx)
            assert.deepEqual(runtime.export(fork, [], ctx), { k: 3 })
            assert.deepEqual(runtime.export(source, [], ctx), { k: 4 })
            verifyRefCounts(ctx, source._state, received._state, fork._state)
        })
    }

    for (const viewUse of ["none", "retained", "released"]) for (const indexed of [false, true])
    for (const entry of [false, true]) {
        it(`copies non-writable Array length before indexed growth, view=${viewUse}, indexed=${indexed}, entry=${entry}`, () => {
            const ctx = context(), array = [1]
            Object.defineProperty(array, "length", { writable: false })
            const source = new runtime.Chain(array, ctx)
            const view = viewUse === "none" ? undefined :
                new runtime.Chain(runtime.run(source, [], "slice", [], ctx, {}), ctx)
            if (viewUse === "released") runtime.assignPath(view, [], null, ctx)
            if (indexed) assert.equal(runtime.hasError(source, [], ctx), false)
            const result = entry
                ? runtime.enter(source, [1], ctx, true, entered => runtime.assignPath(entered, [], 2, ctx))
                : runtime.assignPath(source, [1], 2, ctx)
            assert.equal(result, undefined)
            assert.deepEqual(runtime.export(source, [], ctx), [1, 2])
            assert.notEqual(runtime.lookupPath(source, [], ctx), array)
            assert.deepEqual(array, [1])
            if (viewUse === "retained") assert.deepEqual(runtime.export(view, [], ctx), [1])
            verifyRefCounts(ctx, source._state, ...(view ? [view._state] : []))
        })
    }

    it("distinguishes exported generations before a pending mutation reaches its target", async () => {
        const ctx = context(), child = Promise.withResolvers(), later = Promise.withResolvers()
        const source = new runtime.Chain({ child: child.promise }, ctx)
        const before = runtime.lookupPath(source, [], ctx)
        const input = new runtime.Chain({ before, after: later.promise }, ctx)
        const result = runtime.export(input, [], ctx)
        runtime.assignPath(input, [], null, ctx)
        const mutation = runtime.assignPath(source, ["child", "k"], 2, ctx)
        const after = runtime.lookupPath(source, [], ctx)
        assert.equal(before, after, "Storage can be reused after the earlier capture")
        later.resolve(after)
        for (let i = 0; i < 10; i++) await Promise.resolve()
        child.resolve({ k: 1 })
        const output = await result
        await mutation
        assert.deepEqual(output, { before: { child: { k: 1 } }, after: { child: { k: 2 } } })
        assert.notEqual(output.before, output.after)
        verifyRefCounts(ctx, source._state, input._state)
    })

    for (const shape of ["record", "array", "view"]) {
        it("retires temporary restoration after failed reception, shape=" + shape, async () => {
            const ctx = context(), child = { k: 1 }, source = new runtime.Chain(child, ctx)
            const pending = Promise.withResolvers(), abandoned = Promise.withResolvers()
            const cycle = {}; cycle.self = cycle
            const raw = shape === "record" ? { child, cycle, pending: pending.promise } : [child, cycle, pending.promise]
            const prior = new runtime.Chain(raw, ctx)
            const holder = shape === "view" ? new runtime.Chain(runtime.run(prior, [], "slice", [], ctx, {}), ctx) : prior
            const cached = holder._state.value
            runtime.assignPath(prior, [], null, ctx)
            runtime.assignPath(holder, [], null, ctx)
            assert.equal(metaOf(cached, ctx).relationshipsActive, false)
            const input = { cached, abandoned: abandoned.promise, invalid: new Proxy({}, {
                ownKeys() { throw new Error("preparation failed") },
            }) }
            const received = new runtime.Chain(input, ctx)
            assert(runtime.isPoisonError(received._state.value))
            assert.equal(metaOf(input, ctx), undefined)
            for (const value of [raw, cached, cycle]) {
                assert.equal(metaOf(value, ctx).relationshipsActive, false)
                assert.deepEqual(getParentPlacements(value, ctx), [])
                assert.equal(metaOf(value, ctx).readLeaseCount ?? 0, 0)
            }
            assert.deepEqual(getParentPlacements(child, ctx), [{ parent: source._state, key: "value" }])
            runtime.assignPath(source, ["k"], 2, ctx)
            assert.equal(source._state.value, child, "Failed reception leaves no COW protection")
            const discarded = {}, delivered = {}
            abandoned.resolve(discarded)
            pending.resolve(delivered)
            await new Promise(setImmediate)
            assert.equal(metaOf(discarded, ctx), undefined)
            assert.equal(metaOf(cached, ctx).relationshipsActive, false)
            assert.deepEqual(getParentPlacements(delivered, ctx), [])
            verifyRefCounts(ctx, source._state, received._state, raw, cached, cycle)
        })
    }

    it("preserves captured generations and releases spent pending inputs", function () {
        this.timeout(30000)
        const result = spawnSync(process.execPath, ["--expose-gc", "--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/ownership-interactions.js", import.meta.url))],
        { encoding: "utf8", timeout: 30000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    for (const fixture of ["ownership-destinations", "array-point-work"]) {
        it("verifies " + fixture, function () {
            this.timeout(30000)
            const result = spawnSync(process.execPath, ["--expose-gc", "--unhandled-rejections=strict",
                fileURLToPath(new URL("./fixtures/" + fixture + ".js", import.meta.url))],
            { encoding: "utf8", timeout: 30000 })
            assert.equal(result.status, 0, result.stdout + result.stderr)
        })
    }

    it("bounds reactivation and Array extension work", function () {
        this.timeout(30000)
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/ownership-work.js", import.meta.url))],
        { encoding: "utf8", timeout: 30000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    it("retires queued mutation and inspection-failure graphs", function () {
        this.timeout(15000)
        const result = spawnSync(process.execPath, ["--import", new URL("./trace-runtime.js", import.meta.url).href,
            "--unhandled-rejections=strict", "--max-old-space-size=256",
            fileURLToPath(new URL("./fixtures/ownership-lifecycle.js", import.meta.url))],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.error, undefined, result.error?.message)
        assert.equal(result.status, 0, result.stdout + result.stderr)
        const { mutationCases, inspectionCases, injectedFailures, failureCoverage } = JSON.parse(result.stdout)
        assert.equal(mutationCases, 288)
        assert.equal(inspectionCases, 112)
        assert(injectedFailures > 0)
        for (const route of ["export", "hasError", "getErrors", "assign", "entry", "observe", "mutate"])
            for (const indexed of [false, true]) for (const cyclic of [false, true]) {
                // Indexed acyclic queries use their summary; the fixture checks
                // that these controls perform no fallible reflection at all.
                if (indexed && !cyclic && (route === "hasError" || route === "getErrors")) continue
                const combination = `${route}:${indexed}:${cyclic}`
                assert(failureCoverage.includes(combination), `Missing failure coverage: ${combination}`)
            }
    })

    it("retires precisely the unreachable region across cyclic multi-root graphs", () => {
        for (let seed = 1; seed <= 32; seed++) {
            const ctx = context(), nodes = Array.from({ length: 12 }, () => ({}))
            const random = createRandom(seed)
            for (const node of nodes) for (let edge = 0; edge < 3; edge++)
                if (randomInteger(random, 3)) node[edge] = nodes[randomInteger(random, nodes.length)]
            const roots = nodes.map(node => new runtime.Chain(node, ctx))
            const retained = new Set(nodes)
            while (retained.size) {
                const removed = [...retained][randomInteger(random, retained.size)]
                retained.delete(removed)
                runtime.assignPath(roots[nodes.indexOf(removed)], [], null, ctx)
                const reachable = new Set()
                const visit = node => {
                    if (reachable.has(node)) return
                    reachable.add(node)
                    for (const child of Object.values(node)) visit(child)
                }
                for (const root of retained) visit(root)
                for (const node of nodes) {
                    assert.equal(metaOf(node, ctx).relationshipsActive, reachable.has(node), `seed ${seed}`)
                    if (!reachable.has(node)) assert.deepEqual(getParentPlacements(node, ctx), [])
                }
                verifyParents(ctx, ...roots.map(root => root._state), ...nodes)
            }
        }
    })

    for (const Constructor of [runtime.Chain, runtime.ContextChain]) {
        it("protects pending " + Constructor.name + " initialization before later source writers", async () => {
            const ctx = context(), child = { k: 1 }, source = new runtime.Chain(child, ctx)
            const pending = Promise.withResolvers()
            const received = new Constructor(pending.promise, ctx)
            const later = pending.promise.then(() => runtime.assignPath(source, ["k"], 2, ctx))
            pending.resolve(child)
            assert.deepEqual(await runtime.export(received, [], ctx), { k: 1 })
            await later
            assert.deepEqual(runtime.export(source, [], ctx), { k: 2 })
            verifyRefCounts(ctx, source._state, received._state)
        })
    }

    it("protects an assignment input while earlier target work waits for delivery", async () => {
        const ctx = context(), source = new runtime.Chain({ child: { k: 1 } }, ctx)
        const signal = new ChainedThenable(), control = new runtime.Chain({}, ctx)
        const target = new runtime.Chain(runtime.continueOperation(signal, ctx, () =>
            runtime.enter(control, [], ctx, false, () => {
                runtime.assignPath(source, ["child", "k"], 2, ctx)
                return {}
            })), ctx)
        signal.resolve(0)
        runtime.assignPath(target, ["child"], runtime.lookupPath(source, ["child"], ctx), ctx)
        assert.deepEqual(await runtime.export(target, [], ctx), { child: { k: 1 } })
        assert.deepEqual(runtime.export(source, [], ctx), { child: { k: 2 } })
        verifyRefCounts(ctx, source._state, target._state)
    })

    it("retains a pending assignment's delivered version while its target waits", async () => {
        const ctx = context(), child = { k: 1 }, source = new runtime.Chain(child, ctx)
        const input = Promise.withResolvers(), receiver = Promise.withResolvers()
        const target = new runtime.Chain(receiver.promise, ctx)
        runtime.assignPath(target, ["child"], input.promise, ctx)
        const later = input.promise.then(() => runtime.assignPath(source, ["k"], 2, ctx))
        input.resolve(child)
        await later
        receiver.resolve({})
        assert.deepEqual(await runtime.export(target, [], ctx), { child: { k: 1 } })
        assert.deepEqual(runtime.export(source, [], ctx), { k: 2 })
        verifyRefCounts(ctx, source._state, target._state)
    })

    it("reuses a unique node after its other owner releases it", () => {
        const ctx = context(), value = { k: 1 }, source = new runtime.Chain(value, ctx)
        const other = new runtime.Chain(runtime.lookupPath(source, [], ctx), ctx)
        runtime.assignPath(other, [], null, ctx)
        runtime.assignPath(source, ["k"], 2, ctx)
        assert.equal(source._state.value, value)
        assert.equal(value.k, 2)
    })

    for (const indexed of [false, true]) {
        it(`preserves late captured settlement after shortening and extending a view, indexed=${indexed}`, async () => {
            const ctx = context(), pending = Promise.withResolvers(), old = { old: true }
            const physical = [1, , pending.promise, old]
            const source = new runtime.Chain(physical, ctx)
            const captured = new runtime.Chain(runtime.lookupPath(source, [2], ctx), ctx)
            if (indexed) runtime.hasError(source, [], ctx)
            const shorter = new runtime.Chain(runtime.run(source, [], "slice", [0, 2], ctx, {}), ctx)
            runtime.assignPath(source, [], null, ctx)
            runtime.run(shorter, [], "push", [7], ctx, { mutationScopeDepth: 0 })
            pending.resolve(9)
            assert.equal(await runtime.export(captured, [], ctx), 9)
            assert.deepEqual(await runtime.export(shorter, [], ctx), [1, , 7])
            verifyRefCounts(ctx, source._state, shorter._state, captured._state)
        })
    }

    it("does not expose discarded physical slots as holes during indexed growth", () => {
        const ctx = context(), source = new runtime.Chain([1, 2, 3, 4], ctx)
        const shorter = new runtime.Chain(runtime.run(source, [], "slice", [0, 1], ctx, {}), ctx)
        runtime.assignPath(source, [], null, ctx)
        runtime.assignPath(shorter, [3], 9, ctx)
        assert.deepEqual(runtime.export(shorter, [], ctx), [1, , , 9])
        verifyRefCounts(ctx, shorter._state)
    })

    it("copies a view when filling a hole in non-extensible backing", () => {
        const ctx = context(), physical = Object.preventExtensions([, 2])
        const source = new runtime.Chain(physical, ctx)
        const view = new runtime.Chain(runtime.run(source, [], "slice", [], ctx, {}), ctx)
        runtime.assignPath(source, [], null, ctx)
        assert.equal(runtime.assignPath(view, [0], 1, ctx), undefined)
        assert.deepEqual(runtime.export(view, [], ctx), [1, 2])
        assert.equal(0 in physical, false)
        verifyRefCounts(ctx, view._state)
    })

    it("preserves retained longer views and falls back for restricted tail storage", () => {
        const ctx = context(), physical = [1, 2, 3], source = new runtime.Chain(physical, ctx)
        const retained = new runtime.Chain(runtime.lookupPath(source, [], ctx), ctx)
        runtime.run(source, [], "pop", [], ctx, { mutationScopeDepth: 0 })
        runtime.run(source, [], "push", [7], ctx, { mutationScopeDepth: 0 })
        assert.deepEqual(runtime.export(retained, [], ctx), [1, 2, 3])
        assert.deepEqual(runtime.export(source, [], ctx), [1, 2, 7])
        const restricted = [1, 2, 3]
        Object.defineProperty(restricted, "2", { writable: false })
        const other = new runtime.Chain(restricted, ctx)
        runtime.run(other, [], "pop", [], ctx, { mutationScopeDepth: 0 })
        runtime.run(other, [], "push", [8], ctx, { mutationScopeDepth: 0 })
        assert.deepEqual(runtime.export(other, [], ctx), [1, 2, 8])
        verifyRefCounts(ctx, source._state, retained._state, other._state)
    })

    it("isolates aliases and off-path cycle occurrences", () => {
        const ctx = context(), child = { k: 1 }, root = { a: child, b: child }
        const source = new runtime.Chain(root, ctx)
        runtime.assignPath(source, ["a", "k"], 2, ctx)
        assert.equal(root.a.k, 2)
        assert.equal(root.b.k, 1)
        const cycle = { k: 1 }; cycle.self = cycle
        const cyclic = new runtime.Chain(cycle, ctx)
        runtime.assignPath(cyclic, ["k"], 2, ctx)
        assert.notEqual(cyclic._state.value, cycle)
        assert.equal(cyclic._state.value.self, cycle)
        assert.equal(cycle.k, 1)
        verifyParents(ctx, source._state, cyclic._state)
    })

    for (const array of [false, true]) {
        it("protects active children of retired input during preparation, array=" + array, async () => {
            const ctx = context(), child = { k: 1 }, source = new runtime.Chain(child, ctx)
            const cached = array ? [child] : { child }, prior = new runtime.Chain(cached, ctx)
            runtime.assignPath(prior, [], null, ctx)
            assert.equal(metaOf(cached, ctx).relationshipsActive, false)
            const signal = new ChainedThenable()
            const drain = runtime.continueOperation(signal, ctx, () => {
                runtime.assignPath(source, ["k"], 2, ctx)
                return 0
            })
            signal.resolve(0)
            const received = new runtime.Chain({ cached, drain }, ctx)
            assert.deepEqual(await runtime.export(received, ["cached"], ctx), array ? [{k:1}] : {child:{k:1}})
            assert.deepEqual(runtime.export(source, [], ctx), {k:2})
            verifyRefCounts(ctx, source._state, received._state)
        })
    }

    for (const nested of [false, true]) for (const pendingReceiver of [false, true]) {
        it(`protects the complete argument frontier, nested=${nested}, pendingReceiver=${pendingReceiver}`, async () => {
            const ctx = context(), source = new runtime.Chain({ child: { k: 1 } }, ctx)
            const control = new runtime.Chain({}, ctx), trigger = new ChainedThenable()
            const child = runtime.lookupPath(source, ["child"], ctx)
            const drain = runtime.continueOperation(trigger, ctx, () => runtime.enter(control, [], ctx, false, () => {
                runtime.assignPath(source, ["child", "k"], 2, ctx)
                return 0
            }))
            trigger.resolve(0)
            const host = runtime.externalState({ use(first, second) { return (second ?? first).child.k } })
            const receiver = new runtime.Chain(pendingReceiver ? Promise.resolve(host) : host, ctx)
            const args = nested ? [{ drain, child }] : [drain, { child }]
            assert.equal(await runtime.run(receiver, [], "use", args, ctx, {}), 1)
            assert.equal(source._state.value.child.k, 2)
        })
    }

    for (const method of ["includes", "indexOf", "lastIndexOf"]) {
        it(`captures ${method}'s fromIndex before the search input resumes earlier work`, async () => {
            const ctx = context(), backwards = method === "lastIndexOf"
            const source = new runtime.Chain([backwards ? 1 : 0], ctx)
            const receiver = new runtime.Chain(backwards ? [9, 2] : [2, 9], ctx)
            const control = new runtime.Chain({}, ctx), trigger = new ChainedThenable()
            const search = runtime.continueOperation(trigger, ctx, () => runtime.enter(control, [], ctx, false, () => {
                runtime.assignPath(source, [0], backwards ? 0 : 1, ctx)
                return 2
            }))
            trigger.resolve(0)
            const fromIndex = [runtime.lookupPath(source, [], ctx)]
            const result = runtime.run(receiver, [], method, [search, fromIndex], ctx, {})
            assert.equal(await result, method === "includes" ? true : backwards ? 1 : 0)
            assert.deepEqual(runtime.export(source, [], ctx), [backwards ? 0 : 1])
            verifyRefCounts(ctx, source._state, receiver._state)
        })
    }

    for (const method of ["pop", "shift"]) {
        it(`releases ${method}'s unpublished view when reading the removed element fails`, () => {
            const ctx = context(), child = {}, survivor = new runtime.Chain(child, ctx)
            const removedKey = method === "pop" ? "1" : "0"
            let fail = false
            const input = new Proxy(method === "pop" ? [child, 1] : [1, child], {
                getOwnPropertyDescriptor(target, key) {
                    if (fail && key === removedKey) throw new Error("Removed element is unreadable")
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const source = new runtime.Chain(input, ctx)
            fail = true
            assert(runtime.isPoisonError(runtime.run(source, [], method, [], ctx, { mutationScopeDepth: 0 })))
            runtime.assignPath(source, [], null, ctx)
            assert.deepEqual(getParentPlacements(child, ctx), [{ parent: survivor._state, key: "value" }])
            fail = false
            verifyRefCounts(ctx, source._state, survivor._state, input)
        })
    }

    for (const cyclic of [false, true]) {
        it(`retires detached topology and restores cached data, cyclic=${cyclic}`, () => {
            const ctx = context(), child = {}, root = { child }
            if (cyclic) { child.root = root; child.self = child }
            const source = new runtime.Chain(root, ctx)
            runtime.assignPath(source, [], null, ctx)
            for (const value of [root, child]) {
                assert.equal(metaOf(value, ctx).relationshipsActive, false)
                assert.deepEqual(getParentPlacements(value, ctx), [])
            }
            const received = new runtime.Chain(root, ctx)
            assert.equal(metaOf(child, ctx).relationshipsActive, true)
            verifyParents(ctx, received._state)
        })
    }

    it("retires physical backing cycles outside the logical Array surface", () => {
        const ctx = context(), array = [], source = new runtime.Chain(array, ctx)
        runtime.run(source, [], "push", [runtime.lookupPath(source, [], ctx)], ctx, {mutationScopeDepth:0})
        assert.deepEqual(runtime.export(source, [], ctx), [[]])
        assert.equal(array[0], array)
        const view = source._state.value, backing = metaOf(view, ctx).backingRecord
        runtime.assignPath(source, [], null, ctx)
        for (const value of [array, view, backing]) assert.equal(metaOf(value, ctx).relationshipsActive, false)
        assert.equal(backing.owners.size, 0)
        verifyRefCounts(ctx, source._state, array, view)
    })

    it("keeps descendants retained by another Chain", () => {
        const ctx = context(), child = { k: 1 }, root = { child }
        const source = new runtime.Chain(root, ctx)
        const receiver = new runtime.Chain(runtime.lookupPath(source, ["child"], ctx), ctx)
        runtime.assignPath(source, [], null, ctx)
        assert.equal(metaOf(root, ctx).relationshipsActive, false)
        assert.equal(metaOf(child, ctx).relationshipsActive, true)
        assert.deepEqual(getParentPlacements(child, ctx), [{ parent: receiver._state, key: "value" }])
        verifyParents(ctx, receiver._state)
    })

    it("bounds silently discarded ready views within a synchronous turn", () => {
        const ctx = context(), child = {}, array = [child]
        const source = new runtime.Chain(array, ctx)
        let last
        for (let index = 0; index < 100; index++) {
            last = runtime.run(source, [], "slice", [], ctx, {})
            assert.equal(metaOf(array, ctx).arrayBacking.owners.size, 2)
        }
        runtime.assignPath(source, [], null, ctx)
        assert.equal(metaOf(last, ctx).relationshipsActive, false)
        assert.equal(metaOf(array, ctx).arrayBacking.owners.size, 0)
        assert.deepEqual(getParentPlacements(child, ctx), [])
    })

    it("retains a pending lookup until each direct receiver attaches", async () => {
        const ctx = context(), pending = Promise.withResolvers(), child = { k: 1 }
        const source = new runtime.Chain({ child: pending.promise }, ctx)
        const lookup = runtime.lookupPath(source, ["child"], ctx)
        const first = new runtime.Chain(lookup, ctx)
        const second = new runtime.Chain(lookup, ctx)
        runtime.assignPath(source, ["child", "k"], 2, ctx)
        pending.resolve(child)
        assert.deepEqual(await runtime.export(first, [], ctx), { k: 1 })
        assert.deepEqual(await runtime.export(second, [], ctx), { k: 1 })
        assert.deepEqual(await runtime.export(source, [], ctx), { child: { k: 2 } })
        verifyParents(ctx, first._state, second._state, source._state)
    })

    for (const property of [false, true]) {
        it(`retains pending external ${property ? "property" : "call"} results before later source work`, async () => {
            const ctx = context(), child = { k: 1 }, source = new runtime.Chain(child, ctx)
            const pending = Promise.withResolvers()
            const host = new runtime.Chain(runtime.externalState({ result: pending.promise, get() { return pending.promise } }), ctx)
            const result = property ? runtime.lookupPath(host, ["result"], ctx) : runtime.run(host, [], "get", [], ctx, {})
            const retained = new runtime.Chain(result, ctx)
            const later = pending.promise.then(() => runtime.assignPath(source, ["k"], 2, ctx))
            pending.resolve(child)
            assert.deepEqual(await runtime.export(retained, [], ctx), { k: 1 })
            await later
            assert.deepEqual(runtime.export(source, [], ctx), { k: 2 })
            verifyRefCounts(ctx, retained._state, source._state)
        })
    }
})
