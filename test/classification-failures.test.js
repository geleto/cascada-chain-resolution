import assert from "node:assert/strict"
import * as r from "cascada-chain-resolution"
import * as metadata from "../src/meta.js"
import { OrderedThenable, ready } from "./ordered-thenable.js"

// Exercise every consumer of fresh classification through public operations.
const routes = [
    ["import", ({ source, ctx, deliver }) => r.import(deliver(source), ctx), "ImportReflectionFailed"],
    ["method-result import", ({ source, ctx, deliver }) => r.importMethodResult(deliver(source), ctx), "ImportReflectionFailed"],
    ...["Chain", "ContextChain"].map(name => [name, ({ source, ctx, deliver }) =>
        r.lookupPath(new r[name](deliver(source), ctx), [], ctx), name === "Chain" ? "ChainValueFailed" : "ImportReflectionFailed"]),
    ["external property", ({ source, ctx, deliver }) =>
        r.lookupPath(new r.Chain(r.externalState({ data: deliver(source) }), ctx), ["data"], ctx), "ImportReflectionFailed"],
    ["external result", ({ source, ctx, deliver }) =>
        r.run(new r.Chain(r.externalState({ read() { return deliver(source) } }), ctx), [], "read", [], ctx, {}), "ImportReflectionFailed"],
    ...["lookup", "export", "prefix", "managed prefix", "receiver", "write", "delete"].map(action => [
        `mutable external ${action}`, ({ source, ctx, deliver, observe }) => {
            const prefix = action !== "lookup" && action !== "export"
            const host = r.externalState({
                data: prefix ? action === "managed prefix" ? { child: source } : source : deliver(source),
                hold() { return deliver(0) },
            })
            const chain = new r.ContextChain({ host }, ctx, { host: {} })
            // Native intermediate paths require ready values. Exercise their
            // deferred work behind an earlier native operation instead.
            if (prefix) r.run(chain, ["host"], "hold", [], ctx, { mutationScopeDepth: 1 })
            observe(chain)
            if (action === "export") return r.export(chain, ["host", "data"], ctx)
            if (action === "receiver") return r.run(chain, ["host", "data"], "read", [], ctx, {})
            if (action === "write") return r.assignPath(chain, ["host", "data", "value"], 2, ctx)
            if (action === "delete") return r.deletePath(chain, ["host", "data", "value"], ctx)
            return r.lookupPath(chain, action === "prefix" ? ["host", "data", "value"] :
                action === "managed prefix" ? ["host", "data", "child", "value"] : ["host", "data"], ctx)
        }, "ExternalPropertyReadFailed",
    ]),
    ["receiver finalization", ({ source, ctx, deliver, observe }) => {
        const chain = new r.Chain({ change() { this.child = source; return deliver(1) } }, ctx)
        observe(chain)
        return r.run(chain, [], "change", [], ctx, { mutationScopeDepth: 0 })
    }, "InvalidManagedReceiver"],
]

