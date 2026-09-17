import { externalLocations } from "./support.js"
import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import * as externalTree from "../src/external-mutation-tree.js"
import { TREE_NODE } from "../src/external-mutation-tree.js"

const context = () => ({ execution: new runtime.Execution(), errorContext: "context tree" })
const external = (value = {}) => runtime.externalState(value)
const paths = chain => externalLocations(chain._externalMutationTree, []).map(record => record[TREE_NODE].path)

describe("compiler-guided context tree", () => {
    it("updates previously healthy ancestor queries when contexts compete for an identity", () => {
        const ctx = context(), identity = external()
        const create = () => new runtime.ContextChain({ parent: { identity } }, ctx, { parent: { identity: {} } })
        const first = create()
        assert.equal(runtime.hasError(first, [], ctx), false)
        assert.equal(runtime.getErrors(first, ["parent"], ctx), null)
        const second = create(), third = create()
        const failure = runtime.getErrors(first, [], ctx)
        assert.equal(failure.kind, runtime.ERROR_KIND.ExternalLocationConflict)
        for (const chain of [first, second, third]) for (const path of [[], ["parent"], ["parent", "identity"]]) {
            assert.equal(runtime.hasError(chain, path, ctx), true)
            assert.equal(runtime.getErrors(chain, path, ctx), failure)
        }
    })

    for (const trap of ["child descriptor", "then descriptor", "prototype"]) {
        it(`abandons native discovery reflection failure without changing prior bindings: ${trap}`, () => {
            const ctx = context(), cause = new Error(trap)
            const existing = external({ value: 1 })
            const original = new runtime.ContextChain({ existing }, ctx, { existing: {} })
            let fail = false
            const child = new Proxy({}, {
                getOwnPropertyDescriptor(target, key) {
                    if (fail && trap === "then descriptor" && key === "then") throw cause
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
                getPrototypeOf(target) {
                    if (fail && trap === "prototype") throw cause
                    return Reflect.getPrototypeOf(target)
                },
            })
            const native = external(new Proxy({ child }, {
                getOwnPropertyDescriptor(target, key) {
                    if (fail && trap === "child descriptor" && key === "child") throw cause
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            }))
            fail = true
            const rejected = new runtime.ContextChain({ existing, native }, ctx, { existing: {}, native: { child: {} } })
            const failure = runtime.lookupPath(rejected, [], ctx)
            assert.equal(failure.kind, runtime.ERROR_KIND.ImportReflectionFailed)
            assert.equal(failure.cause, cause)
            assert.equal(ctx.execution.fatalError, null)
            assert.equal(runtime.getErrors(original, [], ctx), null)
            assert.equal(runtime.lookupPath(original, ["existing", "value"], ctx), 1)
            fail = false
            const retry = new runtime.ContextChain({ native }, ctx, { native: { child: {} } })
            assert.equal(runtime.getErrors(retry, [], ctx), null)
        })
    }

    it("distinguishes omitted requests from a request for an external root", () => {
        const ctx = context()
        const root = external()
        const unrequested = new runtime.ContextChain(root, ctx)
        assert.equal(unrequested._externalMutationTree, undefined)
        assert.equal(ctx.execution._externalIdentities.has(root), false)
        const requested = new runtime.ContextChain(root, ctx, {})
        assert.deepEqual(paths(requested), [[]])
        assert.equal(ctx.execution._externalIdentities.get(root).binding, requested._externalMutationTree)
    })

    it("discovers requested native descendants and prunes managed endpoints", () => {
        const request = { apis: { db: {}, config: { flags: {} } }, missing: {}, primitive: {}, managed: {} }
        const original = structuredClone(request)
        for (const depth of ["root", "internal", "endpoint", "managed"]) {
            const root = { apis: { db: {}, config: { flags: 1 } }, primitive: 2, managed: { hidden: external() } }
            const owner = depth === "root" ? root : depth === "internal" ? root.apis : root.apis.db
            if (depth !== "managed") external(owner)
            const chain = new runtime.ContextChain(root, context(), request)
            const expected = depth === "managed" ? [] : depth === "endpoint" ? [["apis", "db"]]
                : depth === "internal" ? [["apis"], ["apis", "db"], ["apis", "config"]]
                    : [[], ["apis"], ["apis", "db"], ["apis", "config"], ["managed"]]
            assert.deepEqual(paths(chain), expected)
            if (depth === "endpoint") {
                assert.deepEqual(Object.keys(chain._externalMutationTree), ["apis"])
                assert.deepEqual(Object.keys(chain._externalMutationTree.apis), ["db"])
            }
        }
        assert.deepEqual(request, original)
        assert.equal(Object.isFrozen(request), false)
        assert.equal(Object.isFrozen(request.apis.db), false)
    })

    it("inspects only compiler-named native child placements", () => {
        const ctx = context()
        let reads = 0
        const owner = external(new Proxy({ db: {}, config: {} }, {
            getOwnPropertyDescriptor(target, key) {
                if (key === "db" || key === "config") reads++
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        }))
        const chain = new runtime.ContextChain({ api: owner }, ctx, { api: { db: {}, config: {} } })
        assert.deepEqual(paths(chain), [["api"], ["api", "db"], ["api", "config"]])
        assert.equal(reads, 2)
        assert.equal(externalTree.tracePath(chain._externalMutationTree, ["api", "db"]).boundary,
            externalTree.tracePath(chain._externalMutationTree, ["api", "config"]).boundary)
        assert.equal(externalTree.findBranch(chain._externalMutationTree, ["api", "db"]), chain._externalMutationTree.api.db)
    })

    it("keeps all String property names separate from record metadata and tree queries", () => {
        const ctx = context()
        const keys = ["", "__proto__", "constructor", "path", "context", "entry", "identity",
            "location", "findBranch", "tracePath"]
        const request = Object.fromEntries(keys.map(key => [key, { resource: {} }]))
        const root = Object.fromEntries(keys.map(key => [key, { resource: external() }]))
        const chain = new runtime.ContextChain(root, ctx, request)
        assert.deepEqual(paths(chain), keys.map(key => [key, "resource"]))
        for (const key of keys) {
            const branch = externalTree.findBranch(chain._externalMutationTree, [key])
            const record = externalTree.findBranch(branch, ["resource"])
            assert.equal(record[TREE_NODE].entry, ctx.execution._externalIdentities.get(root[key].resource))
            assert.equal(record[TREE_NODE].entry.binding, record)
            assert.equal(externalTree.findBranch(branch, ["resource", "context"]), undefined)
        }
    })

    it("copies canonical locations without retaining mutable compiler input", () => {
        const ctx = context()
        const request = { api: { db: {} } }
        const first = new runtime.ContextChain({ api: { db: external() } }, ctx, request)
        const second = new runtime.ContextChain({ api: { db: external() } }, ctx, request)
        const firstRecord = externalTree.findBranch(first._externalMutationTree, ["api", "db"])
        const secondRecord = externalTree.findBranch(second._externalMutationTree, ["api", "db"])
        assert.notEqual(firstRecord[TREE_NODE].entry, secondRecord[TREE_NODE].entry)
        delete request.api.db
        request.api.other = {}
        assert.deepEqual(paths(first), [["api", "db"]])
        assert.deepEqual(paths(second), [["api", "db"]])
    })

    it("does not reuse binding authority when two contexts reuse the compiler input", () => {
        const ctx = context()
        const root = { resource: external() }
        const request = Object.freeze({ resource: Object.freeze({}) })
        const first = new runtime.ContextChain(root, ctx, request)
        const second = new runtime.ContextChain(root, ctx, request)
        const isolated = new runtime.ContextChain(root, context(), request)
        const a = first._externalMutationTree.resource
        const b = second._externalMutationTree.resource
        assert.notEqual(a, b)
        assert.equal(a[TREE_NODE].entry, b[TREE_NODE].entry)
        assert.equal(a[TREE_NODE].entry.binding.kind, runtime.ERROR_KIND.ExternalLocationConflict)
        assert.notEqual(a[TREE_NODE].entry, isolated._externalMutationTree.resource[TREE_NODE].entry)
        assert.equal(isolated._externalMutationTree.resource[TREE_NODE].entry.binding,
            isolated._externalMutationTree.resource)
    })

    it("rejects explicit duplicate locations through finite cycle routes without changing prior bindings", () => {
        const ctx = context()
        const resource = external()
        const previous = new runtime.ContextChain({ resource }, ctx, { resource: {} })
        const originalBinding = ctx.execution._externalIdentities.get(resource).binding
        const root = { resource }
        root.self = root
        const request = { resource: {}, self: { self: { resource: {} } } }
        const originalRequest = structuredClone(request)
        const failed = new runtime.ContextChain(root, ctx, request)
        const failure = runtime.lookupPath(failed, [], ctx)
        assert.equal(failure.kind, runtime.ERROR_KIND.ExternalLocationConflict)
        assert.equal(failure.errorContext, ctx.errorContext)
        assert.equal(failed._externalMutationTree, undefined)
        assert.equal(ctx.execution._metadata.has(root), false)
        assert.equal(ctx.execution._externalIdentities.get(resource).binding, originalBinding)
        assert.deepEqual(request, originalRequest)
    })

    for (const cyclic of [false, true]) {
        it(`bounds discovery to requested occurrences through a shared ${cyclic ? "cyclic" : "acyclic"} graph`, () => {
            const ctx = context()
            let reads = 0, enumerations = 0
            const track = value => new Proxy(value, {
                getOwnPropertyDescriptor(target, key) {
                    reads++
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
                ownKeys(target) {
                    enumerations++
                    return Reflect.ownKeys(target)
                },
            })
            const resource = external()
            const tail = track({ resource })
            if (cyclic) tail.self = tail
            let root = tail
            for (let i = 0; i < 12; i++) root = track({ left: root, right: root })
            runtime.import(root, ctx)
            reads = enumerations = 0
            const endpoint = new runtime.ContextChain(root, ctx, {})
            assert.equal(endpoint._externalMutationTree, undefined)
            assert.equal(reads, 0)
            assert.equal(enumerations, 0)
            assert.equal(ctx.execution._externalIdentities.has(resource), false)

            let request = cyclic ? { self: { resource: {} } } : { resource: {} }
            for (let i = 0; i < 12; i++) request = { left: request }
            const selected = new runtime.ContextChain(root, ctx, request)
            const route = [...Array(12).fill("left"), ...(cyclic ? ["self"] : []), "resource"]
            assert.deepEqual(paths(selected), [route])
            assert.equal(reads, route.length)
            assert.equal(enumerations, 0)
        })
    }
})
