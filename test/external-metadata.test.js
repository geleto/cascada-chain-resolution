import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable } from "./ordered-thenable.js"
import { TREE_NODE } from "../src/external-mutation-tree.js"
import { spawnSync } from "node:child_process"

const turn = () => new Promise(setImmediate)
function fixture() {
    const ctx = { execution: new r.Execution(), errorContext: "metadata versions" }, calls = []
    const db = r.externalState({ fail() { throw new Error("db") }, read() { calls.push("db"); return 1 } })
    const other = r.externalState({ fail() { throw new Error("other") }, read() { calls.push("other"); return 2 } })
    const api = r.externalState({ db, other, fail() { throw new Error("api") }, read() { calls.push("api"); return 3 } })
    const chain = new r.ContextChain({ api, sibling: 7 }, ctx, { api: { db: {}, other: {} } })
    return { ctx, chain, api, calls }
}
const mutate = (chain, ctx, path, method = "fail") => r.run(chain, path, method, [], ctx, { mutationScopeDepth: path.length })
const leaves = value => new Set(value?.errors ?? (value ? [value] : []))

describe("versioned external metadata", () => {
    for (const entered of [false, true])
    for (const previous of ["healthy", "ready", "pending", "child-poison", "own-poison"])
    for (const outcome of ["throw", "direct", "reject", "argument", "missing", "success"])
    it(`publishes repair-and-call after ${previous}: ${outcome}, entered=${entered}`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: "repair-and-call" }
        const earlier = Promise.withResolvers(), failed = Promise.withResolvers()
        failed.promise.catch(() => {})
        const direct = r.createPoisonError(new Error("direct"), ctx, r.ERROR_KIND.InvocationFailed)
        let calls = 0, reads = 0
        const child = r.externalState({ fail() { throw new Error("child") } })
        const api = r.externalState({
            child,
            ok() { return previous === "pending" ? earlier.promise : 1 },
            old() { throw new Error("old") },
            change() {
                calls++
                if (outcome === "throw") throw new Error("new")
                return outcome === "direct" ? direct : outcome === "reject" ? failed.promise : 1
            },
            read() { reads++; return 7 },
        })
        const chain = new r.ContextChain({ api }, ctx, { api: { child: {} } })
        let result, before, after, read, old
        const issue = (owner, path) => {
            if (previous === "ready" || previous === "pending") mutate(owner, ctx, path, "ok")
            if (previous === "child-poison") old = mutate(owner, ctx, [...path, "child"])
            if (previous === "own-poison") old = mutate(owner, ctx, path, "old")
            before = r.getErrors(owner, path, ctx)
            result = r.run(owner, path, outcome === "missing" ? "missing" : "change",
                outcome === "argument" ? [failed.promise] : [], ctx, { mutationScopeDepth: path.length, repair: true })
            after = r.getErrors(owner, path, ctx)
            read = r.run(owner, path, "read", [], ctx, {})
            return result
        }
        const entry = entered ? r.enter(chain, ["api"], ctx, true, inside => issue(inside, [])) : issue(chain, ["api"])
        earlier.resolve(1)
        if (outcome === "reject" || outcome === "argument") failed.reject(new Error("new"))
        const received = await result
        await entry
        assert.equal(await before, old ?? null, "The earlier metadata view keeps its original poison")
        if (outcome === "success") {
            assert.equal(received, 1)
            assert.equal(await after, null)
            assert.equal(await read, 7)
            assert.equal(reads, 1)
        } else {
            assert.equal(received.kind, outcome === "argument" ? r.ERROR_KIND.OperationInputFailed : r.ERROR_KIND.InvocationFailed)
            assert.equal(await after, received, "The new failure belongs to the repaired scope")
            assert.equal(await read, received, "Later host work must be blocked")
            assert.equal(reads, 0)
        }
        assert.equal(calls, outcome === "argument" || outcome === "missing" ? 0 : 1)
        assert.equal(await r.getErrors(chain, ["api"], ctx), outcome === "success" ? null : received)
        assert.equal(ctx.execution.fatalError, null)
    })

    it("bounds pending selection work and releases completed history", function () {
        this.timeout(30000)
        const result = spawnSync(process.execPath, [...process.execArgv, "--unhandled-rejections=strict",
            "test/fixtures/path-selection-work.mjs"], { encoding: "utf8", timeout: 25000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })
    it("captures a pending failure before a covering reset without holding later native siblings", async () => {
        const { ctx, chain, api, calls } = fixture(), gate = Promise.withResolvers()
        api.db.fail = () => gate.promise
        const mutation = mutate(chain, ctx, ["api", "db"])
        const earlier = r.getErrors(chain, ["api"], ctx)
        assert.equal(r.repairPath(chain, ["api"], ctx), undefined)
        assert.equal(r.getErrors(chain, ["api"], ctx), null)
        assert.equal(r.run(chain, ["api", "other"], "read", [], ctx, {}), 2)
        assert.deepEqual(calls, ["other"])
        gate.reject(new Error("late"))
        assert.equal(await earlier, await mutation)
        assert.equal(r.getErrors(chain, ["api"], ctx), null)
    })

    for (const mutation of [false, true]) it(`retains selected projections after a covering reset, mutation=${mutation}`, async () => {
        const { ctx, chain } = fixture(), gate = Promise.withResolvers()
        const entry = r.enter(chain, [], ctx, true, () => gate.promise)
        const call = r.run(chain, ["api", "db"], "read", [], ctx, mutation ? { mutationScopeDepth: 2 } : {})
        const repair = r.repairPath(chain, ["api"], ctx)
        gate.resolve()
        await entry
        assert.equal(await call, 1)
        await repair
        assert.equal(r.getErrors(chain, [], ctx), null)
    })

    for (const selected of ["db", "other"])
    it(`retains issuance snapshots across delayed selection and intervening writes: ${selected}`, async () => {
        const { ctx, chain } = fixture(), key = Promise.withResolvers()
        const before = mutate(chain, ctx, ["api", "db"])
        const query = r.getErrors(chain, ["api", key.promise], ctx)
        const repair = r.repairPath(chain, ["api", key.promise], ctx)
        const later = mutate(chain, ctx, ["api", "other"])
        key.resolve(selected)
        assert.equal(await query, selected === "db" ? before : null)
        assert.equal(await repair, undefined)
        const newFailure = await later
        assert.deepEqual(leaves(await r.getErrors(chain, ["api"], ctx)),
            new Set(selected === "db" ? [newFailure] : [before, newFailure]))
    })

    it("a covering reset bypasses an unresolved selection while earlier snapshots retain it", async () => {
        const { ctx, chain } = fixture(), key = Promise.withResolvers()
        const old = mutate(chain, ctx, ["api", "db"])
        const repair = r.repairPath(chain, ["api", key.promise], ctx)
        const captured = r.getErrors(chain, ["api"], ctx)
        assert.equal(r.repairPath(chain, ["api"], ctx), undefined)
        assert.equal(r.getErrors(chain, ["api"], ctx), null)
        key.resolve("other")
        await repair
        assert.equal(await captured, old)
        assert.equal(r.getErrors(chain, ["api"], ctx), null)
    })

    for (const selected of ["db", "unregistered"])
    it(`a reset retains strict-ancestor poison until selection determines its scope: ${selected}`, async () => {
        const { ctx, chain } = fixture(), key = Promise.withResolvers()
        const old = mutate(chain, ctx, ["api"])
        const repair = r.repairPath(chain, ["api", key.promise], ctx)
        const descendant = r.repairPath(chain, ["api", "db"], ctx)
        key.resolve(selected)
        assert.equal(await repair, selected === "db" ? old : undefined)
        assert.equal(await descendant, selected === "db" ? old : undefined)
        assert.equal(await r.getErrors(chain, ["api"], ctx), selected === "db" ? old : null)
    })

    for (const delivery of ["ready", "synchronous", "native", "ordered"])
    for (const suffix of ["invalid", "poison", "pending"])
    it(`stops repair at a strict-ancestor Error before an unused ${suffix} key: ${delivery}`, async () => {
        const { ctx, chain } = fixture(), unused = new OrderedThenable()
        const old = mutate(chain, ctx, ["api"])
        const key = delivery === "native" ? Promise.withResolvers() : new OrderedThenable()
        const selected = delivery === "ready" ? "db" : delivery === "synchronous"
            ? { then: resolve => resolve("db") } : key.promise ?? key
        const tail = suffix === "pending" ? unused : suffix === "invalid" ? {} :
            r.createPoisonError(new Error("unused key"), ctx, r.ERROR_KIND.OperationInputFailed)
        const result = r.repairPath(chain, ["api", selected, tail], ctx)
        key.resolve("db")
        await turn()
        try {
            assert.equal(unused.subscriptions, 0, "The failed prefix must not consume another key")
            assert.equal(await result, old, "The ancestor's exact Error precedes unused-key validation")
            assert.equal(r.getErrors(chain, ["api"], ctx), old)
        } finally { unused.resolve("unused"); await result }
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const action of ["assign", "delete", "call", "repair-call"])
    for (const suffix of ["invalid", "poison", "pending"])
    it(`stops ${action} at native poison before an unused ${suffix} key`, async () => {
        const { ctx, chain } = fixture(), unused = new OrderedThenable()
        const old = mutate(chain, ctx, ["api"])
        const tail = suffix === "pending" ? unused : suffix === "invalid" ? {} :
            r.createPoisonError(new Error("unused key"), ctx, r.ERROR_KIND.OperationInputFailed)
        const path = action === "repair-call" ? ["api", "db", tail] : ["api", tail]
        const result = action === "assign" ? r.assignPath(chain, path, 2, ctx) :
            action === "delete" ? r.deletePath(chain, path, ctx) :
                r.run(chain, path, "read", [], ctx, { mutationScopeDepth: action === "repair-call" ? 2 : 1,
                    repair: action === "repair-call" })
        try {
            assert.equal(unused.subscriptions, 0)
            assert.equal(result, old)
            assert.equal(r.getErrors(chain, ["api"], ctx), old)
        } finally { unused.resolve("unused"); await result }
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const failed of [false, true])
    it(`checks an unfinished strict ancestor before a repair suffix: failed=${failed}`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: "ancestor outcome" }
        const gate = Promise.withResolvers(), suffix = new OrderedThenable()
        const source = new r.ContextChain({ api: r.externalState({ db: r.externalState({}),
            wait() { return gate.promise } }) }, ctx, { api: { db: {} } })
        const original = mutate(source, ctx, ["api"], "wait")
        const result = r.repairPath(source, ["api", "db", suffix], ctx)
        assert.equal(suffix.subscriptions, 0, "An unavailable prefix precedes its suffix")
        if (failed) gate.reject(new Error("ancestor"))
        else gate.resolve(1)
        const before = await original
        await turn()
        try {
            assert.equal(suffix.subscriptions, failed ? 0 : 1)
            if (failed) assert.equal(await result, before)
        } finally { suffix.resolve("unregistered"); await result }
        assert.equal(await r.getErrors(source, ["api"], ctx), failed ? before : null)
    })

    it("repair-and-call can clear its declared broader scope before using a child", () => {
        const { ctx, chain } = fixture()
        mutate(chain, ctx, ["api"])
        assert.equal(r.run(chain, ["api", "db"], "read", [], ctx,
            { mutationScopeDepth: 1, repair: true }), 1)
        assert.equal(r.getErrors(chain, ["api"], ctx), null)
    })

    it("still completes a fixed mutation scope's Error collection before failing", async () => {
        const ctx = { execution: new r.Execution(), errorContext: "fixed scope collection" }
        const first = Promise.withResolvers(), second = Promise.withResolvers(), suffix = new OrderedThenable()
        let calls = 0, settled = false
        const source = new r.ContextChain({ api: r.externalState({
            db: r.externalState({ wait() { return first.promise } }),
            other: r.externalState({ wait() { return second.promise } }),
            read() { calls++; return 1 },
        }) }, ctx, { api: { db: {}, other: {} } })
        const left = mutate(source, ctx, ["api", "db"], "wait")
        const right = mutate(source, ctx, ["api", "other"], "wait")
        const result = r.run(source, ["api", suffix], "read", [], ctx, { mutationScopeDepth: 1 })
        const delivered = Promise.resolve(result).then(value => { settled = true; return value })
        first.reject(new Error("first"))
        const leftError = await left
        await turn()
        try {
            assert.equal(settled, false, "The second earlier native outcome still requires collection")
            assert.equal(suffix.subscriptions, 0, "The native scope precedes its receiver suffix")
        } finally { second.reject(new Error("second")); suffix.resolve("unused") }
        const rightError = await right
        assert.deepEqual(leaves(await delivered), new Set([leftError, rightError]))
        assert.equal(calls, 0)
        assert.deepEqual(leaves(r.getErrors(source, ["api"], ctx)), new Set([leftError, rightError]))
        r.repairPath(source, ["api", "db"], ctx)
        r.repairPath(source, ["api", "other"], ctx)
        assert.equal(r.getErrors(source, ["api"], ctx), null, "Blocked work must not copy child poison into its parent")
    })

    for (const call of [false, true])
    it(`preserves inherited ancestor poison before entered repair keys: call=${call}`, async () => {
        const { ctx, chain } = fixture(), suffix = new OrderedThenable()
        const old = mutate(chain, ctx, ["api"])
        let result
        const entered = r.enter(chain, ["api", "db"], ctx, true, inside => {
            result = call ? r.run(inside, [suffix], "read", [], ctx, { mutationScopeDepth: 0, repair: true }) :
                r.repairPath(inside, [suffix], ctx)
            return result
        })
        try {
            assert.equal(suffix.subscriptions, 0)
            assert.equal(result, old)
            assert.equal(await entered, old)
            assert.equal(r.getErrors(chain, ["api"], ctx), old)
        } finally { suffix.resolve("unused"); await entered }
    })

    it("publishes entry metadata without extending native coverage for overwritten repairs", async () => {
        const { ctx, chain } = fixture(), key = Promise.withResolvers()
        const old = mutate(chain, ctx, ["api", "db"])
        let repair
        const entry = r.enter(chain, ["api"], ctx, true, inside => {
            repair = r.repairPath(inside, [key.promise], ctx)
        })
        assert.equal(entry, undefined)
        const earlier = r.getErrors(chain, ["api"], ctx)
        let ran = false
        const native = Promise.resolve(r.run(chain, ["api", "other"], "read", [], ctx, {})).then(value => { ran = true; return value })
        await turn()
        assert.equal(ran, false, "The earlier reader retains the pending metadata publication")
        assert.equal(r.repairPath(chain, ["api"], ctx), undefined)
        assert.equal(r.getErrors(chain, ["api"], ctx), null)
        assert.equal(r.run(chain, ["api", "other"], "read", [], ctx, {}), 2)
        await turn()
        assert.equal(ran, false, "Reset must not revise the earlier reader's capture")
        key.resolve("other")
        await repair
        assert.equal(await earlier, old)
        assert.equal(await native, 2)
    })

    it("releases a forbidden observation's unused read reservation before its predecessor", async () => {
        const { ctx, chain, api } = fixture(), work = Promise.withResolvers(), key = Promise.withResolvers()
        api.db.fail = () => work.promise
        const mutation = mutate(chain, ctx, ["api", "db"])
        const read = r.lookupPath(chain, ["api", key.promise, "value"], ctx)
        key.resolve("db")
        assert.equal((await read).kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(r.run(chain, ["api", "other"], "read", [], ctx, { mutationScopeDepth: 2 }), 2)
        work.resolve()
        await mutation
    })

    it("does not consume a key after an earlier own-poison blocker", () => {
        const { ctx, chain } = fixture(), key = new OrderedThenable()
        const old = mutate(chain, ctx, ["api"])
        assert.equal(r.getErrors(chain, ["api", key], ctx), old)
        assert.equal(r.lookupPath(chain, ["api", key], ctx), old)
        assert.equal(key.subscriptions, 0)
    })

    for (const reverse of [false, true]) for (const count of [32, 128, 512])
    it(`releases resolved selection history: count=${count}, reverse=${reverse}`, async () => {
        const { ctx, chain } = fixture(), keys = [], results = []
        for (let i = 0; i < count; i++) {
            const key = Promise.withResolvers()
            keys.push(key)
            results.push(r.repairPath(chain, ["api", key.promise], ctx))
        }
        const pending = r.getErrors(chain, ["api"], ctx)
        for (const key of reverse ? keys.reverse() : keys) key.resolve("unregistered")
        await Promise.all(results)
        assert.equal(await pending, null)
        const visited = new Set(), work = [chain._externalMutationTree[TREE_NODE].metadata.current]
        while (work.length) {
            const state = work.pop()
            if (!state || visited.has(state)) continue
            visited.add(state)
            work.push(state.a, state.b, state.into)
        }
        assert(visited.size < 12, `Retained ${visited.size} states after publication`)
        assert.equal(r.getErrors(chain, ["api"], ctx), null)
    })
})
