import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { metaOf } from "../src/meta.js"
import { ChainedThenable } from "./ordered-thenable.js"

const context = () => ({ execution: new r.Execution(), errorContext: "invocation inputs" })
const turn = () => new Promise(setImmediate)
const insertions = [
    { method: "push", initial: [], args: p => [p], mutation: true },
    { method: "unshift", initial: [], args: p => [p], mutation: true },
    { method: "fill", initial: [0], args: p => [p], mutation: true },
    { method: "splice", initial: [0], args: p => [0, 1, p], mutation: true },
    { method: "toSpliced", initial: [0], args: p => [0, 1, p] },
    { method: "with", initial: [0], args: p => [0, p] },
    { method: "concat", initial: [], args: p => [p] },
]

describe("invocation input ownership", () => {
    for (const method of ["push", "unshift", "splice", "fill"])
    for (const pending of [false, true]) for (const wrapper of [false, true]) {
        it(`captures an ancestor before the ${method} mutation walk, pending=${pending}, wrapper=${wrapper}`, async () => {
            const ctx = context(), available = Promise.withResolvers()
            const initial = { a: [{ list: ["s2"] }] }
            const source = new r.Chain(pending ? available.promise : initial, ctx)
            const ancestor = r.lookupPath(source, ["a"], ctx)
            const argument = wrapper ? { w: ancestor } : ancestor
            const args = method === "splice" ? [0, 1, argument] : [argument]
            const expected = structuredClone(initial)
            const captured = structuredClone(initial.a)
            const payload = wrapper ? { w: captured } : captured
            expected.a[0].list[method](...(method === "splice" ? [0, 1, payload] : [payload]))
            const outcome = r.run(source, ["a", 0, "list"], method, args, ctx, { mutationScopeDepth: 3 })
            available.resolve(initial)
            await outcome
            assert.deepEqual(await r.export(source, [], ctx), expected)
        })
    }

    for (const mutation of [false, true]) it(`prepares rejected mutation inputs without waiting for unused values, mutation=${mutation}`, async () => {
        const ctx = context(), pending = Promise.withResolvers()
        let inspections = 0
        const input = new Proxy({ child: pending.promise }, { ownKeys(target) {
            inspections++
            return Reflect.ownKeys(target)
        } })
        const source = new r.Chain([], ctx)
        const outcome = r.run(source, [], "missing", [input], ctx, mutation ? { mutationScopeDepth: 0 } : {})
        assert(r.isPoisonError(outcome), "Unused pending input must not postpone dispatch failure")
        assert.equal(inspections, mutation ? 1 : 0)
        pending.reject(new Error("unused input"))
        // Observational rejected dispatch leaves rejection ownership with the host.
        if (!mutation) pending.promise.catch(() => {})
        await turn()
        assert.equal(ctx.execution.fatalError, null)
        if (mutation) assert.equal(metaOf(input, ctx).relationshipsActive, false)
    })

    for (const rejection of ["constructor", "mode", "receiver", "blocked scope"]) {
        it(`releases provisional inputs after ${rejection} rejection without conversion or late root inspection`, async () => {
            const ctx = context(), late = Promise.withResolvers(), child = Promise.withResolvers()
            const unused = new Error("unused argument"), blocked = new Error("blocked scope")
            let inspections = 0, lateInspections = 0, conversions = 0
            const input = new Proxy({ child: child.promise, toString() { conversions++; return "input" } }, {
                ownKeys(target) { inspections++; return Reflect.ownKeys(target) },
            })
            const source = new r.Chain(rejection === "receiver" ? 3 : rejection === "blocked scope" ? blocked : [], ctx)
            const baseline = rejection === "blocked scope" ? r.lookupPath(source, [], ctx) : undefined
            const method = rejection === "constructor" ? "constructor" : rejection === "mode" ? "includes" : "push"
            const outcome = r.run(source, rejection === "blocked scope" ? ["unused"] : [], method,
                [input, late.promise], ctx, { mutationScopeDepth: 0 })
            assert(r.isPoisonError(outcome), "Rejection must complete without pending inputs")
            if (baseline) assert.equal(outcome, baseline)
            assert.equal(inspections, 1, "Ownership preparation precedes receiver traversal")
            assert.equal(conversions, 0, "Rejected dispatch selects no argument conversion")
            assert.equal(metaOf(input, ctx).relationshipsActive, false)
            const lateInput = new Proxy({}, { ownKeys(target) { lateInspections++; return Reflect.ownKeys(target) } })
            child.reject(unused)
            late.resolve(lateInput)
            await turn()
            assert.equal(lateInspections, 0)
            assert.equal(metaOf(lateInput, ctx), undefined)
            assert.notEqual(outcome.cause, unused)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const definition of insertions) for (const pendingReceiver of [false, true])
    for (const wrapper of [false, true]) for (const indexed of [false, true]) {
        it(`protects ${definition.method} payload delivery, receiver=${pendingReceiver}, wrapper=${wrapper}, indexed=${indexed}`, async () => {
            const ctx = context(), receiver = Promise.withResolvers(), argument = Promise.withResolvers()
            const source = new r.Chain({ k: 1 }, ctx)
            const destination = new r.Chain(pendingReceiver ? receiver.promise : [...definition.initial], ctx)
            if (indexed) r.hasError(destination, [], ctx)
            const outcome = r.run(destination, [], definition.method, definition.args(argument.promise), ctx,
                definition.mutation ? { mutationScopeDepth: 0 } : {})
            const output = definition.mutation ? destination : new r.Chain(outcome, ctx)
            const later = argument.promise.then(() => r.assignPath(source, ["k"], 2, ctx))
            receiver.resolve([...definition.initial])
            await turn()
            argument.resolve(wrapper ? { child: r.lookupPath(source, [], ctx) } : r.lookupPath(source, [], ctx))
            assert.deepEqual(await r.export(output, [], ctx), wrapper ? [{ child: { k: 1 } }] : [{ k: 1 }])
            await Promise.all([outcome, later])
            assert.deepEqual(r.export(source, [], ctx), { k: 2 })
        })
    }

    for (const category of ["managed", "external", "string"]) for (const pendingReceiver of [false, true]) {
        it(`protects ${category} call input delivery, receiver=${pendingReceiver}`, async () => {
            const ctx = context(), receiver = Promise.withResolvers(), argument = Promise.withResolvers()
            const source = new r.Chain(category === "string" ? [1] : { k: 1 }, ctx)
            const target = category === "string" ? "a" : category === "external"
                ? r.externalState({ read(x) { return x.k } }) : { read(x) { return x.k } }
            const destination = new r.Chain(pendingReceiver ? receiver.promise : target, ctx)
            const outcome = r.run(destination, [], category === "string" ? "repeat" : "read", [argument.promise], ctx, {})
            const later = argument.promise.then(() => r.assignPath(source, [category === "string" ? 0 : "k"], 2, ctx))
            receiver.resolve(target)
            await turn()
            argument.resolve(r.lookupPath(source, [], ctx))
            assert.equal(await outcome, category === "string" ? "a" : 1)
            await later
        })
    }

    for (const shape of ["array", "view", "cycle", "alias"])
    for (const consumer of ["managed", "external", "push"]) for (const pendingReceiver of [false, true]) {
        it(`protects ${shape} input for ${consumer}, receiver=${pendingReceiver}`, async () => {
            const ctx = context(), receiver = Promise.withResolvers(), argument = Promise.withResolvers()
            const array = shape === "array" || shape === "view", child = { nested: 9 }
            const initial = array ? [1] : { k: 1, left: child, right: child }
            if (shape === "cycle") child.self = child
            let source = new r.Chain(initial, ctx)
            if (shape === "view") source = new r.Chain(r.run(source, [], "slice", [], ctx, {}), ctx)
            const read = value => array ? value[0] : value.k
            const target = consumer === "push" ? [] : consumer === "external" ? r.externalState({ read }) : { read }
            const destination = new r.Chain(pendingReceiver ? receiver.promise : target, ctx)
            const outcome = r.run(destination, [], consumer === "push" ? "push" : "read", [argument.promise], ctx,
                consumer === "push" ? { mutationScopeDepth: 0 } : {})
            const later = argument.promise.then(() => r.assignPath(source, [array ? 0 : "k"], 2, ctx))
            receiver.resolve(target)
            await turn()
            argument.resolve(r.lookupPath(source, [], ctx))
            const result = await outcome
            assert.equal(consumer === "push" ? read((await r.export(destination, [], ctx))[0]) : result, 1)
            await later
        })
    }

    for (const selection of ["unused", "rejected", "failed preparation"]) for (const rejected of [false, true]) {
        it(`abandons pending roots after ${selection}, rejected=${rejected}`, async () => {
            const ctx = context(), receiver = Promise.withResolvers(), argument = Promise.withResolvers()
            let inspections = 0
            const input = new Proxy({ k: 1 }, { ownKeys(target) { inspections++; return Reflect.ownKeys(target) } })
            const source = new r.Chain(receiver.promise, ctx)
            const outcome = r.run(source, [], selection === "failed preparation" ? "with" : "pop",
                selection === "failed preparation" ? [99, argument.promise] : [argument.promise], ctx, {})
            receiver.resolve(selection === "rejected" ? 1 : [0])
            const result = await outcome
            if (selection !== "unused") assert(r.isPoisonError(result))
            argument[rejected ? "reject" : "resolve"](rejected ? new Error("unused rejection") : input)
            await turn()
            assert.equal(inspections, 0)
            assert.equal(metaOf(input, ctx), undefined)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("prepares a pending argument once across receiver selection", async () => {
        const ctx = context(), receiver = Promise.withResolvers(), argument = new ChainedThenable()
        const source = new r.Chain({ k: 1 }, ctx)
        const destination = new r.Chain(receiver.promise, ctx)
        const outcome = r.run(destination, [], "push", [argument], ctx, { mutationScopeDepth: 0 })
        const later = argument.then(() => r.assignPath(source, ["k"], 2, ctx))
        receiver.resolve([])
        await turn()
        assert.equal(argument.subscriptions, 2, "One input preparation and the explicit later writer")
        argument.resolve(r.lookupPath(source, [], ctx))
        assert.deepEqual(await r.export(destination, [], ctx), [{ k: 1 }])
        await Promise.all([outcome, later])
    })

    for (const ordered of [false, true]) for (const pendingReceiver of [false, true])
    for (const mutation of [false, true]) {
        it(`abandons pending fill payloads for empty ranges, ordered=${ordered}, receiver=${pendingReceiver}, mutation=${mutation}`, async () => {
            for (const view of [false, true]) for (const deferredBounds of [false, true])
            for (const delivery of ["value", "reflection failure", "rejection"]) {
                const ctx = context(), receiver = Promise.withResolvers(), start = Promise.withResolvers()
                const argument = ordered ? new ChainedThenable() : Promise.withResolvers()
                let inspections = 0
                const input = new Proxy({ k: 1 }, { ownKeys(target) {
                    inspections++
                    if (delivery === "reflection failure") throw new Error("Unused input inspection")
                    return Reflect.ownKeys(target)
                } })
                const initial = new r.Chain([0], ctx)
                const data = view ? r.run(initial, [], "slice", [], ctx, {}) : [0]
                const source = new r.Chain(pendingReceiver ? receiver.promise : data, ctx)
                const outcome = r.run(source, [], "fill",
                    [ordered ? argument : argument.promise, deferredBounds ? start.promise : 0, 0],
                    ctx, mutation ? { mutationScopeDepth: 0 } : {})
                const output = mutation ? source : new r.Chain(outcome, ctx)
                receiver.resolve(data)
                start.resolve(0)
                await outcome
                assert.deepEqual(await r.export(output, [], ctx), [0])
                if (delivery === "rejection") argument.reject(new Error("Unused payload rejection"))
                else argument.resolve(input)
                await turn()
                assert.equal(inspections, 0)
                assert.equal(metaOf(input, ctx), undefined)
                assert.equal(ctx.execution.fatalError, null)
                assert.deepEqual(await r.export(output, [], ctx), [0])
            }
        })
    }

    for (const mutation of [false, true]) {
        it(`matches native fill ranges with a pending payload, mutation=${mutation}`, async () => {
            const bounds = [undefined, -Infinity, -5, -1.5, -0.5, 0, 1.5, 5, Infinity, NaN]
            const ranges = [[], ...bounds.flatMap(start => [[start], ...bounds.map(end => [start, end])])]
            for (const length of [0, 1, 3]) for (const range of ranges) {
                const ctx = context(), argument = Promise.withResolvers()
                let inspections = 0
                const input = new Proxy({ k: 1 }, { ownKeys(target) { inspections++; return Reflect.ownKeys(target) } })
                const expected = new Array(length).fill(0).fill(input, ...range)
                const used = expected.includes(input)
                const source = new r.Chain(new Array(length).fill(0), ctx)
                const outcome = r.run(source, [], "fill", [argument.promise, ...range],
                    ctx, mutation ? { mutationScopeDepth: 0 } : {})
                const output = mutation ? source : new r.Chain(outcome, ctx)
                await outcome
                argument.resolve(input)
                await turn()
                assert.equal(inspections, used ? 1 : 0, `length=${length}, range=${range}`)
                assert.equal(metaOf(input, ctx) !== undefined, used)
                assert.deepEqual(await r.export(output, [], ctx), expected)
            }
        })
    }

    for (const created of [false, true]) for (const mutation of [false, true]) {
        it(`decides fill payload use after pending length settles, created=${created}, mutation=${mutation}`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), argument = Promise.withResolvers()
            let inspections = 0
            const input = new Proxy({ k: 1 }, { ownKeys(target) { inspections++; return Reflect.ownKeys(target) } })
            const source = new r.Chain([0], ctx)
            const entry = r.enter(source, [1], ctx, true, inside => hold.promise.then(() => {
                if (created) r.assignPath(inside, [], 9, ctx)
            }))
            const outcome = r.run(source, [], "fill", [argument.promise, 1],
                ctx, mutation ? { mutationScopeDepth: 0 } : {})
            const output = mutation ? source : new r.Chain(outcome, ctx)
            hold.resolve()
            await Promise.all([entry, outcome])
            argument.resolve(input)
            await turn()
            assert.equal(inspections, created ? 1 : 0)
            assert.deepEqual(await r.export(output, [], ctx), created ? [0, { k: 1 }] : [0])
        })
    }

    it("continues installed child settlement after an empty fill discards its payload", async () => {
        const ctx = context(), start = Promise.withResolvers(), child = Promise.withResolvers()
        const input = { waiting: child.promise }
        const source = new r.Chain([0], ctx)
        const outcome = r.run(source, [], "fill", [input, start.promise, 0], ctx, {})
        const output = new r.Chain(outcome, ctx)
        const retained = new r.Chain(input, ctx)
        start.resolve(0)
        await outcome
        child.resolve({ k: 7 })
        assert.deepEqual(await r.export(retained, [], ctx), { waiting: { k: 7 } })
        assert.deepEqual(await r.export(output, [], ctx), [0])
    })

    it("abandons provisional roots when a mutation path fails before invocation", async () => {
        const ctx = context(), receiver = Promise.withResolvers(), argument = Promise.withResolvers()
        let inspections = 0
        const input = new Proxy({ k: 1 }, { ownKeys(target) { inspections++; return Reflect.ownKeys(target) } })
        const source = new r.Chain(receiver.promise, ctx)
        const outcome = r.run(source, ["missing"], "push", [argument.promise], ctx, { mutationScopeDepth: 1 })
        receiver.resolve({})
        assert(r.isPoisonError(await outcome))
        argument.resolve(input)
        await turn()
        assert.equal(inspections, 0)
        assert.equal(metaOf(input, ctx), undefined)
    })

    it("continues installed child settlement after an unused argument closes", async () => {
        const ctx = context(), receiver = Promise.withResolvers(), child = Promise.withResolvers()
        const input = { waiting: child.promise }
        const source = new r.Chain(receiver.promise, ctx)
        const outcome = r.run(source, [], "pop", [input], ctx, {})
        receiver.resolve([0])
        await outcome
        assert.equal(metaOf(input, ctx).relationshipsActive, false)
        child.resolve({ k: 7 })
        await turn()
        const received = new r.Chain(input, ctx)
        assert.deepEqual(r.export(received, [], ctx), { waiting: { k: 7 } })
    })
})
