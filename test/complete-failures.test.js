import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import * as kernel from "cascada-chain-resolution/integration"
import * as metadata from "../src/meta.js"
import { ready } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = (execution = new runtime.Execution()) => Object.freeze({
    execution,
    errorContext: Object.freeze({ operation: "complete failures" }),
})
const leaves = error => error.errors ?? [error]
const deliveries = { ready: value => value, synchronous: ready, pending: value => Promise.resolve(value) }
const flush = async () => {
    for (let index = 0; index < 16; index++) await Promise.resolve()
}

describe("complete failure outcomes", () => {
    for (const route of ["export", "receiver", "argument"]) {
        it(`${route} returns all ready failures synchronously`, () => {
            const ctx = context()
            const first = new Error("first")
            const last = new Error("last")
            const reflection = new Error("descriptor")
            const graph = new Proxy({ first, bad: 0, last }, {
                getOwnPropertyDescriptor(value, key) {
                    if (key === "bad") throw reflection
                    return Reflect.getOwnPropertyDescriptor(value, key)
                },
            })
            const receiver = { read() { assert.fail("failed preparation must not invoke external code") } }
            if (route === "receiver") receiver.graph = graph
            const chain = new runtime.Chain(route === "export" ? graph : receiver, ctx)
            const result = route === "export"
                ? runtime.export(chain, [], ctx)
                : runtime.run(chain, [], "read", route === "argument" ? [graph] : [], ctx, {})
            assert(runtime.isPoisonError(result))
            assert.equal(leaves(result).length, 3)
            assert.deepEqual(new Set(leaves(result).map(error => error.cause)), new Set([first, last, reflection]))
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("collects failures inside an ArrayView without inspecting outside its bounds", () => {
        const ctx = context()
        const first = new Error("first")
        const last = new Error("last")
        const reflection = new Error("inside descriptor")
        let fail = false
        const source = new Proxy([0, first, 0, last, 0], {
            ownKeys(value) {
                assert.equal(fail, false, "a bounded view must not enumerate its whole backing")
                return Reflect.ownKeys(value)
            },
            getOwnPropertyDescriptor(value, key) {
                if (fail) {
                    assert.notEqual(key, "0")
                    assert.notEqual(key, "4")
                    if (key === "2") throw reflection
                }
                return Reflect.getOwnPropertyDescriptor(value, key)
            },
        })
        const chain = new runtime.Chain(source, ctx)
        const view = runtime.run(chain, [], "slice", [1, 4], ctx, {})
        fail = true
        const result = runtime.export(new runtime.Chain(view, ctx), [], ctx)
        assert(runtime.isPoisonError(result))
        assert.equal(leaves(result).length, 3)
        assert.deepEqual(new Set(leaves(result).map(error => error.cause)), new Set([first, last, reflection]))
        assert.equal(ctx.execution.fatalError, null)
        fail = false
        verifyRefCounts(ctx, source, view)
    })

    for (const route of ["export", "receiver", "argument"]) {
        for (const array of [false, true]) {
            for (const [delivery, deliver] of Object.entries(deliveries)) {
                it(`${route} collects descriptor failure and required siblings in a ${array ? "logical Array" : "record"} with ${delivery} input`, async () => {
                    const ctx = context()
                    const introduced = context(ctx.execution)
                    const first = new Error("before descriptor")
                    const last = new Error("pending sibling")
                    const reflection = new Error("descriptor")
                    const pending = Promise.withResolvers()
                    let fail = false
                    let calls = 0
                    const target = array
                        ? [first, 0, pending.promise]
                        : { before: first, bad: 0, after: pending.promise }
                    const badKey = array ? "1" : "bad"
                    const graph = new Proxy(target, {
                        getOwnPropertyDescriptor(value, key) {
                            if (fail && key === badKey) throw reflection
                            return Reflect.getOwnPropertyDescriptor(value, key)
                        },
                    })
                    // Aliases and cycles must not duplicate any failure.
                    if (array) target.push(graph, graph)
                    else Object.assign(target, { self: graph, alias: graph })
                    runtime.import(graph, introduced)
                    const receiver = { read() { calls++; return 1 } }
                    if (route === "receiver") receiver.graph = deliver(graph)
                    const chain = new runtime.Chain(route === "export" ? deliver(graph) : receiver, ctx)
                    fail = true
                    const work = route === "export"
                        ? runtime.export(chain, [], ctx)
                        : runtime.run(chain, [], "read", route === "argument" ? [deliver(graph)] : [], ctx, {})
                    let settled = false
                    const result = Promise.resolve(work).then(value => { settled = true; return value })
                    await flush()
                    assert.equal(settled, false, "a required sibling still has to contribute its outcome")
                    pending.reject(last)
                    const failure = await result
                    assert(runtime.isPoisonError(failure))
                    const errors = leaves(failure)
                    assert.equal(errors.length, 3)
                    for (const cause of [first, last]) {
                        const error = errors.find(error => error.cause === cause)
                        assert(error)
                        assert.equal(error.errorContext, introduced.errorContext)
                        assert.equal(error.kind, runtime.ERROR_KIND.ContextValueFailed)
                    }
                    const reflected = errors.find(error => error.cause === reflection)
                    assert(reflected)
                    assert.equal(reflected.errorContext, ctx.errorContext)
                    assert.equal(reflected.kind, route === "receiver"
                        ? runtime.ERROR_KIND.InvalidManagedReceiver
                        : runtime.ERROR_KIND.ExportReflectionFailed)
                    assert.equal(calls, 0)
                    assert.equal(ctx.execution.fatalError, null)
                    fail = false
                    const graphChain = new runtime.Chain(graph, ctx)
                    assert.equal(runtime.hasError(graphChain, [], ctx), true)
                    runtime.assignPath(graphChain, [array ? "0" : "before"], 7, ctx)
                    assert.equal(runtime.lookupPath(graphChain, [array ? "0" : "before"], ctx), 7)
                    verifyRefCounts(ctx, graph, graphChain._state.value, chain._state.value)
                })
            }
        }
    }

    for (const pending of [false, true]) {
        for (const trap of ["keys", "placement", "then"]) {
            it(`retains receiver validation Errors around ${trap} reflection after ${pending ? "pending" : "ready"} completion`, async () => {
                const ctx = context()
                const first = new Error("first")
                const last = new Error("last")
                const nested = new Error("inside child")
                const reflection = new Error("reflection")
                let fail = false
                const child = new Proxy({ bad: 0, nested: 0 }, {
                    ownKeys(value) {
                        if (fail && trap === "keys") throw reflection
                        return Reflect.ownKeys(value)
                    },
                    getOwnPropertyDescriptor(value, key) {
                        if (fail && key === (trap === "then" ? "then" : "bad") && trap !== "keys") throw reflection
                        return Reflect.getOwnPropertyDescriptor(value, key)
                    },
                })
                const receiver = {
                    first: 0, child, last: 0,
                    change() {
                        const finish = () => {
                            this.first = first
                            this.last = last
                            this.child.nested = nested
                            fail = true
                            return 1
                        }
                        return pending ? Promise.resolve().then(finish) : finish()
                    },
                }
                receiver.self = receiver
                const chain = new runtime.Chain(receiver, ctx)
                const failure = await runtime.run(chain, [], "change", [], ctx, { mutationScopeDepth: 0 })
                assert(runtime.isPoisonError(failure))
                const expected = new Set([first, last, reflection])
                if (trap !== "keys") expected.add(nested)
                assert.equal(leaves(failure).length, expected.size)
                assert.deepEqual(new Set(leaves(failure).map(error => error.cause)), expected)
                assert(leaves(failure).every(error => error.kind === runtime.ERROR_KIND.InvalidManagedReceiver && error.errorContext === ctx.errorContext))
                assert.equal(runtime.lookupPath(chain, [], ctx), failure)
                assert.equal(ctx.execution.fatalError, null)
                fail = false
                runtime.assignPath(chain, [], { healthy: true }, ctx)
                assert.equal(runtime.lookupPath(chain, ["healthy"], ctx), true)
                verifyRefCounts(ctx, chain._state.value)
            })
        }

        for (const invalidResult of [false, true]) {
            for (const invalidReceiver of [false, true]) {
                it(`keeps ${invalidResult ? "failed" : "valid"} result import and ${invalidReceiver ? "invalid" : "valid"} receiver outcomes after ${pending ? "pending" : "ready"} completion`, async () => {
                    const ctx = context()
                    const resultCause = new Error("result import")
                    const receiverCause = new Error("receiver")
                    const output = new Proxy({ answer: 2 }, {
                        ownKeys(value) {
                            if (invalidResult) throw resultCause
                            return Reflect.ownKeys(value)
                        },
                    })
                    const chain = new runtime.Chain({
                        n: 1,
                        change() {
                            const finish = () => {
                                this.n = 2
                                if (invalidReceiver) this.bad = receiverCause
                                return output
                            }
                            return pending ? Promise.resolve().then(finish) : finish()
                        },
                    }, ctx)
                    const result = await runtime.run(chain, [], "change", [], ctx, { mutationScopeDepth: 0 })
                    if (!invalidResult && !invalidReceiver) assert.equal(result, output)
                    else {
                        const expected = new Set()
                        if (invalidResult) expected.add(resultCause)
                        if (invalidReceiver) expected.add(receiverCause)
                        assert.equal(leaves(result).length, expected.size)
                        assert.deepEqual(new Set(leaves(result).map(error => error.cause)), expected)
                        for (const error of leaves(result)) {
                            assert.equal(error.errorContext, ctx.errorContext)
                            assert.equal(error.kind, error.cause === resultCause
                                ? runtime.ERROR_KIND.ImportReflectionFailed
                                : runtime.ERROR_KIND.InvalidManagedReceiver)
                        }
                    }
                    const published = runtime.lookupPath(chain, [], ctx)
                    if (invalidReceiver) {
                        assert(runtime.isPoisonError(published))
                        assert.deepEqual(leaves(published).map(error => error.cause), [receiverCause])
                    } else assert.equal(published.n, 2)
                    assert.equal(ctx.execution.fatalError, null)
                    verifyRefCounts(ctx, published)
                })
            }
        }
    }

    it("deduplicates an existing poison shared by result import and receiver validation", () => {
        const ctx = context()
        const original = context(ctx.execution)
        const poison = kernel.createPoisonError(new Error("shared failure"), original, runtime.ERROR_KIND.InvocationFailed)
        const output = new Proxy({}, { ownKeys() { throw poison } })
        const chain = new runtime.Chain({ change() { this.bad = poison; return output } }, ctx)
        assert.equal(runtime.run(chain, [], "change", [], ctx, { mutationScopeDepth: 0 }), poison)
        assert.equal(runtime.lookupPath(chain, [], ctx), poison)
        assert.equal(ctx.execution.fatalError, null)
    })

    it("keeps internal receiver validation defects fatal", () => {
        const ctx = context()
        const cause = new Error("corrupt admission fact")
        const child = {}
        const chain = new runtime.Chain({
            child,
            change() {
                Object.defineProperty(metadata.metaOf(child, ctx), "type", { get() { throw cause } })
            },
        }, ctx)
        assert.throws(() => runtime.run(chain, [], "change", [], ctx, { mutationScopeDepth: 0 }), failure => {
            assert(runtime.isFatalError(failure))
            assert.equal(failure.cause, cause)
            assert.equal(failure, ctx.execution.fatalError)
            return true
        })
    })

    for (const mutation of [false, true]) {
        for (const [delivery, deliver] of Object.entries(deliveries)) {
            for (const nested of [false, true]) {
                it(`preserves a ${nested ? "nested" : "root"} receiver after rejected prototype selection in ${mutation ? "mutation" : "observation"} mode with ${delivery} preparation`, async () => {
                    const ctx = context()
                    let calls = 0
                    class Value {
                        n = 1
                        read() { calls++; return this.n }
                    }
                    runtime.managedStateClass(Value)
                    const value = new Value()
                    const chain = new runtime.Chain(nested ? { value } : value, ctx)
                    const path = nested ? ["value"] : []
                    const descriptor = Object.getOwnPropertyDescriptor(Value.prototype, "read")
                    Object.defineProperty(Value.prototype, "read", { get() { calls++; throw new Error("must not invoke accessor") } })
                    const work = runtime.run(chain, path, "read", [deliver(0)], ctx, mutation ? { mutationScopeDepth: path.length } : {})
                    if (delivery !== "pending") assert(runtime.isPoisonError(work))
                    const failure = await work
                    assert.equal(failure.kind, runtime.ERROR_KIND.InvalidManagedReceiver)
                    assert.equal(calls, 0)
                    assert.equal(ctx.execution.fatalError, null)
                    assert.equal(await runtime.lookupPath(chain, [...path, "n"], ctx), 1)
                    Object.defineProperty(Value.prototype, "read", descriptor)
                    assert.equal(runtime.run(chain, path, "read", [], ctx, {}), 1)
                    assert.equal(calls, 1)
                    verifyRefCounts(ctx, chain._state.value)
                })
            }
        }
    }
})
