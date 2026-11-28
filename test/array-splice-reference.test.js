import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { ready } from "./ordered-thenable.js"

const mutation = { mutationScopeDepth: 0 }
const modes = Object.values(r.CHAIN_MODE)
const tick = () => new Promise(setImmediate)
const context = () => ({ execution: new r.Execution(), errorContext: "splice reference" })

// Give holes coordinates too. Map each input occurrence forward, independently
// of the native splice that consumes it and of the kernel's range operations.
function partition(n, args) {
    const start = args[0] ?? 0
    const s = Math.max(0, Math.min(n, start < 0 ? n + start : start))
    const d = args.length === 1 ? n - s : Math.max(0, Math.min(n - s, args[1] ?? 0))
    const w = Math.max(0, args.length - 2), kept = [], removed = []
    for (let i = 0; i < n; ++i) {
        if (i < s) kept[i] = i
        else if (i < s + d) removed[i - s] = i
        else kept[i - d + w] = i
    }
    for (let j = 0; j < w; ++j) kept[s + j] = n + j
    return { kept, removed }
}

function* argumentsFor(n) {
    yield []
    for (const at of [undefined, ...Array.from({ length: 2 * n + 3 }, (_, i) => i - n - 1)]) {
        yield [at]
        for (const count of [undefined, ...Array.from({ length: n + 3 }, (_, i) => i - 1)]) {
            yield [at, count]
            yield [at, count, "insert"]
        }
    }
}

// A fresh graph for each interpreter. Compare sparse presence separately,
// and require every repeated occurrence of the child to select one identity.
function graph(n, mask) {
    const a = new Array(n), child = { id: "shared" }
    for (let i = 0; i < n; ++i) if (mask & (1 << i)) a[i] = i === 1 ? undefined : child
    return a
}
function sameSlots(actual, expected) {
    assert.deepEqual(actual, expected)
    let child
    for (let i = 0; i < expected.length; ++i) {
        assert.equal(Object.hasOwn(actual, i), Object.hasOwn(expected, i))
        if (expected[i]?.id) {
            child ??= actual[i]
            assert.equal(actual[i], child)
        }
    }
}

// The language trace before exact repair. A failed insertion position flags
// the displaced occurrences in Sequential. Unordered preserves their data.
function insertionTrace(ordered, child, cause) {
    const visible = ordered ? cause : child
    return [cause, visible, visible, child]
}
const failedStartWitness = (ordered, trace, child, cause) => {
    assert.equal(trace[0], cause, "failed insertion result")
    assert.equal(trace[1], ordered ? cause : child, "slot zero before repair")
    assert.equal(trace[2], ordered ? cause : child, "at zero before repair")
    assert.equal(trace[3], child, "slot zero after exact repair")
}
function sortTrace(broad) {
    const record = { a: [2, 1], tag: 0 }
    // The selected Array fails. Only a disjoint write has authority here.
    if (!broad) record.tag = 7
    record.a.push(3)
    return record
}
function sortWitness(broad, repaired) {
    assert.deepEqual(repaired, { a: [2, 1, 3], tag: broad ? 0 : 7 }, "writes visible after repair")
}

