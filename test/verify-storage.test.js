import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { metaOf } from "../src/meta.js"
import { verifyStorage } from "./verify-storage.js"

describe("storage verifier", () => {
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
        verifyStorage(ctx, chain._state)
        version.storageAbsent = true
        assert.throws(() => verifyStorage(ctx, chain._state), /Absent storage fact hides a physical placement/)
    })
})
