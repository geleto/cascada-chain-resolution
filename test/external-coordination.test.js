import { externalLocations, externalLocationPaths } from "./support.js"
import { TREE_NODE } from "../src/external-mutation-tree.js"
import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"

const context = (execution = new runtime.Execution()) => Object.freeze({
    execution, errorContext: Object.freeze({ operation: "external coordination" }),
})
const external = () => runtime.externalState({})
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }

function fixture(count = 1) {
    const ctx = context()
    const identities = Array.from({ length: count }, external)
    const chain = new runtime.ContextChain({ identities }, ctx, {
        identities: Object.fromEntries(identities.map((_, index) => [index, {}])),
    })
    const boundaries = externalLocations(chain._externalMutationTree, [])
    return { ctx, identities, chain, boundaries }
}

describe("external binding commit", () => {
    for (const shape of ["direct", "managed aliases"]) {
        for (const reverse of [false, true]) {
            it(`rejects duplicate candidate paths atomically: ${shape}, reverse=${reverse}`, () => {
                const ctx = context()
                const identity = external()
                const shared = { identity }
                const value = shape === "direct" ? identity : shared
                const keys = reverse ? ["second", "first"] : ["first", "second"]
                const root = Object.fromEntries(keys.map(key => [key, value]))
                root.self = root
                const request = shape === "direct" ? {} : { identity: {} }
                const tree = Object.fromEntries(keys.map(key => [key, request]))
                const chain = new runtime.ContextChain(root, ctx, tree)
                const failure = runtime.lookupPath(chain, [], ctx)
                assert.equal(failure.kind, runtime.ERROR_KIND.ExternalLocationConflict)
                assert.equal(failure.errorContext, ctx.errorContext)
                assert.equal(chain._externalMutationTree, undefined)
                for (const value of [root, shared, identity]) {
                    assert.equal(ctx.execution._metadata.has(value), false)
                    assert.equal(ctx.execution._externalIdentities.has(value), false)
                }
                assert.equal(ctx.execution.fatalError, null)
            })
        }
    }

    it("stops merged native-suffix requests at one owning boundary", () => {
        const ctx = context()
        const identity = external()
        const chain = new runtime.ContextChain({ items: [identity] }, ctx,
            { items: { 0: { opaque: {}, field: {} } } })
        const boundaries = externalLocations(chain._externalMutationTree, [])
        assert.equal(boundaries.length, 1)
        assert.deepEqual(externalLocationPaths(chain._externalMutationTree), [["items", "0"]])
        assert.equal(boundaries[0][TREE_NODE].identity, identity)
    })

    it("abandons pending import work without invalidating an existing registration", async () => {
        const { ctx, identities: [existing], boundaries: [boundary] } = fixture()
        const revision = ctx.execution._externalRegistrationRevision
        const duplicate = external()
        const pending = Promise.withResolvers()
        const root = { existing, pending: pending.promise, rawError: new Error("staged"), first: duplicate, second: duplicate }
        const chain = new runtime.ContextChain(root, ctx, { existing: {}, first: {}, second: {} })
        assert.equal(runtime.lookupPath(chain, [], ctx).kind, runtime.ERROR_KIND.ExternalLocationConflict)
        assert.equal(boundary[TREE_NODE].identity, existing)
        const late = { identity: external(), error: new Error("abandoned") }
        pending.resolve(late)
        await flush()
        assert.equal(root.pending, pending.promise)
        for (const value of [root, duplicate, late, late.identity]) {
            assert.equal(ctx.execution._metadata.has(value), false)
            assert.equal(ctx.execution._externalIdentities.has(value), false)
        }
        assert.equal(ctx.execution._externalRegistrationRevision, revision, "rejected staging never advances registration revision")
        const retried = new runtime.Chain(runtime.import(late, ctx), ctx)
        assert.equal(runtime.lookupPath(retried, ["identity"], ctx), late.identity,
            "an independent preparation can admit values abandoned by the rejected context")
        assert.equal(ctx.execution._metadata.has(late), true)
        assert.equal(ctx.execution._externalRegistrationRevision, revision)
    })

    for (const regularFirst of [false, true]) {
        it(`leaves regular imports inert and rejects competing contexts: regularFirst=${regularFirst}`, () => {
            const ctx = context(), identity = runtime.externalState({ value: 7 })
            const root = { identity, inertAlias: identity }
            let ordinary
            if (regularFirst) ordinary = new runtime.Chain(runtime.import(root, ctx), ctx)
            const first = new runtime.ContextChain(root, ctx, { identity: {} })
            if (!regularFirst) ordinary = new runtime.Chain(runtime.import(root, ctx), ctx)
            assert.equal(runtime.lookupPath(ordinary, ["identity"], ctx).kind, runtime.ERROR_KIND.ExternalLocationConflict)
            const secondContext = context(ctx.execution)
            const second = new runtime.ContextChain({ identity }, secondContext, { identity: {} })
            const failure = runtime.getErrors(second, [], ctx)
            assert.equal(failure.kind, runtime.ERROR_KIND.ExternalLocationConflict)
            assert.equal(failure.errorContext, secondContext.errorContext)
            assert.equal(runtime.getErrors(first, [], ctx), null)
            assert.equal(runtime.lookupPath(first, ["identity", "value"], ctx), 7)
            assert.equal(runtime.repairPath(second, [], ctx), failure)
        })
    }

    for (const reverse of [false, true]) for (const cached of [false, true])
    it(`rejects the whole later transaction: reverse=${reverse}, cached=${cached}`, () => {
        const ctx = context(), existing = runtime.externalState({ value: 1 })
        const first = new runtime.ContextChain({ existing }, ctx, { existing: {} })
        const fresh = runtime.externalState({ value: 2 }), managed = { value: 3 }
        if (cached) runtime.import(managed, ctx)
        const entries = [["fresh", fresh], ["existing", existing], ["managed", managed]]
        if (reverse) entries.reverse()
        const root = Object.fromEntries(entries)
        const rejected = new runtime.ContextChain(root, ctx, Object.fromEntries(entries.map(([key]) => [key, {}])))
        assert.equal(runtime.getErrors(rejected, [], ctx).kind, runtime.ERROR_KIND.ExternalLocationConflict)
        assert.equal(ctx.execution._metadata.has(root), false)
        assert.equal(ctx.execution._metadata.has(fresh), false)
        assert.equal(ctx.execution._metadata.has(managed), cached)
        assert.equal(ctx.execution._externalIdentities.has(fresh), false)
        assert.equal(runtime.lookupPath(first, ["existing", "value"], ctx), 1)
        const valid = new runtime.ContextChain({ fresh }, ctx, { fresh: {} })
        assert.equal(runtime.lookupPath(valid, ["fresh", "value"], ctx), 2)
    })
})
