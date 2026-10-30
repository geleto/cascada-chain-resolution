import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import * as r from "../src/index.js"
import { ready, rejected, OrderedThenable } from "./ordered-thenable.js"

function availability(value, mode) {
    if (mode === "ready") return { value, release() {} }
    if (mode === "synchronous") return { value: ready(value), release() {} }
    if (mode === "native") {
        const signal = Promise.withResolvers()
        return { value: signal.promise, release: () => signal.resolve(value) }
    }
    const signal = new OrderedThenable()
    return { value: signal, release: () => signal.resolve(value) }
}

describe("external binding diagnostics", () => {
    for (const mode of ["ready", "synchronous", "native", "ordered"])
    for (const action of ["lookup", "expression", "export", "call", "length"])
    it(`rechecks snapshot authority before a ${mode} ${action} key resumes`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: "snapshot registration" }
        let inspected = 0
        const data = new Proxy({ v: 1, list: [1] }, {
            getOwnPropertyDescriptor(target, key) { inspected++; return Reflect.getOwnPropertyDescriptor(target, key) },
        })
        const cache = r.externalState({ data, change() { data.v = 5; data.list.push(2) } })
        const source = new r.ContextChain({ api: r.externalState({ cache }) }, ctx, { api: {} })
        const pending = availability(action === "call" ? "list" : action === "length" ? "length" : "v", mode)
        const path = ["api", "cache", "data", ...(action === "length" ? ["list"] : []), pending.value]
        const result = action === "expression" ? r.lookupPathForExpression(source, path, ctx) :
            action === "export" ? r.export(source, path, ctx) : action === "call" ? r.run(source, path, "join", [","], ctx, {}) :
                r.lookupPath(source, path, ctx)
        const later = new r.ContextChain({ cache }, ctx, { cache: {} })
        assert.equal(r.run(later, ["cache"], "change", [], ctx, { mutationScopeDepth: 1 }), undefined)
        const readsBeforeResume = inspected
        pending.release()
        const received = action === "expression" ? await Promise.resolve(result).catch(error => error) : await result
        if (mode === "native" || mode === "ordered") {
            assert.equal(received.kind, r.ERROR_KIND.ExternalLocationConflict)
            assert.equal(inspected, readsBeforeResume, "Reject before reading host snapshot storage again")
        } else assert.equal(received, action === "call" ? "1" : 1)
        assert.equal(r.getErrors(source, [], ctx), null)
        assert.equal(r.getErrors(later, [], ctx), null)
        assert.equal(ctx.execution.fatalError, null)
    })

    it("bounds retained native authority checks across ready and deferred paths", function () {
        this.timeout(30000)
        const result = spawnSync(process.execPath, [...process.execArgv, "--unhandled-rejections=strict",
            "test/fixtures/native-authority-work.mjs"], { encoding: "utf8", timeout: 25000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    for (const mode of ["ready", "synchronous", "native", "ordered"])
    for (const route of ["call", "assignment", "delete"])
    it(`keeps a blocking child's poison repairable: ${route}, ${mode}`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: { route, mode } }
        const cause = new Error("child failure")
        const pending = availability(7, mode)
        let calls = 0
        const child = r.externalState({ fail() { throw cause } })
        const host = r.externalState({ child, value: 1, change() { calls++; return 7 } })
        const chain = new r.ContextChain({ host }, ctx, { host: { child: {} } })
        const failure = r.run(chain, ["host", "child"], "fail", [], ctx, { mutationScopeDepth: 2 })
        const blocked = route === "call" ? r.run(chain, ["host"], "change", [pending.value], ctx, { mutationScopeDepth: 1 })
            : route === "assignment" ? r.assignPath(chain, ["host", "value"], pending.value, ctx)
            : r.deletePath(chain, ["host", "value"], ctx)
        pending.release()
        if (blocked !== undefined) assert.equal(await blocked, failure)
        assert.equal(host.value, 1)
        assert.equal(calls, 0)
        assert.equal(r.repairPath(chain, ["host", "child"], ctx), undefined)
        assert.equal(r.getErrors(chain, [], ctx), null)
        assert.equal(r.run(chain, ["host"], "change", [], ctx, { mutationScopeDepth: 1 }), 7)
        assert.equal(calls, 1)
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const mode of ["ready", "synchronous", "native", "ordered"])
    for (const route of ["call result", "call argument", "assignment input"])
    for (const queryAfter of [false, true])
    it(`preserves earlier mutation failure after a rejected registration: ${route}, ${mode}, queryAfter=${queryAfter}`, async () => {
        const execution = new r.Execution()
        const ctx = errorContext => ({ execution, errorContext })
        const at = ctx("mutation"), competitor = ctx("competing context")
        const cause = new Error("earlier mutation failed")
        const signal = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
        const input = mode === "ready" ? r.createPoisonError(cause, at, r.ERROR_KIND.OperationInputFailed)
            : mode === "synchronous" ? rejected(cause) : signal.promise ?? signal
        let calls = 0
        const host = r.externalState({ value: 1, change() {
            calls++
            if (mode === "ready") throw cause
            return mode === "synchronous" ? rejected(cause) : signal.promise ?? signal
        } })
        const chain = new r.ContextChain({ host }, ctx("original context"), { host: {} })
        const result = route === "assignment input"
            ? r.assignPath(chain, ["host", "value"], input, at)
            : r.run(chain, ["host"], "change", route === "call argument" ? [input] : [], at,
                { mutationScopeDepth: 1 })
        const other = new r.ContextChain({ host }, competitor, { host: {} })
        const collected = queryAfter ? undefined : r.getErrors(chain, [], ctx("query"))
        if (mode === "native" || mode === "ordered") signal.reject(cause)
        if (route !== "assignment input") {
            const failure = await result
            assert.equal(failure.cause, cause)
            assert.equal(failure.errorContext, at.errorContext)
        }
        const error = await (queryAfter ? r.getErrors(chain, [], ctx("query")) : collected)
        const leaves = error.errors ?? [error]
        assert.equal(leaves.length, 1)
        assert(leaves.some(error => error.cause === cause && error.errorContext === at.errorContext &&
            error.kind === r.ERROR_KIND[route === "call result" ? "InvocationFailed" : "OperationInputFailed"]))
        assert.equal(r.getErrors(other, [], at).kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(host.value, 1)
        assert.equal(calls, route === "call result" ? 1 : 0)
        assert.equal(execution.fatalError, null)
    })

    for (const mode of ["ready", "synchronous", "native", "ordered"])
    for (const cached of [false, true]) for (const array of [false, true])
    it(`attributes rejection only to the later context: ${mode}, cached=${cached}, array=${array}`, async () => {
        const execution = new r.Execution(), context = errorContext => ({ execution, errorContext })
        const firstAt = context("first"), secondAt = context("second"), accessAt = context("access")
        let calls = 0
        const host = r.externalState({ read() { calls++; return 7 } })
        const pending = availability(1, mode)
        const data = array ? { branch: [host], pending: pending.value } : { branch: { host }, pending: pending.value }
        const key = array ? 0 : "host", tree = { branch: { [key]: {} } }, path = ["branch", key]
        if (cached) r.import(data, firstAt)
        const first = new r.ContextChain(data, firstAt, tree)
        const captured = r.getErrors(first, [], accessAt)
        const second = new r.ContextChain(data, secondAt, tree)
        const failure = r.getErrors(second, [], accessAt)
        assert.equal(failure.kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(failure.errorContext, secondAt.errorContext)
        assert.equal(r.repairPath(second, path, accessAt), failure)
        assert.equal(r.run(first, path, "read", [], accessAt, {}), 7)
        pending.release()
        assert.equal(await captured, null)
        assert.equal(await r.getErrors(first, [], accessAt), null)
        assert.equal(calls, 1)
        assert.equal(execution.fatalError, null)
    })

    for (const mode of ["synchronous", "native", "ordered"])
    for (const root of [false, true]) {
        it(`does not register a fulfilled context ${root ? "root" : "property"}: ${mode}`, async () => {
            const execution = new r.Execution(), ctx = { execution, errorContext: "thenable context" }
            const host = r.externalState({ value: 7 }), pending = availability(host, mode)
            const chain = new r.ContextChain(root ? pending.value : { host: pending.value }, ctx, root ? {} : { host: {} })
            pending.release()
            assert.equal(await r.lookupPath(chain, root ? [] : ["host"], ctx), host)
            assert.equal(execution._externalIdentities.has(host), false)
            const directAt = { execution, errorContext: "direct context" }
            const direct = new r.ContextChain({ host }, directAt, { host: {} })
            assert.equal(r.lookupPath(direct, ["host", "value"], ctx), 7)
            assert.equal(r.getErrors(direct, [], ctx), null)
            assert.equal(execution.fatalError, null)
        })
    }

    for (const mode of ["native", "ordered"])
    for (const wait of ["key", "property"]) for (const position of ["root", "middle"])
    it(`rechecks native prefixes after a managed ${wait} wait: ${mode}, ${position}`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: "mixed route" }
        let reads = 0
        const receiver = r.externalState({ get value() { reads++; return 7 } })
        const pending = availability(wait === "key" ? "child" : receiver, mode)
        const middle = r.externalState({ bridge: { child: wait === "property" ? pending.value : receiver } })
        const root = r.externalState({ middle })
        const source = new r.Chain(root, ctx)
        const result = r.lookupPath(source,
            ["middle", "bridge", wait === "key" ? pending.value : "child", "value"], ctx)
        const selected = position === "root" ? root : middle
        const canonical = new r.ContextChain({ selected }, ctx, { selected: {} })
        pending.release()
        const failure = await result
        assert.equal(failure.kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(failure.errorContext, ctx.errorContext)
        assert.equal(reads, 0)
        assert.equal(r.getErrors(canonical, [], ctx), null)
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const mode of ["native", "ordered"])
    for (const canonical of [false, true]) for (const position of ["root", "middle", "receiver"])
    it(`rechecks the retained native route: ${mode}, canonical=${canonical}, ${position}`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: "original" }
        let calls = 0, getters = 0
        const receiver = r.externalState({ read(value) { calls++; return value } })
        const middle = r.externalState({ get receiver() { getters++; return receiver } })
        const root = r.externalState({ get middle() { getters++; return middle } })
        const selected = { root, middle, receiver }[position]
        const chain = canonical
            ? new r.ContextChain({ selected }, ctx, { selected: {} }) : new r.Chain(root, ctx)
        const pending = availability(2, mode)
        const path = canonical ? ["selected", ...({ root: ["middle", "receiver"], middle: ["receiver"], receiver: [] }[position])]
            : ["middle", "receiver"]
        const result = r.run(chain, path, "read", [pending.value], ctx, {})
        const reached = getters
        const at = { ...ctx, errorContext: "registration" }
        const later = new r.ContextChain({ selected }, at, { selected: {} })
        pending.release()
        const outcome = await result
        assert.equal(getters, reached, "Authority checks must not replay getters")
        if (canonical) {
            assert.equal(outcome, 2)
            assert.equal(calls, 1)
            assert.equal(r.getErrors(later, [], ctx).errorContext, at.errorContext)
        } else {
            assert.equal(outcome.kind, r.ERROR_KIND.ExternalLocationConflict)
            assert.equal(outcome.errorContext, ctx.errorContext)
            assert.equal(calls, 0)
            assert.equal(r.getErrors(later, [], ctx), null)
        }
        assert.equal(ctx.execution.fatalError, null)
    })
})
