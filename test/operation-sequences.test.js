import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as r from "../src/index.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { TREE_NODE } from "../src/external-mutation-tree.js"
import { metaOf } from "../src/meta.js"

// Bounded command sequences use native property semantics as an independent
// oracle. Each prefix is a separate scenario, so intermediate exports cannot
// accidentally serialize pending work or change the scenario's sharing.
function sequences(commands, limit, prefix = []) {
    if (prefix.length) return [prefix, ...(prefix.length < limit
        ? commands.flatMap(command => sequences(commands, limit, [...prefix, command])) : [])]
    return commands.flatMap(command => sequences(commands, limit, [command]))
}

const shapes = [
    ["absent record", () => ({}), "item"],
    ["present record", () => ({ item: 8 }), "item"],
    ["Array hole", () => new Array(2), 0],
    ["Array growth", () => [], 3],
]

describe("ownership across unchanged and pending paths", () => {
    for (const route of ["export", "getErrors", "hasError", "method"]) for (const failed of [false, true]) {
        it(`${route} preserves an earlier frontier after a resolved child is replaced, failure=${failed}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const first = Promise.withResolvers(), last = Promise.withResolvers()
            const cause = new Error("earlier child")
            const read = function () { return this.a.n + this.b.n }
            const chain = new r.Chain({ a: first.promise, b: last.promise, read }, ctx)
            const result = route === "method" ? r.run(chain, [], "read", [], ctx, {}) : r[route](chain, [], ctx)
            if (failed) first.reject(cause)
            else first.resolve({ n: 1 })
            await new Promise(setImmediate)
            // Do not inspect the graph before replacement: an extra lookup could
            // supply protection missing from the operation under test.
            r.assignPath(chain, ["a"], { n: 99 }, ctx)
            last.resolve({ n: 2 })
            const value = await result
            if (route === "hasError") assert.equal(value, failed)
            else if (failed) {
                assert(r.isPoisonError(value))
                assert.equal(value.cause, cause)
            } else if (route === "getErrors") assert.equal(value, null)
            else if (route === "method") assert.equal(value, 3)
            else assert.deepStrictEqual(value, { a: { n: 1 }, b: { n: 2 }, read })
            assert.deepStrictEqual(await r.export(chain, [], ctx), { a: { n: 99 }, b: { n: 2 }, read })
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state.value)
        })
    }

    for (const array of [false, true]) for (const admitted of [false, true]) for (const observed of [false, true]) {
        for (const action of ["repair", "scoped no-op", "entry"]) {
            it(`retains reused children after ${action}, Array=${array}, admitted=${admitted}, observed=${observed}`, async () => {
                const ctx = { execution: new r.Execution(), errorContext: {} }
                const initial = () => ({ item: array ? [{ n: 1 }] : { n: 1, inner: {} } })
                const chain = new r.Chain(admitted ? r.import(initial(), ctx) : initial(), ctx)
                const fork = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
                // Exercise both explicit child protection and a still-lazy fork.
                if (observed) r.lookupPath(fork, ["item"], ctx)
                if (action === "repair") r.repairPath(chain, ["item"], ctx)
                else if (action === "scoped no-op") r.deletePath(chain, ["item", array ? 0 : "inner", "absent"], ctx, 1)
                else r.enter(chain, ["item"], ctx, true, () => {})
                r.assignPath(chain, array ? ["item", 0, "n"] : ["item", "n"], 9, ctx)
                assert.deepStrictEqual(await r.export(fork, [], ctx), initial())
                assert.equal(await r.lookupPath(chain, array ? ["item", 0, "n"] : ["item", "n"], ctx), 9)
                verifyRefCounts(ctx, chain._state, fork._state)
            })
        }
    }

    for (const array of [false, true]) for (const assigned of [false, true]) for (const nested of [false, true]) for (const observed of [false, true]) {
        it(`isolates entered pending children, Array=${array}, assigned=${assigned}, nested=${nested}, observed=${observed}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }, pending = Promise.withResolvers()
            const chain = new r.Chain(assigned ? {} : { item: pending.promise }, ctx)
            if (assigned) r.assignPath(chain, ["item"], pending.promise, ctx)
            const fork = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
            if (observed) r.lookupPath(fork, ["item"], ctx)
            const change = inner => r.deletePath(inner, [array ? 0 : "n"], ctx)
            const entry = r.enter(chain, ["item"], ctx, true, inner => nested
                ? r.enter(inner, [], ctx, true, change) : change(inner))
            pending.resolve(array ? [1] : { n: 1 })
            await entry
            assert.deepStrictEqual(await r.export(fork, ["item"], ctx), array ? [1] : { n: 1 })
            assert.deepStrictEqual(await r.export(chain, ["item"], ctx), array ? new Array(1) : {})
            verifyRefCounts(ctx, chain._state, fork._state)
        })
    }
})