describe("independent splice reference", () => {
    it("agrees with native sparse partitions in both coordinate directions", async function () {
        this.timeout(60000)
        let partitions = 0, replays = 0
        for (let n = 0; n <= 3; ++n) for (const args of argumentsFor(n)) {
            const { kept, removed } = partition(n, args)
            const labels = Array.from({ length: n }, (_, i) => i)
            const tagged = args.length === 3 ? [...args.slice(0, 2), n] : args
            assert.deepEqual(labels.splice(...tagged), removed)
            assert.deepEqual(labels, kept)
            assert.deepEqual([...kept, ...removed].sort((a, b) => a - b),
                Array.from({ length: n + Number(args.length === 3) }, (_, i) => i))
            ++partitions
            for (let mask = 0; mask < 2 ** n; ++mask) {
                const before = graph(n, mask), after = before.slice(), gone = after.splice(...args)
                for (const mode of modes) for (const method of ["splice!", "splice", "toSpliced"]) {
                    const ctx = context(), wrap = value => new r.Chain(value, ctx, mode)
                    const source = wrap(graph(n, mask)), write = method === "splice!"
                    const value = r.run(source, [], write ? "splice" : method, args.slice(), ctx, write ? mutation : {})
                    sameSlots(await r.export(wrap(value), [], ctx), write ? gone : method === "toSpliced" ? [...after] : after)
                    sameSlots(await r.export(source, [], ctx), write ? after : before)
                    ++replays
                }
            }
        }
        assert.equal(replays, 9 * [0, 1, 2, 3].reduce((sum, n) => sum + [...argumentsFor(n)].length * 2 ** n, 0))
        assert.equal(partitions, [0, 1, 2, 3].reduce((sum, n) => sum + [...argumentsFor(n)].length, 0))
    })

    it("rejects a model that exposes C or replays a suppressed write", () => {
        const child = {}, cause = {}
        const trace = insertionTrace(true, child, cause)
        failedStartWitness(true, trace, child, cause)
        trace[1] = child
        assert.throws(() => failedStartWitness(true, trace, child, cause), /slot zero before repair/)
        const record = sortTrace(true)
        sortWitness(true, record)
        record.tag = 7
        assert.throws(() => sortWitness(true, record), /writes visible after repair/)
    })

    it("replays the failed-start trace through the producer and every receiving mode", async () => {
        for (const producer of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) for (const receiver of modes)
        for (const schedule of ["ready", "synchronous", "start first", "count first"]) {
            const ordered = producer === r.CHAIN_MODE.Sequential, child = { id: "C" }, ctx = context()
            const cause = r.validationError("start", ctx, r.ERROR_KIND.OperationInputFailed)
            const start = Promise.withResolvers(), count = Promise.withResolvers()
            const args = schedule === "ready" ? [cause, 0] : schedule === "synchronous" ?
                [ready(cause), ready(0)] : [start.promise, count.promise]
            const source = new r.Chain([child], ctx, producer)
            const direct = r.run(source, [], "splice", [...args, "Y"], ctx, mutation)
            const captured = r.capturePath(source, [], ctx, receiver)
            const lookup = r.lookupPath(captured, [0], ctx), at = r.run(captured, [], "at", [0], ctx, {})
            if (schedule.endsWith("first")) {
                if (schedule === "count first") count.resolve(0)
                else start.reject(cause)
                await tick()
                assert(r.isPending(direct, ctx))
                start.reject(cause)
                count.resolve(0)
            }
            const trace = await Promise.all([direct, lookup, at])
            await r.repairPath(source, [0], ctx)
            trace.push(r.lookupPath(source, [0], ctx))
            failedStartWitness(ordered, trace, child, cause)
            assert.deepEqual(trace, insertionTrace(ordered, child, cause))
        }
    })

    it("selects the surviving rear occurrence while the discarded tail stays open", async () => {
        for (const mode of modes) for (const readers of ["early", "fresh", "both"])
        for (const startFirst of [true, false]) {
            const ctx = context(), tail = Promise.withResolvers(), start = Promise.withResolvers(), count = Promise.withResolvers()
            const wrap = value => new r.Chain(value, ctx, mode), input = wrap(["A", "B", "C"])
            r.run(input, [], "splice", [2, tail.promise], ctx, mutation)
            const output = wrap(r.run(input, [], "toSpliced", [start.promise, count.promise], ctx, {}))
            const read = () => r.run(output, [], "at", [-1], ctx, {})
            const points = readers === "fresh" ? [] : [read()]
            if (startFirst) start.resolve(1)
            else count.resolve(3)
            await tick()
            if (startFirst) count.resolve(3)
            else start.resolve(1)
            await tick()
            if (readers !== "early") points.push(read())
            const held = Symbol("held")
            for (const point of points)
                assert.equal(await Promise.race([point, Promise.resolve(held)]),
                    mode === r.CHAIN_MODE.Complete ? held : "A", "rear of the retained prefix")
            tail.resolve(1)
            assert.deepEqual(await Promise.all(points), points.map(() => "A"))
            assert.deepEqual(await r.export(output, [], ctx), ["A"])
        }
    })

    it("wakes an earlier rear read when the selected width excludes it", async () => {
        for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
        for (const method of ["slice", "toSpliced"]) for (const first of [0, 1]) {
            const ctx = context(), wrap = value => new r.Chain(value, ctx, mode)
            const predecessor = Promise.withResolvers(), bounds = [Promise.withResolvers(), Promise.withResolvers()]
            const source = wrap(["A", "B", "C"]), args = method === "slice" ? [-2, -1] : [-4, 4, "X"]
            r.run(source, [], "splice", [0, predecessor.promise], ctx, mutation)
            const output = wrap(r.run(source, [], method, [...bounds.map(b => b.promise), ...args.slice(2)], ctx, {}))
            const rear = () => r.run(output, [], "at", [-2], ctx, {}), earlier = rear()
            const pending = Symbol("held")
            assert.equal(await Promise.race([earlier, Promise.resolve(pending)]), pending)
            bounds[first].resolve(args[first])
            await tick()
            bounds[1 - first].resolve(args[1 - first])
            await tick()
            assert.equal(await Promise.race([earlier, Promise.resolve(pending)]), undefined)
            assert.equal(await Promise.race([rear(), Promise.resolve(pending)]), undefined)
            predecessor.resolve(1)
            assert.deepEqual(await r.export(output, [], ctx), method === "slice" ? ["B"] : ["X"])
        }
    })

    it("wakes a captured forward point when slice excludes it before concat settles", async () => {
        const held = Symbol("held")
        const checkpoint = point => Promise.race([point, Promise.resolve(held)])
        for (const mode of modes) for (const first of [0, 1]) for (const method of ["at", "lookup"])
        for (const readers of ["early", "fresh", "both"]) for (const reject of [false, true]) {
            const ctx = context(), wrap = value => new r.Chain(value, ctx, mode)
            const gap = Promise.withResolvers(), bounds = [Promise.withResolvers(), Promise.withResolvers()]
            const joined = wrap(r.run(wrap([]), [], "concat", [gap.promise], ctx, {}))
            const sliced = wrap(r.run(joined, [], "slice", bounds.map(b => b.promise), ctx, {}))
            const read = index => method === "at" ? r.run(sliced, [], "at", [index], ctx, {}) : r.lookupPath(sliced, [index], ctx)
            const points = readers === "fresh" ? [] : [read(1)]
            for (const point of points) assert.equal(await checkpoint(point), held)
            const values = [-1, 1], complete = mode === r.CHAIN_MODE.Complete
            const expected = complete ? held : undefined
            bounds[first].resolve(values[first])
            await tick()
            // Either bound alone limits the result to at most one slot.
            for (const point of points) assert.equal(await checkpoint(point), expected)
            bounds[1 - first].resolve(values[1 - first])
            await tick()
            if (readers !== "early") points.push(read(1))
            for (const point of points) assert.equal(await checkpoint(point), expected)
            const possible = read(0)
            assert.equal(await checkpoint(possible), held)
            const cause = r.validationError("concat operand", ctx, r.ERROR_KIND.OperationInputFailed)
            if (reject) gap.reject(cause)
            else gap.resolve(["X"])
            for (const point of points) assert.equal(await point, reject && complete ? cause : undefined)
            assert.equal(await possible, reject ? cause : "X")
        }
    })

    it("preserves the source position through alternating end crops", async () => {
        for (const mode of modes) for (const [length, expected] of [[1, 0], [2, 1], [3, 1], [4, 2]]) {
            const ctx = context(), gap = Promise.withResolvers(), wrap = value => new r.Chain(value, ctx, mode)
            let current = wrap(r.run(wrap([]), [], "concat", [gap.promise], ctx, {}))
            for (const args of [[-3], [0, 2], [-1]]) current = wrap(r.run(current, [], "slice", args, ctx, {}))
            const point = r.lookupPath(current, [0], ctx)
            assert(r.isPending(point, ctx))
            gap.resolve(Array.from({ length }, (_, i) => i))
            assert.equal(await point, expected)
        }
    })

    it("publishes a positional failure only inside the final splice width", async () => {
        for (const length of [2, 3]) for (const countFirst of [true, false]) {
            const ctx = context(), tail = Promise.withResolvers(), start = Promise.withResolvers(), count = Promise.withResolvers()
            const wrap = value => new r.Chain(value, ctx, r.CHAIN_MODE.Sequential)
            const receiver = wrap(["A", "B", "C"]), cause = r.validationError("start", ctx, r.ERROR_KIND.OperationInputFailed)
            r.run(receiver, [], "splice", [2, tail.promise], ctx, mutation)
            const view = wrap(r.run(receiver, [], "toSpliced", [start.promise, count.promise, "I"], ctx, {}))
            const rear = r.run(view, [], "at", [-4], ctx, {}), inside = r.run(view, [], "at", [-3], ctx, {})
            const reversed = wrap(r.run(view, [], "toReversed", [], ctx, {}))
            // Index 3 is in the extended Array even when the failed range ends before it.
            r.assignPath(reversed, [4], "padding", ctx)
            const last = r.lookupPath(reversed, [3], ctx)
            if (countFirst) count.resolve(0)
            else start.reject(cause)
            await tick()
            if (countFirst) start.reject(cause)
            else count.resolve(0)
            await tick()
            assert.equal(await Promise.race([rear, Promise.resolve("held")]), "held")
            tail.resolve(3 - length)
            assert.equal(await rear, length === 3 ? cause : undefined)
            assert.equal(await last, length === 3 ? cause : undefined)
            assert.equal(await r.lookupPath(reversed, [4], ctx), "padding")
            assert.equal(await inside, cause)
        }
    })

    it("keeps the common occurrence of opposing slice bounds in either delivery order", async () => {
        for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) for (const first of [0, 1]) {
            const ctx = context(), tail = Promise.withResolvers(), bounds = [Promise.withResolvers(), Promise.withResolvers()]
            const source = new r.Chain(["A", "B", "C", "D", "E"], ctx, mode)
            r.run(source, [], "splice", [4, tail.promise], ctx, mutation)
            const result = new r.Chain(r.run(source, [], "slice", bounds.map(b => b.promise), ctx, {}), ctx, mode)
            const read = () => r.run(result, [], "at", [-1], ctx, {})
            const earlier = read(), values = [-3, 3]
            bounds[first].resolve(values[first])
            await tick()
            bounds[1 - first].resolve(values[1 - first])
            await tick()
            for (const point of [earlier, read()]) assert.equal(await Promise.race([point, Promise.resolve("held")]), "C")
            tail.resolve(1)
            assert.deepEqual(await r.export(result, [], ctx), ["B", "C"])
        }
    })

    it("keeps duplicate copy and concat occurrences independent through an insertion", async () => {
        for (const copy of [false, true]) for (const position of [0, 1, 2]) {
            const ctx = context(), wrap = value => new r.Chain(value, ctx, r.CHAIN_MODE.Unordered)
            const slot = ["X"], start = Promise.withResolvers()
            const input = wrap(copy ? ["X", "other"] : slot)
            if (copy) r.run(input, [], "copyWithin", [1, 0, 1], ctx, mutation)
            const data = copy ? input : wrap(r.run(input, [], "concat", [slot], ctx, {}))
            const view = wrap(r.run(data, [], "toSpliced", [start.promise, 0, "Y"], ctx, {}))
            const first = r.iterate(view, [], ctx), second = r.iterate(view, [], ctx)
            const early = await first.next()
            assert.equal(early.done, false)
            await first.return()
            const native = ["X", "X"].toSpliced(position, 0, "Y"), steps = []
            for (let i = 0; i < native.length; i++) {
                const item = await second.next()
                assert.equal(item.done, false)
                steps.push([r.lookupPath(item.value, [], ctx), item.index])
            }
            assert.deepEqual(steps.map(([value]) => value).sort(), ["X", "X", "Y"])
            assert.equal((await second.next()).done, true)
            start.resolve(position)
            const ordered = []
            for (const [value, index] of steps) ordered[await index] = value
            assert.deepEqual(ordered, native)
        }
    })

    it("delivers historical append points from their own version when one cut fans out", async () => {
        for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) for (const count of [0, 1]) {
            const ctx = context(), control = Promise.withResolvers(), input = new r.Chain(["A", "B"], ctx, mode)
            r.run(input, [], "splice", [1, control.promise], ctx, mutation)
            const native = ["A", "B"].toSpliced(1, count), values = [], expected = []
            for (let i = 0; i < 128; ++i) {
                native.push(i)
                expected.push(native[i + 1])
                r.run(input, [], "push", [i], ctx, mutation)
                values.push(r.lookupPath(input, [i + 1], ctx))
            }
            assert(values.every(value => r.isPending(value, ctx)))
            control.resolve(count)
            assert.deepEqual(await Promise.all(values), expected)
        }
    })

    it("waits for membership of an old Error when only the first slot survives overwrites", async () => {
        for (const position of [0, 1]) {
            const ctx = context(), start = Promise.withResolvers()
            const cause = r.validationError("old slot", ctx, r.ERROR_KIND.OperationInputFailed)
            const view = new r.Chain([cause, "B"], ctx, r.CHAIN_MODE.Unordered)
            r.run(view, [], "splice", [start.promise, 0, "Y"], ctx, mutation)
            r.assignPath(view, [1], "healthy", ctx)
            r.assignPath(view, [2], "healthy", ctx)
            const error = r.hasError(view, [], ctx)
            await tick()
            assert.equal(await Promise.race([error, Promise.resolve("pending")]), "pending")
            start.resolve(position)
            assert.equal(await error, position === 1)
        }
    })

    it("orders a pending count, a rear read, length and exact repair in each mode", async () => {
        for (const mode of modes) for (const fail of [false, true]) {
            const ctx = context(), count = Promise.withResolvers(), source = new r.Chain(["A", "B", "C"], ctx, mode)
            const cause = r.validationError("delete count", ctx, r.ERROR_KIND.OperationInputFailed)
            const direct = r.run(source, [], "splice", [1, count.promise], ctx, mutation)
            if (!fail) r.run(source, [], "push", ["D"], ctx, mutation)
            const length = r.lookupPath(source, ["length"], ctx)
            const point = fail ? r.lookupPath(source, [1], ctx) : r.run(source, [], "at", [-1], ctx, {})
            assert(r.isPending(length, ctx))
            if (fail || mode === r.CHAIN_MODE.Complete) assert(r.isPending(point, ctx))
            else assert.equal(point, "D")
            if (fail) {
                count.reject(cause)
                assert.equal(await direct, cause)
                assert.equal(await length, mode === r.CHAIN_MODE.Complete ? cause : 3)
                assert.equal(await point, cause)
                await r.repairPath(source, [], ctx)
                if (mode === r.CHAIN_MODE.Complete) assert.deepEqual(await r.export(source, [], ctx), ["A", "B", "C"])
                else {
                    await r.repairPath(source, [1], ctx)
                    assert.equal(r.lookupPath(source, [1], ctx), cause)
                }
            } else {
                count.resolve(1)
                assert.equal(await length, 3)
                assert.equal(await point, "D")
            }
        }
    })

    for (const method of ["sort", "splice"]) it(`checks broad and disjoint effects while ${method} is held and after repair`, async () => {
        for (const broad of [true, false]) for (const receiver of modes) {
            const ctx = context(), control = Promise.withResolvers()
            const source = new r.Chain({ a: [2, 1], tag: 0 }, ctx, r.CHAIN_MODE.Complete)
            const before = r.capturePath(source, ["a"], ctx, receiver)
            const args = method === "sort" ? [control.promise] : [1, control.promise, "insert"]
            const result = r.run(source, ["a"], method, args, ctx, { mutationScopeDepth: broad ? 0 : 1 })
            const read = r.capturePath(source, ["a"], ctx, receiver), cursor = r.iterate(read, [], ctx)
            let bodies = 0
            const step = cursor.next().then(() => { ++bodies }, cause => cause)
            r.assignPath(source, ["a", 0], 9, ctx)
            r.assignPath(source, ["tag"], 7, ctx)
            const tag = r.lookupPath(source, ["tag"], ctx)
            await tick()
            assert.equal(bodies, 0)
            if (broad) assert(r.isPending(tag, ctx))
            else assert.equal(tag, 7)
            assert.deepEqual(r.export(before, [], ctx), [2, 1])
            const cause = r.validationError("count", ctx, r.ERROR_KIND.OperationInputFailed)
            if (method === "sort") control.resolve(42)
            else control.reject(cause)
            const failure = await result
            assert(r.isPoisonError(failure))
            if (method === "splice") assert.equal(failure, cause)
            assert.equal(await step, failure)
            assert.equal(bodies, 0)
            if (broad) assert.equal(await tag, failure)
            await r.repairPath(source, broad ? [] : ["a"], ctx)
            await r.run(source, ["a"], "push", [3], ctx, { mutationScopeDepth: 1 })
            const repaired = await r.export(source, [], ctx)
            sortWitness(broad, repaired)
            assert.deepEqual(repaired, sortTrace(broad))
        }
    })
})
