import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const MAX = 0xffffffff, K = Number.MAX_SAFE_INTEGER
const mutate = { mutationScopeDepth: 0 }

describe("capacity projection of a captured slot", () => {
    it("publishes certain Complete scope failure and permits exact repair before the cause settles", async () => {
        for (const length of [MAX, MAX - 1]) for (const reject of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: "scoped splice" }
            const source = new r.Chain({ a: new Array(length), tag: 0 }, ctx, r.CHAIN_MODE.Complete)
            const start = new OrderedThenable(), invalid = r.validationError("start", ctx, r.ERROR_KIND.OperationInputFailed)
            const result = r.run(source, ["a"], "splice", [start, 0, "X"], ctx, mutate)
            const exact = r.lookupPath(source, [], ctx), causes = r.getErrors(source, [], ctx)
            const shallow = r.isPoisoned(source, [], ctx), deep = r.hasError(source, [], ctx)
            const cursor = r.iterate(source, ["a"], ctx), pull = cursor.next().catch(error => error)
            const owner = r.capturePath(source, [], ctx), child = r.capturePath(source, ["a", 0], ctx)
            r.assignPath(source, ["tag"], 9, ctx)
            const repair = r.repairPath(source, [], ctx), after = r.lookupPath(source, ["tag"], ctx)
            const otherRepair = r.repairPath(owner, [], ctx), otherTag = r.lookupPath(owner, ["tag"], ctx)
            const later = r.assignPath(source, ["tag"], 7, ctx)
            assert(r.isPending(result, ctx))
            assert(r.isPending(exact, ctx))
            assert(r.isPending(causes, ctx))
            if (length === MAX) {
                assert.equal(shallow, true)
                assert.equal(deep, true)
                assert.equal(repair, undefined)
                assert.equal(after, 0)
                assert.equal(otherRepair, undefined)
                assert.equal(otherTag, 0)
                assert.equal(r.lookupPath(source, ["tag"], ctx), 7)
            } else {
                assert(r.isPending(shallow, ctx))
                assert(r.isPending(after, ctx))
            }
            if (reject) start.reject(invalid)
            else start.resolve(0)
            const outcome = await result, step = await pull
            const failed = reject || length === MAX
            assert.equal(await shallow, failed)
            assert.equal(await deep, failed)
            assert.equal(await after, failed ? 0 : 9)
            assert.equal(await otherTag, 0)
            if (failed) {
                if (reject) assert.equal(outcome, invalid)
                else assert.equal(outcome.kind, r.ERROR_KIND.InvalidArrayLength)
                assert.equal(await exact, outcome)
                assert.equal(await causes, outcome)
                assert.equal(step, outcome)
                await r.repairPath(child, [], ctx)
                assert.equal(await r.lookupPath(child, [], ctx), outcome)
            } else assert.equal(r.lookupPath(step.value, [], ctx), "X")
            await Promise.all([repair, otherRepair, later, cursor.return()])
            assert.equal(await r.lookupPath(source, ["tag"], ctx), 7)
        }
    })

    it("wakes previously issued operations when the delete count proves the Complete scope must fail", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "narrowed splice" }
        const source = new r.Chain({ a: new Array(MAX), tag: 0 }, ctx, r.CHAIN_MODE.Complete)
        const start = new OrderedThenable(), count = new OrderedThenable()
        const result = r.run(source, ["a"], "splice", [start, count, "X"], ctx, mutate)
        const child = r.capturePath(source, ["a", 0], ctx)
        const settled = new Map()
        const observe = (name, value) => Promise.resolve(value).then(v => settled.set(name, v))
        observe("shallow", r.isPoisoned(source, [], ctx))
        observe("child", r.hasError(child, [], ctx))
        const exact = r.lookupPath(child, [], ctx)
        r.assignPath(source, ["tag"], 9, ctx)
        observe("repair", r.repairPath(source, [], ctx))
        observe("tag", r.lookupPath(source, ["tag"], ctx))
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(settled.size, 0)
        count.resolve(0)
        await new Promise(resolve => setImmediate(resolve))
        assert.deepEqual(Object.fromEntries(settled), { shallow: true, child: true, repair: undefined, tag: 0 })
        assert(r.isPending(exact, ctx))
        const error = r.validationError("bad start", ctx, r.ERROR_KIND.OperationInputFailed)
        start.reject(error)
        assert.equal(await result, error)
        assert.equal(await exact, error)
    })

    it("releases an inserted match when its cut proves it stays before the virtual tail", async () => {
        for (const grow of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: "insert at capacity" }, wrap = v => new r.Chain(v, ctx)
            const hold = Promise.withResolvers(), cut = Promise.withResolvers(), suffix = wrap([])
            let inside
            const open = r.enter(suffix, [], ctx, { maximumCount: 1, mayPoisonScope: false }, ref => { inside = ref; return hold.promise })
            const base = wrap(r.run(wrap(new Array(MAX - 1)), [], "concat", [r.lookupPath(suffix, [], ctx)], ctx, {}))
            const inserted = wrap(r.run(base, [], "toSpliced", [cut.promise, 0, "X"], ctx, {}))
            const found = r.run(inserted, [], "includes", ["X"], ctx, {})
            assert(r.isPending(found, ctx))
            cut.resolve(0)
            assert.equal(await found, true)
            if (grow) r.run(inside, [], "push", ["tail"], ctx, mutate)
            hold.resolve()
            await open
            assert.equal(await r.lookupPath(inserted, ["length"], ctx), MAX + Number(grow))
            const last = await r.lookupPath(inserted, [MAX], ctx)
            if (grow) assert.equal(last.kind, r.ERROR_KIND.InvalidArrayLength)
            else assert.equal(last, undefined)
        }
    })
    it("applies the selected Array's capacity policy through nested entries and a cross-mode handoff", async () => {
        for (const mode of [r.CHAIN_MODE.Complete, r.CHAIN_MODE.Unordered]) for (const key of [0, MAX])
        for (const over of [false, true]) for (const delayed of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: "concat" }, tail = Promise.withResolvers()
            const edit = { ...ctx, errorContext: "entered edit" }
            const wrap = value => new r.Chain(value, ctx, r.CHAIN_MODE.Unordered)
            const suffix = over ? [2] : []
            const open = wrap(r.run(wrap(["P"]), [], "concat", [new Array(MAX - 1), delayed ? tail.promise : suffix], ctx, {}))
            const owner = r.capturePath(open, [], ctx, mode)
            const entry = r.enter(owner, [key], ctx, true, inner =>
                r.enter(inner, [], ctx, true, ref => r.assignPath(ref, [], 9, edit)))
            const read = r.lookupPath(owner, [key], ctx)
            tail.resolve(suffix)
            await entry
            const value = await read
            if (key === MAX || over && mode === r.CHAIN_MODE.Complete) {
                assert.equal(value.kind, over ? r.ERROR_KIND.InvalidArrayLength : r.ERROR_KIND.PropertyValidation)
                assert.equal(value.errorContext, "entered edit")
            } else assert.equal(value, 9)
            assert.equal(await r.lookupPath(open, [0], ctx), "P")
        }
    })
    for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
        it(`orders uncertain virtual reads, edits and repair in mode ${mode}`, async () => {
            for (const exists of [false, true]) for (const remove of [false, true]) for (const depth of [0, 1]) {
                const ctx = { execution: new r.Execution(), errorContext: "concat" }
                const edit = { ...ctx, errorContext: "edit" }
                const tail = Promise.withResolvers(), wrap = v => new r.Chain(v, ctx, mode)
                const chain = wrap(r.run(wrap(["P"]), [], "concat", [new Array(MAX - 1), tail.promise], ctx, {}))
                const before = r.capturePath(chain, [], ctx)
                const old = r.lookupPath(chain, [MAX], ctx), oldError = r.hasError(chain, [MAX], ctx)
                assert.equal(r.lookupPath(chain, ["0" + MAX], ctx), undefined)
                assert(r.isPending(old, ctx))
                assert(r.isPending(oldError, ctx))
                const result = remove ? r.deletePath(chain, [MAX], edit, depth) : r.assignPath(chain, [MAX], 9, edit, depth)
                const prefix = r.lookupPath(chain, [0], ctx), after = r.lookupPath(chain, [MAX], ctx)
                assert(r.isPending(prefix, ctx))
                r.assignPath(chain, [0], "later", ctx)
                const repair = r.repairPath(chain, [], ctx)
                tail.resolve(exists ? ["tail"] : [])
                assert.equal(result, undefined, "a pending property command acknowledges issuance")
                const failure = await after
                assert.equal(failure.kind, exists ? r.ERROR_KIND.InvalidArrayLength : r.ERROR_KIND.PropertyValidation)
                assert.equal(failure.errorContext, "edit")
                assert.equal(await prefix, exists ? "P" : failure)
                assert.equal(await oldError, exists)
                assert.equal(await old, await r.lookupPath(before, [MAX], ctx))
                if (exists) assert.equal((await old).errorContext, "concat")
                else assert.equal(await old, undefined)
                await repair
                assert.equal(await r.lookupPath(chain, [0], ctx), exists ? "later" : "P")
                assert.equal(await r.lookupPath(chain, [MAX], ctx), exists ? failure : undefined)
            }
        })
    for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
    it(`keeps an earlier marker and reports only newly lost slots in mode ${mode}`, async () => {
        for (const action of ["keep", "replace", "other loss"]) for (const delayed of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: action }, hold = Promise.withResolvers()
            const wrap = value => new r.Chain(value, ctx, mode)
            const marker = r.validationError("earlier", ctx, r.ERROR_KIND.OperationInputFailed), marked = wrap([])
            r.appendMissingOutput(marked, marker, ctx)
            const extra = action === "other loss", last = MAX - (extra ? 2 : 1)
            const parts = [r.lookupPath(marked, [], ctx)]
            if (extra) parts.push([101])
            const source = wrap(r.run(wrap(new Array(last)), [], "concat", parts, ctx, {}))
            const write = ref => action === "replace" ? r.assignPath(ref, [], 9, ctx) : undefined
            const entry = r.enter(source, [last], ctx, true, ref => delayed ? hold.promise.then(() => write(ref)) : write(ref))
            const direct = r.run(source, [], "unshift", extra ? [7, 8] : [7], ctx, mutate)
            const selected = r.lookupPath(source, [MAX], ctx)
            assert.equal(r.hasError(source, [MAX], ctx), true)
            const suffix = wrap(r.run(source, [], "slice", [MAX], ctx, {})), cursor = r.iterate(suffix, [], ctx)
            const terminal = cursor.next().then(() => assert.fail("a virtual slot ran a body"), error => error)
            const search = r.run(source, [], "includes", ["absent", MAX], ctx, {})
            assert.equal(r.lookupPath(source, [0], ctx), 7)
            if (delayed) {
                assert(r.isPending(selected, ctx))
                if (extra) assert.equal(direct.kind, r.ERROR_KIND.InvalidArrayLength)
                else assert(r.isPending(direct, ctx))
            }
            hold.resolve()
            await entry
            const outcome = await direct, slot = await selected
            if (action === "keep") assert.equal(outcome, MAX + 1)
            else assert.equal(outcome.kind, r.ERROR_KIND.InvalidArrayLength)
            assert.equal(slot, action === "replace" ? outcome : marker)
            if (extra) assert.deepEqual(new Set((await search).errors), new Set([marker, outcome]))
            else assert.equal(await search, slot)
            if (extra && mode === r.CHAIN_MODE.Unordered)
                assert.deepEqual(new Set((await terminal).errors), new Set([marker, outcome]))
            else assert.equal(await terminal, slot)
            r.repairPath(suffix, [0], ctx)
            assert.equal(await r.lookupPath(suffix, [0], ctx), slot)
        }
    })

    it("credits repeated virtual slots together before their common predecessor selects the cause", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "repeated selection" }
        const wrap = value => new r.Chain(value, ctx), get = source => r.lookupPath(source, [], ctx)
        const concat = (source, ...parts) => wrap(r.run(source, [], "concat", parts, ctx, {}))
        const hold = Promise.withResolvers(), tail = Promise.withResolvers()
        const [first, last] = ["prefix", "suffix"].map(s => r.validationError(s, ctx, r.ERROR_KIND.OperationInputFailed))
        let prefix = wrap([]), suffix = wrap([])
        r.appendMissingOutput(prefix, first, ctx)
        r.appendMissingOutput(suffix, last, ctx)
        for (let i = 0; i < 32; i++) prefix = concat(prefix, get(prefix))
        prefix = wrap(r.run(prefix, [], "slice", [0, MAX], ctx, {}))
        const entry = r.enter(suffix, [0], ctx, true, () => hold.promise)
        for (let i = 0; i < 10; i++) suffix = concat(suffix, get(suffix))
        const copy = concat(prefix, get(suffix), tail.promise), output = wrap([]), counts = new Map()
        let batches = 0
        const cursor = r.iterate(copy, [], ctx, { onSkip(start, end, cause, count, markers) {
            counts.set(cause, (counts.get(cause) ?? 0) + count)
            assert(++batches <= 64)
            r.appendMissingOutput(output, cause, ctx, markers)
        } })
        const terminal = assert.rejects(cursor.next(), error => {
            assert.deepEqual(new Set(error.errors), new Set([first, last]))
            return true
        })
        assert.equal(counts.get(first), MAX)
        const remaining = [...counts].filter(([cause]) => cause !== first)
        assert.equal(remaining.length, 1)
        const [[cause, count]] = remaining
        assert(r.isPending(cause, ctx))
        assert.equal(count, 1024)
        hold.resolve()
        await entry
        tail.resolve([])
        await terminal
        assert.equal(await cause, last)
        assert.equal(counts.size, 2)
        assert.equal(r.lookupPath(output, ["length"], ctx), MAX + 1024)
        assert.equal(await r.lookupPath(output, [MAX], ctx), last)
    })
})

