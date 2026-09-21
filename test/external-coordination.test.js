import { externalLocations } from "./support.js"
import * as externalTree from "../src/external-mutation-tree.js"
import { TREE_NODE } from "../src/external-mutation-tree.js"
import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import { validateExternalAccess } from "../src/external-operation.js"

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
        assert.deepEqual(boundaries[0][TREE_NODE].path, ["items", "0"])
        assert.equal(boundaries[0][TREE_NODE].entry.binding, boundaries[0])
    })

    it("abandons pending import work without invalidating an existing registration", async () => {
        const { ctx, identities: [existing], boundaries: [boundary] } = fixture()
        const duplicate = external()
        const pending = Promise.withResolvers()
        const root = { existing, pending: pending.promise, rawError: new Error("staged"), first: duplicate, second: duplicate }
        const chain = new runtime.ContextChain(root, ctx, { existing: {}, first: {}, second: {} })
        assert.equal(runtime.lookupPath(chain, [], ctx).kind, runtime.ERROR_KIND.ExternalLocationConflict)
        assert.equal(boundary[TREE_NODE].entry.binding, boundary)
        const late = { identity: external(), error: new Error("abandoned") }
        pending.resolve(late)
        await flush()
        assert.equal(root.pending, pending.promise)
        for (const value of [root, duplicate, late, late.identity]) {
            assert.equal(ctx.execution._metadata.has(value), false)
            assert.equal(ctx.execution._externalIdentities.has(value), false)
        }
    })

    for (const regularFirst of [false, true]) {
        it(`leaves regular imports inert and invalidates competing context bindings, regularFirst=${regularFirst}`, () => {
            const ctx = context()
            const identity = external()
            const root = { identity, inertAlias: identity }
            assert.equal(validateExternalAccess(identity, undefined, ctx), null)
            let ordinary
            if (regularFirst) ordinary = new runtime.Chain(runtime.import(root, ctx), ctx)
            const first = new runtime.ContextChain(root, ctx, { identity: {} })
            if (!regularFirst) ordinary = new runtime.Chain(runtime.import(root, ctx), ctx)
            const boundary = externalTree.findBranch(first._externalMutationTree, ["identity"])
            assert.equal(boundary[TREE_NODE].entry.binding, boundary)
            assert.equal(validateExternalAccess(identity, undefined, ctx).kind, runtime.ERROR_KIND.ExternalLocationConflict)
            assert.equal(boundary[TREE_NODE].entry.binding, boundary)
            assert.equal(runtime.lookupPath(ordinary, ["identity"], ctx).kind, runtime.ERROR_KIND.ExternalLocationConflict)

            const secondContext = context(ctx.execution)
            const second = new runtime.ContextChain({ identity }, secondContext, { identity: {} })
            const failure = boundary[TREE_NODE].entry.binding
            assert.equal(failure.kind, runtime.ERROR_KIND.ExternalLocationConflict)
            assert.equal(failure.errorContext, secondContext.errorContext)
            assert.equal(validateExternalAccess(identity, boundary, ctx), failure)
            assert.equal(validateExternalAccess(identity, undefined, ctx), failure)
            for (const chain of [first, second]) {
                assert.equal(externalLocations(chain._externalMutationTree, []).length, 1)
                assert.equal(externalTree.tracePath(chain._externalMutationTree, ["identity", "opaque"]).externalScope[TREE_NODE].entry.binding, failure)
                assert.equal(externalTree.findBranch(chain._externalMutationTree, ["identity"])[TREE_NODE].entry.binding, failure)
                assert.equal(runtime.lookupPath(chain, ["identity"], ctx), failure)
            }
            new runtime.ContextChain({ identity }, ctx, { identity: {} })
            assert.equal(boundary[TREE_NODE].entry.binding, failure)
        })
    }

    it("invalidates both context claims in either registration order", () => {
        for (const paths of [["left", "right"], ["right", "left"]]) {
            const ctx = context()
            const identity = external()
            const chains = paths.map(key => new runtime.ContextChain({ [key]: identity }, ctx, { [key]: {} }))
            const boundaries = chains.map((chain, index) => externalTree.findBranch(chain._externalMutationTree, [paths[index]]))
            const failure = boundaries[0][TREE_NODE].entry.binding
            assert.equal(failure.kind, runtime.ERROR_KIND.ExternalLocationConflict)
            for (const boundary of boundaries) {
                assert.equal(validateExternalAccess(identity, boundary, ctx), failure)
            }
        }
    })
})
