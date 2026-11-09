import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as r from "../src/index.js"
import { OrderedThenable, ready } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new r.Execution(), errorContext: "status repair" })
const mutate = (chain, path, method, ctx, repair = false) =>
    r.run(chain, path, method, [], ctx, { mutationScopeDepth: path.length, repair })
const sameRoot = (left, right, ctx) => r.run(new r.Chain([r.lookupPath(left, [], ctx)], ctx), [],
    "includes", [r.lookupPath(right, [], ctx)], ctx, {})

describe("exact path status repair", () => {
    for (const ordinaryError of [false, true]) for (const pending of [false, true])
    it(`repair-and-call without status preserves no-op identity: Error=${ordinaryError}, pending=${pending}`, async () => {
        const ctx = context(), source = Promise.withResolvers()
        const data = ordinaryError ? r.createPoisonError(new Error("data"), ctx, r.ERROR_KIND.OperationInputFailed) : [1]
        const chain = new r.Chain({ item: pending ? source.promise : data }, ctx)
        const captured = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
        const result = r.run(chain, ["item"], ordinaryError ? "missing" : "fill",
            ordinaryError ? [] : [9, 0, 0], ctx, { mutationScopeDepth: 1, repair: true })
        source.resolve(data)
        if (ordinaryError) assert.equal(await result, data)
        else assert.deepEqual(await r.export(new r.Chain(await result, ctx), [], ctx), [1])
        assert.equal(await sameRoot(chain, captured, ctx), true, "Neither repair nor the blocked/no-op call published a change")
        assert.equal(r.repairPath(chain, ["item"], ctx), undefined)
        assert.equal(await sameRoot(chain, captured, ctx), true, "Blocked ordinary Error data must not acquire own status")
        verifyRefCounts(ctx, chain._state, captured._state)
    })

    it("retains current data through the owner without attaching it to diagnostics", function () {
        this.timeout(30000)
        const result = spawnSync(process.execPath, [...process.execArgv, "--expose-gc", "--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/status-repair-retention.mjs", import.meta.url))],
        { encoding: "utf8", timeout: 25000 })
        assert.equal(result.error, undefined)
        assert.equal(result.status, 0, result.stderr || result.stdout)
    })

    it("bounds repeated status changes over one unresolved payload", function () {
        this.timeout(30000)
        const result = spawnSync(process.execPath, [...process.execArgv, "--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/status-repair-work.mjs", import.meta.url))],
        { encoding: "utf8", timeout: 25000 })
        assert.equal(result.error, undefined)
        assert.equal(result.status, 0, result.stderr || result.stdout)
    })

    it("preserves queued failure status through an Array copy", async () => {
        const ctx = context(), pending = Promise.withResolvers()
        const chain = new r.Chain([pending.promise], ctx)
        r.hasError(chain, [], ctx)
        r.assignPath(chain, [0, "x"], 9, ctx)
        const copy = new r.Chain(r.run(chain, [], "slice", [], ctx, {}), ctx)
        pending.resolve(2)
        const failure = await r.lookupPath(chain, [0], ctx)
        assert.equal(failure.kind, r.ERROR_KIND.ScalarLookup)
        assert.equal(await r.lookupPath(copy, [0], ctx), failure)
        assert.equal(r.repairPath(copy, [0], ctx), undefined)
        assert.equal(r.lookupPath(copy, [0], ctx), 2)
        assert.equal(r.lookupPath(chain, [0], ctx), failure)
        verifyRefCounts(ctx, chain._state, copy._state)
    })

    it("orders an absent flagged record placement before a later sibling", async () => {
        const ctx = context(), held = Promise.withResolvers()
        const chain = new r.Chain({ a: { k0: 0, k1: 1 } }, ctx)
        const entry = r.enter(chain, ["a"], ctx, true, () => held.promise)
        r.deletePath(chain, ["a", "k2"], ctx)
        r.assignPath(chain, ["a", "k2", "x"], 9, ctx)
        r.assignPath(chain, ["a", "k3"], 3, ctx)
        held.resolve()
        await entry
        const value = await r.lookupPath(chain, ["a"], ctx)
        // Enumerate the supported logical graph, including metadata-only keys.
        const { logicalKeys } = await import("./support.js")
        assert.deepEqual([...logicalKeys(value, ctx)], ["k0", "k1", "k2", "k3"])
        assert.equal(r.repairPath(chain, ["a", "k2"], ctx), undefined)
        assert.deepEqual(await r.export(chain, ["a"], ctx), { k0: 0, k1: 1, k3: 3 })
        verifyRefCounts(ctx, chain._state)
    })

    for (const scope of [0, 1]) for (const pending of [false, true])
    it(`keeps flagged property order when replaced: scope=${scope}, pending=${pending}`, async () => {
        const ctx = context(), held = Promise.withResolvers()
        const chain = new r.Chain({ a: 1 }, ctx)
        const entry = pending ? r.enter(chain, [], ctx, true, () => held.promise) : undefined
        r.assignPath(chain, ["b", "x"], 2, ctx)
        r.assignPath(chain, ["c"], 3, ctx)
        r.assignPath(chain, ["b"], 4, ctx, scope)
        held.resolve()
        await entry
        const exported = await r.export(chain, [], ctx)
        assert.deepEqual(Object.keys(exported), ["a", "b", "c"])
        assert.deepEqual(exported, { a: 1, b: 4, c: 3 })
        verifyRefCounts(ctx, chain._state)
    })

    for (const mode of ["ready", "synchronous", "native", "ordered"]) {
        it(`clears repeated status once without consuming the payload: ${mode}`, async () => {
            const ctx = context(), data = { n: 1 }
            const pending = mode === "ordered" ? new OrderedThenable() : Promise.withResolvers()
            const payload = mode === "ready" ? data : mode === "synchronous" ? ready(data) : pending.promise ?? pending
            const chain = new r.Chain({ then: payload, sibling: 2 }, ctx)
            r.assignPath(chain, ["then"], () => 1, ctx)
            const failure = r.assignPath(chain, ["then"], () => 2, ctx)
            const held = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
            assert.equal(r.getErrors(chain, ["then"], ctx), failure)
            assert.equal(r.repairPath(chain, ["then"], ctx), undefined)
            assert.equal(r.lookupPath(held, ["then"], ctx), failure)
            assert.equal(r.lookupPath(chain, ["sibling"], ctx), 2)
            const value = r.lookupPath(chain, ["then", "n"], ctx)
            if (mode === "native" || mode === "ordered") {
                assert(value instanceof Promise || typeof value?.then === "function")
                pending.resolve(data)
            }
            assert.equal(await value, 1)
            assert.equal(r.repairPath(held, ["then"], ctx), undefined)
            assert.equal(r.lookupPath(held, ["then", "n"], ctx), 1)
            verifyRefCounts(ctx, chain._state, held._state)
        })
    }

    it("keeps ordinary Error data after successful repair", () => {
        const ctx = context()
        const dataError = r.assignPath(new r.Chain({ then: 0 }, ctx), ["then"], () => 0, ctx)
        const chain = new r.Chain({ item: dataError }, ctx)
        assert.equal(r.repairPath(chain, ["item"], ctx), undefined)
        assert.equal(r.lookupPath(chain, ["item"], ctx), dataError)
        assert.equal(r.hasError(chain, [], ctx), true)
    })

    it("publishes a gated failure before its retained payload is available", async () => {
        const ctx = context(), payload = Promise.withResolvers(), assigned = Promise.withResolvers()
        const chain = new r.Chain({ then: payload.promise, sibling: 3 }, ctx)
        r.assignPath(chain, ["then"], assigned.promise, ctx)
        const earlier = r.lookupPath(chain, ["then"], ctx)
        r.assignPath(chain, ["then", "n"], 2, ctx)
        const later = r.lookupPath(chain, ["then"], ctx)
        assigned.resolve(() => 0)
        const delivered = await Promise.race([
            Promise.all([earlier, later]),
            new Promise(resolve => setImmediate(() => resolve("still waiting"))),
        ])
        assert.notEqual(delivered, "still waiting", "Path status must not wait for hidden data")
        assert(r.isPoisonError(delivered[0]))
        assert.equal(delivered[1], delivered[0])
        assert.equal(r.repairPath(chain, ["then"], ctx), undefined)
        payload.resolve({ n: 1 })
        assert.equal(await r.lookupPath(chain, ["then", "n"], ctx), 1)
        verifyRefCounts(ctx, chain._state)
    })

    it("discards failed managed native work before clearing its status", () => {
        const ctx = context(), cause = new Error("failed mutation")
        const data = { n: 1, fail() { this.n = 9; throw cause } }
        const chain = new r.Chain(r.import({ data }, ctx), ctx)
        const failure = mutate(chain, ["data"], "fail", ctx)
        assert.equal(failure.cause, cause)
        assert.equal(r.lookupPath(chain, ["data"], ctx), failure)
        assert.equal(data.n, 1)
        assert.equal(r.repairPath(chain, ["data"], ctx), undefined)
        assert.equal(r.lookupPath(chain, ["data", "n"], ctx), 1)
        verifyRefCounts(ctx, chain._state)
    })

    it("clears a managed parent without clearing a child's status", () => {
        const ctx = context(), chain = new r.Chain({ group: { then: { n: 1 } } }, ctx)
        const child = r.assignPath(chain, ["group", "then"], () => 0, ctx)
        const parent = r.assignPath(chain, ["group", null], 2, ctx)
        assert.equal(r.lookupPath(chain, ["group"], ctx), parent)
        assert.equal(r.repairPath(chain, ["group"], ctx), undefined)
        assert.equal(r.lookupPath(chain, ["group", "then"], ctx), child)
        assert.equal(r.repairPath(chain, ["group", "then"], ctx), undefined)
        assert.equal(r.lookupPath(chain, ["group", "then", "n"], ctx), 1)
        verifyRefCounts(ctx, chain._state)
    })

    it("clears external own status without undoing effects or clearing descendants", () => {
        const ctx = context(), childCause = new Error("child"), parentCause = new Error("parent")
        const child = r.externalState({ n: 1, fail() { this.n = 2; throw childCause } })
        const api = r.externalState({ child, n: 1, fail() { this.n = 2; throw parentCause } })
        const chain = new r.ContextChain({ api }, ctx, { api: { child: {} } })
        const parentFailure = mutate(chain, ["api"], "fail", ctx)
        assert.equal(parentFailure.cause, parentCause)
        assert.equal(r.repairPath(chain, ["api"], ctx), undefined)
        const childFailure = mutate(chain, ["api", "child"], "fail", ctx)
        assert.equal(childFailure.cause, childCause)
        assert.equal(r.repairPath(chain, ["api"], ctx), undefined)
        assert.equal(r.getErrors(chain, ["api"], ctx), childFailure)
        assert.equal(r.repairPath(chain, ["api", "child"], ctx), undefined)
        assert.equal(r.getErrors(chain, ["api"], ctx), null)
        assert.equal(api.n, 2)
        assert.equal(child.n, 2)
    })
})
