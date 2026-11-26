import assert from "node:assert/strict"
import { createHook } from "node:async_hooks"
import { spawnSync } from "node:child_process"
import * as r from "../src/index.js"
import { ready } from "./ordered-thenable.js"

const mutation = { mutationScopeDepth: 0 }
const MAX = 0xffffffff
const turn = () => new Promise(setImmediate)
const context = errorContext => ({ execution: new r.Execution(), errorContext })
const modes = Object.values(r.CHAIN_MODE)
const streams = [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]
const diagnostic = (ctx, label) => r.validationError(label, ctx, r.ERROR_KIND.OperationInputFailed)

describe("Array failures across capture, conversion and repair", () => {
    it("checks the distinct-leaf limit without allocating a native-sized diagnostic list", () => {
        const root = new URL("../src/", import.meta.url).href
        const program = `
            import assert from "node:assert/strict"
            import { registerHooks } from "node:module"
            const root = ${JSON.stringify(root)}
            registerHooks({ load(url, context, next) {
                const loaded = next(url, context)
                if (url !== root + "error.js") return loaded
                const source = String(loaded.source), limit = "const MAX_DIAGNOSTIC_LEAVES = 0xffffffff"
                assert(source.includes(limit))
                return { ...loaded, source: source.replace(limit, "const MAX_DIAGNOSTIC_LEAVES = 2") }
            } })
            const r = await import(root + "index.js")
            const ctx = { execution: new r.Execution(), errorContext: "collection" }
            const [a, b, c] = ["a", "b", "c"].map(x => r.validationError(x, ctx, r.ERROR_KIND.OperationInputFailed))
            const pair = r.combineErrors([a, b])
            assert.equal(r.combineErrors([pair, a, pair, b]), pair)
            const overflow = r.combineErrors((function* () { yield a; yield b; yield c; assert.fail("expanded the suffix") })())
            assert.equal(overflow.kind, r.ERROR_KIND.InvalidArrayLength)
            assert.equal(overflow.errors, undefined)
            for (const order of [[a, b, c], [c, b, a]]) {
                const inputs = order.map(() => Promise.withResolvers()), source = new r.Chain(inputs.map(p => p.promise), ctx)
                const report = r.getErrors(source, [], ctx), output = r.export(source, [], ctx)
                for (let i = inputs.length - 1; i >= 0; i--) inputs[i].resolve(order[i])
                for (const value of await Promise.all([report, output])) {
                    assert.equal(value.kind, r.ERROR_KIND.InvalidArrayLength)
                    assert.equal(value.errorContext, ctx.errorContext)
                    assert.equal(value.errors, undefined)
                }
            }
        `
        const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", program],
            { encoding: "utf8", timeout: 10000 })
        assert.equal(child.status, 0, child.stderr + child.stdout)
    })

    for (const mode of modes) {
        it(`shares the intrinsic text-size failure and preserves a supplied RangeError in mode ${mode}`, async () => {
            const ctx = context("nested join"), huge = new Array(2 ** 30), held = Promise.withResolvers()
            const hostCause = new RangeError("Invalid string length")
            const hostError = r.createPoisonError(hostCause, ctx, r.ERROR_KIND.ScalarConversionFailed)
            const source = new r.Chain([huge, held.promise, hostError], ctx, mode)
            const result = r.run(source, [], "join", [], ctx, {})
            held.resolve(huge)
            const leaves = (await result).errors
            assert.equal(leaves.length, 2)
            assert(leaves.includes(hostError))
            assert.equal(hostError.cause, hostCause)
            const intrinsic = leaves.find(error => error !== hostError)
            assert.equal(intrinsic.kind, r.ERROR_KIND.ScalarConversionFailed)
            assert.equal(intrinsic.errorContext, ctx.errorContext)
            assert(intrinsic.cause instanceof RangeError)
            assert.notEqual(intrinsic.cause, hostCause)
        })

        it(`keeps an earlier descriptor failure when an open sort rejects its comparator in mode ${mode}`, async () => {
            for (const open of [false, true]) for (const timing of ["ready", "sync", "held"]) {
                const ctx = context("sort inspection"), wrap = x => new r.Chain(x, ctx, mode)
                const end = Promise.withResolvers(), cmp = Promise.withResolvers(), tail = wrap([])
                const entry = open && r.enter(tail, [], ctx, { maximumCount: 1, mayPoisonScope: false }, () => end.promise)
                const cause = new Error("descriptor")
                let armed = false, reads = 0
                const head = new Proxy([0, 2, 1], { getOwnPropertyDescriptor(target, key) {
                    if (armed && key === "0") { reads++; throw cause }
                    return Reflect.getOwnPropertyDescriptor(target, key)
                } })
                const source = wrap(r.run(wrap(head), [], "concat", [r.lookupPath(tail, [], ctx)], ctx, {}))
                armed = true
                const value = timing === "ready" ? 42 : timing === "sync" ? ready(42) : cmp.promise
                const sorted = r.run(source, [], "sort", [value], ctx, mutation)
                assert.equal(r.isPoisoned(source, [], ctx), true)
                cmp.resolve(42)
                const result = await sorted
                assert.equal(reads, 1)
                assert.equal(result.errors.length, 2)
                assert(result.errors.some(e => e.cause === cause && e.kind === r.ERROR_KIND.PropertyMutationFailed))
                assert(result.errors.some(e => e.kind === r.ERROR_KIND.NotAFunction))
                armed = false
                r.repairPath(source, [], ctx)
                assert.equal(r.lookupPath(source, [1], ctx), 2)
                end.resolve()
                await entry
            }
        })

        it(`preserves native callback order for a repeated sortable run in mode ${mode}`, async () => {
            const ctx = context("valid comparator"), s = Symbol(), p = Promise.withResolvers()
            const source = new r.Chain([0, 0, 0, "Z"], ctx, mode)
            r.run(source, [], "fill", [s, 0, 3], ctx, mutation)
            const actual = [], expected = []
            const comparator = log => (a, b) => {
                log.push([a, b])
                return Number(a === s) - Number(b === s)
            }
            const result = new r.Chain(r.run(source, [], "toSorted", [p.promise], ctx, {}), ctx)
            const sorted = [s, s, s, "Z"].sort(comparator(expected))
            p.resolve(comparator(actual))
            assert.deepEqual(await r.export(result, [], ctx), sorted)
            assert.deepEqual(actual, expected)
        })

        it(`delivers the sorted present item and its host effect ahead of an absent slot’s cause in mode ${mode}`, async () => {
            for (const timing of ["ready", "sync", "held"]) {
                const ctx = context("body"), hold = Promise.withResolvers(), cause = diagnostic(ctx, "hole"), writes = []
                const host = new r.ContextChain({ sink: r.externalState({ emit(value) { writes.push(value) } }) }, ctx, { sink: {} })
                const source = new r.Chain({ a: [, "A"], tag: 0 }, ctx, mode)
                r.poisonPath(source, ["a", 0], timing === "ready" ? cause : timing === "sync" ? ready(cause) : hold.promise, ctx)
                r.run(source, ["a"], "sort", [42], ctx, mutation)
                const cursor = r.iterate(source, ["a"], ctx), step = await cursor.next()
                const value = r.lookupPath(step.value, [], ctx)
                r.run(host, ["sink"], "emit", [value], ctx, { mutationScopeDepth: 1 })
                r.assignPath(source, ["tag"], 1, ctx)
                r.repairPath(source, ["a", 1], ctx)
                assert.deepEqual(writes, ["A"])
                assert.equal(r.lookupPath(source, ["tag"], ctx), 1)
                assert.deepEqual(r.export(source, ["a"], ctx), ["A", ,])
                hold.resolve(cause)
                await cursor.return()
            }
        })

        it(`publishes a failed sort prefix while a later append remains open in mode ${mode}`, async () => {
            const ctx = context("sort prefix"), held = Promise.withResolvers(), wrap = value => new r.Chain(value, ctx, mode)
            const tail = wrap([])
            let inside
            const open = r.enter(tail, [], ctx, { maximumCount: 1, mayPoisonScope: false },
                reference => { inside = reference; return held.promise })
            const source = wrap(r.run(wrap([Symbol(), 2]), [], "concat", [r.lookupPath(tail, [], ctx)], ctx, {}))
            const sorted = r.run(source, [], "sort", [], ctx, mutation)
            assert.equal(r.isPoisoned(source, [], ctx), true)
            assert.equal(r.repairPath(source, [], ctx), undefined)
            assert.equal(r.lookupPath(source, [1], ctx), 2)
            assert(r.isPending(sorted, ctx))
            const later = diagnostic(ctx, "later input")
            r.run(inside, [], "push", [later], ctx, mutation)
            held.resolve()
            await open
            const causes = (await sorted).errors
            assert.equal(causes.length, 2)
            assert(causes.includes(later))
            assert.equal(r.lookupPath(source, [2], ctx), later)
        })

        it(`can repair a certain sort failure before a required comparator arrives in mode ${mode}`, async () => {
            for (const delayedError of [false, true]) for (const extraRoot of [false, true])
            for (const valid of [false, true]) {
                const ctx = context("comparator"), cmp = Promise.withResolvers(), input = Promise.withResolvers()
                const failure = diagnostic(ctx, "input"), data = [delayedError ? input.promise : failure, 1]
                if (extraRoot) data.push(2)
                const source = new r.Chain(data, ctx, mode)
                const result = r.run(source, [], "sort", [cmp.promise], ctx, mutation)
                const status = r.isPoisoned(source, [], ctx), repair = r.repairPath(source, [], ctx)
                let failed, repaired = false
                Promise.resolve(status).then(value => { failed = value })
                Promise.resolve(repair).then(() => { repaired = true })
                input.resolve(failure)
                await turn()
                assert.equal(failed, true)
                assert.equal(repaired, true)
                assert.equal(r.lookupPath(source, [0], ctx), failure)
                cmp.resolve(valid ? () => assert.fail("comparison after failed preparation") : 42)
                if (valid) assert.equal(await result, failure)
                else assert.equal((await result).kind, r.ERROR_KIND.NotAFunction)
            }
        })

        it(`preserves hole flags through sort and skips them before flat discovery in mode ${mode}`, async () => {
            for (const method of ["sort", "toSorted", "flat"])
            for (const mutating of method === "sort" ? [false, true] : [false])
            for (const timing of ["ready", "sync", "held"]) {
                const ctx = context(method), held = Promise.withResolvers()
                const first = diagnostic(ctx, "first hole"), last = diagnostic(ctx, "last hole")
                const source = new r.Chain([, "A", ,], ctx, mode)
                r.poisonPath(source, [0], timing === "held" ? held.promise : timing === "sync" ? ready(first) : first, ctx)
                r.poisonPath(source, [2], last, ctx)
                const result = r.run(source, [], method, method === "flat" ? [Infinity] : [42], ctx, mutating ? mutation : {})
                const output = new r.Chain(result, ctx, mode)
                assert.equal(r.lookupPath(output, [0], ctx), "A")
                if (method === "flat") assert.deepEqual(r.export(output, [], ctx), ["A"])
                else {
                    assert.equal(r.lookupPath(output, [2], ctx), last)
                    const saved = r.capturePath(output, [], ctx)
                    r.repairPath(output, [1], ctx)
                    r.repairPath(output, [2], ctx)
                    const values = r.export(output, [], ctx)
                    assert.equal(values.length, 3)
                    assert.equal(1 in values, method === "toSorted")
                    assert.equal(2 in values, method === "toSorted")
                    held.resolve(first)
                    assert.equal(await r.lookupPath(saved, [1], ctx), first)
                }
                held.resolve(first)
            }
        })

        it(`shares intrinsic failures across placements and preserves independent causes in mode ${mode}`, async () => {
            for (const timing of ["ready", "sync", "held"]) {
                const ctx = context("first call"), end = Promise.withResolvers(), s = Symbol()
                const prior = diagnostic(ctx, "prior")
                const source = new r.Chain([0, 0, 0, prior], ctx, mode)
                r.run(source, [], "fill", [s, 0, timing === "held" ? end.promise : timing === "sync" ? ready(3) : 3], ctx, mutation)
                const join = r.run(source, [], "join", [], ctx, {})
                const sort = r.run(source, [], "toSorted", [], { ...ctx, errorContext: "second call" }, {})
                end.resolve(3)
                const [joined, sorted] = await Promise.all([join, sort])
                for (const [report, label] of [[joined, "first call"], [sorted, "second call"]]) {
                    assert.equal(report.errors.length, 2)
                    assert(report.errors.includes(prior))
                    const conversion = report.errors.find(error => error !== prior)
                    assert.equal(conversion.kind, r.ERROR_KIND.ScalarConversionFailed)
                    assert.equal(conversion.errorContext, label)
                }
                const cycle = []
                cycle.push(cycle)
                const flat = new r.Chain(r.run(new r.Chain([cycle, cycle], ctx, mode), [], "flat", [Infinity], ctx, {}), ctx, mode)
                const failure = r.getErrors(flat, [], ctx)
                assert.equal(failure.kind, r.ERROR_KIND.InvalidArrayOperation)
                assert.equal(failure.errors, undefined)
                assert.equal(r.lookupPath(flat, [0], ctx), failure)
                assert.equal(r.lookupPath(flat, [1], ctx), failure)
            }
        })

        it(`publishes certain sort failure and gates later writes at the selected owner in mode ${mode}`, async () => {
            for (const delayedProof of [false, true]) for (const proven of [false, true]) {
                const ctx = context("sort"), first = Promise.withResolvers(), last = Promise.withResolvers()
                const symbol = delayedProof ? first.promise : Symbol()
                const source = new r.Chain({ a: proven ? [symbol, 2, last.promise] : [symbol, last.promise], tag: 0 }, ctx, mode)
                const original = r.capturePath(source, ["a"], ctx)
                const direct = r.run(source, ["a"], "sort", [], ctx, mutation)
                const exact = r.getErrors(source, ["a"], ctx)
                const scope = mode === r.CHAIN_MODE.Complete ? [] : ["a"]
                const status = r.isPoisoned(source, scope, ctx), deep = r.hasError(source, scope, ctx)
                const cursor = r.iterate(source, ["a"], ctx), pull = cursor.next().catch(error => error)
                r.assignPath(source, ["tag"], 1, ctx)
                const repair = r.repairPath(source, scope, ctx), after = r.lookupPath(source, ["tag"], ctx)
                const settled = new Map()
                for (const [key, result] of Object.entries({ direct, exact, status, deep, pull, repair, after }))
                    Promise.resolve(result).then(value => settled.set(key, value))
                first.resolve(Symbol())
                await turn()
                assert.equal(settled.has("direct"), false)
                assert.equal(settled.has("exact"), false)
                assert.equal(settled.has("pull"), false)
                assert.equal(settled.has("status"), proven)
                assert.equal(settled.has("repair"), proven)
                if (proven) {
                    assert.equal(settled.get("status"), true)
                    assert.equal(settled.get("deep"), true)
                    assert.equal(settled.get("after"), mode === r.CHAIN_MODE.Complete ? 0 : 1)
                }
                const other = diagnostic(ctx, "held cause")
                last.resolve(proven ? other : undefined)
                if (proven) {
                    const report = await direct
                    assert.equal(report.errors.length, 2)
                    assert(report.errors.includes(other))
                    assert.equal(await exact, report)
                    assert.equal(await pull, report)
                    assert.equal(await r.lookupPath(original, [1], ctx), 2)
                } else {
                    assert.equal(await status, false)
                    assert.equal(await deep, false)
                    assert.equal(await after, 1)
                    assert.equal((await pull).done, false)
                }
                await cursor.return()
            }
        })
    }

    for (const mode of streams) {
        it(`skips reflection inside a reached oversized Array and still inspects its sibling in mode ${mode}`, () => {
            const ctx = context("query"), data = new Array(MAX)
            let hidden = 0, armed = false, failSibling = false
            const failure = new Error("sibling inspection")
            data[0] = new Proxy({ n: 1 }, { ownKeys(target) {
                if (armed) { hidden++; throw new Error("oversized prefix") }
                return Reflect.ownKeys(target)
            } })
            const sibling = new Proxy({ n: 2 }, { ownKeys(target) {
                if (failSibling) throw failure
                return Reflect.ownKeys(target)
            } })
            const wide = new r.Chain(data, ctx, mode)
            r.run(wide, [], "push", ["lost"], ctx, mutation)
            const root = new r.Chain({ wide: r.lookupPath(wide, [], ctx), sibling }, ctx, mode)
            armed = true
            assert.equal(r.hasError(root, [], ctx), true)
            assert.equal(r.getErrors(root, [], ctx).kind, r.ERROR_KIND.InvalidArrayLength)
            assert.equal(r.export(root, [], ctx).kind, r.ERROR_KIND.InvalidArrayLength)
            failSibling = true
            const report = r.getErrors(root, [], ctx)
            assert.equal(report.kind, r.ERROR_KIND.QueryReflectionFailed)
            assert.equal(report.cause, failure)
            assert.equal(hidden, 0)
        })

        it(`keeps a full report conditional on captured width in mode ${mode}`, async () => {
            for (const grow of [false, true]) {
                const ctx = context("width"), held = Promise.withResolvers(), prefix = diagnostic(ctx, "first")
                const data = new Array(MAX)
                data[0] = prefix
                const source = new r.Chain(data, ctx, mode)
                let entered
                const open = r.enter(source, [], ctx, { maximumCount: 1, mayPoisonScope: false },
                    reference => { entered = reference; return held.promise })
                const full = r.getErrors(source, [], ctx), exported = r.export(source, [], ctx)
                assert(r.isPending(full, ctx))
                assert(r.isPending(exported, ctx))
                assert.equal(r.hasError(source, [], ctx), true)
                assert.equal(r.lookupPath(source, [0], ctx), prefix)
                r.assignPath(source, [], ["later"], ctx)
                if (grow) r.run(entered, [], "push", [1], ctx, mutation)
                held.resolve()
                await open
                for (const result of await Promise.all([full, exported])) {
                    if (grow) {
                        assert.equal(result.kind, r.ERROR_KIND.InvalidArrayLength)
                        assert.equal(result.errorContext, "width")
                    } else assert.equal(result, prefix)
                }
                assert.deepEqual(r.export(source, [], ctx), ["later"])
            }
        })

        it(`uses one overflow Error for each losing operation at the native limit in mode ${mode}`, async () => {
            const ctx = context("full"), held = Promise.withResolvers(), source = new r.Chain(new Array(MAX), ctx, mode)
            r.run(source, [], "fill", [held.promise], ctx, mutation)
            const small = new r.Chain(r.run(source, [], "slice", [0, 2], ctx, {}), ctx, mode)
            const sort = r.run(source, [], "toSorted", [], ctx, {})
            const first = r.run(source, [], "push", [1, 2], { ...ctx, errorContext: "push" }, mutation)
            assert.equal(first, r.lookupPath(source, [MAX], ctx))
            assert.equal(first, r.lookupPath(source, [MAX + 1], ctx))
            const separator = diagnostic(ctx, "separator")
            assert.equal(r.run(source, [], "join", [separator], ctx, {}), separator)
            assert.equal(r.hasError(source, [], ctx), true)
            for (const report of [r.export(source, [], ctx), r.getErrors(source, [], ctx),
                r.run(source, [], "join", [""], ctx, {}), r.run(source, [], "toString", [], ctx, {})]) {
                assert.equal(report.kind, r.ERROR_KIND.InvalidArrayLength)
                assert.equal(report.errorContext, "full")
                assert.equal(report.errors, undefined)
                assert.notEqual(report, first)
            }
            const sibling = Promise.withResolvers(), nested = new r.Chain({ a: r.lookupPath(source, [], ctx), b: sibling.promise }, ctx, mode)
            const both = r.getErrors(nested, [], ctx)
            const slice = r.run(small, [], "join", [], ctx, {})
            assert(r.isPending(slice, ctx))
            assert(r.isPending(both, ctx))
            sibling.resolve(separator)
            const report = await both
            assert.equal(report.errors.length, 2)
            assert(report.errors.includes(separator))
            assert(report.errors.some(error => error.kind === r.ERROR_KIND.InvalidArrayLength && error !== first))
            held.resolve(Symbol())
            for (const value of await Promise.all([slice, sort])) {
                assert.equal(value.kind, r.ERROR_KIND.ScalarConversionFailed)
                assert.equal(value.errors, undefined)
            }
        })

        it(`reuses two marker producers across repeated copies in mode ${mode}`, async () => {
            const ctx = context("missing output"), hold = Promise.withResolvers()
            const first = diagnostic(ctx, "first"), second = diagnostic(ctx, "second")
            let source = new r.Chain([], ctx, mode)
            r.appendMissingOutput(source, first, ctx)
            r.appendMissingOutput(source, hold.promise, ctx)
            let promises = 0
            const hook = createHook({ init(_id, type) { if (type === "PROMISE") promises++ } })
            for (let i = 0; i < 10; i++) {
                const prior = r.lookupPath(source, [], ctx)
                hook.enable()
                try { source = new r.Chain(r.run(source, [], "concat", [prior], ctx, {}), ctx, mode) }
                finally { hook.disable() }
            }
            assert(promises < 100, `Ten copies of two causes allocated ${promises} Promises`)
            const historical = r.capturePath(source, [], ctx), earlier = r.getErrors(source, [], ctx)
            r.assignPath(source, [2047], "new", ctx)
            assert.equal(r.lookupPath(source, [2047], ctx), "new")
            hold.resolve(second)
            assert.deepEqual(new Set((await earlier).errors), new Set([first, second]))
            assert.equal(r.lookupPath(historical, [2047], ctx), second)
            for (const report of [r.getErrors(historical, [], ctx), r.export(historical, [], ctx),
                r.run(historical, [], "join", [], ctx, {})])
                assert.deepEqual(new Set(report.errors), new Set([first, second]))
        })
    }
})
