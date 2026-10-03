import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { metaOf } from "../src/meta.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { verifyLiveness } from "./verify-parents.js"

// Tests reach the storage oracle through verifyRefCounts, the suite's common
// consistency check, so this also guards that it keeps running there.
describe("graph consistency verifiers", () => {
    it("rejects an incoming placement from a retired parent", () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const child = {}, parent = { child }
        const survivor = new r.Chain(child, ctx), holder = new r.Chain(parent, ctx)
        r.assignPath(holder, [], null, ctx)
        metaOf(child, ctx).incomingParents = new Map([[survivor._state, new Set(["value"])], [parent, new Set(["child"])]])
        assert.throws(() => verifyRefCounts(ctx, survivor._state), /retired parent/)
    })

    it("rejects activity inconsistent with independently modeled roots", () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }, value = {}
        const holder = new r.Chain(value, ctx)
        r.assignPath(holder, [], null, ctx)
        verifyLiveness(ctx, [value], new Set())
        metaOf(value, ctx).relationshipsActive = true
        assert.throws(() => verifyLiveness(ctx, [value], new Set()), /modeled liveness/)
    })

    for (const fault of ["missing", "extra"]) it("rejects " + fault + " reciprocal counter child links", () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }, parent = { child: {} }
        const holder = new r.Chain(parent, ctx)
        assert.equal(r.hasError(holder, [], ctx), false)
        verifyRefCounts(ctx, holder._state)
        if (fault === "missing") metaOf(parent, ctx).counterChildren.clear()
        else metaOf(parent, ctx).counterChildren.add(new Map())
        assert.throws(() => verifyRefCounts(ctx, holder._state), /Counter child links|reciprocal child link/)
    })

    it("accepts storage masked by an absent overlay and rejects a false absence fact", async () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }, hold = Promise.withResolvers()
        const chain = new r.Chain({ data: [3, 7, 1] }, ctx)
        const entry = r.enter(chain, ["data", 0], ctx, true, () => hold.promise)
        const deletion = r.deletePath(chain, ["data", 0], ctx)
        const noop = r.enter(chain, ["data", 0], ctx, true, () => undefined)
        hold.resolve()
        await Promise.all([entry, deletion, noop])
        // The deletion published only its captured version, and the no-op entry
        // wrote nothing, so an absent overlay now masks the stale slot.
        const array = await r.lookupPath(chain, ["data"], ctx)
        const version = metaOf(array, ctx).placementVersions["0"]
        assert.equal(version.present, false)
        assert(Object.hasOwn(array, "0"))
        verifyRefCounts(ctx, chain._state)
        version.storageAbsent = true
        assert.throws(() => verifyRefCounts(ctx, chain._state), /Absent storage fact hides a physical placement/)
    })
})
