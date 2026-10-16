import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { captureIdentity, inheritIdentity, IdentityPublication, resolveCapturedIdentities } from "../src/captured-identity.js"
import { OperationOwner } from "../src/operation-lifecycle.js"

const context = () => ({ execution: new r.Execution(), errorContext: "identity lineage" })

// Removing an undecided destination fixes the contents while leaving the
// write/no-write decision open. No pending element value explains these waits.
function pendingIdentity(ctx) {
    const source = new r.Chain([, 7, ,], ctx), gate = Promise.withResolvers()
    const entry = r.enter(source, [0], ctx, true, () => gate.promise)
    r.run(source, [], "copyWithin", [0, 2, 3], ctx, { mutationScopeDepth: 0 })
    return { source, gate, entry }
}

describe("identity lineage completion", () => {
    for (const method of ["assign", "delete", "fill"])
    it(`preserves identity when existing poison blocks ${method}`, () => {
        const ctx = context(), source = new r.Chain({ box: { k: 1 } }, ctx)
        r.assignPath(source, ["box", "k", "child"], 2, ctx)
        const before = new r.Chain(r.lookupPath(source, [], ctx), ctx)
        if (method === "assign") r.assignPath(source, ["box", "k", "child"], 3, ctx, 2)
        else if (method === "delete") r.deletePath(source, ["box", "k", "child"], ctx, 2)
        else r.run(source, ["box", "k"], "fill", [7], ctx, { mutationScopeDepth: 2 })
        assert.equal(r.run(new r.Chain([r.lookupPath(source, [], ctx)], ctx), [], "includes",
            [r.lookupPath(before, [], ctx)], ctx, {}), true)
    })

    for (const method of ["join", "toString", "flat"]) for (const write of [false, true])
    it(`resolves same-lineage cycle checks in ${method}, write=${write}`, async () => {
        const outcomes = []
        for (const pending of [false, true]) {
            const ctx = context(), hold = Promise.withResolvers()
            const host = []; host[0] = host; host[1] = 7
            const source = new r.Chain(r.import({ array: host }, ctx), ctx)
            const body = inside => { if (write) r.assignPath(inside, [], 8, ctx) }
            const entry = r.enter(source, ["array", 1], ctx, true,
                pending ? inside => hold.promise.then(() => body(inside)) : body)
            const result = r.run(source, ["array"], method, method === "flat" ? [Infinity] : [], ctx, {})
            if (pending) assert(result instanceof Promise)
            hold.resolve(); await entry
            const value = await result
            outcomes.push(r.isPoisonError(value) ? value.kind : value)
        }
        assert.deepEqual(outcomes, Array(2).fill(method === "flat" ? r.ERROR_KIND.InvalidArrayOperation
            : write ? ",7,8" : ",7"))
    })

    for (const [method, args] of [["fill", [7, 1, 1]], ["reverse", []], ["copyWithin", [0, 1, 1]], ["sort", []]])
    for (const scope of [0, 1, 2])
    it(`preserves ancestor identity for nested nonwriting ${method}, scope=${scope}`, async () => {
        const ctx = context()
        const source = new r.Chain({ box: { list: method === "reverse" || method === "sort" ? [] : [1, 2] } }, ctx)
        const before = new r.Chain(r.lookupPath(source, [], ctx), ctx)
        await r.run(source, ["box", "list"], method, args, ctx, { mutationScopeDepth: scope })
        assert.equal(r.run(new r.Chain([r.lookupPath(source, [], ctx)], ctx), [], "includes",
            [r.lookupPath(before, [], ctx)], ctx, {}), true)
    })

    for (const method of ["join", "toString", "flat"])
    it(`finishes unrelated cycle checks in ${method}`, async () => {
        const ctx = context(), { source, gate, entry } = pendingIdentity(ctx)
        const wrapper = new r.Chain([[r.lookupPath(source, [], ctx)]], ctx)
        const result = r.run(wrapper, [], method, method === "flat" ? [Infinity] : [], ctx, {})
        try {
            if (method === "flat") assert.deepEqual(r.export(new r.Chain(result, ctx), [], ctx), [7])
            else assert.equal(result, ",7,")
        } finally { gate.resolve(); await entry }
    })

    for (const method of ["includes", "indexOf", "lastIndexOf"])
    for (const reversed of [false, true])
    it(`rejects unrelated identities in ${method}, reversed=${reversed}`, async () => {
        const ctx = context(), { source, gate, entry } = pendingIdentity(ctx)
        const value = r.lookupPath(source, [], ctx), unrelated = {}
        const array = new r.Chain([reversed ? unrelated : value], ctx)
        const result = r.run(array, [], method, [reversed ? value : unrelated], ctx, {})
        try { assert.equal(result, method === "includes" ? false : -1) }
        finally { gate.resolve(); await entry }
    })

    for (const consumer of ["export", "receiver", "arguments"])
    it(`assembles one captured key without its outcome: ${consumer}`, async () => {
        const ctx = context(), { source, gate, entry } = pendingIdentity(ctx)
        const value = r.lookupPath(source, [], ctx)
        let result
        if (consumer === "export") result = r.export(new r.Chain([value, value], ctx), [], ctx)
        else {
            const receiver = new r.Chain({ value, inspect(a, b) {
                return a ? a === b && a.length === 3 : this.value.length === 3
            } }, ctx)
            result = r.run(receiver, [], "inspect", consumer === "arguments" ? [value, value] : [], ctx, {})
        }
        try {
            if (consumer === "export") {
                assert(Array.isArray(result))
                assert.equal(result[0], result[1])
                assert.deepEqual(result[0], [, 7, ,])
            } else assert.equal(result, true)
        } finally { gate.resolve(); await entry }
    })

    it("finishes conversion Error collection through unrelated cycle checks", async () => {
        const ctx = context(), { source, gate, entry } = pendingIdentity(ctx)
        const failure = r.validationError("bad", ctx)
        const wrapper = new r.Chain([[failure], [r.lookupPath(source, [], ctx)]], ctx)
        try { assert.equal(r.run(wrapper, [], "join", [], ctx, {}), failure) }
        finally { gate.resolve(); await entry }
    })

    it("finishes a captured partition when its keys merge into an unfinished predecessor", async () => {
        const ctx = context(), owner = new OperationOwner(ctx)
        const source = new r.Chain({}, ctx), copy = new r.Chain({}, ctx)
        const first = new IdentityPublication(ctx)
        first.capture(source._state.value); first.suspend()
        inheritIdentity(source._state.value, copy._state.value, ctx)
        const second = new IdentityPublication(ctx)
        second.capture(copy._state.value); second.suspend()
        const nodes = [source, copy].map(chain => ({ identity: captureIdentity(chain._state.value, ctx) }))
        const result = resolveCapturedIdentities(nodes, owner)
        second.finish(false)
        let settled = false
        Promise.resolve(result).then(() => { settled = true })
        await new Promise(setImmediate)
        try {
            assert.equal(settled, true)
            assert.equal(nodes[0].identity, nodes[1].identity)
        } finally { first.finish(false); owner.close() }
    })
})
