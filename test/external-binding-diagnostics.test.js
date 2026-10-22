import assert from "node:assert/strict"
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
    it(`preserves earlier mutation failure after a binding conflict: ${route}, ${mode}, queryAfter=${queryAfter}`, async () => {
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
        assert.equal(leaves.length, 2)
        assert(leaves.some(error => error.kind === r.ERROR_KIND.ExternalLocationConflict &&
            error.errorContext === competitor.errorContext))
        assert(leaves.some(error => error.cause === cause && error.errorContext === at.errorContext &&
            error.kind === r.ERROR_KIND[route === "call result" ? "InvocationFailed" : "OperationInputFailed"]))
        assert.equal(r.getErrors(other, [], at).kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(host.value, 1)
        assert.equal(calls, route === "call result" ? 1 : 0)
        assert.equal(execution.fatalError, null)
    })

    for (const mode of ["ready", "synchronous", "native", "ordered"])
    for (const cached of [false, true]) for (const array of [false, true]) {
        it(`attributes conflict to the second committed context: ${mode}, cached=${cached}, array=${array}`, async () => {
            const execution = new r.Execution()
            const context = errorContext => ({ execution, errorContext })
            const firstAt = context("first context"), secondAt = context("second context"), accessAt = context("access")
            let calls = 0
            const host = r.externalState({ read() { calls++; return 7 } })
            const firstPending = availability(1, mode), secondPending = availability(2, mode)
            const data = pending => array ? { branch: [host], pending } : { branch: { host }, pending }
            const key = array ? 0 : "host", tree = { branch: { [key]: {} } }, path = ["branch", key]
            const firstData = data(firstPending.value), secondData = data(secondPending.value)
            if (cached) { r.import(firstData, firstAt); r.import(secondData, secondAt) }
            const first = new r.ContextChain(firstData, firstAt, tree)
            assert.equal(r.hasError(first, ["branch"], accessAt), false)
            const second = new r.ContextChain(secondData, secondAt, tree)
            const failure = r.getErrors(first, ["branch"], accessAt)
            assert.equal(failure.kind, r.ERROR_KIND.ExternalLocationConflict)
            assert.equal(failure.errorContext, secondAt.errorContext)
            const third = new r.ContextChain(data(3), context("third context"), tree)
            const complete = [], graphExports = []
            for (const chain of [first, second, third]) {
                assert.equal(r.lookupPath(chain, path, accessAt), failure)
                assert.equal(r.run(chain, path, "read", [], accessAt, {}), failure)
                assert.equal(r.hasError(chain, [], accessAt), true)
                assert.equal(r.getErrors(chain, ["branch"], accessAt), failure)
                complete.push(r.getErrors(chain, [], accessAt), r.export(chain, path, accessAt))
                graphExports.push(r.export(chain, [], accessAt))
                assert.equal(r.repairPath(chain, path, accessAt), failure)
                assert.equal(r.getErrors(chain, path, accessAt), failure)
            }
            secondPending.release()
            firstPending.release()
            for (const result of complete) assert.equal(await result, failure)
            // Whole managed export rejects the capability as data; it does not
            // access the resource or consume its scope's binding diagnostics.
            for (const result of graphExports) {
                const error = await result
                assert.equal(error.kind, r.ERROR_KIND.ExternalCapabilityEscape)
                assert.equal(error.errorContext, accessAt.errorContext)
            }
            assert.equal(calls, 0)
            assert.equal(execution.fatalError, null)
        })
    }

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

    for (const mode of ["native", "ordered"]) {
        it(`rechecks authority before a delayed native call: ${mode}`, async () => {
            const execution = new r.Execution(), ctx = { execution, errorContext: "original" }
            const secondAt = { execution, errorContext: "competing context" }
            let calls = 0
            const host = r.externalState({ read(value) { calls++; return value } })
            const chain = new r.ContextChain({ host }, ctx, { host: {} })
            assert.equal(r.run(chain, ["host"], "read", [1], ctx, {}), 1)
            const pending = availability(2, mode)
            const result = r.run(chain, ["host"], "read", [pending.value], ctx, {})
            new r.ContextChain({ host }, secondAt, { host: {} })
            const failure = r.getErrors(chain, ["host"], ctx)
            new r.ContextChain({ host }, { execution, errorContext: "later competitor" }, { host: {} })
            pending.release()
            assert.equal(await result, failure)
            assert.equal(failure.errorContext, secondAt.errorContext)
            assert.equal(calls, 1)
            assert.equal(execution.fatalError, null)
        })
    }
})
