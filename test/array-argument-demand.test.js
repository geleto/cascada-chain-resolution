import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { ready, OrderedThenable } from "./ordered-thenable.js"

const context = () => ({ execution: new r.Execution(), errorContext: "controlled Array demand" })

describe("controlled Array input demand", () => {
    const turn = () => new Promise(setImmediate)
    for (const mode of Object.values(r.CHAIN_MODE)) {
        it(`discharges the splice count and releases a later push when its suffix becomes empty in mode ${mode}`, async () => {
            for (const failed of [false, true]) {
                const ctx = context(), end = Promise.withResolvers(), count = new OrderedThenable()
                const source = new r.Chain(["A"], ctx, r.CHAIN_MODE.Unordered)
                const array = new r.Chain(r.run(source, [], "slice", [0, end.promise], ctx, {}), ctx, mode)
                const at = failed ? r.validationError("start", ctx, r.ERROR_KIND.OperationInputFailed) : 0
                const removed = new r.Chain(r.run(array, [], "splice", [at, count, "X"], ctx, { mutationScopeDepth: 0 }), ctx)
                const pushed = r.run(array, [], "push", ["P"], ctx, { mutationScopeDepth: 0 })
                end.resolve(0)
                assert.deepEqual(await r.export(removed, [], ctx), [])
                assert.equal(await pushed, 2)
                assert.deepEqual(await r.export(array, [], ctx), ["X", "P"])
            }
        })

        it(`uses a delivered search or at bound before an optional position is known in mode ${mode}`, async () => {
            const ctx = context(), end = Promise.withResolvers()
            const source = new r.Chain(["A"], ctx, r.CHAIN_MODE.Unordered)
            const array = new r.Chain(r.run(source, [], "slice", [0, end.promise], ctx, {}), ctx, mode)
            for (const [method, at, expected] of [["at", 1, undefined], ["at", -2, undefined],
                ["includes", 1, false], ["indexOf", 1, -1], ["lastIndexOf", -2, -1]]) {
                for (const wrap of [x => x, ready, x => Promise.resolve(x)]) {
                    const args = method === "at" ? [wrap(at)] : ["A", wrap(at)]
                    assert.equal(await r.run(array, [], method, args, ctx, {}), expected)
                }
            }
            const cause = r.validationError("index", ctx, r.ERROR_KIND.OperationInputFailed)
            const conditional = r.run(array, [], "at", [cause], ctx, {})
            assert(r.isPending(conditional, ctx))
            end.resolve(0)
            assert.equal(await conditional, undefined)
        })

        it(`skips start conversion for zero-equivalent splice counts in mode ${mode}`, () => {
            const ctx = context(), array = new r.Chain(["A"], ctx, mode)
            for (const count of ["0", "-1", "", false, NaN, null, undefined, 0.5]) {
                for (const method of ["splice", "toSpliced"]) {
                    const start = new OrderedThenable()
                    const copy = new r.Chain(r.run(array, [], method, [[start], count], ctx, {}), ctx)
                    assert.deepEqual(r.export(copy, [], ctx), ["A"])
                    assert.equal(start.subscriptions, 0)
                }
            }
        })
    }

    it("carries a proved result Error through raw and expression lookup into a new Chain", async () => {
        for (const mode of Object.values(r.CHAIN_MODE)) for (const length of [0, 1]) {
            const ctx = context(), end = Promise.withResolvers(), index = Promise.withResolvers()
            const source = new r.Chain(["A"], ctx, r.CHAIN_MODE.Unordered)
            const array = new r.Chain(r.run(source, [], "slice", [0, end.promise], ctx, {}), ctx, mode)
            const kept = new r.Chain(r.run(array, [], "with", [index.promise, "X"], ctx, {}), ctx)
            const raw = r.lookupPath(kept, [], ctx), expression = r.lookupPathForExpression(kept, [], ctx)
            const copy = new r.Chain(raw, ctx, mode), evaluated = new r.Chain(expression, ctx, mode)
            const child = r.capturePath(kept, [0], ctx, mode)
            const observed = [kept, copy, evaluated, child].map(h => [r.isPoisoned(h, [], ctx), r.hasError(h, [], ctx)])
            assert(observed.flat().every(value => r.isPending(value, ctx)))
            const errors = r.getErrors(copy, [], ctx)
            const cause = r.validationError("index", ctx, r.ERROR_KIND.OperationInputFailed)
            index.resolve(cause)
            assert.deepEqual(await Promise.all(observed.flat()), Array(8).fill(true))
            assert.equal(r.isPoisoned(evaluated, [], ctx), true)
            assert(r.isPending(r.getErrors(evaluated, [], ctx), ctx))
            end.resolve(length)
            const exact = await errors
            if (length) assert.equal(exact, cause)
            else assert.equal(exact.kind, r.ERROR_KIND.InvalidArrayOperation)
            assert.equal(await raw, exact)
            await assert.rejects(expression, reason => reason === exact)
            assert.equal(await r.getErrors(child, [], ctx), exact)
            await r.repairPath(copy, [], ctx)
            assert.equal(await r.lookupPath(copy, [], ctx), exact)
            assert.equal(await r.getErrors(evaluated, [], ctx), exact)
        }
    })

    it("stores the Error from a failed ancestor lookup as the new Chain's data", async () => {
        for (const timing of ["ready", "synchronous", "pending"]) {
            const ctx = context(), cause = r.validationError("ancestor", ctx, r.ERROR_KIND.OperationInputFailed)
            const holder = new r.Chain({ a: [7] }, ctx), gate = Promise.withResolvers()
            const input = timing === "ready" ? cause : timing === "synchronous" ? ready(cause) : gate.promise
            r.poisonPath(holder, ["a"], input, ctx)
            const observed = new r.Chain(r.lookupPath(holder, ["a", 0], ctx), ctx)
            const expression = new r.Chain(r.lookupPathForExpression(holder, ["a", 0], ctx), ctx)
            const captured = r.capturePath(holder, ["a"], ctx)
            assert.equal(r.isPoisoned(observed, [], ctx), true)
            assert.equal(r.hasError(expression, [], ctx), true)
            r.repairPath(holder, ["a"], ctx)
            r.repairPath(captured, [], ctx)
            assert.equal(await r.lookupPath(captured, [0], ctx), 7)
            gate.resolve(cause)
            for (const copy of [observed, expression]) {
                assert.equal(await r.getErrors(copy, [], ctx), cause)
                await r.repairPath(copy, [], ctx)
                assert.equal(await r.lookupPath(copy, [], ctx), cause)
            }
        }
    })

    for (const method of ["fill", "copyWithin"])
        it(`answers deep Error queries from ranges preserved by Complete ${method}`, async () => {
            for (const ancestor of [false, true]) for (const fails of [false, true]) {
                const ctx = context(), selector = Promise.withResolvers(), payload = Promise.withResolvers()
                const array = ["A", "B", { child: payload.promise }]
                const root = new r.Chain(ancestor ? { array } : array, ctx, r.CHAIN_MODE.Complete)
                const path = ancestor ? ["array"] : []
                const args = method === "fill" ? ["X", selector.promise, 1] : [0, selector.promise, 2]
                const result = r.run(root, path, method, args, ctx, { mutationScopeDepth: 0 })
                const deep = r.hasError(root, [], ctx), shallow = r.isPoisoned(root, [], ctx)
                const exact = r.getErrors(root, [], ctx), read = r.lookupPath(root, [...path, 0], ctx)
                assert(r.isPending(deep, ctx))
                const old = r.validationError("payload", ctx, r.ERROR_KIND.AssignmentValueFailed)
                payload.resolve(old)
                assert.equal(await deep, true)
                assert.equal(r.hasError(root, [], ctx), true)
                assert(r.isPending(r.isPoisoned(root, [], ctx), ctx))
                assert(r.isPending(r.lookupPath(root, [...path, 0], ctx), ctx))
                const bad = r.validationError("selector", ctx, r.ERROR_KIND.OperationInputFailed)
                selector.resolve(fails ? bad : 0)
                await result
                assert.equal(await shallow, fails)
                assert.equal(await exact, fails ? bad : old)
                assert.equal(await read, fails ? bad : method === "fill" ? "X" : "A")
            }
        })

    it("keeps a deep Error conditional when fill can overwrite its only cause", async () => {
        const ctx = context(), index = Promise.withResolvers()
        const cause = r.validationError("replaced", ctx, r.ERROR_KIND.OperationInputFailed)
        const array = new r.Chain([cause, "B"], ctx, r.CHAIN_MODE.Complete)
        r.run(array, [], "fill", ["X", index.promise, 1], ctx, { mutationScopeDepth: 0 })
        let result
        const query = Promise.resolve(r.hasError(array, [], ctx)).then(answer => { result = answer })
        await turn()
        assert.equal(result, undefined)
        index.resolve(0)
        await query
        assert.equal(result, false)
    })

    for (const mode of Object.values(r.CHAIN_MODE))
        it(`reports an empty with result regardless of index availability in mode ${mode}`, async () => {
            for (const open of [false, true]) for (const timing of ["ready", "synchronous", "held"]) {
                const ctx = context(), source = new r.Chain([], ctx, mode)
                const hold = Promise.withResolvers(), index = new OrderedThenable(), replacement = new OrderedThenable()
                const cause = r.validationError("index", ctx, r.ERROR_KIND.OperationInputFailed)
                const entry = open && r.enter(source, [], ctx, { maximumCount: 1, mayPoisonScope: false }, () => hold.promise)
                const result = r.run(source, [], "with", [timing === "held" ? index : timing === "synchronous" ? ready(cause) : cause,
                    replacement], ctx, {})
                if (open) assert(r.isPending(result, ctx))
                else {
                    assert.equal(index.subscriptions, 0)
                    assert.equal(replacement.subscriptions, 0)
                }
                hold.resolve()
                await entry
                assert.equal((await result).kind, r.ERROR_KIND.InvalidArrayOperation)
            }
        })
    for (const mode of Object.values(r.CHAIN_MODE))
        it(`leaves a replacement unconsumed when with rejects its index in mode ${mode}`, () => {
            const ctx = context(), source = new r.Chain([1], ctx, mode)
            const failure = r.validationError("index", ctx, r.ERROR_KIND.OperationInputFailed)
            for (const value of [7, failure]) for (const deliver of [value => value, ready]) {
                const unused = new OrderedThenable()
                let inspections = 0
                const object = new Proxy({}, { ownKeys() { inspections++; return [] } })
                for (const replacement of [unused, object]) {
                    const result = r.run(source, [], "with", [deliver(value), replacement], ctx, {})
                    if (value === failure) assert.equal(result, failure)
                    else assert.equal(result.kind, r.ERROR_KIND.InvalidArrayOperation)
                }
                assert.equal(unused.subscriptions, 0)
                assert.equal(inspections, 0)
            }
            assert.deepEqual(r.export(source, [], ctx), [1])
        })
    for (const mode of Object.values(r.CHAIN_MODE))
        it(`uses both signed with bounds while the receiver may still be empty in mode ${mode}`, async () => {
            const ctx = context(), end = Promise.withResolvers()
            const source = new r.Chain(["A"], ctx, r.CHAIN_MODE.Sequential)
            const partial = new r.Chain(r.run(source, [], "slice", [0, end.promise], ctx, {}), ctx, mode)
            assert(r.isPending(r.lookupPath(partial, ["length"], ctx), ctx))
            for (const at of [1, -2]) {
                for (const input of [at, ready(at)]) {
                    const unused = new OrderedThenable()
                    assert.equal(r.run(partial, [], "with", [input, unused], ctx, {}).kind, r.ERROR_KIND.InvalidArrayOperation)
                    assert.equal(unused.subscriptions, 0)
                }
                const index = Promise.withResolvers(), result = r.run(partial, [], "with", [index.promise, "X"], ctx, {})
                index.resolve(at)
                assert.equal((await result).kind, r.ERROR_KIND.InvalidArrayOperation)
            }
            const cause = r.validationError("index", ctx, r.ERROR_KIND.OperationInputFailed)
            const unused = new OrderedThenable(), failed = r.run(partial, [], "with", [cause, unused], ctx, {})
            assert(r.isPending(failed, ctx))
            assert.equal(unused.subscriptions, 0)
            end.resolve(0)
            assert.equal((await failed).kind, r.ERROR_KIND.InvalidArrayOperation)
        })
    for (const mode of Object.values(r.CHAIN_MODE))
        it(`skips a known end-relative slice exclusion while its start is pending in mode ${mode}`, async () => {
            const ctx = context(), first = Promise.withResolvers()
            let armed = false, excludedReads = 0
            const receiver = new r.Chain(new Proxy(["A", "B"], {
                getOwnPropertyDescriptor(target, key) {
                    if (armed && key === "1") excludedReads++
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            }), ctx, mode)
            armed = true
            const result = new r.Chain(r.run(receiver, [], "slice", [first.promise, -1], ctx, {}), ctx)
            first.resolve(0)
            assert.deepEqual(await r.export(result, [], ctx), ["A"])
            assert.equal(excludedReads, 0)
        })
    it("leaves a replacement unconsumed when a complete with result cannot fit", async () => {
        const ctx = context(), source = new r.Chain(new Array(0xffffffff), ctx, r.CHAIN_MODE.Unordered)
        r.run(source, [], "push", ["lost"], ctx, { mutationScopeDepth: 0 })
        const complete = r.capturePath(source, [], ctx, r.CHAIN_MODE.Complete), unused = new OrderedThenable()
        const result = r.run(complete, [], "with", [0, unused], ctx, {})
        assert.equal(result.kind, r.ERROR_KIND.InvalidArrayLength)
        assert.equal(unused.subscriptions, 0)
        const cause = r.validationError("index", ctx, r.ERROR_KIND.OperationInputFailed)
        for (const at of [0, Infinity, cause]) {
            const index = Promise.withResolvers(), pending = r.run(complete, [], "with", [index.promise, unused], ctx, {})
            assert(r.isPending(pending, ctx))
            const holder = new r.Chain(pending, ctx)
            assert.equal(r.isPoisoned(holder, [], ctx), true)
            assert.equal(r.hasError(holder, [], ctx), true)
            const errors = r.getErrors(holder, [], ctx)
            assert(r.isPending(errors, ctx))
            assert.equal(unused.subscriptions, 0)
            index.resolve(at)
            const result = await pending
            assert.equal(await errors, result)
            if (at === cause) assert.equal(result, cause)
            else assert.equal(result.kind, at === 0 ? r.ERROR_KIND.InvalidArrayLength : r.ERROR_KIND.InvalidArrayOperation)
            assert.equal(unused.subscriptions, 0)
        }
    })
    for (const mode of Object.values(r.CHAIN_MODE))
        it(`drops the with replacement while a nested index failure collects its other cause in mode ${mode}`, async () => {
            const ctx = context(), tail = Promise.withResolvers(), unused = new OrderedThenable()
            const a = r.validationError("first", ctx, r.ERROR_KIND.OperationInputFailed)
            const b = r.validationError("last", ctx, r.ERROR_KIND.OperationInputFailed)
            const result = r.run(new r.Chain(["A"], ctx, mode), [], "with", [[a, tail.promise], unused], ctx, {})
            assert(r.isPending(result, ctx))
            assert.equal(unused.subscriptions, 0)
            tail.resolve(b)
            assert.deepEqual(new Set((await result).errors), new Set([a, b]))
            assert.equal(unused.subscriptions, 0)
        })
    it("keeps with behind an earlier whole-Array failure even for an impossible index", async () => {
        const ctx = context(), cut = Promise.withResolvers(), source = new r.Chain(["A"], ctx, r.CHAIN_MODE.Complete)
        const cause = r.validationError("cut", ctx, r.ERROR_KIND.OperationInputFailed)
        const prior = r.run(source, [], "splice", [0, cut.promise], ctx, { mutationScopeDepth: 0 })
        const result = r.run(source, [], "with", [2, "unused"], ctx, {})
        assert(r.isPending(result, ctx))
        cut.resolve(cause)
        assert.equal(await prior, cause)
        assert.equal(await result, cause)
        await r.repairPath(source, [], ctx)
        assert.deepEqual(await r.export(source, [], ctx), ["A"])
    })
    for (const method of ["splice", "toSpliced"])
        it(`skips impossible insertions and preserves conditional controls on open Complete ${method}`, async () => {
            const ctx = context(), cut = Promise.withResolvers(), unused = new OrderedThenable()
            const source = new r.Chain(["A", "B"], ctx, r.CHAIN_MODE.Unordered)
            const prior = r.run(source, [], "splice", [1, cut.promise], ctx, { mutationScopeDepth: 0 })
            const complete = r.capturePath(source, [], ctx, r.CHAIN_MODE.Complete)
            const failure = key => r.validationError(key, ctx, r.ERROR_KIND.OperationInputFailed)
            const a = failure("start"), b = failure("count")
            for (const deliver of [value => value, ready]) {
                assert.equal(r.run(complete, [], method, [deliver(a), 0, unused], ctx, {}), a)
                assert.equal(r.run(complete, [], method, [-1, deliver(b), unused], ctx, {}), b)
            }
            const count = Promise.withResolvers(), both = r.run(complete, [], method, [a, count.promise, unused], ctx, {})
            assert(r.isPending(both, ctx))
            count.resolve(b)
            assert.deepEqual(new Set((await both).errors), new Set([a, b]))
            assert.equal(unused.subscriptions, 0)
            // At the eventual end the failed count is irrelevant and the insertion escapes.
            const owner = new r.Chain({ n: 1 }, ctx), value = r.lookupPath(owner, [], ctx)
            const possible = new r.Chain(r.run(complete, [], method, [1, b, value], ctx, {}), ctx)
            r.assignPath(owner, ["n"], 9, ctx)
            cut.resolve(1)
            await prior
            assert.deepEqual(await r.export(possible, [], ctx), ["A", { n: 1 }])
            // Empty input admits the insertion while both controls remain held.
            const end = Promise.withResolvers(), base = new r.Chain(["A"], ctx, r.CHAIN_MODE.Sequential)
            const bounded = new r.Chain(r.run(base, [], "slice", [0, end.promise], ctx, {}), ctx, r.CHAIN_MODE.Complete)
            const at = Promise.withResolvers(), n = Promise.withResolvers()
            const inserted = new r.Chain(r.run(bounded, [], method, [at.promise, n.promise, "Y"], ctx, {}), ctx)
            end.resolve(0)
            assert.deepEqual(await r.export(inserted, [], ctx), ["Y"])
            at.resolve(a)
            n.resolve(b)
        })
    for (const method of ["splice", "toSpliced"])
        it(`orders a conditional count failure before certain capacity failure in open Complete ${method}`, async () => {
            const max = 0xffffffff
            for (const width of [0, 1]) {
                const ctx = context(), end = Promise.withResolvers(), unused = new OrderedThenable()
                const stream = value => new r.Chain(value, ctx, r.CHAIN_MODE.Sequential)
                const tail = r.run(stream(["last"]), [], "slice", [0, end.promise], ctx, {})
                const open = stream(r.run(stream(new Array(max)), [], "concat", [tail], ctx, {}))
                const complete = r.capturePath(open, [], ctx, r.CHAIN_MODE.Complete)
                assert.equal(r.run(complete, [], method, [max, 0, unused], ctx, {}).kind, r.ERROR_KIND.InvalidArrayLength)
                const cause = r.validationError("count", ctx, r.ERROR_KIND.OperationInputFailed)
                const selected = r.run(complete, [], method, [max, cause, unused], ctx, {})
                assert(r.isPending(selected, ctx))
                assert.equal(unused.subscriptions, 0)
                end.resolve(width)
                const actual = await selected
                if (width) assert.equal(actual, cause)
                else assert.equal(actual.kind, r.ERROR_KIND.InvalidArrayLength)
                assert.equal(unused.subscriptions, 0)
            }
        })
    for (const method of ["push", "unshift", "splice", "toSpliced"])
        it(`leaves discarded inputs unconsumed when complete observational ${method} fails`, () => {
            const ctx = context(), splice = method === "splice" || method === "toSpliced"
            const cause = r.validationError("count", ctx, r.ERROR_KIND.OperationInputFailed)
            const full = new r.Chain(new Array(0xffffffff), ctx, r.CHAIN_MODE.Complete)
            const short = new r.Chain([1, 2], ctx, r.CHAIN_MODE.Complete)
            for (const deliver of [value => value, ready]) {
                const unused = new OrderedThenable()
                let inspections = 0
                const object = new Proxy({}, { ownKeys() { inspections++; return [] } })
                for (const payload of [unused, object]) {
                    const result = r.run(full, [], method, splice ? [0, deliver(0), payload] : [payload], ctx, {})
                    assert.equal(result.kind, r.ERROR_KIND.InvalidArrayLength)
                    if (splice) assert.equal(r.run(short, [], method, [0, deliver(cause), payload], ctx, {}), cause)
                }
                assert.equal(unused.subscriptions, 0)
                assert.equal(inspections, 0)
            }
        })
    for (const mode of Object.values(r.CHAIN_MODE))
        it(`drops fill payload demand while a failed bound still collects Errors in mode ${mode}`, async () => {
            const ctx = context(), source = new r.Chain([1, 2], ctx, mode)
            const payload = Promise.withResolvers(), rest = Promise.withResolvers()
            const cause = r.validationError("bound", ctx, r.ERROR_KIND.OperationInputFailed)
            const result = r.run(source, [], "fill", [payload.promise, 0, [cause, rest.promise]], ctx, { mutationScopeDepth: 0 })
            let inspections = 0
            payload.resolve(new Proxy({}, { ownKeys() { inspections++; return [] } }))
            await new Promise(setImmediate)
            assert.equal(inspections, 0)
            rest.resolve(1)
            assert.equal(await result, cause)
        })
    it("includes compares a sparse hole range once and respects its captured start", async () => {
        const ctx = context(), sparse = new Array(0xffffffff)
        sparse[sparse.length - 1] = 7
        const source = new r.Chain(sparse, ctx)
        assert.equal(r.run(source, [], "includes", [8, 3000000000], ctx, {}), false)
        assert.equal(r.run(source, [], "includes", [7], ctx, {}), true)
        const from = Promise.withResolvers(), result = r.run(source, [], "includes", [undefined, from.promise], ctx, {})
        from.resolve(-1)
        assert.equal(await result, false)
    })
    it("flat keeps depth conditional until a top-level occurrence needs discovery", async () => {
        const ctx = context(), source = new r.Chain([1, , 2], ctx, r.CHAIN_MODE.Complete), unused = new OrderedThenable()
        const result = r.run(source, [], "flat", [unused], ctx, {})
        assert.deepEqual(r.export(new r.Chain(result, ctx), [], ctx), [1, 2])
        assert.equal(unused.subscriptions, 0)
        const value = Promise.withResolvers(), depth = Promise.withResolvers()
        const conditional = r.run(new r.Chain([value.promise, 2], ctx, r.CHAIN_MODE.Complete), [], "flat", [depth.promise], ctx, {})
        value.resolve(1)
        assert.deepEqual(r.export(new r.Chain(await conditional, ctx), [], ctx), [1, 2])
        const poison = r.validationError("root", ctx, r.ERROR_KIND.OperationInputFailed)
        const failed = new r.Chain([poison], ctx, r.CHAIN_MODE.Complete)
        assert.equal(r.run(failed, [], "flat", [1], ctx, {}), poison)
        const leaf = r.run(failed, [], "flat", [0], ctx, {})
        assert.equal(r.lookupPath(new r.Chain(leaf, ctx), [0], ctx), poison)
    })
    for (const method of ["includes", "indexOf", "lastIndexOf"]) {
        const miss = method === "includes" ? false : -1
        it(`${method} captures the relative bound's length before releasing the source`, async () => {
            const ctx = context(), source = new r.Chain([1, 2], ctx), bound = Promise.withResolvers()
            const result = r.run(source, [], method, [2, bound.promise], ctx, {})
            r.assignPath(source, ["length"], 0, ctx)
            bound.resolve(-1)
            assert.equal(await result, method === "includes" ? true : 1)
        })
        it(`${method} drops a failed or unfinished range on a proved mismatch`, async () => {
            const ctx = context(), source = new r.Chain([1], ctx)
            const unused = new OrderedThenable()
            const failure = r.validationError("range", ctx, r.ERROR_KIND.OperationInputFailed)
            for (const bound of [unused, failure, ready(failure)])
                assert.equal(r.run(source, [], method, [2, bound], ctx, {}), miss)
            assert.equal(unused.subscriptions, 0)
            const value = Promise.withResolvers(), bound = Promise.withResolvers()
            const result = r.run(new r.Chain([value.promise], ctx), [], method, [2, bound.promise], ctx, {})
            bound.resolve(failure)
            value.resolve(1)
            assert.equal(await result, miss)
        })
        it(`${method} drops a failed comparison once its position is excluded`, async () => {
            const ctx = context(), source = new r.Chain([1], ctx), bound = Promise.withResolvers()
            const failure = r.validationError("needle", ctx, r.ERROR_KIND.OperationInputFailed)
            const result = r.run(source, [], method, [failure, bound.promise], ctx, {})
            bound.resolve(method === "lastIndexOf" ? -2 : 2)
            assert.equal(await result, miss)
            if (method !== "includes") {
                const unused = new OrderedThenable()
                assert.equal(r.run(new r.Chain(new Array(1000000), ctx), [], method, [unused, unused], ctx, {}), -1)
                assert.equal(unused.subscriptions, 0)
            }
        })
    }

    it("slice ignores the opposite bound when a reached endpoint proves the range empty", async () => {
        for (const deliver of [value => value, ready, value => Promise.resolve(value)]) {
            const ctx = context()
            const chain = new r.Chain([1, 2], ctx, r.CHAIN_MODE.Complete)
            for (const args of [[new OrderedThenable(), deliver(0)], [new OrderedThenable(), deliver(-2)],
                [deliver(2), new OrderedThenable()]]) {
                const copy = await r.run(chain, [], "slice", args, ctx, {})
                assert.deepEqual(r.export(new r.Chain(copy, ctx), [], ctx), [])
            }
            const failed = r.validationError("unusable bound", ctx, r.ERROR_KIND.OperationInputFailed)
            assert.deepEqual(r.export(new r.Chain(await r.run(chain, [], "slice", [failed, deliver(0)], ctx, {}), ctx), [], ctx), [])
            assert.equal(await r.run(chain, [], "slice", [failed, deliver(1)], ctx, {}), failed)
        }
    })

    for (const method of ["sort", "toSorted"]) {
        for (const input of [() => 42, () => ready(42), () => new OrderedThenable()])
            it(`${method} transfers a sole sortable placement without consuming its comparator`, async () => {
                const ctx = context(), comparator = input(), pending = Promise.withResolvers()
                for (const source of [[7, undefined], [pending.promise], [, , pending.promise]]) {
                    const result = r.run(new r.Chain(source, ctx), [], method, [comparator], ctx, {})
                    assert(!r.isPending(result, ctx) && !r.isPoisonError(result))
                    const copy = new r.Chain(result, ctx)
                    assert.equal(r.lookupPath(copy, ["length"], ctx), source.length)
                    assert.equal(r.isPending(r.lookupPath(copy, [0], ctx), ctx), source.includes(pending.promise))
                }
                if (comparator instanceof OrderedThenable) assert.equal(comparator.subscriptions, 0)
            })

        it(`${method} selects a required invalid comparator independently of unrelated payloads`, async () => {
            const ctx = context(), wait = Promise.withResolvers()
            const direct = r.run(new r.Chain([2, 1, wait.promise], ctx), [], method, [42], ctx, {})
            assert(r.isPoisonError(direct))
            assert.equal(direct.kind, r.ERROR_KIND.NotAFunction)
            const conditional = r.run(new r.Chain([2, wait.promise], ctx), [], method, [42], ctx, {})
            assert(r.isPending(conditional, ctx))
            wait.resolve(undefined)
            assert.deepEqual(r.export(new r.Chain(await conditional, ctx), [], ctx), [2, undefined])
        })
    }
})