describe("publication between queued commands", () => {
    const turns = [0, 1, 2, 3, 4, 5]
    const methods = [["push", [3]], ["pop", []], ["sort", []], ["fill", [8]], ["splice", [1, 1, 9]], ["reverse", []]]
    for (const [method, args] of methods) for (const action of ["assign", "delete", "entry"]) {
        it(`preserves ${action} between pending replacement, ${method}, and push`, async () => {
            for (const before of turns) for (const after of turns) {
                const ctx = { execution: new r.Execution(), errorContext: {} }, pending = Promise.withResolvers()
                const chain = new r.Chain({ list: [] }, ctx)
                r.assignPath(chain, ["list"], pending.promise, ctx)
                const first = r.run(chain, ["list"], method, args, ctx, { mutationScopeDepth: 1 })
                pending.resolve([2, 1])
                for (let i = 0; i < before; i++) await Promise.resolve()
                let entry
                if (action === "assign") r.assignPath(chain, ["list", 0], 7, ctx)
                else if (action === "delete") r.deletePath(chain, ["list", 0], ctx)
                else entry = r.enter(chain, ["list", 0], ctx, true, inner => r.deletePath(inner, [], ctx))
                for (let i = 0; i < after; i++) await Promise.resolve()
                const last = r.run(chain, ["list"], "push", [3], ctx, { mutationScopeDepth: 1 })
                const output = r.export(chain, ["list"], ctx)
                const expected = [2, 1]
                expected[method](...args)
                if (action === "assign") expected[0] = 7
                else delete expected[0]
                expected.push(3)
                assert.deepStrictEqual(await output, expected, `before=${before}, after=${after}`)
                await Promise.all([first, entry, last])
                verifyRefCounts(ctx, chain._state)
            }
        })
    }

    it("preserves structural poison through intervening element entry", async () => {
        for (const mutable of [false, true]) for (const before of turns) for (const after of turns) {
            const ctx = { execution: new r.Execution(), errorContext: {} }, pending = Promise.withResolvers()
            const chain = new r.Chain({ list: [] }, ctx)
            r.assignPath(chain, ["list"], pending.promise, ctx)
            const reversed = r.run(chain, ["list"], "reverse", [], ctx, { mutationScopeDepth: 1 })
            r.assignPath(chain, ["list", 9, "x"], 1, ctx, 1)
            pending.resolve([2])
            for (let i = 0; i < before; i++) await Promise.resolve()
            const entry = r.enter(chain, ["list", 1], ctx, mutable, entered => r.lookupPath(entered, [], ctx))
            for (let i = 0; i < after; i++) await Promise.resolve()
            const exported = await r.export(chain, ["list"], ctx)
            assert.equal(exported.kind, r.ERROR_KIND.NullLookup, `mutable=${mutable}, before=${before}, after=${after}`)
            assert.equal(exported, await entry)
            await reversed
            await r.repairPath(chain, ["list"], ctx)
            assert.deepStrictEqual(await r.export(chain, ["list"], ctx), [2])
            verifyRefCounts(ctx, chain._state)
        }
    })

    it("does not let a ready record observation overtake a queued deletion", async () => {
        for (const before of turns) for (const after of turns) {
            const ctx = { execution: new r.Execution(), errorContext: {} }, pending = Promise.withResolvers()
            const chain = new r.Chain({ item: {} }, ctx)
            r.assignPath(chain, ["item"], pending.promise, ctx)
            const first = r.run(chain, ["item"], "bump", [], ctx, { mutationScopeDepth: 1 })
            pending.resolve({ n: 1, bump() { this.n++ }, hasN() { return Object.hasOwn(this, "n") } })
            for (let i = 0; i < before; i++) await Promise.resolve()
            r.deletePath(chain, ["item", "n"], ctx)
            for (let i = 0; i < after; i++) await Promise.resolve()
            assert.equal(await r.run(chain, ["item"], "hasN", [], ctx, {}), false,
                `before=${before}, after=${after}`)
            await first
            verifyRefCounts(ctx, chain._state)
        }
    })
})

describe("observations across scope publication", () => {
    class Receiver {
        n = 0
        bump() { this.n++ }
        read() { return this.n }
    }
    r.managedStateClass(Receiver)
    const observations = {
        export: (chain, ctx) => r.export(chain, ["item"], ctx),
        lookup: (chain, ctx) => r.lookupPath(chain, ["item"], ctx),
        scalar: (chain, ctx) => r.lookupPath(chain, ["item", "n"], ctx),
        expression: (chain, ctx) => r.lookupPathForExpression(chain, ["item", "n"], ctx),
        hasError: (chain, ctx) => r.hasError(chain, ["item"], ctx),
        getErrors: (chain, ctx) => r.getErrors(chain, ["item"], ctx),
        rootExport: (chain, ctx) => r.export(chain, [], ctx),
        rootErrors: (chain, ctx) => r.getErrors(chain, [], ctx),
        entry: (chain, ctx) => r.enter(chain, ["item"], ctx, false,
            inside => r.lookupPath(inside, ["n"], ctx)),
        method: (chain, ctx) => r.run(chain, ["item"], "read", [], ctx, {}),
    }
    for (const category of ["record", "class"]) for (const preceding of ["method", "repair", "no-op"]) {
        for (const [name, observe] of Object.entries(observations)) {
            it(`${name} captures ${category} state after ${preceding} and before a later write`, async () => {
                for (const change of ["assign", "delete", "entry"]) for (const before of [0, 1, 2]) for (const after of [0, 1, 2, 3]) {
                    const ctx = { execution: new r.Execution(), errorContext: {} }, pending = Promise.withResolvers()
                    const chain = new r.Chain({ item: {} }, ctx)
                    r.assignPath(chain, ["item"], pending.promise, ctx)
                    const first = preceding === "method"
                        ? r.run(chain, ["item"], "bump", [], ctx, { mutationScopeDepth: 1 })
                        : preceding === "repair" ? r.repairPath(chain, ["item"], ctx)
                            : r.deletePath(chain, ["item", "absent"], ctx, 1)
                    pending.resolve(category === "class" ? new Receiver()
                        : { n: 0, bump: Receiver.prototype.bump, read: Receiver.prototype.read })
                    for (let i = 0; i < before; i++) await Promise.resolve()
                    const captured = observe(chain, ctx)
                    for (let i = 0; i < after; i++) await Promise.resolve()
                    const query = name === "hasError" || name === "getErrors" || name === "rootErrors"
                    const next = query ? new Error("later Error") : 50
                    if (change === "delete") r.deletePath(chain, ["item", "n"], ctx)
                    else if (change === "entry") r.enter(chain, ["item", "n"], ctx, true,
                        inside => r.assignPath(inside, [], next, ctx))
                    else r.assignPath(chain, ["item", "n"], next, ctx)
                    const value = await captured
                    const expected = query ? name === "hasError" ? false : null : preceding === "method" ? 1 : 0
                    const result = name === "export" || name === "lookup" ? value.n
                        : name === "rootExport" ? value.item.n : value
                    assert.equal(result, expected, `${change}, before=${before}, after=${after}`)
                    await first
                    // Delivery must not end a retained lookup's protection.
                    r.assignPath(chain, ["item", "n"], 60, ctx)
                    if (name === "export" || name === "lookup") assert.equal(value.n, expected)
                    if (name === "rootExport") assert.equal(value.item.n, expected)
                    assert.equal(await r.lookupPath(chain, ["item", "n"], ctx), 60)
                    verifyRefCounts(ctx, chain._state)
                }
            })
        }
    }
})