describe("Complete Array capacity", () => {
    it("rejects a guaranteed oversized successor while an independent suffix is open", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "open capacity" }, tail = Promise.withResolvers()
        const prefix = new Array(MAX)
        prefix[0] = "A"
        const source = new r.Chain(prefix, ctx)
        const joined = r.run(source, [], "concat", [["B", "C"], tail.promise], ctx, {})
        for (const [method, args] of [
            ["with", [0, 9]], ["toReversed", []], ["slice", []], ["reverse", []], ["toSpliced", [0, 0]],
            ["splice", [0, 0]], ["push", []], ["unshift", []], ["pop", []], ["shift", []],
            ["fill", [9, 0, 0]], ["copyWithin", [0, 0, 0]], ["concat", []],
        ]) {
            const receiver = new r.Chain(joined, ctx, r.CHAIN_MODE.Complete)
            assert.equal(r.run(receiver, [], method, args, ctx, {}).kind, r.ERROR_KIND.InvalidArrayLength, method)
            assert.equal(r.lookupPath(receiver, [0], ctx), "A")
        }
        for (const method of ["push", "pop", "reverse"]) {
            const receiver = new r.Chain(joined, ctx, r.CHAIN_MODE.Complete)
            const failure = r.run(receiver, [], method, [], ctx, mutate)
            assert.equal(failure.kind, r.ERROR_KIND.InvalidArrayLength, method)
            assert.equal(r.lookupPath(receiver, [0], ctx), failure)
            r.repairPath(receiver, [], ctx)
            assert.equal(r.lookupPath(receiver, [0], ctx), "A")
        }
        const receiver = new r.Chain(joined, ctx, r.CHAIN_MODE.Complete)
        const holes = r.run(receiver, [], "copyWithin", [2, 3, 4], ctx, mutate)
        assert.equal(holes, r.lookupPath(receiver, [], ctx))
        tail.resolve([])
        assert.equal(await r.lookupPath(receiver, ["length"], ctx), MAX + 2)
    })

    it("releases safe copies and their known endpoints before the final count", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "capacity proof" }
        const held = Promise.withResolvers(), tail = Promise.withResolvers(), source = new r.Chain([10], ctx)
        let inside
        const entry = r.enter(source, [], ctx, { maximumCount: 1, mayPoisonScope: false }, ref => {
            inside = ref
            return held.promise
        })
        const joined = r.run(source, [], "concat", [tail.promise, [40]], ctx, {})
        const complete = new r.Chain(joined, ctx, r.CHAIN_MODE.Complete)
        const end = r.run(new r.Chain(joined, ctx), [], "at", [-1], ctx, {})
        const replaced = r.run(complete, [], "with", [0, 9], ctx, {})
        const reversed = r.run(complete, [], "toReversed", [], ctx, {})
        const appended = r.run(new r.Chain([5], ctx, r.CHAIN_MODE.Complete), [], "concat", [joined], ctx, {})
        for (const result of [end, replaced, reversed, appended]) assert(r.isPending(result, ctx))
        tail.resolve([])
        assert.equal(await end, 40)
        const copies = (await Promise.all([replaced, reversed, appended])).map(value => new r.Chain(value, ctx))
        for (const [i, first] of [9, 40, 5].entries()) {
            assert.equal(await r.lookupPath(copies[i], [0], ctx), first)
            assert(r.isPending(r.lookupPath(copies[i], ["length"], ctx), ctx))
        }
        r.run(inside, [], "push", [30], ctx, mutate)
        held.resolve()
        await entry
        assert.deepEqual(await Promise.all(copies.map(copy => r.export(copy, [], ctx))),
            [[9, 30, 40], [40, 30, 10], [5, 10, 30, 40]])
    })

    it("reports the failed cut when only its streaming fallback would overflow", () => {
        const ctx = { execution: new r.Execution(), errorContext: "cut" }
        const input = new r.Chain(new Array(MAX), ctx, r.CHAIN_MODE.Complete)
        const failed = r.validationError("invalid start", ctx, r.ERROR_KIND.InvalidArrayOperation)
        assert.equal(r.run(input, [], "splice", [failed, 0, "X"], ctx, mutate), failed)
        r.repairPath(input, [], ctx)
        assert.equal(r.lookupPath(input, ["length"], ctx), MAX)
    })
    it("copies an earlier missing contribution as data through concat", () => {
        const ctx = { execution: new r.Execution(), errorContext: "capture" }
        const input = new r.Chain([], ctx, r.CHAIN_MODE.Unordered)
        const failed = r.validationError("missing", ctx, r.ERROR_KIND.OperationInputFailed)
        r.appendMissingOutput(input, failed, ctx)
        const complete = new r.Chain(r.lookupPath(input, [], ctx), ctx, r.CHAIN_MODE.Complete)
        const copy = new r.Chain(r.run(complete, [], "concat", [["end"]], ctx, {}), ctx)
        assert.equal(r.lookupPath(copy, ["length"], ctx), 2)
        assert.equal(r.lookupPath(copy, [0], ctx), failed)
        assert.equal(r.lookupPath(copy, [1], ctx), "end")
    })
})

