import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable, ready, rejected } from "./ordered-thenable.js"

const context = () => ({ execution: new r.Execution(), errorContext: "Array iteration" })
const payload = (step, ctx) => r.lookupPath(step.value, [], ctx)

describe("captured Array iteration", () => {
    it("keeps both cursors' group coordinates valid after a rejected splice count", async () => {
        for (const order of ["first", "second", "together"]) {
            const ctx = context(), chain = new r.Chain(["s0", "s1"], ctx)
            const start = Promise.withResolvers(), count = Promise.withResolvers()
            const cause = r.validationError("count", ctx, r.ERROR_KIND.OperationInputFailed)
            const splice = r.run(chain, [], "splice", [start.promise, count.promise, "new"], ctx, { mutationScopeDepth: 0 })
            const a = r.iterate(chain, [], ctx), b = r.iterate(chain, [], ctx)
            const first = a.next()
            start.resolve(1)
            count.reject(cause)
            async function drain(cursor, step) {
                const positions = []
                for (let i = 0; i < 2; i++) {
                    const item = await (step ?? cursor.next())
                    step = undefined
                    positions[await item.index] = await payload(item, ctx)
                }
                assert.deepEqual(positions, ["s0", "new"])
                await assert.rejects(cursor.next(), error => error === cause)
            }
            if (order === "together") await Promise.all([drain(a, first), drain(b)])
            else if (order === "first") { await drain(a, first); await drain(b) }
            else { await drain(b); await drain(a, first) }
            assert.equal(await splice, cause)
            assert.equal(ctx.execution.fatalError, null)
        }
    })

    it("closes a bounded pull after the finalized prefix covers every surviving occurrence", async () => {
        for (const remaining of [0, 1]) {
            const ctx = context(), start = Promise.withResolvers(), chain = new r.Chain(["old"], ctx)
            const splice = r.run(chain, [], "splice", [start.promise, 1, "new"], ctx, { mutationScopeDepth: 0 })
            const cursor = r.iterate(chain, [], ctx, { windowEnd: 2 })
            const item = await cursor.next(), next = cursor.next()
            assert.equal(await payload(item, ctx), "new")
            start.resolve(remaining)
            assert.equal(await item.index, remaining)
            if (remaining) assert.equal(await payload(await next, ctx), "old")
            cursor.setWindow(remaining + 1, remaining + 3)
            assert((await (remaining ? cursor.next() : next)).done)
            await splice
        }
    })

    it("repairs displacement of a structural Error back to its original cause", async () => {
        for (const deferred of [false, true]) {
            const ctx = context(), chain = new r.Chain([], ctx, r.CHAIN_MODE.Sequential)
            const failure = label => r.validationError(label, ctx, r.ERROR_KIND.OperationInputFailed)
            const original = failure("missing"), position = failure("start"), start = Promise.withResolvers()
            r.appendMissingOutput(chain, original, ctx)
            const splice = r.run(chain, [], "splice", [deferred ? start.promise : position, 0, "X"], ctx,
                { mutationScopeDepth: 0 })
            const cursor = r.iterate(chain, [], ctx), item = cursor.next()
            start.resolve(position)
            assert.equal(await splice, position)
            await assert.rejects(item, error => error === position)
            await r.repairPath(chain, [1], ctx)
            assert.equal(await r.lookupPath(chain, [0], ctx), position)
            assert.equal(await r.getErrors(chain, [], ctx), position)
            await r.repairPath(chain, [0], ctx)
            assert.equal(await r.lookupPath(chain, [0], ctx), original)
            assert.equal(await r.lookupPath(chain, [1], ctx), "X")
        }
    })

    it("credits a certainly skipped copy before its selector identifies the cause", async () => {
        for (const flagged of [false, true]) for (const outcome of [0, 1, "reject"]) {
            const ctx = context(), hold = new OrderedThenable(), mutate = { mutationScopeDepth: 0 }
            const error = message => r.validationError(message, ctx, r.ERROR_KIND.OperationInputFailed)
            const e = error("first"), f = error("second"), p = error("selector")
            const source = new r.Chain(flagged ? ["A"] : [], ctx), target = new r.Chain([], ctx)
            if (flagged) r.poisonPath(source, [0], e, ctx)
            else r.appendMissingOutput(source, e, ctx)
            r.appendMissingOutput(source, f, ctx)
            r.run(source, [], "push", ["B"], ctx, mutate)
            const copy = r.run(source, [], "copyWithin", [0, hold, 2], ctx, mutate)
            const credits = []
            let end = 1
            const cursor = r.iterate(source, [], ctx, { windowEnd: end, onSkip(first, last, cause, count, markers) {
                credits.push([first, last])
                r.appendMissingOutput(target, cause, ctx, markers)
                cursor.setWindow(0, end += count)
            } })
            let delivered
            const pull = cursor.next().then(step => { delivered = step })
            await new Promise(resolve => setImmediate(resolve))
            assert.deepEqual(credits.flatMap(([first, last]) => Array.from({ length: last - first }, (_, i) => first + i)), [0, 1])
            assert.equal(delivered.index, 2)
            assert.equal(payload(delivered, ctx), "B")
            assert.equal(r.run(target, [], "push", ["B"], ctx, mutate), 3)
            const first = r.lookupPath(target, [0], ctx)
            let terminal
            const reported = cursor.next().catch(cause => { terminal = cause })
            await new Promise(resolve => setImmediate(resolve))
            assert.equal(terminal, undefined)
            assert(r.isPending(first, ctx))
            if (outcome === "reject") hold.reject(p)
            else hold.resolve(outcome)
            await Promise.all([pull, copy, reported])
            const selected = outcome === "reject" ? p : outcome === 1 ? f : e
            assert.deepEqual(new Set(terminal.errors ?? [terminal]), new Set([selected, f]))
            assert.equal(await first, selected)
            assert.equal(await r.lookupPath(target, [1], ctx), f)
            await r.repairPath(source, [0], ctx)
            assert.equal(await r.lookupPath(source, [0], ctx), flagged && outcome === 0 ? "A" : selected)
            await r.repairPath(target, [0], ctx)
            assert.equal(await r.lookupPath(target, [0], ctx), selected)
        }
    })

    it("credits a shared failed copy range in bounded work and preserves positional causes", async () => {
        const tick = () => new Promise(resolve => setImmediate(resolve))
        for (const delivery of ["ready", "synchronous", "deferred"]) for (const failed of [false, true]) {
            const ctx = context(), mutation = { mutationScopeDepth: 0 }, hold = new OrderedThenable()
            const error = name => r.validationError(name, ctx, r.ERROR_KIND.OperationInputFailed)
            const e = error("even"), f = error("odd"), failure = error("copy")
            let source = new r.Chain([], ctx)
            const output = new r.Chain([], ctx), complete = new r.Chain([], ctx, r.CHAIN_MODE.Complete)
            r.appendMissingOutput(source, e, ctx)
            r.appendMissingOutput(source, f, ctx)
            for (let i = 0; i < 20; i++) {
                const previous = r.lookupPath(source, [], ctx)
                source = new r.Chain(r.run(source, [], "concat", [previous], ctx, {}), ctx)
            }
            const width = 2 ** 21
            r.run(source, [], "push", ["B"], ctx, mutation)
            const selector = delivery === "deferred" ? hold : delivery === "synchronous" ?
                failed ? rejected(failure) : ready(1) : failed ? failure : 1
            const copy = r.run(source, [], "copyWithin", [0, selector, width], ctx, mutation)
            let end = 1, batches = 0
            const cursor = r.iterate(source, [], ctx, { windowEnd: end, onSkip(first, stop, cause, count, markers) {
                assert(++batches <= 8, "expanded a compressed skip into individual callbacks")
                assert.equal(first, end - 1)
                assert.equal(stop, first + count)
                r.appendMissingOutput(output, cause, ctx, markers)
                r.appendMissingOutput(complete, cause, ctx, markers)
                cursor.setWindow(0, end += count)
            } })
            const item = await cursor.next()
            assert.equal(item.index, width)
            assert.equal(payload(item, ctx), "B")
            assert.equal(r.run(source, [], "includes", ["B"], ctx, {}), true)
            assert.equal(r.run(source, [], "includes", ["absent", width - 1], ctx, {}), f)
            assert.equal(r.run(output, [], "push", ["B"], ctx, mutation), width + 1)
            assert.equal(await r.hasError(output, [], ctx), true)
            assert.equal(await r.isPoisoned(complete, [], ctx), true)
            await r.repairPath(output, [0], ctx)
            const first = r.lookupPath(output, [0], ctx), gate = r.lookupPath(complete, [], ctx)
            let reversedOutput, reversedReport
            if (delivery === "deferred") {
                const reversed = new r.Chain(r.run(source, [], "toReversed", [], ctx, {}), ctx)
                reversedOutput = new r.Chain([], ctx)
                let groups = 0
                const backward = r.iterate(reversed, [], ctx, { onSkip(_i, _j, cause, _count, markers) {
                    assert(++groups <= 8, "reversal expanded a compressed skip")
                    r.appendMissingOutput(reversedOutput, cause, ctx, markers)
                } })
                assert.equal(payload(await backward.next(), ctx), "B")
                reversedReport = backward.next().catch(cause => cause)
                assert.equal(r.lookupPath(reversedOutput, ["length"], ctx), width)
            }
            let terminal
            const report = cursor.next().catch(error => { terminal = error })
            if (delivery === "deferred") {
                await tick()
                assert.equal(terminal, undefined)
                assert(r.isPending(first, ctx))
                if (failed) hold.reject(failure)
                else hold.resolve(1)
            }
            await Promise.all([report, copy])
            const leading = failed ? failure : f
            assert.equal(await first, leading)
            assert.equal(await gate, leading)
            assert.equal(r.lookupPath(output, [1], ctx), failed ? failure : e)
            assert.equal(r.lookupPath(output, [width - 1], ctx), f)
            if (reversedOutput) {
                assert.equal(r.lookupPath(reversedOutput, [0], ctx), f)
                assert.equal(r.lookupPath(reversedOutput, [width - 1], ctx), leading)
                const reverseFailure = await reversedReport
                assert.deepEqual(new Set(reverseFailure.errors ?? [reverseFailure]), new Set(terminal.errors ?? [terminal]))
            }
            assert.deepEqual(new Set(terminal.errors ?? [terminal]), new Set(failed ? [failure, f] : [e, f]))
            await r.repairPath(complete, [], ctx)
            assert.equal(r.lookupPath(complete, ["length"], ctx), 0)
        }
    })

    it("releases an earlier failure query and a captured marker prefix as copy bounds narrow", async () => {
        for (const issueCursorFirst of [true, false]) {
            const ctx = context(), target = new OrderedThenable(), start = new OrderedThenable()
            const source = new r.Chain([], ctx), output = new r.Chain([], ctx), mutation = { mutationScopeDepth: 0 }
            const e = r.validationError("E", ctx, r.ERROR_KIND.OperationInputFailed)
            const f = r.validationError("F", ctx, r.ERROR_KIND.OperationInputFailed)
            r.appendMissingOutput(source, e, ctx)
            r.appendMissingOutput(source, f, ctx)
            r.run(source, [], "push", ["C", "D"], ctx, mutation)
            const copy = r.run(source, [], "copyWithin", [target, start, 4], ctx, mutation)
            let seen, cursor, pull, end = 1
            Promise.resolve(r.hasError(source, [], ctx)).then(result => { seen = result })
            const open = () => {
                cursor = r.iterate(source, [], ctx, { windowEnd: end, onSkip(_i, _j, cause, count, markers) {
                    r.appendMissingOutput(output, cause, ctx, markers)
                    cursor.setWindow(0, end += count)
                } })
                pull = cursor.next()
            }
            if (issueCursorFirst) open()
            target.resolve(2)
            await new Promise(resolve => setImmediate(resolve))
            assert.equal(seen, true)
            if (!issueCursorFirst) open()
            assert.equal(r.lookupPath(output, ["length"], ctx), 2)
            assert.deepEqual(new Set((await r.getErrors(output, [], ctx)).errors), new Set([e, f]))
            await cursor.return()
            start.resolve(2)
            await copy
            assert.equal(payload(await pull, ctx), "C")
        }
    })

    it("finds a retained copy failure away from the first slot before any point lookup", async () => {
        const mutation = { mutationScopeDepth: 0 }
        for (const control of ["target", "start", "end"]) for (const alwaysFailed of [false, true]) {
            const ctx = context(), gate = new OrderedThenable(), source = new r.Chain(["A"], ctx)
            const cause = r.validationError("retained slot", ctx, r.ERROR_KIND.OperationInputFailed)
            r.appendMissingOutput(source, cause, ctx)
            if (alwaysFailed) r.appendMissingOutput(source, r.validationError("second slot", ctx, r.ERROR_KIND.OperationInputFailed), ctx)
            r.run(source, [], "push", ["Z"], ctx, mutation)
            const args = control === "target" ? [gate, alwaysFailed ? 1 : 0, alwaysFailed ? 3 : 1] :
                control === "start" ? [1, gate, 3] : [1, 0, gate]
            const copy = r.run(source, [], "copyWithin", args, ctx, mutation)
            const query = r.hasError(source, [], ctx)
            if (alwaysFailed) assert.equal(query, true)
            else assert(r.isPending(query, ctx))
            gate.resolve(control === "start" ? 2 : 1)
            await copy
            assert.equal(await query, alwaysFailed)
        }

        // Fresh Error payloads run bodies, but also prove a deep failure when
        // both possible sources for the middle slot are failed.
        {
            const ctx = context(), gate = new OrderedThenable()
            const error = name => r.validationError(name, ctx, r.ERROR_KIND.OperationInputFailed)
            const e = error("E"), f = error("F"), source = new r.Chain(["A", e, f, "Z"], ctx)
            const copy = r.run(source, [], "copyWithin", [1, 0, gate], ctx, mutation)
            assert.equal(r.hasError(source, [], ctx), true)
            gate.resolve(1)
            await copy
            assert.equal(r.getErrors(source, [], ctx), f)
        }

        // The only copy reaching the last slot selects that same slot. Its
        // nested Error is visible even when its placement runs a normal body.
        const ctx = context(), gate = new OrderedThenable()
        const cause = r.validationError("nested", ctx, r.ERROR_KIND.OperationInputFailed)
        const source = new r.Chain(["A", "B", { nested: cause }], ctx)
        const copy = r.run(source, [], "copyWithin", [0, gate, 3], ctx, mutation)
        assert.equal(r.hasError(source, [], ctx), true)
        gate.resolve(0)
        await copy
        assert.equal(await r.getErrors(source, [], ctx), cause)
    })

    it("reopens the bounded window only when every remaining copy choice obstructs the body", async () => {
        for (const role of ["marker", "payload", "hole"]) {
            const ctx = context(), start = new OrderedThenable(), end = new OrderedThenable()
            const cause = r.validationError("source", ctx, r.ERROR_KIND.OperationInputFailed)
            const source = new r.Chain(role === "marker" ? [] : role === "payload" ? [cause] : new Array(1), ctx)
            if (role === "marker") r.appendMissingOutput(source, cause, ctx)
            r.appendMissingOutput(source, cause, ctx)
            r.run(source, [], "push", ["B"], ctx, { mutationScopeDepth: 0 })
            const result = r.run(source, [], "copyWithin", [0, start, end], ctx, { mutationScopeDepth: 0 })
            let delivered, limit = 1
            const cursor = r.iterate(source, [], ctx, { windowEnd: 1, onSkip(_first, _last, _cause, count) {
                cursor.setWindow(0, limit += count)
            } })
            const pull = cursor.next().then(step => { delivered = step })
            let obstructed, replaced, old
            if (role === "marker") {
                old = r.lookupPath(source, [0], ctx)
                Promise.resolve(r.isPoisoned(source, [0], ctx)).then(value => { obstructed = value })
                r.assignPath(source, [0, "x"], 9, ctx)
                r.assignPath(source, [0], "replacement", ctx)
                Promise.resolve(r.lookupPath(source, [0], ctx)).then(value => { replaced = value })
            }
            end.resolve(2)
            await new Promise(resolve => setImmediate(resolve))
            if (role === "marker") {
                assert.equal(limit, 3)
                assert.equal(payload(delivered, ctx), "B")
                assert.equal(obstructed, true)
                assert.equal(replaced, "replacement")
                assert((await cursor.return()).done)
            } else {
                assert.equal(limit, 1)
                assert.equal(delivered, undefined)
            }
            start.resolve(0)
            await Promise.all([pull, result])
            if (role === "marker") {
                assert.equal(await old, cause)
                assert.equal(r.lookupPath(source, [0], ctx), "replacement")
            } else {
                assert.equal(delivered.index, 0)
                assert.equal(payload(delivered, ctx), role === "payload" ? cause : undefined)
            }
            await cursor.return()
        }
    })

    for (const bounded of [false, true]) it(`reports a host slot failure on an unordered pull, bounded=${bounded}`, async () => {
        const ctx = context(), thrown = new Error("slot"), tail = Promise.withResolvers()
        let armed = false
        const storage = new Proxy(["a", "b"], { getOwnPropertyDescriptor(target, key) {
            if (armed && key === "1") throw thrown
            return Reflect.getOwnPropertyDescriptor(target, key)
        } })
        const source = new r.Chain(r.run(new r.Chain(storage, ctx), [], "concat", [tail.promise], ctx, {}), ctx)
        armed = true
        const cursor = r.iterate(source, [], ctx, bounded ? { windowEnd: 1 } : {})
        assert.equal(payload(await cursor.next(), ctx), "a")
        const second = cursor.next()
        if (bounded) cursor.setWindow(0, 2)
        await assert.rejects(second, error => error.kind === r.ERROR_KIND.LookupReflectionFailed && error.cause === thrown)
        assert.equal(ctx.execution.fatalError, null)
        assert((await cursor.next()).done)
        tail.resolve([])
    })

    for (const mode of Object.values(r.CHAIN_MODE)) it(`validates the target of a missing Array contribution in mode ${mode}`, async () => {
        const ctx = context(), target = Promise.withResolvers(), chain = new r.Chain(target.promise, ctx, mode)
        const missing = r.validationError("missing", ctx, r.ERROR_KIND.OperationInputFailed)
        const result = r.appendMissingOutput(chain, missing, ctx)
        target.resolve({ keep: 3 })
        const failure = await result
        assert.equal(failure.kind, r.ERROR_KIND.InvalidArrayOperation)
        assert.equal(await r.lookupPath(chain, [], ctx), failure)
        await r.repairPath(chain, [], ctx)
        assert.deepEqual(await r.export(chain, [], ctx), { keep: 3 })
    })

    it("keeps a moved slot's own failure when the cursor consumes it after publication", async () => {
        for (const failureFirst of [false, true]) {
            const ctx = context(), source = new r.Chain([10, 20], ctx)
            const write = Promise.withResolvers(), growth = Promise.withResolvers()
            const failed = r.enter(source, [1], ctx, true, ref => write.promise.then(() => r.assignPath(ref, ["x"], 7, ctx)))
            const entry = r.enter(source, [3], ctx, true, () => growth.promise)
            const copy = new r.Chain(r.run(source, [], "unshift", [5], ctx, {}), ctx)
            const cursor = r.iterate(copy, [], ctx)
            if (failureFirst) { write.resolve(); await failed; growth.resolve() }
            else { growth.resolve(); await entry; write.resolve() }
            await Promise.all([entry, failed])
            const cause = await r.lookupPath(copy, [2], ctx), items = []
            assert.equal(cause.kind, r.ERROR_KIND.ScalarLookup)
            await assert.rejects(async () => {
                for (;;) {
                    const step = await cursor.next()
                    if (step.done) break
                    items[await step.index] = await payload(step, ctx)
                }
            }, error => error === cause)
            assert.deepEqual(items, [5, 10])
            r.repairPath(copy, [2], ctx)
            assert.equal(await r.lookupPath(copy, [2], ctx), 20)
        }
    })

    it("applies a new position flag to the selected predecessor and preserves its data for repair", async () => {
        for (const priorFailure of [false, true]) for (const delayed of [false, true]) {
            const ctx = context(), hold = Promise.withResolvers(), data = Promise.withResolvers()
            const source = new r.Chain([priorFailure ? 10 : data.promise], ctx)
            const cause = r.validationError("missing", ctx, r.ERROR_KIND.OperationInputFailed)
            const write = ref => priorFailure ? r.assignPath(ref, ["x"], 7, ctx) : undefined
            const entry = r.enter(source, [0], ctx, true, ref => delayed ? hold.promise.then(() => write(ref)) : write(ref))
            const base = new r.Chain([], ctx, r.CHAIN_MODE.Sequential)
            const copy = new r.Chain(r.run(base, [], "concat", [cause, r.lookupPath(source, [], ctx)], ctx, {}), ctx)
            const cursor = r.iterate(copy, [], ctx), pull = cursor.next()
            const skipped = assert.rejects(pull, error => error === cause || error.errors.includes(cause))
            const reported = r.getErrors(copy, [1], ctx)
            hold.resolve()
            const flagged = await r.lookupPath(copy, [1], ctx)
            if (priorFailure) assert.deepEqual(new Set(flagged.errors), new Set([cause, await r.lookupPath(source, [0], ctx)]))
            else assert.equal(flagged, cause)
            assert.equal(await reported, flagged)
            await skipped
            r.repairPath(copy, [1], ctx)
            const value = r.lookupPath(copy, [1], ctx)
            if (!priorFailure) assert(r.isPending(value, ctx))
            data.resolve(20)
            await entry
            assert.equal(await value, priorFailure ? 10 : 20)
        }
    })

    it("protects a captured Array between source publication and destination delivery", async () => {
        const ctx = context(), source = new r.Chain({ a: [] }, ctx)
        r.assignPath(source, ["a", 0], 2, ctx)
        const held = new OrderedThenable(), key = new OrderedThenable()
        const entry = r.enter(source, ["a"], ctx, true, () => held)
        const saved = r.capturePath(source, [key], ctx)
        key.resolve("a")
        await new Promise(setImmediate)
        held.resolve()
        await Promise.resolve()
        r.assignPath(source, ["a", 5], 44, ctx)
        await entry
        assert.equal(await r.lookupPath(source, ["a", "length"], ctx), 6)
        assert.deepEqual(await r.export(saved, [], ctx), [2])
    })

    for (const mode of Object.values(r.CHAIN_MODE)) for (const timing of ["ready", "sync", "deferred"])
        it(`orders a failing sort, a body effect and a sibling write through repair in ${mode}/${timing}`, async () => {
            const ctx = context(), calls = []
            const host = new r.ContextChain({ db: r.externalState({ write(n) { calls.push(n) } }) }, ctx, { db: {} })
            const items = [2, 1, undefined, ,]
            const source = new r.Chain({ items, tag: 0 }, ctx, mode)
            const earlier = r.iterate(source, ["items"], ctx), control = Promise.withResolvers()
            const cmp = timing === "ready" ? 7 : timing === "sync" ? ready(7) : control.promise
            const sorted = r.run(source, ["items"], "sort", [cmp], ctx, { mutationScopeDepth: 0 })
            const cursor = r.iterate(source, ["items"], ctx)
            const suffix = [2, 3].map(index => r.lookupPath(source, ["items", index], ctx))
            if (timing === "deferred") for (const slot of suffix) assert(r.isPending(slot, ctx))
            const body = cursor.next().then(step => r.run(host, ["db"], "write", [payload(step, ctx)], ctx, { mutationScopeDepth: 1 }))
            r.assignPath(source, ["tag"], 9, ctx)
            const repaired = r.repairPath(source, [], ctx)
            assert.equal(payload(await earlier.next(), ctx), 2)
            await earlier.return()
            control.resolve(7)
            const failure = await sorted
            await assert.rejects(body, error => error === failure)
            for (const slot of suffix) assert.equal(await slot, failure)
            await repaired
            assert.deepEqual(calls, [])
            assert.equal(r.lookupPath(source, ["tag"], ctx), mode === r.CHAIN_MODE.Complete ? 0 : 9)
            if (mode !== r.CHAIN_MODE.Complete) {
                assert.equal(r.lookupPath(source, ["items"], ctx), failure)
                r.repairPath(source, ["items"], ctx)
            }
            assert.deepEqual(r.export(source, ["items"], ctx), items)
        })
    it("densifies a captured slot even when its entry later publishes a hole", async () => {
        const ctx = context(), mode = r.CHAIN_MODE.Unordered, hold = Promise.withResolvers()
        const source = new r.Chain(r.run(new r.Chain([, "Z"], ctx, mode), [], "concat", [], ctx, {}), ctx, mode)
        const entry = r.enter(source, [0], ctx, true, () => hold.promise)
        const result = new r.Chain(r.run(source, [], "toReversed", [], ctx, {}), ctx, mode)
        assert.equal(r.lookupPath(result, [0], ctx), "Z")
        hold.resolve()
        await entry
        const copy = await r.export(result, [], ctx)
        assert.deepEqual(copy, ["Z", undefined])
    })
    for (const deferred of [false, true])
        it(`transfers reached status and its retained data across modes (deferred=${deferred})`, async () => {
            const ctx = context(), hold = Promise.withResolvers()
            const chain = new r.Chain({ a: [2, 1] }, ctx, r.CHAIN_MODE.Complete)
            const sorted = r.run(chain, ["a"], "sort", [deferred ? hold.promise : 42], ctx, { mutationScopeDepth: 1 })
            const received = r.capturePath(chain, ["a"], ctx, r.CHAIN_MODE.Unordered)
            const descendant = r.capturePath(chain, ["a", 0], ctx)
            const before = r.lookupPath(received, [], ctx)
            if (deferred) {
                assert(r.isPending(before, ctx))
                r.assignPath(chain, ["a"], [], ctx)
                hold.resolve(42)
            }
            const failure = await sorted
            assert.equal(await before, failure)
            r.repairPath(received, [], ctx)
            assert.deepEqual(await r.export(received, [], ctx), [2, 1])
            r.repairPath(descendant, [], ctx)
            assert.equal(await r.lookupPath(descendant, [], ctx), failure)
            if (deferred) assert.deepEqual(await r.export(chain, ["a"], ctx), [])
            else assert.equal(r.lookupPath(chain, ["a"], ctx), failure)
        })
    for (const mode of Object.values(r.CHAIN_MODE))
        it(`preserves presence independently of a hole's status in mode ${mode}`, async () => {
            const ctx = context(), source = new r.Chain(new Array(1), ctx, mode)
            const cause = r.validationError("position", ctx, r.ERROR_KIND.OperationInputFailed)
            r.poisonPath(source, [0], cause, ctx)
            const call = (method, args = []) => r.run(source, [], method, args, ctx, {})
            assert.equal(call("indexOf", [undefined]), -1)
            assert.equal(call("includes", [undefined]), cause)
            assert.equal(call("at", [0]), cause)
            assert.deepEqual(r.export(new r.Chain(call("flat", [0]), ctx), [], ctx), [])
            for (const [method, present] of [["slice", false], ["toReversed", true]]) {
                const copy = new r.Chain(call(method), ctx, mode)
                assert.equal(r.lookupPath(copy, [0], ctx), cause)
                r.repairPath(copy, [0], ctx)
                assert.equal(Object.hasOwn(r.export(copy, [], ctx), "0"), present)
            }
        })
    for (const delivery of ["ready", "synchronous", "deferred", "repeated"])
    it(`publishes skipped positions in order across output modes: ${delivery}`, async () => {
        const ctx = context(), wrap = value => new r.Chain(value, ctx)
        const source = wrap(["left", "right"]), empty = wrap([]), signal = Promise.withResolvers()
        const [left, right] = ["left", "right"].map(name => r.validationError(name, ctx, r.ERROR_KIND.OperationInputFailed))
        r.poisonPath(source, [0], left, ctx)
        r.poisonPath(source, [1], right, ctx)
        const reversed = wrap(r.run(source, [], "reverse", [], ctx, {})), value = r.lookupPath(reversed, [], ctx)
        const part = delivery === "ready" ? value : delivery === "synchronous" ? ready(value) : signal.promise
        let copy = wrap(r.run(empty, [], "concat", [part], ctx, {})), length = 2
        if (delivery === "repeated") {
            signal.resolve(value)
            await r.lookupPath(copy, ["length"], ctx)
            while (length < 1024) {
                copy = wrap(r.run(copy, [], "concat", [r.lookupPath(copy, [], ctx)], ctx, {}))
                length *= 2
            }
        }
        const output = wrap([]), complete = new r.Chain(["baseline"], ctx, r.CHAIN_MODE.Complete)
        const credits = []
        const cursor = r.iterate(copy, [], ctx, { windowEnd: 1, onSkip(first, end, cause, count, markers) {
            credits.push(count)
            r.appendMissingOutput(output, cause, ctx, markers)
            assert.equal(r.appendMissingOutput(complete, cause, ctx, markers), right)
            cursor.setWindow(end, end + 1)
        } })
        const terminal = assert.rejects(cursor.next(), cause => {
            assert.deepEqual(new Set(cause.errors), new Set([left, right]))
            return true
        })
        signal.resolve(value)
        await terminal
        assert.equal(credits.reduce((sum, n) => sum + n, 0), length)
        if (length > 2) assert(credits.length <= 16, `Expanded one repeated range into ${credits.length} callbacks`)
        assert.equal(r.lookupPath(output, ["length"], ctx), length)
        for (const index of new Set([0, 1, length - 2, length - 1])) {
            r.repairPath(copy, [index], ctx)
            r.repairPath(output, [index], ctx)
            assert.equal(r.lookupPath(copy, [index], ctx), index % 2 ? "left" : "right")
            assert.equal(r.lookupPath(output, [index], ctx), index % 2 ? left : right)
        }
        assert.equal(r.lookupPath(complete, [], ctx), right)
        r.assignPath(complete, [0], "blocked", ctx)
        r.repairPath(complete, [], ctx)
        assert.deepEqual(r.export(complete, [], ctx), ["baseline"])
    })
    it("keeps a skipped slot's visible cause after output repair while an earlier width is open", async () => {
        const ctx = context(), wrap = value => new r.Chain(value, ctx)
        const [old, next, flag] = ["old", "next", "flag"].map(name => r.validationError(name, ctx, r.ERROR_KIND.OperationInputFailed))
        const source = wrap([]), prefix = wrap([]), output = wrap([])
        r.appendMissingOutput(source, old, ctx)
        r.appendMissingOutput(source, next, ctx)
        r.poisonPath(source, [0], flag, ctx)
        const hold = Promise.withResolvers()
        const entry = r.enter(prefix, [], ctx, { maximumCount: 1, mayPoisonScope: false }, () => hold.promise)
        const joined = wrap(r.run(prefix, [], "concat", [r.lookupPath(source, [], ctx)], ctx, {}))
        const cursor = r.iterate(joined, [], ctx, { onSkip(first, end, cause, count, markers) {
            r.appendMissingOutput(output, cause, ctx, markers)
        } })
        const exhausted = assert.rejects(cursor.next(), error => {
            assert.deepEqual(new Set(error.errors), new Set([flag, next]))
            return true
        })
        assert.equal(r.lookupPath(output, ["length"], ctx), 2)
        r.repairPath(source, [0], ctx)
        r.repairPath(output, [0], ctx)
        assert.equal(r.lookupPath(source, [0], ctx), old)
        assert.equal(r.lookupPath(output, [0], ctx), flag)
        assert.equal(r.lookupPath(output, [1], ctx), next)
        hold.resolve()
        await entry
        await exhausted
    })
    for (const [delivery, input] of Object.entries({ direct: value => value, synchronous: ready, deferred: value => Promise.resolve(value) })) {
        it(`owns unread items across root, index and nested writes (${delivery})`, async () => {
            const ctx = context(), pending = Promise.withResolvers()
            const shared = { n: 1 }
            const source = new r.Chain(input([pending.promise, shared, , shared]), ctx)
            const cursor = r.iterate(source, [], ctx)
            assert.equal(cursor[Symbol.asyncIterator](), cursor)
            const first = await cursor.next().then(step => step.value)
            r.assignPath(source, [1, "n"], 8, ctx)
            r.assignPath(source, [], [], ctx)
            const rest = []
            for await (const item of cursor) rest.push(item)
            assert.equal(rest.length, 3)
            assert.deepEqual(r.export(rest[0], [], ctx), { n: 1 })
            assert.equal(r.lookupPath(rest[1], [], ctx), undefined)
            r.assignPath(rest[0], ["n"], 7, ctx)
            assert.deepEqual(r.export(rest[2], [], ctx), { n: 1 })
            pending.reject(new Error("payload"))
            assert(r.isPoisonError(await r.lookupPath(first, [], ctx)))
            assert((await cursor.return()).done)
        })
    }

    for (const reject of [false, true]) it(`preserves an issued pull after close: reject=${reject}`, async () => {
        const ctx = context(), pending = Promise.withResolvers()
        const cause = r.validationError("source", ctx, r.ERROR_KIND.OperationInputFailed)
        const source = new r.Chain(pending.promise, ctx)
        const cursor = r.iterate(source, [], ctx), issued = cursor.next()
        await cursor.return().then(step => assert(step.done))
        assert((await cursor.next()).done)
        if (reject) {
            pending.reject(cause)
            await assert.rejects(issued, error => error === cause)
        } else {
            pending.resolve([2])
            assert.equal(payload(await issued, ctx), 2)
        }
    })

    it("closes an unused pending selection before its path is consumed", async () => {
        const ctx = context(), source = Promise.withResolvers()
        const cursor = r.iterate(new r.Chain(source.promise, ctx), ["a"], ctx)
        assert((await cursor.return()).done)
        source.resolve({ a: [1] })
        await new Promise(resolve => setImmediate(resolve))
        assert((await cursor.next()).done)
        assert.equal(ctx.execution.fatalError, null)
    })

    it("rejects a pending pull and subsequent iterator calls with the execution fatal", async () => {
        const ctx = context()
        const cursor = r.iterate(new r.Chain(new Promise(() => {}), ctx), [], ctx)
        const pending = cursor.next()
        assert.throws(() => r.failExecution(ctx, new Error("fatal")), r.isFatalError)
        for (const step of [pending, cursor.return(), cursor.next()])
            await assert.rejects(step, error => error === ctx.execution.fatalError)
    })

    it("reads a sparse ArrayView through the same captured placements", async () => {
        const ctx = context(), source = new r.Chain([], ctx)
        r.run(source, [], "push", ["a", "b", "c"], ctx, { mutationScopeDepth: 0 })
        const slice = new r.Chain(r.run(source, [], "slice", [1], ctx, {}), ctx)
        r.deletePath(slice, [0], ctx)
        const cursor = r.iterate(slice, [], ctx)
        r.assignPath(slice, [1], "later", ctx)
        assert.equal(payload(await cursor.next(), ctx), undefined)
        assert.equal(payload(await cursor.next(), ctx), "c")
        assert((await cursor.next()).done)
    })

    it("separates a failed whole-Array version from an earlier captured view", async () => {
        const ctx = context(), pending = Promise.withResolvers()
        const source = new r.Chain({ items: [2, 1], tag: 0 }, ctx, r.CHAIN_MODE.Complete)
        const earlier = r.iterate(source, ["items"], ctx)
        const effect = r.run(source, ["items"], "splice", [0, pending.promise], ctx, { mutationScopeDepth: 0 })
        const after = r.iterate(source, ["items"], ctx)
        const request = after.next()
        r.assignPath(source, ["tag"], 8, ctx)
        const repair = r.repairPath(source, [], ctx)
        assert.equal(payload(await earlier.next(), ctx), 2)
        pending.reject(new Error("count"))
        const failure = await effect
        await assert.rejects(request, error => error === failure)
        assert((await after.next()).done)
        await repair
        assert.equal(r.lookupPath(source, ["tag"], ctx), 0)
        assert.equal(payload(await earlier.next(), ctx), 1)
    })

    for (const pending of [false, true]) for (const timing of ["before pull", "after pull", "after settlement"])
    it(`transfers inert external data with registration ${timing}, pending=${pending}`, async () => {
        const ctx = context(), resource = r.externalState({}), input = Promise.withResolvers()
        const source = new r.Chain([pending ? input.promise : resource], ctx)
        const cursor = r.iterate(source, [], ctx)
        const register = () => new r.ContextChain({ resource }, ctx, { resource: {} })
        if (timing === "before pull") register()
        const item = await cursor.next()
        if (timing === "after pull") register()
        input.resolve(resource)
        await new Promise(setImmediate)
        if (timing === "after settlement") register()
        assert.equal(item.done, false)
        assert.equal(await r.hasError(item.value, [], ctx), false)
        const captured = r.capturePath(item.value, [], ctx)
        assert.equal((await payload(item, ctx)).kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal((await r.lookupPath(captured, [], ctx)).kind, r.ERROR_KIND.ExternalLocationConflict)
    })

    it("rejects structural or source failure, and delivers stored poison as an item", async () => {
        const ctx = context(), failure = r.validationError("input", ctx, r.ERROR_KIND.OperationInputFailed)
        for (const value of [failure, 4]) {
            const cursor = r.iterate(new r.Chain(value, ctx), [], ctx)
            await assert.rejects(cursor.next(), error => value === failure ? error === failure : error.kind === r.ERROR_KIND.NotIterable)
            assert((await cursor.next()).done)
        }
        const source = new r.Chain([failure, {}], ctx)
        const status = r.run(source, [1], "missing", [], ctx, { mutationScopeDepth: 1 })
        const cursor = r.iterate(source, [], ctx)
        assert.equal(payload(await cursor.next(), ctx), failure)
        await assert.rejects(cursor.next(), error => error === status)
        assert((await cursor.next()).done)
    })
})
