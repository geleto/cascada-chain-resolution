import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { metaOf } from "../src/meta.js"
import { verifyRefCounts } from "./verify-refcounts.js"

// Tests reach the storage oracle through verifyRefCounts, the suite's common
// consistency check, so this also guards that it keeps running there.
describe("storage verifier", () => {
    it("rejects a retained backing prefix beyond the logical view length", () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const view = r.run(new r.Chain([1], ctx), [], "push", [], ctx, {})
        verifyRefCounts(ctx, view)
        metaOf(view, ctx).retainedPrefixLength = 2
        assert.throws(() => verifyRefCounts(ctx, view), /Retained backing prefix exceeds its view/)
    })

    it("rejects an unprotected child in a retained backing prefix", () => {
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const child = { n: 1 }
        const view = r.run(new r.Chain([child], ctx), [], "push", [], ctx, {})
        verifyRefCounts(ctx, view)
        metaOf(child, ctx).shared = false
        assert.throws(() => verifyRefCounts(ctx, view), /Retained backing prefix contains an unprotected child/)
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
