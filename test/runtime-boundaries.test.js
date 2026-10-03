import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import vm from "node:vm"
import * as r from "../src/index.js"
import { metaOf } from "../src/meta.js"
import { OrderedThenable } from "./ordered-thenable.js"

const context = () => ({ execution: new r.Execution(), errorContext: "boundary regression" })
const turn = () => new Promise(setImmediate)

describe("runtime boundary completion", () => {
    it("answers Array range and length questions without scanning unrelated fork outcomes", () => {
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
            "test/fixtures/length-fork-work.js"], { encoding: "utf8", timeout: 30000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })
    it("releases completed captures while returned Errors remain unformatted", () => {
        const result = spawnSync(process.execPath, ["--expose-gc", "--unhandled-rejections=strict",
            "test/fixtures/completed-work-retention.js"], { encoding: "utf8", timeout: 30000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    for (const mode of ["ready", "fulfill", "reject", "return", "throw", "call fulfill", "call reject"]) {
        it(`preserves native Error causes without reflecting on inherited prototypes: ${mode}`, async () => {
            const ctx = context()
            const prototype = new Proxy(Object.create(Error.prototype), { getPrototypeOf() { throw new Error("Must not inspect ancestry") } })
            function HostError() {}
            HostError.prototype = prototype
            const cause = Reflect.construct(Error, ["native failure"], HostError)
            const api = r.externalState({ invoke() {
                if (mode === "throw") throw cause
                return mode === "call fulfill" ? Promise.resolve(cause) : mode === "call reject" ? Promise.reject(cause) : cause
            } })
            const result = await (mode === "ready" ? r.import(cause, ctx)
                : mode === "fulfill" ? r.import(Promise.resolve(cause), ctx)
                : mode === "reject" ? r.import(Promise.reject(cause), ctx)
                : r.run(new r.Chain(api, ctx), [], "invoke", [], ctx, {}))
            assert(r.isPoisonError(result))
            assert.equal(result.cause, cause)
            assert.equal(result.errorContext, ctx.errorContext)
            assert.equal(ctx.execution.fatalError, null)
            assert.equal(r.externalState(cause), cause)
            assert.equal(r.managedState(cause), cause)
            assert.equal(r.managedStateClass(cause), cause)
        })
    }

    for (const inherited of [false, true]) for (const foreign of [false, true]) {
        it(`accepts safe Error-valued prototype data: inherited=${inherited}, foreign=${foreign}`, async () => {
            const ctx = context()
            function Value() { this.n = 1 }
            const prototype = foreign ? vm.runInNewContext("new Error('prototype')") : new Error("prototype")
            Value.prototype = inherited ? Object.create(prototype) : prototype
            Value.prototype.read = function () { return this.n }
            assert.equal(r.managedStateClass(Value), undefined)
            const original = new Value(), chain = new r.Chain(await r.import(Promise.resolve(original), ctx), ctx)
            assert.equal(r.run(chain, [], "read", [], ctx, {}), 1)
            r.assignPath(chain, ["n"], 2, ctx)
            assert.equal(r.run(chain, [], "read", [], ctx, {}), 2)
            assert.equal(original.n, 1)
            assert.equal(r.managedState(new Value()) instanceof Value, true)
        })
    }

    it("keeps failed multi-class declaration atomic and distinguishes thrown prototype Errors", () => {
        class First {}
        const cause = new Error("reflection"), second = new Proxy(function () {}, { get() { throw cause } })
        assert.equal(r.managedStateClass(First, second), cause)
        const ctx = context(), original = new First()
        assert.equal(r.export(new r.Chain(original, ctx), [], ctx), original)
    })

    for (const method of ["includes", "indexOf", "lastIndexOf"]) {
        it(`${method} skips known-empty bounds but consumes its needle`, async () => {
            const ctx = context(), chain = new r.Chain([], ctx), bound = new OrderedThenable()
            for (const input of [bound, Symbol("unused"), new Error("unused")])
                assert.equal(r.run(chain, [], method, ["needle", input], ctx, {}), method === "includes" ? false : -1)
            assert.equal(bound.subscriptions, 0)
            assert(r.isPoisonError(r.run(chain, [], method, [new Error("required"), bound], ctx, {})))
            assert.equal(bound.subscriptions, 0)
            const pending = Promise.withResolvers(), source = new r.Chain(pending.promise, ctx)
            const result = r.run(source, [], method, ["needle", bound], ctx, {})
            pending.resolve([])
            assert.equal(await result, method === "includes" ? false : -1)
        })

        it(`${method} releases captured needle identity before an unrelated bound settles`, async () => {
            const ctx = context(), needle = { child: { k: 1 } }, holder = new r.Chain(needle, ctx)
            const bound = Promise.withResolvers(), chain = new r.Chain([0], ctx)
            const result = r.run(chain, [], method, [r.lookupPath(holder, [], ctx), bound.promise], ctx, {})
            r.assignPath(holder, [], null, ctx)
            assert.equal(metaOf(needle, ctx).readLeaseCount ?? 0, 0)
            assert.equal(metaOf(needle, ctx).relationshipsActive, false)
            bound.resolve(0)
            assert.equal(await result, method === "includes" ? false : -1)
        })
    }

    for (const action of ["assign", "delete", "run", "repair"]) for (const prefix of [null, undefined, 3]) {
        it(`${action} reports its failed prefix before consuming an invalid suffix: ${prefix}`, () => {
            const ctx = context(), chain = new r.Chain({ stop: prefix }, ctx), path = ["stop", {}]
            const result = action === "assign" ? r.assignPath(chain, path, 1, ctx, 1)
                : action === "delete" ? r.deletePath(chain, path, ctx, 1)
                : action === "repair" ? r.repairPath(chain, path, ctx)
                : r.run(chain, path, "missing", [], ctx, { mutationScopeDepth: 1 })
            assert.equal(result.kind, prefix == null ? r.ERROR_KIND.NullLookup : r.ERROR_KIND.ScalarLookup)
            assert.equal(result.errorContext, ctx.errorContext)
        })
    }

    for (const deleting of [false, true]) for (const entered of [false, true]) for (const namespace of ["record", "array"]) {
        it(`repairs a fixed binding's managed placement: delete=${deleting}, entry=${entered}, ${namespace}`, async () => {
            const ctx = context()
            class Resource { read() { return 1 } }
            const key = namespace === "array" ? 0 : "service", resource = new Resource()
            const data = namespace === "array" ? [resource] : { service: resource }
            const chain = new r.ContextChain({ branch: data }, ctx, { branch: { [key]: {} } })
            const use = current => {
                const failure = deleting ? r.deletePath(current, [key], ctx) : r.assignPath(current, [key], {}, ctx)
                assert.equal(failure.kind, r.ERROR_KIND.PropertyValidation)
                assert.equal(r.repairPath(current, [key], ctx), undefined)
                assert.equal(r.run(current, [key], "read", [], ctx, {}), 1)
            }
            if (entered) await r.enter(chain, ["branch"], ctx, true, use)
            else {
                const failure = deleting ? r.deletePath(chain, ["branch", key], ctx) : r.assignPath(chain, ["branch", key], {}, ctx)
                assert.equal(failure.kind, r.ERROR_KIND.PropertyValidation)
                assert.equal(r.repairPath(chain, ["branch", key], ctx), undefined)
                assert.equal(r.run(chain, ["branch", key], "read", [], ctx, {}), 1)
            }
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("releases a failed invocation's receiver while complete Error collection continues", async () => {
        const ctx = context(), first = new Error("first"), second = new Error("second"), pending = Promise.withResolvers()
        const root = [{ unrelated: 1 }], chain = new r.Chain(root, ctx)
        const result = r.run(chain, [], "slice", [[first, pending.promise]], ctx, {})
        r.assignPath(chain, [], null, ctx)
        assert.equal(metaOf(root, ctx).readLeaseCount ?? 0, 0)
        pending.reject(second)
        const error = await result
        assert(error.errors.some(error => error.cause === first))
        assert(error.errors.some(error => error.cause === second))
    })

    for (const gated of [false, true]) for (const repair of ["direct", "entry", "call"])
    for (const action of ["assign", "pending assign", "delete"]) {
        it(`restores fixed bindings through ordered recovery: ${action}, ${repair}, gated=${gated}`, async () => {
            const ctx = context(), pause = Promise.withResolvers(), input = Promise.withResolvers()
            let calls = 0
            class Resource { read() { calls++; return 1 } }
            const chain = new r.ContextChain({ branch: { service: new Resource() } }, ctx, { branch: { service: {} } })
            const retained = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
            const path = ["branch", "service"]
            const entry = gated ? r.enter(chain, ["branch"], ctx, true, () => pause.promise) : undefined
            const rejected = action === "delete" ? r.deletePath(chain, path, ctx)
                : r.assignPath(chain, path, action === "pending assign" ? input.promise : {}, ctx)
            const recovered = repair === "entry" ? r.enter(chain, path, ctx, true, inside => r.repairPath(inside, [], ctx))
                : repair === "call" ? r.run(chain, path, "read", [], ctx, { mutationScopeDepth: path.length, repair: true })
                : r.repairPath(chain, path, ctx)
            const later = r.run(chain, path, "read", [], ctx, {})
            input.resolve({})
            pause.resolve()
            await entry
            const error = await rejected
            if (error !== undefined) assert.equal(error.kind, r.ERROR_KIND.PropertyValidation)
            assert.equal(await recovered, repair === "call" ? 1 : undefined)
            assert.equal(await later, 1)
            assert.equal(calls, repair === "call" ? 2 : 1)
            assert.equal(await r.hasError(retained, [], ctx), false)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("releases a converted scalar container while its captured children settle", async () => {
        const ctx = context(), pending = Promise.withResolvers(), input = [pending.promise, 9]
        const result = r.run(new r.Chain([0], ctx), [], "slice", [input], ctx, {})
        assert.equal(metaOf(input, ctx).readLeaseCount ?? 0, 0)
        assert.equal(metaOf(input, ctx).relationshipsActive, false)
        pending.resolve(1)
        assert.deepEqual(await r.export(new r.Chain(result, ctx), [], ctx), [0])
        await turn()
    })
})