describe("pending structural publication", () => {
    it("matches a sequential model across seeded placement schedules", function () {
        this.timeout(60000)
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--max-old-space-size=128",
            fileURLToPath(new URL("./fixtures/placement-sequences.js", import.meta.url))],
        { encoding: "utf8", timeout: 55000 })
        assert.equal(result.error, undefined, result.error?.message)
        assert.equal(result.status, 0, result.stderr)
        const coverage = JSON.parse(result.stdout)
        assert.equal(coverage.cases, Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 16) * 4)
        assert.equal(coverage.distinctTraces, coverage.cases)
    })

    it("makes progress through repeated length assignments, copies, and entry", function () {
        this.timeout(15000)
        // A microtask livelock also prevents Mocha's timeout from firing.
        // Bound both time and heap in a child process so a regression is safe.
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--max-old-space-size=128",
            fileURLToPath(new URL("./fixtures/pending-structural-publication.js", import.meta.url))],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.error, undefined, result.error?.message)
        assert.equal(result.status, 0, result.stderr)
        assert.equal(result.stdout.trim(), "96 cases passed")
    })
})

describe("bounded property command sequences", () => {
    for (const [shape, initial, key] of shapes) {
        for (const route of ["direct", "entered", "nested entry"]) {
            for (const delivery of ["ready", "synchronous thenable", "deferred"]) {
                it(`${shape}, ${route}, ${delivery}`, async () => {
                    for (const commands of sequences(["set", "undefined", "delete"], 3)) {
                        const ctx = { execution: new r.Execution(), errorContext: {} }
                        const source = initial(), expected = initial()
                        const chain = new r.Chain(r.import(source, ctx), ctx)
                        const retained = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
                        const releases = []
                        const perform = (target, path) => {
                            for (const command of commands) {
                                if (command === "delete") {
                                    delete expected[key]
                                    r.deletePath(target, path, ctx)
                                } else {
                                    const value = command === "set" ? 5 : undefined
                                    expected[key] = value
                                    let supplied = value
                                    if (delivery === "synchronous thenable") supplied = { then(resolve) { return resolve(value) } }
                                    if (delivery === "deferred") {
                                        const pending = Promise.withResolvers()
                                        supplied = pending.promise
                                        releases.push(() => pending.resolve(value))
                                    }
                                    r.assignPath(target, path, supplied, ctx)
                                }
                            }
                        }
                        let completion
                        if (route === "direct") perform(chain, [key])
                        else completion = r.enter(chain, [key], ctx, true, inside => {
                            if (route === "nested entry") return r.enter(inside, [], ctx, true, nested => perform(nested, []))
                            perform(inside, [])
                        })
                        for (const release of releases.reverse()) release()
                        await completion
                        await checkpoint()
                        const label = `${shape}; ${route}; ${delivery}; ${commands.join(" -> ")}`
                        assert.deepStrictEqual(await r.export(chain, [], ctx), expected, label)
                        assert.deepStrictEqual(await r.export(retained, [], ctx), initial(), `${label}; retained output`)
                        assert.deepStrictEqual(source, initial(), `${label}; imported source`)
                        assert.equal(await r.getErrors(chain, [], ctx), null, label)
                        verifyRefCounts(ctx, chain._state.value, retained._state.value)
                        assert.equal(ctx.execution.fatalError, null, label)
                    }
                })
            }
        }
    }
})

describe("managed failure and replacement sequences", () => {
    for (const route of ["direct", "entered"]) for (const pending of [false, true]) {
        it(`${route}, pending failure=${pending}`, async () => {
            for (const commands of sequences(["put", "delete", "fail", "repair"], 3)) {
                const ctx = { execution: new r.Execution(), errorContext: {} }
                const cause = new Error("method failed")
                const fail = function () {
                    this.x = 99
                    if (pending) return Promise.reject(cause)
                    throw cause
                }
                const initial = { x: 8, fail }
                const chain = new r.Chain(r.import({ item: initial }, ctx), ctx)
                const outcomes = []
                let state = { present: true, value: initial }, recovery
                const perform = (target, path) => {
                    for (const command of commands) {
                        let outcome
                        if (command === "put") {
                            outcome = r.assignPath(target, path, { x: 5, fail }, ctx)
                            state = { present: true, value: { x: 5, fail } }
                            recovery = undefined
                        } else if (command === "delete") {
                            outcome = r.deletePath(target, path, ctx)
                            state = { present: false }
                            recovery = undefined
                        } else if (command === "fail") {
                            outcome = r.run(target, path, "fail", [], ctx, { mutationScopeDepth: path.length })
                            if (!state.error) { recovery = state; state = { error: true } }
                        } else {
                            outcome = r.repairPath(target, path, ctx)
                            if (recovery) { state = recovery; recovery = undefined }
                        }
                        outcomes.push(outcome)
                    }
                }
                const completion = route === "direct" ? perform(chain, ["item"]) :
                    r.enter(chain, ["item"], ctx, true, inside => perform(inside, []))
                await completion
                await Promise.all(outcomes)
                const label = `${route}; pending=${pending}; ${commands.join(" -> ")}`
                const error = await r.getErrors(chain, [], ctx)
                if (state.error) assert(r.isPoisonError(error), label)
                else {
                    assert.equal(error, null, label)
                    assert.deepStrictEqual(await r.export(chain, [], ctx), state.present ? { item: state.value } : {}, label)
                }
                assert.equal(initial.x, 8, label)
                verifyRefCounts(ctx, chain._state.value)
            }
        })
    }
})

// Drain ready Promise reactions without advancing or timing out held inputs.
const checkpoint = () => new Promise(setImmediate)
const releaseOrders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]

function expectedProgress(sequence, released) {
    const starts = [], ends = []
    sequence.forEach(({ node, mutation }, index) => {
        const blocked = sequence.slice(0, index).some((prior, before) =>
            (node === prior.node || node === "parent" || prior.node === "parent") &&
            (mutation || prior.mutation) && !ends.includes(before))
        if (!blocked) {
            starts.push(index)
            if (released.has(index)) ends.push(index)
        }
    })
    return { starts, ends }
}

