import assert from "node:assert/strict"
import * as r from "cascada-chain-resolution"
import { OrderedThenable, ready } from "./ordered-thenable.js"

// Check transport independently of boundary-specific kinds and graph effects.
// Faults are real host traps, armed after any prerequisite admission.
const routes = [
    ["import", ({ source, ctx, deliver }) => () => r.import(deliver(source), ctx)],
    ["method-result import", ({ source, ctx, deliver }) => () => r.importMethodResult(deliver(source), ctx)],
    ["Chain input", ({ source, ctx, deliver }) => () => r.lookupPath(new r.Chain(deliver(source), ctx), [], ctx)],
    ["ContextChain input", ({ source, ctx, deliver }) => () => r.lookupPath(new r.ContextChain(deliver(source), ctx), [], ctx)],
    ...[
        ["lookup", (chain, ctx) => r.lookupPath(chain, ["value"], ctx)],
        ["assignment", (chain, ctx) => r.assignPath(chain, ["value"], 2, ctx)],
        ["deletion", (chain, ctx) => r.deletePath(chain, ["value"], ctx)],
        ["repair", (chain, ctx) => r.repairPath(chain, ["value"], ctx)],
        ["export", (chain, ctx) => r.export(chain, [], ctx)],
        ["hasError", (chain, ctx) => r.hasError(chain, [], ctx)],
        ["getErrors", (chain, ctx) => r.getErrors(chain, [], ctx)],
        ["managed observation", (chain, ctx) => r.run(chain, [], "read", [], ctx, {})],
        ["managed mutation", (chain, ctx) => r.run(chain, [], "read", [], ctx, { mutationScopeDepth: 0 })],
    ].map(([name, invoke]) => [name, ({ source, ctx, deliver, observe }) => {
        new r.Chain(source, ctx)
        const chain = new r.Chain(deliver(source), ctx)
        observe(chain)
        return () => invoke(chain, ctx)
    }]),
    ["native argument export", ({ source, ctx, deliver }) => {
        new r.Chain(source, ctx)
        const chain = new r.Chain(r.externalState({ read() { assert.fail("Poison must prevent invocation") } }), ctx)
        return () => r.run(chain, [], "read", [deliver(source)], ctx, {})
    }],
    ["native result preparation", ({ source, ctx, deliver }) => {
        const chain = new r.Chain(r.externalState({ read() { return deliver(source) } }), ctx)
        return () => r.run(chain, [], "read", [], ctx, {})
    }],
    ["entered result preparation", ({ source, ctx, deliver }) => {
        const chain = new r.Chain({}, ctx)
        return () => r.enter(chain, [], ctx, false, () => deliver(source))
    }],
    ["managed receiver validation", ({ source, ctx, deliver }) => {
        const chain = new r.Chain({ change() { this.child = source; return deliver(0) } }, ctx)
        return () => r.run(chain, [], "change", [], ctx, { mutationScopeDepth: 0 })
    }],
    ["native property getter", ({ ctx, deliver, fail }) => {
        const host = r.externalState({ get value() { return fail() } })
        const chain = new r.Chain(deliver(host), ctx)
        return () => r.lookupPath(chain, ["value"], ctx)
    }],
    ["native method selection", ({ ctx, deliver, fail }) => {
        const host = r.externalState({ get read() { return fail() } })
        const chain = new r.Chain(deliver(host), ctx)
        return () => r.run(chain, [], "read", [], ctx, {})
    }],
    ["managed prototype inspection", ({ ctx, deliver, fail }) => {
        const prototype = new Proxy({ read() { return 1 } }, {
            getOwnPropertyDescriptor(target, key) {
                if (key === "read") return fail()
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        const source = r.managedState(Object.create(prototype))
        new r.Chain(source, ctx)
        const chain = new r.Chain(deliver(source), ctx)
        return () => r.run(chain, [], "read", [], ctx, {})
    }],
    ...["lookup", "export"].map(name => [`external snapshot ${name}`, ({ source, ctx, deliver }) => {
        const chain = new r.ContextChain({ api: r.externalState({ data: deliver(source) }) }, ctx, { api: {} })
        return () => (name === "lookup" ? r.lookupPath : r.export)(chain, ["api", "data"], ctx)
    }]),
    ...["join", "includes", "slice", "sort", "push"].map(method => [`Array ${method}`, ({ probe, ctx, deliver }) => {
        const source = probe([1, 2])
        new r.Chain(source, ctx)
        const chain = new r.Chain(deliver(source), ctx)
        return () => r.run(chain, [], method, method === "includes" || method === "push" ? [3] : [], ctx,
            method === "sort" || method === "push" ? { mutationScopeDepth: 0 } : {})
    }]),
]

describe("public inspection failure transport", () => {
    for (const mode of ["ready", "synchronous", "native", "ordered"])
    for (const [name, prepare] of routes) {
        it(`keeps inspection failure recoverable without throwing or rejecting: ${name}, ${mode}`, async () => {
            const reports = []
            const ctx = { execution: new r.Execution(error => reports.push(error)), errorContext: { name, mode } }
            const cause = new Error("required host inspection failed")
            let armed = false, inspections = 0, release, observed
            const fail = () => { inspections++; throw cause }
            const probe = value => new Proxy(value, {
                get(target, key, receiver) {
                    if (armed && Array.isArray(target) && key === "length") { inspections++; throw cause }
                    return Reflect.get(target, key, receiver)
                },
                ownKeys(target) {
                    if (armed) { inspections++; throw cause }
                    return Reflect.ownKeys(target)
                },
                getOwnPropertyDescriptor(target, key) {
                    if (armed && (key === "value" || key === "0")) { inspections++; throw cause }
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const deliver = value => {
                if (mode === "ready") return value
                if (mode === "synchronous") return ready(value)
                const gate = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
                release = () => gate.resolve(value)
                return gate.promise ?? gate
            }
            const source = probe({ value: 1, read() { return this.value } })
            const invoke = prepare({ source, probe, ctx, deliver, fail, observe: chain => { observed = chain } })
            armed = true
            let result
            assert.doesNotThrow(() => { result = invoke() })
            release?.()
            // Any rejected result fails the test, including an accidental fatal.
            result = await result
            assert(inspections > 0, "The required inspection was exercised")
            armed = false
            if (name === "hasError") assert.equal(result, true)
            else {
                // Import can keep healthy siblings beside a poisoned placement.
                const error = r.isPoisonError(result) ? result
                    : await r.getErrors(observed ?? new r.Chain(result, ctx), [], ctx)
                assert(r.isPoisonError(error), "The inspection failure must remain observable poison")
                assert((error.errors ?? [error]).some(leaf => leaf.cause === cause))
            }
            assert.equal(ctx.execution.fatalError, null)
            assert.deepEqual(reports, [])
            assert.equal(r.import(7, ctx), 7, "A recoverable failure must leave the execution usable")
        })
    }

    for (const pending of [false, true]) {
        it(`keeps expression inspection poison in its documented transport, pending=${pending}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "expression inspection" }
            const cause = new Error("descriptor failure")
            let armed = false
            const source = new Proxy({ value: 1 }, {
                getOwnPropertyDescriptor(target, key) {
                    if (armed && key === "value") throw cause
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            new r.Chain(source, ctx)
            const signal = Promise.withResolvers()
            const chain = new r.Chain(pending ? signal.promise : source, ctx)
            armed = true
            let result
            assert.doesNotThrow(() => { result = r.lookupPathForExpression(chain, ["value"], ctx) })
            assert.equal(r.isPoisonedValue(result), !pending)
            signal.resolve(source)
            await assert.rejects(Promise.resolve(result), error => {
                assert(r.isPoisonError(error))
                assert.equal(error.cause, cause)
                assert.equal(error.kind, r.ERROR_KIND.LookupReflectionFailed)
                return true
            })
            assert.equal(ctx.execution.fatalError, null)
        })
    }
})
