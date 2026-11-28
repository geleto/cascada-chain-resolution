import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { captureOrder } from "../src/array-sequence.js"
import { ready, rejected } from "./ordered-thenable.js"

const context = () => ({ execution: new r.Execution(), errorContext: "open append" })
const access = { mayPoisonScope: false, maximumCount: 2 }
const push = (chain, value, ctx) => r.run(chain, [], "push", [value], ctx, { mutationScopeDepth: 0 })

describe("ordered open append contributions", () => {
    for (const mode of Object.values(r.CHAIN_MODE)) it(`keeps a later push after shifting an empty open entry in mode ${mode}`, async () => {
        const ctx = context(), close = Promise.withResolvers(), chain = new r.Chain([], ctx, mode)
        const entry = r.enter(chain, [], ctx, access, () => close.promise)
        const removed = r.run(chain, [], "shift", [], ctx, { mutationScopeDepth: 0 })
        const length = push(chain, 1, ctx)
        close.resolve()
        await entry
        assert.equal(await removed, undefined)
        assert.equal(await length, 1)
        assert.deepEqual(await r.export(chain, [], ctx), [1])
    })

    for (const method of ["assign", "delete", "slice", "with", "toSpliced", "fill", "reverse"]) {
        it(`discovers a surviving middle occurrence after ${method} with both ends open`, async () => {
            const ctx = context(), wrap = v => new r.Chain(v, ctx, r.CHAIN_MODE.Unordered)
            const call = (a, name, args) => r.run(a, [], name, args, ctx, {})
            const before = wrap([]), after = wrap([]), left = Promise.withResolvers(), right = Promise.withResolvers()
            const bound = { ...access, maximumCount: 1 }
            let prefix
            const entries = [r.enter(before, [], ctx, bound, inner => { prefix = inner; return left.promise }),
                r.enter(after, [], ctx, bound, () => right.promise)]
            const source = wrap(call(before, "concat", [["B", "C"], r.lookupPath(after, [], ctx)]))
            const args = { slice: [1, 3], with: [0, "W"], toSpliced: [0, 1, "W"], fill: ["W", 0, 1], reverse: [] }
            if (method === "assign") r.assignPath(source, [0], "W", ctx)
            else if (method === "delete") r.deletePath(source, [0], ctx)
            const output = args[method] ? wrap(call(source, method, args[method])) : source
            const cursor = r.iterate(output, [], ctx, { windowEnd: 4, metadata: ["index0", "last", "revindex0"] })
            const steps = []
            const drain = (async () => {
                for (;;) {
                    const step = await cursor.next()
                    if (step.done) return
                    steps.push({ value: r.lookupPath(step.value, [], ctx), fields: step.metadata })
                }
            })()
            try {
                assert.equal(call(output, "includes", ["C"]), true)
                await new Promise(setImmediate)
                assert.equal(steps.filter(s => s.value === "C").length, 1)
                if (method !== "slice") assert(r.isPending(steps.find(s => s.value === "C").fields.index0, ctx))
                // A later assignment changes only the successor. The search
                // bound, cursor metadata and remaining items use their capture.
                r.assignPath(output, [0], "later", ctx)
                push(prefix, "A", ctx)
            } finally { right.resolve(); left.resolve(); await Promise.all(entries) }
            await drain
            const expected = method === "slice" ? ["B", "C"] : method === "reverse" ? ["C", "B", "A"] :
                [method === "delete" ? undefined : "W", "B", "C"]
            const actual = []
            for (const { value, fields } of steps) {
                const at = await fields.index0
                actual[at] = value
                assert.equal(await fields.revindex0, expected.length - 1 - at)
                assert.equal(await fields.last, at === expected.length - 1)
            }
            assert.equal(steps.length, expected.length)
            assert.deepEqual(actual, expected)
        })
    }

    for (const add of [false, true]) it(`waits only for occurrences a growing point write can replace, add=${add}`, async () => {
        const ctx = context(), wrap = v => new r.Chain(v, ctx, r.CHAIN_MODE.Unordered), hold = Promise.withResolvers()
        let inner
        const prefix = wrap([]), entry = r.enter(prefix, [], ctx, { ...access, maximumCount: 1 },
            ref => { inner = ref; return hold.promise })
        const output = wrap(r.run(prefix, [], "concat", [["B", "C", "D"]], ctx, {}))
        r.assignPath(output, [3], "W", ctx)
        const has = (v, start) => r.run(output, [], "includes", [v, start], ctx, {})
        const maybe = has("D", 1), after = has("C", 2)
        assert.equal(has("C", 1), true)
        assert.equal(has("W", 3), true)
        assert(r.isPending(maybe, ctx))
        assert(r.isPending(after, ctx))
        if (add) push(inner, "A", ctx)
        hold.resolve()
        await entry
        assert.equal(await maybe, !add)
        assert.equal(await after, add)
        assert.deepEqual(await r.export(output, [], ctx), add ? ["A", "B", "C", "W"] : ["B", "C", "D", "W"])
    })

    it("finds a surviving item and its Error before an unbounded tail reveals its width", async () => {
        const ctx = context(), wrap = v => new r.Chain(v, ctx, r.CHAIN_MODE.Unordered)
        const call = (a, method, args) => r.run(a, [], method, args, ctx, {})
        const left = Promise.withResolvers(), tail = Promise.withResolvers(), prefix = wrap([])
        const entry = r.enter(prefix, [], ctx, { ...access, maximumCount: 1 }, () => left.promise)
        const error = r.validationError("payload", ctx, r.ERROR_KIND.OperationInputFailed)
        const source = wrap(call(prefix, "concat", [["B", "C", error], tail.promise]))
        const output = wrap(call(source, "slice", [1]))
        try {
            assert.equal(call(output, "includes", ["C"]), true)
            assert.equal(r.hasError(output, [], ctx), true)
            const cursor = r.iterate(output, [], ctx, { windowEnd: 3 })
            const step = await Promise.race([cursor.next(), new Promise(setImmediate)])
            assert(step && !step.done)
            assert.equal(r.lookupPath(step.value, [], ctx), "C")
            await cursor.return()
        } finally { left.resolve(); tail.resolve([]); await entry }
    })

    it("finds holes beyond the old maximum at their fixed coordinates", async () => {
        const ctx = context(), wrap = v => new r.Chain(v, ctx, r.CHAIN_MODE.Unordered)
        const prefix = wrap([]), hold = Promise.withResolvers()
        const entry = r.enter(prefix, [], ctx, { ...access, maximumCount: 1 }, () => hold.promise)
        const output = wrap(r.run(prefix, [], "concat", [["B", "C"]], ctx, {}))
        r.assignPath(output, [4], "W", ctx)
        try { assert.equal(r.run(output, [], "includes", [undefined, 3], ctx, {}), true) }
        finally { hold.resolve(); await entry }
        const native = await r.export(output, [], ctx)
        assert.equal(native.length, 5)
        assert.equal(3 in native, false)
        assert.equal(native[4], "W")
    })

    for (const present of [false, true]) it(`waits for an Error that can move behind an override, present=${present}`, async () => {
        const ctx = context(), wrap = v => new r.Chain(v, ctx, r.CHAIN_MODE.Unordered), prefix = wrap([])
        const hold = Promise.withResolvers(), cause = r.validationError("B", ctx, r.ERROR_KIND.OperationInputFailed)
        let inner
        const entry = r.enter(prefix, [], ctx, { ...access, maximumCount: 1 }, ref => { inner = ref; return hold.promise })
        const output = wrap(r.run(prefix, [], "concat", [[cause]], ctx, {}))
        r.assignPath(output, [1], "W", ctx)
        const error = r.hasError(output, [], ctx)
        assert(r.isPending(error, ctx))
        if (present) push(inner, "A", ctx)
        hold.resolve()
        await entry
        assert.equal(await error, !present)
    })

    for (const closeFirst of [false, true]) it(`keeps future appends in an open cursor and search, closeFirst=${closeFirst}`, async () => {
        const ctx = context(), wrap = v => new r.Chain(v, ctx, r.CHAIN_MODE.Unordered)
        const first = wrap([]), a = Promise.withResolvers(), b = Promise.withResolvers()
        const limit = { ...access, maximumCount: 1 }
        const earlier = r.enter(first, [], ctx, limit, () => a.promise)
        const source = wrap(r.run(first, [], "concat", [["B", "C"]], ctx, {}))
        let inner
        const outer = r.enter(source, [], ctx, limit, ref => { inner = ref; return b.promise })
        const cursor = r.iterate(source, [], ctx, { windowEnd: 4, metadata: ["last"] })
        const order = captureOrder(r.lookupPath(source, [], ctx), ctx)
        for (let i = 0; i < 32; i++) assert.equal(r.run(source, [], "includes", ["B"], ctx, {}), true)
        assert(order.pending.size <= 1, "finished matches share the issuer's remaining contribution")
        const search = r.run(source, [], "includes", ["X"], ctx, {})
        assert.equal(r.lookupPath((await cursor.next()).value, [], ctx), "B")
        const c = await cursor.next()
        assert.equal(r.lookupPath(c.value, [], ctx), "C")
        let answered = false
        Promise.resolve(search).then(() => { answered = true })
        const next = cursor.next()
        if (closeFirst) { a.resolve(); await earlier }
        await new Promise(setImmediate)
        assert.equal(answered, false)
        assert(r.isPending(c.metadata.last, ctx))
        push(inner, "X", ctx)
        const x = await Promise.race([next, new Promise(setImmediate)])
        assert(x && !x.done)
        assert.equal(r.lookupPath(x.value, [], ctx), "X")
        assert.equal(await search, true)
        assert.equal(await c.metadata.last, false)
        assert.equal(await x.metadata.last, true)
        a.resolve(); b.resolve()
        await Promise.all([earlier, outer])
        assert((await cursor.next()).done)
        assert.deepEqual(await r.export(source, [], ctx), ["B", "C", "X"])
    })

    for (const mode of Object.values(r.CHAIN_MODE))
        it(`publishes full contents while the push-only entry stays open in mode ${mode}`, async () => {
            const ctx = context(), source = new r.Chain([], ctx, mode), hold = Promise.withResolvers()
            let inner
            const entry = r.enter(source, [], ctx, { ...access, maximumCount: 1 }, ref => { inner = ref; return hold.promise })
            const before = r.export(source, [], ctx)
            assert.equal(push(inner, 7, ctx), 1)
            const reads = Promise.all([before, r.export(source, [], ctx), r.hasError(source, [], ctx)])
            try {
                assert.deepEqual(await Promise.race([reads, new Promise(setImmediate)]), [[7], [7], false])
                assert.equal(r.lookupPath(inner, [0], ctx), 7)
            } finally { hold.resolve(); await entry }
            assert.deepEqual(await r.export(source, [], ctx), [7])
        })

    for (const unbounded of [false, true])
        it(`reads points and bounded slices through tall concat histories, unbounded=${unbounded}`, async function () {
            this.timeout(20000)
            const ctx = context(), wrap = value => new r.Chain(value, ctx)
            const concat = (owner, arg) => wrap(r.run(owner, [], "concat", [arg], ctx, {}))
            const hold = Promise.withResolvers(), prefix = wrap([])
            const entry = r.enter(prefix, [], ctx, { ...access, maximumCount: 1 }, () => hold.promise)
            const tail = Promise.withResolvers(), suffix = unbounded ? concat(wrap([]), tail.promise) : prefix
            let result = concat(prefix, "X")
            for (let i = 0; i < 6500; i++) result = concat(result, r.lookupPath(suffix, [], ctx))
            const first = r.run(result, [], "at", [0], ctx, {})
            const head = wrap(r.run(result, [], "slice", [0, 1], ctx, {}))
            hold.resolve(); tail.resolve([])
            await entry
            assert.equal(await first, "X")
            assert.deepEqual(await r.export(head, [], ctx), ["X"])
        })

    for (const hasItem of [false, true]) it(`bounds discovery of a repeated open contribution, item=${hasItem}`, async () => {
        const ctx = context(), source = new r.Chain([], ctx), hold = Promise.withResolvers()
        const opened = r.enter(source, [], ctx, { ...access, maximumCount: 1 }, () => hold.promise)
        const shared = captureOrder(r.lookupPath(source, [], ctx), ctx)
        let result = hasItem ? new r.Chain(r.run(source, [], "concat", ["B"], ctx, {}), ctx) : source
        for (let i = 0; i < 12; i++)
            result = new r.Chain(r.run(result, [], "concat", [r.lookupPath(result, [], ctx)], ctx, {}), ctx)
        const readers = () => (shared.widths.waiting?.size ?? 0) +
            (shared.widths.questions?.runs.reduce((n, run) => n + (run?.live ?? 0), 0) ?? 0)
        const before = readers()
        const cursor = r.iterate(result, [], ctx, { windowEnd: 2 }), pull = cursor.next()
        assert(readers() - before <= 24, "demand expands only the paths it can use")
        if (hasItem) {
            assert.equal(r.run(result, [], "includes", ["B"], ctx, {}), true)
            const step = await pull
            assert.equal(r.lookupPath(step.value, [], ctx), "B")
            assert(r.isPending(step.index, ctx))
            await cursor.return()
        }
        hold.resolve()
        await opened
        if (hasItem) assert.equal(await (await pull).index, 0)
        else assert((await pull).done)
        assert.equal(await r.lookupPath(result, ["length"], ctx), hasItem ? 4096 : 0)
    })

    it("discovers a guaranteed item before an unrelated unbounded concat tail", async () => {
        const ctx = context(), before = new r.Chain([], ctx), first = Promise.withResolvers(), tail = Promise.withResolvers()
        const opened = r.enter(before, [], ctx, { ...access, maximumCount: 1 }, () => first.promise)
        const partial = new r.Chain(r.run(before, [], "concat", [["B"], tail.promise], ctx, {}), ctx)
        const joined = new r.Chain(r.run(partial, [], "concat", ["later"], ctx, {}), ctx)
        assert.equal(r.run(joined, [], "includes", ["B"], ctx, {}), true)
        const cursor = r.iterate(joined, [], ctx, { windowEnd: 2, metadata: ["index0", "revindex0"] })
        const step = await cursor.next()
        assert.equal(r.lookupPath(step.value, [], ctx), "B")
        assert(r.isPending(step.index, ctx))
        assert(r.isPending(step.metadata.revindex0, ctx))
        await cursor.return()
        first.resolve()
        await opened
        assert.equal(await step.index, 0)
        tail.resolve(["C"])
        assert.equal(await step.metadata.revindex0, 2)
    })
    it("settles Boolean endpoints independently of unknown prefix and suffix widths", async () => {
        const ctx = context(), before = new r.Chain([], ctx), after = new r.Chain([], ctx)
        const first = Promise.withResolvers(), last = Promise.withResolvers()
        let earlier
        const openBefore = r.enter(before, [], ctx, access, ref => { earlier = ref; return first.promise })
        const openAfter = r.enter(after, [], ctx, access, () => last.promise)
        const combined = new r.Chain(r.run(before, [], "concat", [["B"], r.lookupPath(after, [], ctx), ["D"]], ctx, {}), ctx)
        const cursor = r.iterate(combined, [], ctx, { metadata: ["first", "last", "index0", "revindex0"] })
        const step = await cursor.next()
        assert.equal(r.lookupPath(step.value, [], ctx), "B")
        assert.equal(step.metadata.last, false)
        assert(r.isPending(step.metadata.revindex0, ctx))
        assert(r.isPending(step.metadata.first, ctx))
        await cursor.return()
        push(earlier, "A", ctx)
        assert.equal(await step.metadata.first, false)
        assert(r.isPending(step.metadata.index0, ctx))
        first.resolve()
        last.resolve()
        await Promise.all([openBefore, openAfter])
        assert.equal(await step.metadata.index0, 1)
        assert.equal(await step.metadata.revindex0, 1)
    })
    it("exposes a complete-mode prefix only when every permitted append fits", async () => {
        for (const maximumCount of [1, undefined]) {
            const ctx = context(), chain = new r.Chain(["A"], ctx, r.CHAIN_MODE.Complete), hold = Promise.withResolvers()
            let inside
            const entry = r.enter(chain, [], ctx, { ...access, maximumCount }, ref => { inside = ref; return hold.promise })
            const first = r.lookupPath(chain, [0], ctx)
            if (maximumCount === 1) assert.equal(first, "A")
            else assert(r.isPending(first, ctx))
            assert.equal(push(inside, "B", ctx), 2)
            hold.resolve()
            await entry
            assert.equal(await first, "A")
            assert.deepEqual(await r.export(chain, [], ctx), ["A", "B"])
        }
    })
    for (const missing of [false, true])
        it(`admits a bounded later contribution before an optional earlier one ends (${missing})`, async () => {
            const ctx = context(), source = new r.Chain([], ctx, r.CHAIN_MODE.Unordered), hold = Promise.withResolvers()
            let inner
            const opened = r.enter(source, [], ctx, { ...access, maximumCount: 1 }, ref => { inner = ref; return hold.promise })
            const result = push(source, "B", ctx)
            const metadata = ["index", "index0", "first", "length", "last", "revindex", "revindex0"]
            const cursor = r.iterate(source, [], ctx, { windowEnd: 2, metadata })
            const item = await cursor.next()
            assert.equal(r.lookupPath(item.value, [], ctx), "B")
            assert(r.isPending(item.index, ctx))
            assert.equal(item.metadata.last, true)
            assert.equal(item.metadata.revindex, 1)
            assert.equal(item.metadata.revindex0, 0)
            assert(r.isPending(item.metadata.first, ctx))
            assert.equal(r.run(source, [], "includes", ["B"], ctx, {}), true)
            const cause = r.validationError("missing", ctx, r.ERROR_KIND.OperationInputFailed)
            if (missing) r.appendMissingOutput(inner, cause, ctx)
            hold.resolve()
            await opened
            assert.equal(await item.index, missing ? 1 : 0)
            assert.equal(await item.metadata.index0, missing ? 1 : 0)
            assert.equal(await item.metadata.index, missing ? 2 : 1)
            assert.equal(await item.metadata.length, missing ? 2 : 1)
            assert.equal(await item.metadata.first, !missing)
            assert.equal(await result, missing ? 2 : 1)
            if (missing) await assert.rejects(cursor.next(), e => e === cause)
            else assert((await cursor.next()).done)
        })
    for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) {
        it(`splices a known prefix without closing the append issuer in mode ${mode}`, async () => {
            const ctx = context(), chain = new r.Chain(["A"], ctx, mode), gate = Promise.withResolvers()
            let inside
            const entry = r.enter(chain, [], ctx, access, ref => { inside = ref; return gate.promise })
            const removed = r.run(chain, [], "splice", [0, 1, "X"], ctx, { mutationScopeDepth: 0 })
            assert(!r.isPending(removed, ctx))
            assert.deepEqual(r.export(new r.Chain(removed, ctx), [], ctx), ["A"])
            assert.equal(r.lookupPath(chain, [0], ctx), "X")
            const replaced = new r.Chain(r.run(chain, [], "with", [0, "Y"], ctx, {}), ctx, mode)
            assert.equal(r.lookupPath(replaced, [0], ctx), "Y")
            assert.equal(push(inside, "B", ctx), 2)
            gate.resolve()
            await entry
            assert.deepEqual(await r.export(chain, [], ctx), ["X", "B"])
            assert.deepEqual(await r.export(replaced, [], ctx), ["Y", "B"])
        })
        it(`finds a retained marker while the append issuer is still open in mode ${mode}`, async () => {
            const ctx = context(), chain = new r.Chain([], ctx, mode), hold = Promise.withResolvers()
            let inside
            const opened = r.enter(chain, [], ctx, access, ref => { inside = ref; return hold.promise })
            const earlier = r.hasError(chain, [], ctx), all = r.getErrors(chain, [], ctx)
            const cause = r.validationError("missing item", ctx, r.ERROR_KIND.OperationInputFailed)
            r.appendMissingOutput(inside, cause, ctx)
            assert.equal(r.hasError(chain, [], ctx), true)
            assert.equal(await earlier, true)
            assert(r.isPending(all, ctx))
            assert.equal(r.isPoisoned(chain, [], ctx), false)
            hold.resolve()
            await opened
            assert.equal(await all, cause)
        })
        it(`reserves earlier appends before a later parent push in mode ${mode}`, async () => {
            const ctx = context(), chain = new r.Chain(["A"], ctx, mode), gate = Promise.withResolvers()
            let inside
            const entry = r.enter(chain, [], ctx, access, ref => { inside = ref; return gate.promise })
            const before = new r.Chain(r.lookupPath(chain, [], ctx), ctx, mode)
            assert.equal(r.lookupPath(before, [0], ctx), "A")
            assert.equal(r.lookupPath(inside, ["length"], ctx), 1)
            const parentLength = push(chain, "D", ctx)
            assert(r.isPending(parentLength, ctx))
            assert.equal(r.run(chain, [], "at", [-1], ctx, {}), "D")
            assert.equal(push(inside, "B", ctx), 2)
            assert.equal(r.lookupPath(before, [1], ctx), "B")
            const cause = r.validationError("missing", ctx, r.ERROR_KIND.OperationInputFailed)
            assert.equal(r.appendMissingOutput(inside, cause, ctx), 3)
            gate.resolve()
            await entry
            assert.equal(await parentLength, 4)
            assert.equal(r.lookupPath(chain, [2], ctx), cause)
            assert.equal(r.lookupPath(chain, [3], ctx), "D")
            assert.equal(r.lookupPath(before, ["length"], ctx), 3)
            assert.equal(r.lookupPath(before, [3], ctx), undefined)
        })
        it(`keeps nested issuance independent of its parent's closure in mode ${mode}`, async () => {
            const ctx = context(), chain = new r.Chain([], ctx, mode), hold = Promise.withResolvers()
            let inner, nested
            r.enter(chain, [], ctx, access, outer => {
                nested = r.enter(outer, [], ctx, access, ref => { inner = ref; return hold.promise })
                push(outer, "B", ctx)
            })
            const later = push(chain, "C", ctx)
            assert.equal(push(inner, "A", ctx), 1)
            hold.resolve()
            await nested
            assert.equal(await later, 3)
            assert.deepEqual(await r.export(chain, [], ctx), ["A", "B", "C"])
        })
    }
    it("captures the compiler's append facts before an earlier entry releases", async () => {
        const ctx = context(), chain = new r.Chain(["A"], ctx, r.CHAIN_MODE.Complete)
        const predecessor = Promise.withResolvers(), hold = Promise.withResolvers(), entered = Promise.withResolvers()
        r.enter(chain, [], ctx, true, () => predecessor.promise)
        const facts = { ...access, mayEmitMissingOutput: true }
        const entry = r.enter(chain, [], ctx, facts, inner => { entered.resolve(inner); return hold.promise })
        facts.mayEmitMissingOutput = false
        const cursor = r.iterate(chain, [], ctx), item = cursor.next()
        const outside = item.then(step => r.lookupPath(step.value, [], ctx), error => error)
        predecessor.resolve()
        const inside = await entered.promise
        await new Promise(setImmediate)
        assert.equal(await Promise.race([outside, Promise.resolve("pending")]), "pending")
        const cause = r.validationError("missing", ctx, r.ERROR_KIND.OperationInputFailed)
        r.appendMissingOutput(inside, cause, ctx)
        hold.resolve()
        await entry
        assert.equal(await outside, cause)
        await cursor.return()
    })
    for (const mode of Object.values(r.CHAIN_MODE))
        it(`derives the scope of a missing contribution in mode ${mode}`, async () => {
            const ctx = context(), chain = new r.Chain(["A"], ctx, mode), hold = Promise.withResolvers()
            const before = new r.Chain(r.lookupPath(chain, [], ctx), ctx, mode)
            const cause = r.validationError("missing", ctx, r.ERROR_KIND.OperationInputFailed)
            let inside
            const entry = r.enter(chain, [], ctx, { ...access, mayEmitMissingOutput: true }, inner => {
                inside = inner
                return hold.promise
            })
            const complete = mode === r.CHAIN_MODE.Complete
            const cursor = r.iterate(chain, [], ctx), item = cursor.next()
            const observed = item.then(step => r.lookupPath(step.value, [], ctx), error => error)
            const later = push(chain, "D", ctx)
            await new Promise(setImmediate)
            assert.equal(await Promise.race([observed, Promise.resolve("pending")]), complete ? "pending" : "A")
            assert.equal(push(inside, "B", ctx), 2)
            assert.equal(r.appendMissingOutput(inside, cause, ctx), complete ? cause : 3)
            hold.resolve()
            await entry
            assert.equal(await observed, complete ? cause : "A")
            assert.equal(await later, complete ? cause : 4)
            if (complete) {
                r.repairPath(chain, [], ctx)
                assert.deepEqual(await r.export(chain, [], ctx), ["A", "B"])
            } else {
                assert.equal(r.lookupPath(chain, [2], ctx), cause)
                assert.equal(r.lookupPath(chain, [3], ctx), "D")
            }
            assert.deepEqual(await r.export(before, [], ctx), ["A"])
            await cursor.return()
        })
    for (const mode of Object.values(r.CHAIN_MODE))
        it(`orders a possible whole-scope failure before outside reads, writes, and repair in mode ${mode}`, async () => {
            const ctx = context(), chain = new r.Chain(["A"], ctx, mode), gate = Promise.withResolvers()
            let inside
            const entry = r.enter(chain, [], ctx, { mayPoisonScope: true }, ref => {
                inside = ref
                return gate.promise
            })
            const cursor = r.iterate(chain, [], ctx), item = cursor.next()
            const later = push(chain, "C", ctx)
            assert(r.isPending(later, ctx))
            assert.equal(push(inside, "B", ctx), 2)
            const cause = r.validationError("whole", ctx, r.ERROR_KIND.OperationInputFailed)
            r.poisonPath(inside, [], cause, ctx)
            gate.resolve()
            await entry
            await assert.rejects(item, e => e === cause)
            assert.equal(await later, cause)
            r.repairPath(chain, [], ctx)
            assert.deepEqual(r.export(chain, [], ctx), ["A", "B"])
        })

    for (const [name, mode] of Object.entries(r.CHAIN_MODE))
        it(`clips a splice against an open concat while its prefix and removed head are observed in ${name}`, async () => {
            const pending = Symbol("pending")
            const checkpoint = value => Promise.race([value, new Promise(resolve => setImmediate(resolve, pending))])
            for (const delivery of ["ready", "sync", "count-first", "close-first"])
            for (const amount of [1, 3, 10, "reject"]) for (const append of [false, true]) {
                const ctx = context(), wrap = v => new r.Chain(v, ctx, mode)
                const stream = wrap(["A", "B", "C"]), close = Promise.withResolvers(), count = Promise.withResolvers()
                let issuer
                const entry = r.enter(stream, [], ctx, { ...access, maximumCount: 1 }, inner => {
                    issuer = inner
                    return close.promise
                })
                async function closeIssuer() {
                    if (append) push(issuer, "extra", ctx)
                    close.resolve()
                    await entry
                }
                const fails = amount === "reject"
                const cause = fails && r.validationError("count", ctx, r.ERROR_KIND.OperationInputFailed)
                let input = count.promise
                if (delivery === "ready") input = fails ? cause : amount
                if (delivery === "sync") input = fails ? rejected(cause) : ready(amount)
                const a = wrap(r.run(stream, [], "concat", [["T"]], ctx, {}))
                const removed = wrap(r.run(a, [], "splice", [2, input, "X"], ctx, { mutationScopeDepth: 0 }))
                const prefix = r.export(wrap(r.run(a, [], "slice", [0, 2], ctx, {})), [], ctx)
                const successor = r.export(a, [], ctx), cut = r.export(removed, [], ctx)
                const head = r.lookupPath(removed, [0], ctx), length = r.lookupPath(removed, ["length"], ctx)
                const scenario = `${name}/${delivery}/${amount}/append=${append}`
                if (input === count.promise) {
                    assert.deepEqual(await checkpoint(prefix), mode === r.CHAIN_MODE.Complete ? pending : ["A", "B"], scenario)
                    if (delivery === "close-first") await closeIssuer()
                    if (fails) count.reject(cause)
                    else count.resolve(amount)
                }
                if (delivery !== "close-first") {
                    if (amount === 1) {
                        assert.deepEqual(await checkpoint(cut), ["C"], scenario)
                        assert.equal(await checkpoint(successor), pending, scenario)
                    } else if (!fails) {
                        assert.deepEqual(await checkpoint(successor), ["A", "B", "X"], scenario)
                        assert.equal(await checkpoint(head), "C", scenario)
                        assert.equal(await checkpoint(length), pending, scenario)
                        assert.equal(await checkpoint(cut), pending, scenario)
                    }
                    await closeIssuer()
                }
                const expected = ["A", "B", "C", ...(append ? ["extra"] : []), "T"]
                if (fails) {
                    assert.equal(await cut, cause, scenario)
                    assert.equal(await head, cause, scenario)
                    assert.equal(await length, cause, scenario)
                    assert.equal(await successor, cause, scenario)
                    if (mode === r.CHAIN_MODE.Complete) {
                        assert.equal(await prefix, cause, scenario)
                        r.repairPath(a, [], ctx)
                        assert.deepEqual(await r.export(a, [], ctx), expected, scenario)
                    } else {
                        assert.deepEqual(await prefix, ["A", "B"], scenario)
                        assert.equal(await r.lookupPath(a, [2], ctx), "X", scenario)
                        assert.equal(await r.lookupPath(a, [3], ctx), cause, scenario)
                    }
                } else {
                    const expectedCut = expected.splice(2, amount, "X")
                    assert.deepEqual(await cut, expectedCut, scenario)
                    assert.equal(await head, expectedCut[0], scenario)
                    assert.equal(await length, expectedCut.length, scenario)
                    assert.deepEqual(await successor, expected, scenario)
                    assert.deepEqual(await prefix, ["A", "B"], scenario)
                }
            }
        })
})