describe("bounded external ordering sequences", () => {
    const commands = ["parent", "left", "right"].flatMap(node => [false, true].map(mutation => ({ node, mutation })))
    it("distinguishes overtaking from unnecessary blocking", () => {
        const sequence = [{ node: "left", mutation: true }, { node: "right", mutation: false }, { node: "parent", mutation: false }]
        const expected = expectedProgress(sequence, new Set())
        assert.deepStrictEqual(expected, { starts: [0, 1], ends: [] })
        assert.throws(() => assert.deepStrictEqual({ starts: [0, 1, 2], ends: [] }, expected))
        assert.throws(() => assert.deepStrictEqual({ starts: [0], ends: [] }, expected))
        assert.deepStrictEqual(expectedProgress(sequence, new Set([0])), { starts: [0, 1, 2], ends: [0] })
    })
    for (const entered of [false, true]) {
        it(`matches an independent conflict model, entered=${entered}`, async () => {
            for (const sequence of sequences(commands, 3).filter(sequence => sequence.length === 3)) {
                for (const order of releaseOrders) {
                    const ctx = { execution: new r.Execution(), errorContext: {} }
                    const holds = sequence.map(() => Promise.withResolvers())
                    const starts = new Set(), ends = new Set(), released = new Set()
                    const make = () => ({ work(index) {
                        starts.add(index)
                        return holds[index].promise.then(() => { ends.add(index); return index })
                    } })
                    const api = r.externalState({ ...make(), left: make(), right: make() })
                    const chain = new r.ContextChain({ api }, ctx, { api: { left: {}, right: {} } })
                    const outcomes = []
                    const issue = (target, prefix) => {
                        sequence.forEach(({ node, mutation }, index) => {
                            const path = node === "parent" ? prefix : [...prefix, node]
                            outcomes.push(r.run(target, path, "work", [index], ctx,
                                mutation ? { mutationScopeDepth: path.length } : {}))
                        })
                    }
                    const entry = entered ? r.enter(chain, ["api"], ctx, true, inside => issue(inside, [])) : issue(chain, ["api"])
                    for (const release of [-1, ...order]) {
                        if (release !== -1) { released.add(release); holds[release].resolve() }
                        await checkpoint()
                        const expected = expectedProgress(sequence, released)
                        const label = JSON.stringify({ sequence, order, release, entered })
                        assert.deepStrictEqual([...starts].sort(), expected.starts, label)
                        assert.deepStrictEqual([...ends].sort(), expected.ends, label)
                    }
                    await Promise.all([entry, ...outcomes])
                    await checkpoint()
                    const inspect = node => {
                        for (const membership of Object.values(node[TREE_NODE].frontier ?? {})) assert.equal(membership.size, 0)
                        for (const child of Object.values(node)) inspect(child)
                    }
                    inspect(chain._externalMutationTree)
                    assert.equal(ctx.execution.fatalError, null)
                }
            }
        })
    }
})

describe("mixed entry and native ordering", () => {
    it("keeps structural entry protection separate from external coverage", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const held = Promise.withResolvers()
        const api = r.externalState({ work() { return held.promise } })
        const chain = new r.ContextChain({ list: [api] }, ctx, { list: { 0: {} } })
        const pending = r.run(chain, ["list", 0], "work", [], ctx, { mutationScopeDepth: 2 })
        let called = false
        const entry = r.enter(chain, ["list", 3], ctx, true, inner => {
            called = true
            r.assignPath(inner, [], 2, ctx)
        })
        assert.equal(called, true)
        assert.equal(entry, undefined)
        assert.equal(r.lookupPath(chain, ["list", "length"], ctx), 4)
        assert.equal(r.lookupPath(chain, ["list", 3], ctx), 2)
        held.resolve()
        await pending
        assert.equal(r.getErrors(chain, [], ctx), null)
        verifyRefCounts(ctx, chain._state)
    })

    for (const entered of [false, true]) for (const releaseBetween of [false, true]) {
        it(`orders gated paths against ancestor entries, entered=${entered}, releaseBetween=${releaseBetween}`, async () => {
            const choices = ["parent", "left", "right"].flatMap(node => [false, true].map(mutation => ({ node, mutation })))
            for (const tail of sequences(choices, 2).filter(sequence => sequence.length === 2)) {
                const sequence = [{ node: "parent", mutation: true }, ...tail]
                for (const order of releaseOrders) {
                    const ctx = { execution: new r.Execution(), errorContext: {} }
                    const holds = sequence.map(() => Promise.withResolvers())
                    const starts = new Set(), ends = new Set(), released = new Set(), outcomes = []
                    const resource = () => r.externalState({ work(index) {
                        starts.add(index)
                        return holds[index].promise.then(() => { ends.add(index); return index })
                    } })
                    const chain = new r.ContextChain({ box: { left: resource(), right: resource() } }, ctx,
                        { box: { left: {}, right: {} } })
                    const issue = target => {
                        sequence.forEach(({ node, mutation }, index) => {
                            if (releaseBetween && index === 2) {
                                released.add(0)
                                holds[0].resolve()
                            }
                            outcomes.push(node === "parent"
                                ? r.enter(target, ["box"], ctx, mutation, inner =>
                                    r.run(inner, ["left"], "work", [index], ctx, mutation ? { mutationScopeDepth: 1 } : {}))
                                : r.run(target, ["box", node], "work", [index], ctx, mutation ? { mutationScopeDepth: 2 } : {}))
                        })
                    }
                    const outer = entered ? r.enter(chain, [], ctx, true, issue) : issue(chain)
                    for (const release of [-1, ...order]) {
                        if (release !== -1) { released.add(release); holds[release].resolve() }
                        await checkpoint()
                        const expected = expectedProgress(sequence, released)
                        const label = JSON.stringify({ sequence, order, release, entered, releaseBetween })
                        assert.deepStrictEqual([...starts].sort(), expected.starts, label)
                        assert.deepStrictEqual([...ends].sort(), expected.ends, label)
                    }
                    await Promise.all([outer, ...outcomes])
                    assert.equal(ctx.execution.fatalError, null)
                    verifyRefCounts(ctx, chain._state)
                }
            }
        })
    }

    const commands = ["call", "failure", "repair", "managed method", "mixed scope", "replace"]
    const followers = ["scope entry", "ancestor entry", "ancestor read entry", "hasError", "getErrors"]
    for (const entered of [false, true]) {
        it(`finishes queued mutations and captures earlier poison, entered=${entered}`, async () => {
            for (const command of commands) for (const follower of followers) {
                const ctx = { execution: new r.Execution(), errorContext: {} }, events = []
                const held = Promise.withResolvers(), cause = new Error("native failure")
                const svc = r.externalState({
                    work(label) { events.push(label); return label },
                    fail() { events.push("failure"); throw cause },
                })
                const chain = new r.ContextChain({ box: { svc, method() { assert.fail("mixed managed receiver") } } }, ctx,
                    { box: { svc: {} } })
                const outcomes = new Map()
                const track = (name, value) => Promise.resolve(value).then(result => { outcomes.set(name, result); return result })
                const issue = target => {
                    track("first", r.enter(target, ["box"], ctx, true, inner =>
                        r.run(inner, ["svc"], "work", ["first", held.promise], ctx, { mutationScopeDepth: 1 })))
                    let middle
                    if (command === "call") middle = r.run(target, ["box", "svc"], "work", ["middle"], ctx, { mutationScopeDepth: 2 })
                    if (command === "failure") middle = r.run(target, ["box", "svc"], "fail", [], ctx, { mutationScopeDepth: 2 })
                    if (command === "repair") middle = r.repairPath(target, ["box"], ctx)
                    if (command === "managed method") middle = r.run(target, ["box"], "method", [], ctx, { mutationScopeDepth: 1 })
                    if (command === "mixed scope") middle = r.run(target, ["box", "svc"], "work", ["invalid"], ctx, { mutationScopeDepth: 1 })
                    if (command === "replace") middle = r.assignPath(target, ["box"], {}, ctx)
                    track("middle", middle)
                    held.resolve()
                    const last = follower === "hasError" ? r.hasError(target, [], ctx)
                        : follower === "getErrors" ? r.getErrors(target, [], ctx)
                            : r.enter(target, follower === "scope entry" ? ["box"] : [], ctx,
                                follower !== "ancestor read entry", inner =>
                                    r.run(inner, follower === "scope entry" ? ["svc"] : ["box", "svc"], "work", ["last"], ctx, {}))
                    track("last", last)
                    track("poison", r.getErrors(target, ["box"], ctx))
                }
                const outer = entered ? r.enter(chain, [], ctx, true, issue) : issue(chain)
                await checkpoint()
                const label = `${command}; ${follower}; entered=${entered}`
                assert.equal(outcomes.size, 4, `Unfinished operation: ${label}`)
                const failed = !["call", "repair"].includes(command)
                const poison = outcomes.get("poison")
                assert.equal(Boolean(poison), failed, label)
                if (failed && command !== "replace") assert.equal(poison, outcomes.get("middle"), label)
                const expectedLast = follower === "hasError" ? failed
                    : follower === "getErrors" ? poison : failed ? poison : "last"
                assert.equal(outcomes.get("last"), expectedLast, label)
                assert.deepEqual(events, ["first", ...(command === "call" ? ["middle"] : command === "failure" ? ["failure"] : []),
                    ...(!failed && follower.includes("entry") ? ["last"] : [])], label)
                await outer
                assert.equal(ctx.execution.fatalError, null, label)
                verifyRefCounts(ctx, chain._state)
            }
        })
    }
})