describe("required classification failures", () => {
    for (const mode of ["ready", "synchronous", "native", "ordered"])
    for (const boundary of ["classification", "availability", "placement descriptor", "managed shape", "accessor"])
    it(`reuses context discovery failures with diagnostic precedence: ${boundary}, ${mode}`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: { boundary, mode } }
        const cause = new Error("classification or shape failure")
        const availabilityCause = new Error("native availability failure")
        let inspections = 0
        const target = { then: 0 }
        if (boundary === "accessor") Object.defineProperty(target, "then", { get() { return 0 } })
        const child = new Proxy(target, {
            getPrototypeOf(target) {
                if (boundary === "managed shape" || boundary === "placement descriptor") return Reflect.getPrototypeOf(target)
                inspections++
                throw cause
            },
            ownKeys(target) {
                if (boundary === "placement descriptor") return Reflect.ownKeys(target)
                inspections++
                throw cause
            },
            getOwnPropertyDescriptor(target, key) {
                if ((boundary === "availability" || boundary === "placement descriptor") && key === "then") throw availabilityCause
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        const signal = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
        const host = r.externalState({ child })
        const root = { first: mode === "ready" ? child : mode === "synchronous" ? ready(child)
            : signal.promise ?? signal, host, healthy: 7 }
        const chain = new r.ContextChain(root, ctx, { host: { child: {} } })
        const rejected = boundary === "classification" || boundary === "availability" || boundary === "placement descriptor"
        const result = r.lookupPath(chain, rejected ? [] : ["first"], ctx)
        signal.resolve(child)
        const failure = await result
        assert(r.isPoisonError(failure))
        assert.equal(failure.cause, boundary === "availability" || boundary === "placement descriptor" ? availabilityCause : cause)
        assert.equal(failure.kind, r.ERROR_KIND.ImportReflectionFailed)
        assert.equal(failure.errorContext, ctx.errorContext)
        // A native availability failure wins before classification when the
        // ordinary branch is pending. Otherwise classification runs once.
        assert.equal(inspections, boundary === "placement descriptor" || boundary === "availability" &&
            (mode === "native" || mode === "ordered") ? 0 : 1)
        assert.equal(metadata.metaOf(child, ctx), undefined)
        assert.equal(ctx.execution._externalIdentities.has(child), false)
        assert.equal(ctx.execution._externalIdentities.has(host), !rejected)
        assert.equal(!!metadata.metaOf(root, ctx), !rejected)
        assert.equal(!!metadata.metaOf(host, ctx), !rejected)
        if (!rejected) assert.equal(r.lookupPath(chain, ["healthy"], ctx), 7)
        assert.equal(host.child, child)
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const mode of ["ready", "synchronous", "native", "ordered"])
    for (const admitted of [false, true])
    it(`does not infer native availability from admission: ${mode}, admitted=${admitted}`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: { mode, admitted } }
        const child = r.externalState({ get then() { return 0 }, value: 7 })
        if (admitted) assert.equal(r.import(child, ctx), child)
        const signal = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
        const host = r.externalState({ child })
        const chain = new r.ContextChain({ first: mode === "ready" ? child : mode === "synchronous" ? ready(child)
            : signal.promise ?? signal, host }, ctx, { host: { child: {} } })
        const result = r.lookupPath(chain, ["first"], ctx)
        signal.resolve(child)
        assert.equal(await result, child)
        assert.equal(ctx.execution._externalIdentities.has(child), false)
        assert.equal(ctx.execution._externalIdentities.has(host), true)
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const trap of ["getPrototypeOf", "ownKeys"])
    for (const mode of ["ready", "synchronous", "native", "ordered"])
    for (const firstReady of [false, true])
    for (const route of ["import", "method result", "external property", "external call", "Chain", "ContextChain"]) {
        it(`reuses failed inspection across preparation segments: ${trap}, ${mode}, firstReady=${firstReady}, ${route}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: { route, mode } }
            let inspections = 0
            const failed = new Proxy({ value: 1 }, {
                [trap]() { inspections++; throw new Error("inspection failed") },
            })
            const releases = []
            const deliver = value => {
                if (mode === "ready") return value
                if (mode === "synchronous") return ready(value)
                const signal = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
                releases.push(() => signal.resolve(value))
                return signal.promise ?? signal
            }
            const graph = { first: firstReady ? failed : deliver(failed),
                second: deliver(failed), later: deliver({ alias: failed }), healthy: 7 }
            const host = route.startsWith("external")
                ? new r.Chain(r.externalState({ data: graph, read() { return graph } }), ctx) : undefined
            const chain = route === "Chain" || route === "ContextChain" ? new r[route](graph, ctx)
                : new r.Chain(route === "import" ? r.import(graph, ctx)
                    : route === "method result" ? r.importMethodResult(graph, ctx)
                    : route === "external property" ? r.lookupPath(host, ["data"], ctx)
                    : r.run(host, [], "read", [], ctx, {}), ctx)
            const results = [["first"], ["second"], ["later", "alias"]].map(path => r.lookupPath(chain, path, ctx))
            // Also cover a first failure discovered only by a later segment.
            for (const release of releases.reverse()) release()
            const errors = await Promise.all(results)
            assert(r.isPoisonError(errors[0]))
            for (const error of errors) assert.equal(error, errors[0])
            assert.equal(inspections, 1)
            assert.equal(errors[0].errorContext, ctx.errorContext)
            assert.equal(await r.getErrors(chain, [], ctx), errors[0])
            assert.equal(await r.export(chain, [], ctx), errors[0])
            assert.equal(r.lookupPath(chain, ["healthy"], ctx), 7)
            assert.equal(metadata.metaOf(failed, ctx), undefined)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const separateExecution of [false, true]) {
        it(`retries failed inspection in an independent import, separateExecution=${separateExecution}`, () => {
            let inspections = 0
            const failed = new Proxy({}, { ownKeys() { inspections++; throw new Error("unreadable") } })
            const first = { execution: new r.Execution(), errorContext: "first import" }
            const second = { execution: separateExecution ? new r.Execution() : first.execution, errorContext: "second import" }
            const a = r.import(failed, first), b = r.import(failed, second)
            assert(r.isPoisonError(a) && r.isPoisonError(b))
            assert.notEqual(a, b)
            assert.equal(a.errorContext, first.errorContext)
            assert.equal(b.errorContext, second.errorContext)
            assert.equal(inspections, 2)
        })
    }

    it("abandons context authority atomically after required native classification fails", () => {
        const ctx = { execution: new r.Execution(), errorContext: "context registration" }
        const cause = new Error("native category inspection failed")
        let inspections = 0
        const child = new Proxy({ then: 0 }, { getPrototypeOf() { inspections++; throw cause } })
        const host = r.externalState({ child })
        const chain = new r.ContextChain({ host }, ctx, { host: { child: {} } })
        const failure = r.lookupPath(chain, [], ctx)
        assert(r.isPoisonError(failure))
        assert.equal(failure.cause, cause)
        assert.equal(failure.kind, r.ERROR_KIND.ImportReflectionFailed)
        assert.equal(inspections, 1)
        assert.equal(metadata.metaOf(child, ctx), undefined)
        assert.equal(metadata.metaOf(host, ctx), undefined)
        assert.equal(ctx.execution._externalIdentities.has(host), false)
        assert.equal(host.child, child)
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const mode of ["ready", "synchronous", "native", "ordered"])
    for (const [name, invoke, kind] of routes) {
        it(`returns poison through ${name}, ${mode}`, async () => {
            const reports = [], ctx = { execution: new r.Execution(error => reports.push(error)), errorContext: { name, mode } }
            const cause = new Error("classification inspection failed")
            let inspections = 0, release, observed
            const source = new Proxy({ value: 1, read() { assert.fail("Must not invoke an unclassified receiver") } }, {
                getPrototypeOf() { inspections++; throw cause },
            })
            const deliver = value => {
                if (mode === "ready") return value
                if (mode === "synchronous") return ready(value)
                const signal = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
                release = () => signal.resolve(value)
                return signal.promise ?? signal
            }
            const result = invoke({ source, ctx, deliver, observe: chain => { observed = chain } })
            release?.()
            const actual = await result
            const failure = r.isPoisonError(actual) ? actual : await r.getErrors(observed ?? new r.Chain(actual, ctx), [], ctx)
            assert(r.isPoisonError(failure), "Required reflection failure must be observable")
            assert.equal(failure.cause, cause)
            assert.equal(failure.kind, r.ERROR_KIND[kind])
            assert.equal(failure.errorContext, ctx.errorContext)
            assert(inspections > 0)
            assert.equal(metadata.metaOf(source, ctx), undefined)
            assert.equal(ctx.execution.fatalError, null)
            assert.deepEqual(reports, [])

        })
    }

    for (const pending of [false, true]) {
        it(`keeps import failure at the child and preserves healthy siblings, pending=${pending}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "child import" }
            const cause = new Error("child classification failed")
            let inspections = 0
            const child = new Proxy({}, { getPrototypeOf() { inspections++; throw cause } })
            const signal = Promise.withResolvers()
            const root = { good: { value: 7 }, branch: pending ? signal.promise : { left: child, right: child } }
            const chain = new r.Chain(r.import(root, ctx), ctx)
            signal.resolve({ left: child, right: child })
            const left = await r.lookupPath(chain, ["branch", "left"], ctx)
            assert(r.isPoisonError(left))
            assert.equal(left.cause, cause)
            assert.equal(await r.lookupPath(chain, ["branch", "right"], ctx), left)
            assert.equal(r.lookupPath(chain, ["good", "value"], ctx), 7)
            assert.equal(inspections, 1)
            assert.equal(metadata.metaOf(child, ctx), undefined)
            assert.equal(await r.getErrors(chain, [], ctx), left)
            assert.equal(await r.export(chain, [], ctx), left)
            assert.equal(ctx.execution.fatalError, null)
        })
    }
})
