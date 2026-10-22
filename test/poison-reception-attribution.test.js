import assert from "node:assert/strict"
import * as r from "cascada-chain-resolution"
import { OrderedThenable, ready } from "./ordered-thenable.js"

const context = (execution, source) => ({ execution, errorContext: { source } })

describe("unattributed poison reception", () => {
    for (const mode of ["ready", "synchronous", "native", "ordered"])
    for (const route of ["import", "method result", "Chain", "ContextChain", "assignment", "host result", "host property", "snapshot", "receiver validation"]) {
        it(`attributes ${route} to its operation across ${mode} delivery`, async () => {
            const execution = new r.Execution()
            const initialization = context(execution, "earlier initialization")
            const ctx = context(execution, route)
            const diagnostic = r.externalState(1)
            let release, observed
            const deliver = value => {
                if (mode === "ready") return value
                if (mode === "synchronous") return ready(value)
                const signal = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
                release = () => signal.resolve(value)
                return signal.promise ?? signal
            }
            let result
            if (route === "import") result = r.import(deliver(diagnostic), ctx)
            if (route === "method result") result = r.importMethodResult(deliver({ child: diagnostic }), ctx)
            if (route === "Chain" || route === "ContextChain") {
                observed = new r[route](deliver({ child: diagnostic }), ctx)
                result = r.lookupPath(observed, [], initialization)
            }
            if (route === "assignment") {
                observed = new r.Chain({}, initialization)
                r.assignPath(observed, ["value"], deliver(diagnostic), ctx)
                result = r.lookupPath(observed, ["value"], initialization)
            }
            if (route === "host result") {
                const chain = new r.Chain(r.externalState({ read() { return deliver(diagnostic) } }), initialization)
                result = r.run(chain, [], "read", [], ctx, {})
            }
            if (route === "host property" || route === "snapshot") {
                const host = r.externalState({ value: deliver(route === "snapshot" ? { child: diagnostic } : diagnostic) })
                const chain = route === "snapshot" ? new r.ContextChain({ host }, initialization, { host: {} }) : new r.Chain({ host }, initialization)
                result = r.lookupPath(chain, ["host", "value"], ctx)
            }
            if (route === "receiver validation") {
                observed = new r.Chain({ change() { this.child = diagnostic; return deliver(1) } }, initialization)
                result = r.run(observed, [], "change", [], ctx, { mutationScopeDepth: 0 })
            }
            release?.()
            result = await result
            const later = context(execution, "later query")
            const failure = r.isPoisonError(result) ? result : await r.getErrors(observed ?? new r.Chain(result, later), [], later)
            assert(r.isPoisonError(failure))
            assert.equal(failure.errorContext, ctx.errorContext)
            assert.equal(failure.kind, diagnostic.kind)
            assert.equal(failure.message, diagnostic.message)
            assert.equal(failure.cause, diagnostic)
            assert.equal(diagnostic.errorContext, undefined)
            assert(Object.isFrozen(failure))
            assert.equal(execution.fatalError, null)
        })
    }

    for (const separateExecutions of [false, true]) {
        it(`attributes independent uses without arrival-order or cross-execution mutation, separate=${separateExecutions}`, async () => {
            const first = context(new r.Execution(), "issued first")
            const second = context(separateExecutions ? new r.Execution() : first.execution, "issued second")
            const signal = Promise.withResolvers()
            const diagnostic = r.managedStateClass(1)
            const pending = r.import(signal.promise, first)
            const early = r.import(diagnostic, second)
            signal.resolve(diagnostic)
            const late = await pending
            assert.equal(early.errorContext, second.errorContext)
            assert.equal(late.errorContext, first.errorContext)
            assert.equal(diagnostic.errorContext, undefined)
            assert.equal(early.cause, diagnostic)
            assert.equal(late.cause, diagnostic)
        })
    }

    it("deduplicates repeated receptions of the same diagnostic at one source", () => {
        const ctx = context(new r.Execution(), "import aliases")
        const diagnostic = r.externalState(1)
        const chain = new r.Chain(r.import({ left: diagnostic, right: diagnostic }, ctx), ctx)
        const error = r.getErrors(chain, [], ctx)
        assert(r.isPoisonError(error))
        assert.equal(error.errors, undefined)
        assert.equal(error.cause, diagnostic)
        assert.equal(error.errorContext, ctx.errorContext)
    })

    it("preserves the first preparation's source on a shared imported placement", async () => {
        const execution = new r.Execution(), first = context(execution, "issued first"), second = context(execution, "prepared first")
        const diagnostic = r.externalState(1), host = { child: diagnostic }
        const signal = Promise.withResolvers()
        const pending = r.import(signal.promise, first)
        const early = new r.Chain(r.import(host, second), second)
        signal.resolve(host)
        const late = new r.Chain(await pending, first)
        const failure = r.lookupPath(early, ["child"], first)
        assert.equal(failure.errorContext, second.errorContext)
        assert.equal(r.lookupPath(late, ["child"], first), failure)
        assert.equal(host.child, diagnostic)
        assert.equal(diagnostic.errorContext, undefined)
    })

    it("attributes poison first accessed in an already prepared graph without a source", () => {
        const execution = new r.Execution(), diagnostic = r.externalState(1)
        const chain = new r.Chain({ child: diagnostic }, { execution })
        for (const api of ["lookupPath", "getErrors", "export", "lookupPathForExpression"]) {
            const ctx = context(execution, api)
            const result = r[api](chain, api === "getErrors" || api === "export" ? [] : ["child"], ctx)
            const failure = api === "lookupPathForExpression" ? result.error : result
            assert(r.isPoisonError(failure), api)
            assert.equal(failure.errorContext, ctx.errorContext, api)
            assert.equal(failure.cause, diagnostic, api)
        }
        assert.equal(diagnostic.errorContext, undefined)
    })

    it("attributes only unsourced compound leaves and preserves existing producers", () => {
        const execution = new r.Execution(), producer = context(execution, "getXValue()"), consumer = context(execution, "var x")
        const sourced = r.validationError("call failure", producer, r.ERROR_KIND.InvocationFailed)
        const diagnostic = r.externalState(1)
        const original = r.combineErrors([sourced, diagnostic])
        const result = r.import(original, consumer)
        assert.equal(result.errorContext, undefined)
        assert.equal(result.errors[0], sourced)
        assert.equal(result.errors[1].errorContext, consumer.errorContext)
        assert.equal(diagnostic.errorContext, undefined)
        const chain = new r.Chain({ child: result }, producer)
        assert.equal(r.lookupPath(chain, ["child"], producer), result)
        assert.equal(r.getErrors(chain, [], producer), result)
    })

    it("gives an entirely unattributed compound the common receiving source", () => {
        const ctx = context(new r.Execution(), "initialization")
        const leaves = [r.externalState(1), r.managedStateClass(1)]
        const result = r.import(r.combineErrors(leaves), ctx)
        assert.equal(result.errorContext, ctx.errorContext)
        assert.deepEqual(result.errors.map(error => error.cause), leaves)
        assert(result.errors.every(error => error.errorContext === ctx.errorContext))
        assert(leaves.every(error => error.errorContext === undefined))
    })

    for (const cause of [undefined, null, 0, new Error("host failure")]) {
        it(`preserves an existing raw cause when supplying a missing source: ${String(cause)}`, () => {
            const execution = new r.Execution(), ctx = context(execution, "consumer")
            const diagnostic = r.createPoisonError(cause, { execution }, r.ERROR_KIND.InvocationFailed)
            const result = r.import(diagnostic, ctx)
            assert.equal(result.cause, cause)
            assert.equal(result.kind, diagnostic.kind)
            assert.equal(result.message, diagnostic.message)
            assert.equal(result.errorContext, ctx.errorContext)
        })
    }
})