describe("structural Array command sequences", () => {
    it("matches native Array methods queued behind indexed element entry", async () => {
        const methods = [
            ["push", [8], true], ["pop", [], true], ["shift", [], true],
            ["unshift", [8], true], ["splice", [1, 1, 8], true], ["reverse", [], true],
            ["slice", [1], false], ["at", [-1], false], ["join", [","], false],
            ["toReversed", [], false],
        ]
        for (const [method, args, mutable] of methods) for (const captures of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: {} }, hold = Promise.withResolvers()
            const chain = new r.Chain([2, , 1], ctx)
            assert.equal(r.hasError(chain, [], ctx), false)
            const expected = [2, , 1]
            expected[4] = 7
            const expectedResult = expected[method](...args)
            const snapshot = Array.isArray(expectedResult) ? expectedResult.slice() : expectedResult
            if (mutable) expected[0] = 9
            const entry = r.enter(chain, [4], ctx, true, inside =>
                hold.promise.then(() => r.assignPath(inside, [], 7, ctx)))
            const earlier = captures ? r.export(chain, [], ctx) : undefined
            const result = r.run(chain, [], method, args, ctx, mutable ? { mutationScopeDepth: 0 } : {})
            const later = mutable ? r.assignPath(chain, [0], 9, ctx) : undefined
            verifyRefCounts(ctx, chain._state)
            hold.resolve()
            await Promise.all([entry, later])
            const actual = await r.export(new r.Chain(await result, ctx), [], ctx)
            const label = `${method}, captures=${captures}`
            assert.deepStrictEqual(actual, snapshot, label)
            assert.deepStrictEqual(await r.export(chain, [], ctx), mutable ? expected : [2, , 1, , 7], label)
            if (captures) assert.deepStrictEqual(await earlier, [2, , 1, , 7], label)
            assert.equal(r.getErrors(chain, [], ctx), null)
            verifyRefCounts(ctx, chain._state)
        }
    })

    const starts = ["length", "replacement", "entry"]
    const changes = ["append", "distant index", "length", "element entry", "broken prefix"]
    const endings = ["push", "pop", "repair", "replace", "delete", "entry", "read entry"]
    for (const representation of ["private", "indexed", "imported", "shared", "leased", "ArrayView", "Proxy"]) {
        for (const captures of [false, true]) {
            it(`orders Array scopes through later operations: ${representation}, captures=${captures}`, async () => {
                for (const start of starts) for (const change of changes) for (const end of endings) {
                    const ctx = { execution: new r.Execution(), errorContext: {} }
                    const hold = Promise.withResolvers(), lease = Promise.withResolvers()
                    const source = [1, 2, 3]
                    const initial = representation === "ArrayView"
                        ? r.run(new r.Chain(source, ctx), [], "slice", [], ctx, {})
                        : representation === "Proxy" ? new Proxy(source, {}) : source
                    const root = { list: initial }
                    const chain = new r.Chain(representation === "imported" ? r.import(root, ctx) : root, ctx)
                    if (representation === "indexed") assert.equal(r.hasError(chain, [], ctx), false)
                    const waits = [], snapshots = []
                    const track = value => {
                        const result = Promise.resolve(value)
                        result.catch(() => {})
                        waits.push(result)
                        return result
                    }
                    let retained
                    if (representation === "shared") retained = new r.Chain(r.lookupPath(chain, ["list"], ctx), ctx)
                    if (representation === "leased") track(r.enter(chain, ["list"], ctx, false, inside => {
                        return lease.promise.then(() => r.export(inside, [], ctx)).then(value => assert.deepStrictEqual(value, source))
                    }))
                    let expected = [1], poison = false, deleted = false
                    const capture = () => {
                        if (!captures) return
                        const value = r.lookupPath(chain, ["list"], ctx)
                        track(value)
                        snapshots.push({ value, expected: expected.slice(), poison, deleted })
                    }
                    if (start === "length") r.assignPath(chain, ["list", "length"], hold.promise, ctx)
                    if (start === "replacement") r.assignPath(chain, ["list"], hold.promise, ctx)
                    if (start === "entry") track(r.enter(chain, ["list"], ctx, true, inside => {
                        r.assignPath(inside, [], [1], ctx)
                        return hold.promise
                    }))
                    capture()
                    if (change === "append" || change === "distant index") {
                        const index = change === "append" ? 1 : 5
                        r.assignPath(chain, ["list", index], 9, ctx)
                        expected[index] = 9
                    }
                    if (change === "length") { r.assignPath(chain, ["list", "length"], 4, ctx); expected.length = 4 }
                    if (change === "element entry") track(r.enter(chain, ["list", 5], ctx, true, () => {}))
                    if (change === "broken prefix") { r.assignPath(chain, ["list", 5, "missing"], 9, ctx, 1); poison = true }
                    capture()
                    if (end === "push" || end === "pop") {
                        track(r.run(chain, ["list"], end, end === "push" ? [5] : [], ctx, { mutationScopeDepth: 1 }))
                        if (!poison) expected[end](5)
                    }
                    if (end === "repair") { track(r.repairPath(chain, ["list"], ctx)); poison = false }
                    if (end === "replace") { r.assignPath(chain, ["list"], [7], ctx); expected = [7]; poison = false }
                    if (end === "delete") { r.deletePath(chain, ["list"], ctx); deleted = true; poison = false }
                    if (end === "entry") track(r.enter(chain, ["list"], ctx, true, () => {}))
                    if (end === "read entry") track(r.enter(chain, ["list"], ctx, false, () => {}))
                    capture()
                    if (representation === "indexed") verifyRefCounts(ctx, chain._state)
                    const output = track(r.export(chain, [], ctx))
                    hold.resolve(start === "replacement" ? [1] : 1)
                    lease.resolve()
                    const label = `${representation}; captures=${captures}; ${start} -> ${change} -> ${end}`
                    try {
                        await Promise.all(waits)
                        for (const snapshot of snapshots) {
                            const value = await r.export(new r.Chain(await snapshot.value, ctx), [], ctx)
                            if (snapshot.poison) assert.equal(value.kind, r.ERROR_KIND.NullLookup)
                            else assert.deepStrictEqual(value, snapshot.deleted ? undefined : snapshot.expected)
                        }
                        if (poison) assert.equal((await output).kind, r.ERROR_KIND.NullLookup)
                        else assert.deepStrictEqual(await output, deleted ? {} : { list: expected })
                        if (retained) assert.deepStrictEqual(await r.export(retained, [], ctx), [1, 2, 3])
                        if (representation === "imported") assert.deepStrictEqual(source, [1, 2, 3])
                        assert.equal(ctx.execution.fatalError, null)
                        verifyRefCounts(ctx, chain._state.value)
                    } catch (error) { error.message = `${label}: ${error.message}`; throw error }
                }
            })
        }
    }

    for (const index of [0, 1, 5]) for (const delivery of ["ready", "synchronous thenable", "deferred"]) {
        it(`preserves each entered element command's owner: index=${index}, ${delivery}`, async () => {
            for (const commands of sequences(["put", "undefined", "delete", "broken", "fail", "repair"], 3)) {
                const cause = new Error("element failed")
                const fail = function () { this.k = 99; if (delivery === "deferred") return Promise.reject(cause); throw cause }
                const execute = async route => {
                    const ctx = { execution: new r.Execution(), errorContext: {} }
                    const source = [{ k: 1, fail }, , 3]
                    const chain = new r.Chain(r.import({ list: source }, ctx), ctx)
                    const releases = [], outcomes = [], captures = []
                    const keep = value => {
                        if (value instanceof Promise) value.catch(() => {})
                        return value
                    }
                    const perform = (target, path) => {
                        for (const command of commands) {
                            let result
                            if (command === "put" || command === "undefined") {
                                let value = command === "put" ? { k: 9, fail } : undefined
                                if (delivery === "synchronous thenable") {
                                    const ready = value
                                    value = { then(resolve) { return resolve(ready) } }
                                } else if (delivery === "deferred") {
                                    const ready = value, hold = Promise.withResolvers()
                                    releases.push(() => hold.resolve(ready))
                                    value = hold.promise
                                }
                                result = r.assignPath(target, path, value, ctx)
                            } else if (command === "delete") result = r.deletePath(target, path, ctx)
                            else if (command === "broken") result = r.assignPath(target, [...path, "missing", "k"], 2, ctx)
                            else if (command === "fail") result = r.run(target, path, "fail", [], ctx, { mutationScopeDepth: path.length })
                            else result = r.repairPath(target, path, ctx)
                            outcomes.push(keep(result))
                            captures.push(keep(r.export(target, path, ctx)))
                        }
                    }
                    let entry
                    if (route === "direct") perform(chain, ["list", index])
                    else if (route === "owner") entry = r.enter(chain, ["list"], ctx, true, inside => perform(inside, [index]))
                    else entry = r.enter(chain, ["list", index], ctx, true, inside => route === "nested"
                        ? r.enter(inside, [], ctx, true, nested => perform(nested, [])) : perform(inside, []))
                    keep(entry)
                    for (const release of releases.reverse()) release()
                    await entry
                    await Promise.all(outcomes)
                    const normalize = value => r.isPoisonError(value)
                        ? { errors: (value.errors ?? [value]).map(error => error.kind).sort() } : value
                    const root = await r.lookupPath(chain, ["list"], ctx)
                    const snapshot = {
                        listPoisoned: r.isPoisonError(root),
                        captures: (await Promise.all(captures)).map(normalize),
                        values: await Promise.all([[], ["length"], [0], [1], [5]].map(async suffix =>
                            normalize(await r.export(chain, ["list", ...suffix], ctx)))),
                    }
                    verifyRefCounts(ctx, chain._state.value)
                    assert.equal(ctx.execution.fatalError, null)
                    assert.deepStrictEqual(source, [{ k: 1, fail }, , 3])
                    return snapshot
                }
                const expected = await execute("direct")
                // Independent ownership rules supplement route equivalence.
                assert.equal(expected.listPoisoned, false)
                if (index === 5 && ["broken", "fail"].includes(commands[0])) assert.equal(expected.values[1], 6)
                if (index === 5 && commands.join() === "put,fail") {
                    assert.equal(expected.listPoisoned, false)
                    assert.equal(expected.values[1], 6)
                    assert.deepStrictEqual(expected.values[2], { k: 1, fail })
                }
                for (const route of ["owner", "element", "nested"]) {
                    assert.deepStrictEqual(await execute(route), expected, `${route}; index=${index}; ${delivery}; ${commands.join(" -> ")}`)
                }
            }
        })
    }

    for (const nested of [false, true]) for (const deleting of [false, true]) {
        it(`replaces pending data inside a grown element without consuming it, nested=${nested}, deleting=${deleting}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const chain = new r.Chain([1], ctx), data = Promise.withResolvers()
            let observed
            try {
                await r.enter(chain, [5], ctx, true, inside => {
                    const change = target => {
                        r.assignPath(target, [], data.promise, ctx)
                        if (deleting) r.deletePath(target, [], ctx)
                        else r.assignPath(target, [], 9, ctx)
                        observed = r.lookupPath(target, [], ctx)
                    }
                    return nested ? r.enter(inside, [], ctx, true, change) : change(inside)
                })
                assert.equal(observed, deleting ? undefined : 9)
                const expected = [1]
                expected.length = 6
                if (!deleting) expected[5] = 9
                assert.deepStrictEqual(r.export(chain, [], ctx), expected)
                verifyRefCounts(ctx, chain._state.value)
            } finally { data.resolve(8) }
        })
    }

    it("preserves a nested element entry's structural effects after its outer callback closes", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const hold = Promise.withResolvers()
        const chain = new r.Chain({ list: [1, 2], sibling: 3 }, ctx)
        let nested
        assert.equal(r.enter(chain, ["list", 5], ctx, true, outer => {
            nested = r.enter(outer, [], ctx, true, inner => hold.promise.then(() => {
                r.assignPath(inner, [], 9, ctx)
                r.deletePath(inner, [], ctx)
            }))
        }), undefined)
        let lengthReady = false
        const length = Promise.resolve(r.lookupPath(chain, ["list", "length"], ctx)).then(value => { lengthReady = true; return value })
        assert.equal(r.lookupPath(chain, ["sibling"], ctx), 3)
        r.run(chain, ["list"], "push", [7], ctx, { mutationScopeDepth: 1 })
        await checkpoint()
        assert.equal(lengthReady, false)
        hold.resolve()
        await nested
        assert.equal(await length, 6)
        const expected = [1, 2]
        expected.length = 6
        expected.push(7)
        assert.deepStrictEqual(await r.export(chain, ["list"], ctx), expected)
        verifyRefCounts(ctx, chain._state.value)
    })

    it("keeps every public element operation relative to the entered reference", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const chain = new r.Chain([1], ctx)
        await r.enter(chain, [5], ctx, true, async inner => {
            assert.equal(r.lookupPath(inner, [], ctx), undefined)
            assert.equal(r.hasError(inner, [], ctx), false)
            assert.equal(r.getErrors(inner, [], ctx), null)
            r.assignPath(inner, [], { n: 8 }, ctx)
            assert.equal(r.lookupPathForExpression(inner, ["n"], ctx), 8)
            await r.enter(inner, [], ctx, false, observed => {
                assert.deepStrictEqual(r.export(observed, [], ctx), { n: 8 })
            })
            r.assignPath(inner, [], new Error("ordinary Error data"), ctx)
            assert.equal(r.hasError(inner, [], ctx), true)
            assert(r.isPoisonError(r.getErrors(inner, [], ctx)))
        }, 0)
        assert.equal(r.lookupPath(chain, [0], ctx), 1)
        assert.equal(r.lookupPath(chain, ["length"], ctx), 6)
    })

    it("preserves fixed external siblings and their ordering during structural entry", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const hold = Promise.withResolvers(), calls = []
        const api = r.externalState({ read() { calls.push("read"); return 4 } })
        const chain = new r.ContextChain({ list: [api], sibling: 7 }, ctx, { list: { 0: {} } })
        const entry = r.enter(chain, ["list", 5], ctx, true, inner => {
            r.assignPath(inner, [], { n: 8 }, ctx)
            assert.equal(r.lookupPath(inner, ["n"], ctx), 8)
            return hold.promise
        })
        const read = r.run(chain, ["list", 0], "read", [], ctx, {})
        await checkpoint()
        assert.deepStrictEqual(calls, ["read"])
        assert.equal(r.lookupPath(chain, ["sibling"], ctx), 7)
        hold.resolve()
        await entry
        assert.equal(await read, 4)
        assert.equal(r.lookupPath(chain, ["list", "length"], ctx), 6)
        assert.deepStrictEqual(r.export(chain, ["list", 5], ctx), { n: 8 })
        assert.equal(r.getErrors(chain, [], ctx), null)
        verifyRefCounts(ctx, chain._state.value)
    })
})

describe("scope boundary regressions", () => {
    for (const action of ["call", "length"]) {
        it(`preserves a later sibling write after pending ${action} publication`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const hold = Promise.withResolvers()
            const chain = new r.Chain(r.import({ items: [1, 2], sibling: 0 }, ctx), ctx)
            const result = action === "call"
                ? r.run(chain, ["items"], "splice", [hold.promise, 1], ctx, { mutationScopeDepth: 1 })
                : r.assignPath(chain, ["items", "length"], hold.promise, ctx)
            r.assignPath(chain, ["sibling"], 7, ctx)
            assert.equal(r.lookupPath(chain, ["sibling"], ctx), 7)
            hold.resolve(1)
            await result
            await checkpoint()
            assert.deepStrictEqual(await r.export(chain, [], ctx), { items: [1], sibling: 7 })
        })
    }

    for (const deleting of [false, true]) {
        it(`orders root replacement after an active entry, deleting=${deleting}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const hold = Promise.withResolvers()
            const chain = new r.Chain({ x: 1 }, ctx)
            const entry = r.enter(chain, [], ctx, true, () => hold.promise)
            if (deleting) r.deletePath(chain, [], ctx)
            else r.assignPath(chain, [], { x: 2 }, ctx)
            let observed = false
            const observation = Promise.resolve(r.lookupPath(chain, [], ctx)).then(value => { observed = true; return value })
            await checkpoint()
            const bypassed = observed
            hold.resolve()
            await entry
            assert.deepStrictEqual(await observation, deleting ? null : { x: 2 })
            assert.equal(bypassed, false, "Replacement must respect the unfinished entry's transition gate")
        })
    }

    for (const action of ["lookupPath", "export"]) {
        for (const position of [0, 1, 2]) it(`collects accessible snapshot Errors around failed descriptor ${position} through ${action}`, () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const first = new Error("first"), reflection = new Error("descriptor"), last = new Error("last")
            const properties = [["first", first], ["last", last]]
            properties.splice(position, 0, ["inaccessible", 0])
            const data = new Proxy(Object.fromEntries(properties), {
                getOwnPropertyDescriptor(target, key) {
                    if (key === "inaccessible") throw reflection
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const chain = new r.ContextChain({ api: r.externalState({ data }) }, ctx, { api: {} })
            const result = r[action](chain, ["api", "data"], ctx)
            assert(r.isPoisonError(result))
            assert.deepStrictEqual(new Set((result.errors ?? [result]).map(error => error.cause)), new Set([first, reflection, last]))
            assert.equal(r.getErrors(chain, ["api"], ctx), null)
            assert.equal(ctx.execution.fatalError, null)
        })
        it(`ignores non-index Array descriptors during a native snapshot through ${action}`, () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const source = [1]
            source.ignored = 2
            const data = new Proxy(source, {
                getOwnPropertyDescriptor(target, key) {
                    if (key === "ignored") throw new Error("Not a language placement")
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const chain = new r.ContextChain({ api: r.externalState({ data }) }, ctx, { api: {} })
            const result = r[action](chain, ["api", "data"], ctx)
            assert.deepStrictEqual(result, [1])
        })
    }

    for (const copied of [false, true]) for (const deleting of [false, true]) for (const nested of [false, true]) {
        it(`replaces a gate's pending published data without waiting for it, copied=${copied}, deleting=${deleting}, nested=${nested}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const hold = Promise.withResolvers(), data = Promise.withResolvers()
            const source = { target: 1, sibling: 0 }
            const chain = new r.Chain(copied ? r.import(source, ctx) : source, ctx)
            const publish = inside => {
                r.assignPath(inside, [], data.promise, ctx)
                return hold.promise
            }
            let child
            const entry = r.enter(chain, ["target"], ctx, true, nested
                ? inside => { child = r.enter(inside, [], ctx, true, publish) }
                : publish)
            if (copied) r.assignPath(chain, ["sibling"], 7, ctx)
            const earlier = r.lookupPath(chain, ["target"], ctx)
            if (deleting) r.deletePath(chain, ["target"], ctx)
            else r.assignPath(chain, ["target"], 2, ctx)
            let finished = false
            const observation = Promise.resolve(r.lookupPath(chain, ["target"], ctx)).then(value => { finished = true; return value })
            await checkpoint()
            assert.equal(finished, false)
            hold.resolve()
            await entry
            await child
            await checkpoint()
            assert.equal(finished, true, "Publication must not wait for the old pending data")
            assert.equal(await observation, deleting ? undefined : 2)
            const expected = { sibling: copied ? 7 : 0 }
            if (!deleting) expected.target = 2
            assert.deepStrictEqual(await r.export(chain, [], ctx), expected)
            data.resolve(9)
            assert.equal(await earlier, 9)
            assert.deepStrictEqual(await r.export(chain, [], ctx), expected)
            verifyRefCounts(ctx, chain._state.value)
        })
    }

    it("keeps queued replacements and their observations in issuance order", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const hold = Promise.withResolvers()
        const chain = new r.Chain({ target: 0 }, ctx)
        const entry = r.enter(chain, ["target"], ctx, true, () => hold.promise)
        const results = [r.lookupPath(chain, ["target"], ctx)]
        r.assignPath(chain, ["target"], 1, ctx)
        results.push(r.lookupPath(chain, ["target"], ctx))
        r.deletePath(chain, ["target"], ctx)
        results.push(r.lookupPath(chain, ["target"], ctx))
        r.assignPath(chain, ["target"], 3, ctx)
        results.push(r.lookupPath(chain, ["target"], ctx))
        hold.resolve()
        await entry
        assert.deepStrictEqual(await Promise.all(results), [0, 1, undefined, 3])
        assert.deepStrictEqual(await r.export(chain, [], ctx), { target: 3 })
    })

    it("retains a gate's pending publication as the recovery baseline of a failed replacement", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const hold = Promise.withResolvers(), data = Promise.withResolvers()
        const chain = new r.Chain({ then: data.promise }, ctx)
        const entry = r.enter(chain, ["then"], ctx, true, () => hold.promise)
        r.assignPath(chain, ["then"], () => {}, ctx)
        const replacement = r.lookupPath(chain, ["then"], ctx)
        hold.resolve()
        await entry
        assert.equal((await replacement).kind, r.ERROR_KIND.PropertyValidation)
        await r.repairPath(chain, ["then"], ctx)
        const restored = r.lookupPath(chain, ["then"], ctx)
        data.resolve(8)
        assert.equal(await restored, 8)
        assert.deepStrictEqual(await r.export(chain, [], ctx), { then: 8 })
    })

    it("releases absent gate placements after their captured consumers complete", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const chain = new r.Chain({}, ctx)
        for (let index = 0; index < 100; index++) r.enter(chain, [`absent${index}`], ctx, true, () => {})
        await checkpoint()
        assert.deepStrictEqual(await r.export(chain, [], ctx), {})
        assert.deepStrictEqual(Object.keys(metaOf(chain._state.value, ctx).placementVersions ?? {}), [],
            "An empty settled graph must not retain historical absent entries")
    })

    it("releases absent gate versions while preserving captures in a copied parent", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const chain = new r.Chain(r.import({}, ctx), ctx)
        const completions = []
        for (let index = 0; index < 20; index++) {
            const hold = Promise.withResolvers()
            const key = `absent${index}`
            const entry = r.enter(chain, [key], ctx, true, () => hold.promise)
            const observed = r.lookupPath(chain, [key], ctx)
            const retained = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
            r.assignPath(chain, ["sibling"], index, ctx)
            const retainedExport = r.export(retained, [], ctx)
            hold.resolve()
            completions.push(Promise.all([entry, observed, retainedExport]).then(([, value, snapshot]) => {
                assert.equal(value, undefined)
                assert.equal(Object.hasOwn(snapshot, key), false)
                verifyRefCounts(ctx, retained._state.value)
            }))
        }
        await Promise.all(completions)
        assert.deepStrictEqual(await r.export(chain, [], ctx), { sibling: 19 })
        assert.deepStrictEqual(Object.keys(metaOf(chain._state.value, ctx).placementVersions ?? {}), [])
        verifyRefCounts(ctx, chain._state.value)
    })
})
