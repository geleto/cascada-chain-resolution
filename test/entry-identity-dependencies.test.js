import assert from "node:assert/strict"
import * as r from "../src/index.js"

describe("entry identity dependencies", () => {
    for (const route of ["external-write", "external-call", "managed-call"])
    for (const changes of [false, true]) {
        it(`captures callback access before an alias-dependent mutation: ${route}/${changes}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: route }
            const native = route !== "managed-call"
            const data = { marker: 0, target: null, read() { return this.marker }, put(value) { this.target = value } }
            const api = native ? r.externalState(data) : data
            const holder = native
                ? new r.ContextChain({ api }, ctx, { api: {} })
                : new r.Chain(r.import({ api }, ctx), ctx)
            const source = new r.Chain([, 7, ,], ctx)
            const before = new r.Chain(r.lookupPath(source, [], ctx), ctx)
            const resume = Promise.withResolvers()
            // Both references are ready here. Capture the read before suspension,
            // then use its entry view instead of issuing through the outside Chain.
            const entry = r.enter(holder, ["api"], ctx, false, reference =>
                r.enter(source, [0], ctx, true, inside => resume.promise.then(async () => {
                    const value = native
                        ? await r.run(reference, [], "read", [], ctx, {})
                        : await r.lookupPath(reference, ["marker"], ctx)
                    assert.equal(value, 0)
                    if (changes) r.assignPath(inside, [], 8, ctx)
                    return value
                })))
            // The pending presence of index 0 determines whether deleting it is
            // effective. Data is ready while the pair's identity partition waits.
            r.run(source, [], "copyWithin", [0, 2, 3], ctx, { mutationScopeDepth: 0 })
            const pair = { a: r.lookupPath(before, [], ctx), b: r.lookupPath(source, [], ctx) }
            const mutation = route === "external-write"
                ? r.assignPath(holder, ["api", "target"], pair, ctx)
                : r.run(holder, ["api"], "put", [pair], ctx, { mutationScopeDepth: 1 })
            // Assignment acknowledges issuance; this ordered observation proves
            // publication and the native effect, not merely entry completion.
            const publication = r.export(holder, ["api", "target"], ctx)
            resume.resolve()
            const [entryResult, outcome, result] = await Promise.all([entry, mutation, publication])
            assert.equal(entryResult, 0)
            assert.equal(r.isPoisonError(outcome), false)
            assert.deepEqual(result.a, [, 7, ,])
            assert.deepEqual(result.b, [, 7, ,])
            assert.equal(result.a === result.b, !changes)
            if (native) {
                assert.deepEqual(api.target.a, result.a)
                assert.deepEqual(api.target.b, result.b)
                assert.equal(api.target.a === api.target.b, !changes)
            }
            assert.equal(ctx.execution.fatalError, null)
        })
    }
})