function fixture(mode = r.CHAIN_MODE.Unordered) {
    const execution = new r.Execution()
    const ctx = { execution, errorContext: "source" }, input = new Array(MAX)
    input[0] = "A"
    input[MAX - 1] = "C"
    const chain = new r.Chain(input, ctx, mode)
    const call = (method, args, location = method, channel = chain) =>
        r.run(channel, [], method, args, { execution, errorContext: location }, mutate)
    return { ctx, chain, call }
}

describe("Array capacity on captured layouts", () => {
    it("selects the natural or clipped endpoint as soon as its count bounds decide", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "capped endpoint" }
        const wrap = value => new r.Chain(value, ctx)
        const concat = (source, ...args) => r.run(source, [], "concat", args, ctx, {})
        const marker = label => {
            const chain = wrap([]), error = r.validationError(label, ctx, r.ERROR_KIND.OperationInputFailed)
            r.appendMissingOutput(chain, error, ctx)
            return { chain, error }
        }
        const body = marker("body"), last = marker("last")
        let repeated = body.chain
        for (let i = 0; i < 53; i++) repeated = wrap(concat(repeated, r.lookupPath(repeated, [], ctx)))
        for (const width of [K - 2, K - 1]) for (const grows of [false, true]) {
            const hold = Promise.withResolvers(), tail = Promise.withResolvers(), prefix = wrap([])
            let inside
            const entry = r.enter(prefix, [], ctx, { maximumCount: 1, mayPoisonScope: false }, ref => {
                inside = ref
                return hold.promise
            })
            const joined = wrap(concat(prefix, tail.promise, r.lookupPath(last.chain, [], ctx)))
            const end = r.run(joined, [], "at", [-1], ctx, {})
            tail.resolve(r.run(repeated, [], "slice", [0, width], ctx, {}))
            if (width === K - 2) assert.equal(await end, last.error)
            else {
                let settled = false
                Promise.resolve(end).then(() => { settled = true })
                await new Promise(resolve => setImmediate(resolve))
                assert.equal(settled, false)
            }
            if (grows) r.run(inside, [], "push", [0], ctx, mutate)
            hold.resolve()
            await entry
            assert.equal(await end, grows && width === K - 1 ? body.error : last.error)
        }
    })

    for (const grow of [false, true]) it(`keeps the cause from the first concat that lost each position, grow=${grow}`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: "context" }, held = Promise.withResolvers()
        const source = new r.Chain([], ctx)
        let inside
        const opened = r.enter(source, [], ctx, { maximumCount: 1, mayPoisonScope: false },
            ref => { inside = ref; return held.promise })
        const inner = new r.Chain(r.run(source, [], "concat", [new Array(MAX), 1, 2], { ...ctx, errorContext: "inner" }, {}), ctx)
        const outer = new r.Chain(r.run(new r.Chain(["prefix"], ctx), [], "concat",
            [r.lookupPath(inner, [], ctx)], { ...ctx, errorContext: "outer" }, {}), ctx)
        const search = r.run(outer, [], "includes", ["absent", MAX], ctx, {})
        if (grow) r.run(inside, [], "push", ["first"], ctx, mutate)
        held.resolve()
        await opened
        const first = await r.lookupPath(outer, [MAX], ctx), second = await r.lookupPath(outer, [MAX + 1], ctx)
        assert.equal(first.errorContext, "outer")
        assert.equal(second.errorContext, "inner")
        assert.deepEqual(new Set((await search).errors), new Set([first, second]))
    })

    it("credits a saturated structural run behind an open prefix without enumerating virtual slots", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "open prefix" }
        const cause = r.validationError("missing", ctx, r.ERROR_KIND.OperationInputFailed)
        let missing = new r.Chain([], ctx)
        r.appendMissingOutput(missing, cause, ctx)
        for (let i = 0; i < 53; i++)
            missing = new r.Chain(r.run(missing, [], "concat", [r.lookupPath(missing, [], ctx)], ctx, {}), ctx)
        const optional = new r.Chain([], ctx), hold = Promise.withResolvers()
        const opened = r.enter(optional, [], ctx, { maximumCount: 1, mayPoisonScope: false }, () => hold.promise)
        const joined = new r.Chain(r.run(optional, [], "concat", [r.lookupPath(missing, [], ctx)], ctx, {}), ctx)
        const array = new r.Chain(r.run(joined, [], "concat", [], ctx, {}), ctx)
        let count = 0, batches = 0, windowEnd = 2
        const cursor = r.iterate(array, [], ctx, { windowEnd, onSkip(first, end, failure, n) {
            assert.equal(failure, cause)
            count += n
            assert(++batches <= 3)
            windowEnd = Math.min(K, windowEnd + n)
            cursor.setWindow(0, windowEnd)
        } })
        const terminal = assert.rejects(cursor.next(), error => error === cause)
        assert.equal(count, K - 1)
        const search = r.run(array, [], "includes", ["absent", MAX], ctx, {})
        hold.resolve()
        await opened
        await terminal
        assert.equal(count, K)
        assert.equal(await search, cause)
    })
    it("credits a definite virtual marker beyond a still-ambiguous healthy candidate", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "crossing native capacity" }
        const cause = r.validationError("missing", ctx, r.ERROR_KIND.OperationInputFailed)
        let missing = new r.Chain([], ctx)
        r.appendMissingOutput(missing, cause, ctx)
        for (let i = 0; i < 32; i++)
            missing = new r.Chain(r.run(missing, [], "concat", [r.lookupPath(missing, [], ctx)], ctx, {}), ctx)
        const prefix = new r.Chain(r.run(missing, [], "slice", [0, MAX - 1], ctx, {}), ctx)
        const hold = Promise.withResolvers()
        const opened = r.enter(prefix, [], ctx, { maximumCount: 1, mayPoisonScope: false }, () => hold.promise)
        const suffix = new r.Chain(["maybe"], ctx)
        r.appendMissingOutput(suffix, cause, ctx)
        const array = new r.Chain(r.run(prefix, [], "concat", [r.lookupPath(suffix, [], ctx)], ctx, {}), ctx)
        let count = 0
        const cursor = r.iterate(array, [], ctx, { onSkip(first, end, failure, n) { assert.equal(failure, cause); count += n } })
        const item = cursor.next()
        assert.equal(count, MAX)
        hold.resolve()
        await opened
        assert.equal(r.lookupPath((await item).value, [], ctx), "maybe")
        await assert.rejects(cursor.next(), error => error === cause)
    })
    for (const safe of [true, false]) for (const extendsPrefix of [false, true])
        it(`searches a sparse concat at the native capacity boundary, safe=${safe}, extend=${extendsPrefix}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "candidate at capacity" }
            const prefix = new r.Chain([], ctx), open = Promise.withResolvers()
            let inside
            const issued = r.enter(prefix, [], ctx, { maximumCount: 1, mayPoisonScope: false },
                ref => { inside = ref; return open.promise })
            const holes = new Array(MAX - (safe ? 2 : 1))
            const array = new r.Chain(r.run(prefix, [], "concat", [holes, ["B"]], ctx, {}), ctx)
            const hit = r.run(array, [], "includes", ["B"], ctx, {})
            if (safe) assert.equal(hit, true)
            else assert(r.isPending(hit, ctx))
            if (extendsPrefix) r.run(inside, [], "push", ["A"], ctx, mutate)
            open.resolve()
            await issued
            const result = await hit
            if (safe || !extendsPrefix) assert.equal(result, true)
            else assert.equal(result.kind, r.ERROR_KIND.InvalidArrayLength)
        })
    it("keeps every repeated child's parent and counter projection through a point write", () => {
        const ctx = { execution: new r.Execution(), errorContext: "repeated child" }, child = { n: 1 }
        child.self = child
        const array = new r.Chain(new Array(80), ctx), retained = new r.Chain(child, ctx)
        r.run(array, [], "fill", [child], ctx, mutate)
        assert.equal(r.hasError(array, [], ctx), false)
        verifyRefCounts(ctx, array._state, retained._state)
        r.assignPath(array, [40, "n"], 2, ctx)
        verifyRefCounts(ctx, array._state, retained._state)
        assert.equal(r.lookupPath(array, [39, "n"], ctx), 1)
        assert.equal(r.lookupPath(array, [40, "n"], ctx), 2)
        assert.equal(r.lookupPath(retained, ["n"], ctx), 1)
    })
    it("exports the selected fill groups after every use of an unrelated pending group is overwritten", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "masked ranges" }
        const a = Promise.withResolvers(), b = Promise.withResolvers(), source = new r.Chain(new Array(160), ctx)
        r.run(source, [], "fill", [a.promise, 0, 80], ctx, mutate)
        r.run(source, [], "fill", [b.promise, 80], ctx, mutate)
        const saved = r.capturePath(source, [], ctx)
        for (let i = 80; i < 160; i++) r.assignPath(source, [i], i, ctx)
        const exported = r.export(source, [], ctx)
        a.resolve("A")
        assert.deepEqual(await exported, Array.from({ length: 160 }, (_, i) => i < 80 ? "A" : i))
        assert(r.isPending(r.lookupPath(saved, [100], ctx), ctx))
        b.resolve("B")
        assert.equal(await r.lookupPath(saved, [100], ctx), "B")
    })
    for (const mode of Object.values(r.CHAIN_MODE)) for (const failed of [false, true])
        it(`shares a pending fill across the full native range, mode=${mode}, failed=${failed}`, async () => {
            const { chain, ctx, call } = fixture(mode), input = Promise.withResolvers()
            const result = call("fill", [input.promise])
            assert(!r.isPending(result, ctx))
            const earlier = r.capturePath(chain, [], ctx), errors = r.getErrors(chain, [], ctx)
            const point = r.lookupPath(chain, [MAX - 2], ctx)
            r.assignPath(chain, [1], 7, ctx)
            const slice = new r.Chain(r.run(chain, [], "slice", [0, 3], ctx, {}), ctx)
            assert.equal(r.lookupPath(chain, [1], ctx), 7)
            const value = failed ? r.validationError("payload", ctx, r.ERROR_KIND.OperationInputFailed) : { n: 3 }
            input.resolve(value)
            assert.equal(await point, value)
            assert.equal(await r.lookupPath(earlier, [1], ctx), value)
            assert.equal(await errors, failed ? value : null)
            const output = await r.export(slice, [], ctx)
            if (failed) assert.equal(output, value)
            else {
                assert.deepEqual(output, [{ n: 3 }, 7, { n: 3 }])
                assert.equal(output[0], output[2])
                r.assignPath(chain, [2, "n"], 9, ctx)
                assert.equal(r.lookupPath(chain, [MAX - 2, "n"], ctx), 3)
                assert.equal(r.lookupPath(earlier, [2, "n"], ctx), 3)
            }
        })
    for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) {
        it(`preserves each overflow cause through reverse, shift, pop and repair in mode ${mode}`, () => {
            const { ctx, chain, call } = fixture(mode)
            const first = call("push", ["D"], "first"), second = call("push", ["F"], "second")
            assert.equal(first.kind, r.ERROR_KIND.InvalidArrayLength)
            assert.equal(second.errorContext, "second")
            const before = new r.Chain(r.lookupPath(chain, [], ctx), ctx, mode)
            assert.equal(r.isPoisoned(chain, [], ctx), false)
            assert.equal(r.run(chain, [], "at", [-1], ctx, {}), second)
            const report = r.getErrors(chain, [], { ...ctx, errorContext: "whole" })
            assert.equal(report.kind, r.ERROR_KIND.InvalidArrayLength)
            assert.equal(report.errorContext, "whole")
            const tail = new r.Chain(r.run(chain, [], "slice", [MAX], ctx, {}), ctx, mode)
            assert.deepEqual(new Set(r.getErrors(tail, [], ctx).errors), new Set([first, second]))
            const lost = call("reverse", [], "reverse")
            assert.equal(lost.errorContext, "reverse")
            assert.equal(r.lookupPath(chain, [0], ctx), second)
            assert.equal(r.lookupPath(chain, [1], ctx), first)
            assert.equal(r.lookupPath(chain, [2], ctx), "C")
            assert.equal(r.lookupPath(chain, [MAX + 1], ctx), lost)
            assert.equal(call("shift", []), second)
            assert.equal(call("pop", []), lost)
            assert.equal(r.lookupPath(chain, ["length"], ctx), MAX)
            assert.equal(r.lookupPath(chain, [0], ctx), first)
            r.repairPath(chain, [0], ctx)
            assert.equal(r.lookupPath(chain, [0], ctx), first)
            assert.equal(r.lookupPath(before, [0], ctx), "A")
            assert.equal(r.lookupPath(before, [MAX], ctx), first)
            assert.equal(r.lookupPath(before, [MAX + 1], ctx), second)
        })
        it(`checks complete-mode receiver and removed-result capacity independently after handoff from ${mode}`, () => {
            const { ctx, chain, call } = fixture(mode)
            call("push", ["D"])
            const second = call("push", ["F"], "F")
            const complete = new r.Chain(r.lookupPath(chain, [], ctx), ctx, r.CHAIN_MODE.Complete)
            const failed = call("pop", [], "over", complete)
            assert.equal(failed.errorContext, "over")
            assert.equal(r.isPoisoned(complete, [], ctx), true)
            r.repairPath(complete, [], ctx)
            assert.equal(r.lookupPath(complete, ["length"], ctx), MAX + 2)
            const removed = call("splice", [0, MAX + 1], "removed", complete)
            assert.equal(removed.kind, r.ERROR_KIND.InvalidArrayLength)
            assert.equal(removed.errorContext, "removed")
            assert.equal(r.isPoisoned(complete, [], ctx), false)
            assert.equal(r.lookupPath(complete, ["length"], ctx), 1)
            assert.equal(r.lookupPath(complete, [0], ctx), second)
        })
        it(`replaces only a selected virtual cause and truncates it without visiting the tail in mode ${mode}`, () => {
            const { ctx, chain, call } = fixture(mode)
            const first = call("push", ["D"]), second = call("push", ["F"], "second")
            const before = new r.Chain(r.lookupPath(chain, [], ctx), ctx, mode)
            const deleting = { ...ctx, errorContext: "virtual delete" }, writing = { ...ctx, errorContext: "virtual write" }
            r.deletePath(chain, [MAX], deleting)
            r.assignPath(chain, [MAX + 1], "replacement", writing, 0)
            assert.equal(r.lookupPath(chain, [MAX], ctx).errorContext, deleting.errorContext)
            assert.equal(r.lookupPath(chain, [MAX + 1], ctx).errorContext, writing.errorContext)
            assert.equal(r.lookupPath(before, [MAX], ctx), first)
            assert.equal(r.lookupPath(before, [MAX + 1], ctx), second)
            const complete = new r.Chain(r.lookupPath(before, [], ctx), ctx, r.CHAIN_MODE.Complete)
            r.deletePath(complete, [1], ctx, 0)
            assert.equal(r.isPoisoned(complete, [], ctx), false)
            r.deletePath(complete, [0], ctx, 0)
            assert.equal(r.isPoisoned(complete, [], ctx), true)
            r.repairPath(complete, [], ctx)
            assert.equal(r.lookupPath(complete, [0], ctx), "A")
            r.assignPath(chain, ["length"], 2, ctx)
            assert.deepEqual(r.export(chain, [], ctx), ["A", ,])
        })
    }

    it("shares alternating structural causes through count saturation and exact end-relative selection", async () => {
        const { ctx, chain, call } = fixture()
        const e = call("push", ["x"], "x"), f = call("push", ["y"], "y")
        let sequence = new r.Chain(r.run(chain, [], "slice", [MAX], ctx, {}), ctx, r.CHAIN_MODE.Unordered)
        for (let n = 0; n < 53; n++) {
            const prior = r.lookupPath(sequence, [], ctx)
            sequence = new r.Chain(r.run(sequence, [], "concat", [prior], ctx, {}), ctx, r.CHAIN_MODE.Unordered)
        }
        assert.equal(r.lookupPath(sequence, ["length"], ctx), K)
        assert.equal(r.run(sequence, [], "at", [-1], ctx, {}), e)
        assert.equal(r.run(sequence, [], "at", [-2], ctx, {}), f)
        for (const report of [r.export(sequence, [], ctx), r.run(sequence, [], "join", [""], ctx, {})]) {
            assert.equal(report.kind, r.ERROR_KIND.InvalidArrayLength)
            assert.equal(report.errorContext, ctx.errorContext)
            assert.equal(report.errors, undefined)
        }
        assert.deepEqual(new Set(r.run(sequence, [], "toSorted", [], ctx, {}).errors), new Set([e, f]))
        assert.deepEqual(new Set(r.run(sequence, [], "includes", ["absent"], ctx, {}).errors), new Set([e, f]))
        assert.equal(r.run(sequence, [], "indexOf", ["absent", 1], ctx, {}), f)
        assert.equal(r.run(sequence, [], "lastIndexOf", ["absent", -1], ctx, {}), e)
        const threshold = Promise.withResolvers()
        const limited = r.run(sequence, [], "includes", ["absent", threshold.promise], ctx, {})
        threshold.resolve(K - 1)
        assert.equal(await limited, e)
        const skips = [], output = new r.Chain([], ctx)
        const cursor = r.iterate(sequence, [], ctx, { windowEnd: 1,
            onSkip(first, end, failure, count, markers) {
                skips.push([first, end, count, new Set(failure.errors)])
                assert.equal(r.appendMissingOutput(output, failure, ctx, markers), K)
                cursor.setWindow(end, end)
            } })
        await assert.rejects(cursor.next(), failure => failure.errors.length === 2)
        assert.deepEqual(skips, [[0, K, K, new Set([e, f])]])
        assert.equal(r.lookupPath(output, [0], ctx), e)
        assert.equal(r.lookupPath(output, [1], ctx), f)
        assert.equal(r.run(output, [], "at", [-2], ctx, {}), f)
        assert.equal(r.lookupPath(output, [K - 1], ctx), e)
        const original = new r.Chain([r.lookupPath(output, [], ctx)], ctx)
        assert.equal(r.appendMissingOutput(output, f, ctx).kind, r.ERROR_KIND.InvalidArrayLength)
        assert.equal(r.run(original, [], "includes", [r.lookupPath(output, [], ctx)], ctx, {}), true)
        for (const takesLastSlot of [false, true]) {
            const target = new r.Chain(r.run(sequence, [], "slice", [1], ctx, {}), ctx)
            const hold = Promise.withResolvers()
            let inside
            const entry = r.enter(target, [], ctx, { maximumCount: 1, mayPoisonScope: false },
                ref => { inside = ref; return hold.promise })
            const prior = new r.Chain([r.lookupPath(target, [], ctx)], ctx)
            const attempted = call("push", ["later"], "last position", target)
            assert.equal(attempted.kind, r.ERROR_KIND.InvalidArrayLength)
            const same = r.run(prior, [], "includes", [r.lookupPath(target, [], ctx)], ctx, {})
            assert(r.isPending(same, ctx))
            if (takesLastSlot) assert.equal(r.appendMissingOutput(inside, e, ctx), K)
            hold.resolve()
            await entry
            assert.equal(await same, takesLastSlot)
        }
        const copy = new r.Chain(r.lookupPath(sequence, [], ctx), ctx, r.CHAIN_MODE.Unordered)
        call("copyWithin", [4, K - 2, K - 1], "copy", copy)
        assert.equal(r.lookupPath(copy, [4], ctx), f)
        const replace = call("splice", [K - 2, 2, "x", "y"], "replace", copy)
        assert.equal(replace.errorContext, "replace")
        assert.equal(r.lookupPath(copy, ["length"], ctx), K)
        const atCap = call("push", ["beyond"], "clipped", sequence)
        assert.equal(atCap.errorContext, "clipped")
        assert.equal(r.run(sequence, [], "at", [-1], ctx, {}), e)
        assert.equal(call("pop", [], "pop", sequence), e)
        assert.equal(r.lookupPath(sequence, ["length"], ctx), K - 1)
        assert.equal(r.run(sequence, [], "at", [-1], ctx, {}), f)
    })
})
