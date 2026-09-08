import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import { OrderedThenable, ready } from "./ordered-thenable.js"
import { buildRefIndex } from "../src/refcounts.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = (execution = new runtime.Execution()) => ({ execution, errorContext: {} })

describe("placement versions across representation boundaries", () => {
    for (const category of ["record", "class"]) {
        for (const delivery of ["ready", "synchronous", "pending"]) {
            for (const mutation of [false, true]) {
                it(`prepares the logical ${category} receiver with ${delivery} data for ${mutation ? "mutation" : "observation"}`, async () => {
                    const ctx = context()
                    const source = new OrderedThenable()
                    const leaf = { n: 2 }
                    source.resolve(leaf)
                    const physicalValue = delivery === "ready" ? leaf
                        : delivery === "synchronous" ? source : Promise.resolve(leaf)
                    const child = { value: physicalValue }
                    child.self = child
                    class Receiver {
                        constructor() { this.left = child; this.right = child }
                        read() {
                            assert.equal(this.left, this.right)
                            assert.equal(this.left.self, this.left)
                            assert.equal(this.left.value.n, 2)
                            if (mutation) this.left.value.n++
                            return this.left.value.n
                        }
                    }
                    if (category === "class") runtime.managedStateClass(Receiver)
                    const original = category === "class" ? new Receiver()
                        : { left: child, right: child, read: Receiver.prototype.read }
                    const chain = new runtime.Chain(runtime.import(original, ctx), ctx)
                    const work = runtime.run(chain, [], "read", [], ctx,
                        mutation ? { mutationScopeDepth: 0 } : {})
                    if (delivery !== "pending") assert.equal(work, mutation ? 3 : 2)
                    assert.equal(await work, mutation ? 3 : 2)
                    assert.equal(runtime.lookupPath(chain, ["left", "value", "n"], ctx), mutation ? 3 : 2)
                    assert.equal(original.left, child)
                    assert.equal(child.value, physicalValue)
                    assert.equal(leaf.n, 2, "host work must not mutate imported storage")
                    assert.equal(source.subscriptions, delivery === "synchronous" ? 1 : 0)
                    assert.equal(ctx.execution.fatalError, null)
                    verifyRefCounts(ctx, chain._state)
                })
            }
        }
    }

    for (const method of ["slice", "concat", "pop", "shift"]) {
        for (const imported of [false, true]) {
            it(`${method} retains fixed Error attribution from ${imported ? "imported" : "runtime"} storage`, () => {
                const introduced = context()
                const later = context(introduced.execution)
                const cause = new Error("original leaf")
                const input = method === "shift" ? [0, cause] : [cause, 0]
                const chain = new runtime.Chain(imported ? runtime.import(input, introduced) : input, introduced)
                const original = runtime.lookupPath(chain, [method === "shift" ? "1" : "0"], introduced)
                const output = runtime.run(chain, [], method, [], later, {})
                const derived = new runtime.Chain(output, later)
                assert.equal(runtime.lookupPath(derived, ["0"], later), original)
                // A bounded derivative and a subsequent COW must retain the same
                // logical placement; neither is another causal boundary.
                const bounded = new runtime.Chain(runtime.run(derived, [], "slice", [0, 1], later, {}), later)
                runtime.assignPath(bounded, ["1"], 7, later)
                assert.equal(runtime.lookupPath(bounded, ["0"], later), original)
                const errors = runtime.getErrors(new runtime.Chain({ original, output, bounded: bounded._state.value }, later), [], later)
                assert.equal(errors, original)
                assert.equal(original.cause, cause)
                assert.equal(original.errorContext, introduced.errorContext)
                assert.equal(introduced.execution.fatalError, null)
                verifyRefCounts(later, chain._state, derived._state, bounded._state)
            })
        }
    }

    it("retains a synchronously consumed placement through view growth without resubscribing", () => {
        const ctx = context()
        const source = new OrderedThenable()
        source.resolve(2)
        const physical = [source, 3]
        const chain = new runtime.Chain(physical, ctx)
        assert.equal(runtime.lookupPath(chain, ["0"], ctx), 2)
        const view = new runtime.Chain(runtime.run(chain, [], "slice", [0, 1], ctx, {}), ctx)
        runtime.assignPath(view, ["1"], 9, ctx)
        assert.deepEqual(runtime.export(view, [], ctx), [2, 9])
        assert.equal(source.subscriptions, 1)
        verifyRefCounts(ctx, chain._state, view._state)
    })

    for (const action of ["assign", "delete"]) {
        for (const indexed of [false, true]) {
            it(`failed ${action} preserves an aliased fixed Error, indexed=${indexed}`, () => {
                const introduced = context()
                const later = context(introduced.execution)
                const cause = new Error("original input")
                const failure = new Error("storage mutation")
                const child = new Proxy({ value: cause }, {
                    set() { throw failure },
                    deleteProperty() { throw failure },
                })
                const chain = new runtime.Chain({ left: child, right: child }, introduced)
                const original = runtime.lookupPath(chain, ["left", "value"], introduced)
                if (indexed) buildRefIndex(chain._state, introduced)
                const result = action === "assign"
                    ? runtime.assignPath(chain, ["left", "value"], 9, later)
                    : runtime.deletePath(chain, ["left", "value"], later)
                assert.equal(result.cause, failure)
                assert.equal(runtime.lookupPath(chain, ["right", "value"], later), original)
                assert.equal(original.errorContext, introduced.errorContext)
                assert.equal(child.value, cause)
                assert.equal(later.execution.fatalError, null)
                verifyRefCounts(later, chain._state)
            })
        }
    }

    for (const method of ["pop", "shift"]) {
        for (const indexed of [false, true]) {
            it(`failed ${method} replay leaves an alias's pending version usable, indexed=${indexed}`, async () => {
                const ctx = context()
                const pending = Promise.withResolvers()
                const failure = new Error("Array deletion")
                const items = new Proxy([pending.promise], {
                    deleteProperty() { throw failure },
                })
                const chain = new runtime.Chain({ left: items, right: items }, ctx)
                if (indexed) buildRefIndex(chain._state, ctx)
                const work = runtime.run(chain, ["left"], method, [], ctx, { mutationScopeDepth: 1 })
                const retained = runtime.lookupPath(chain, ["right", "0"], ctx)
                verifyRefCounts(ctx, chain._state)
                pending.resolve(4)
                assert.equal((await work).cause, failure)
                assert.equal(await retained, 4)
                assert.equal(ctx.execution.fatalError, null)
                verifyRefCounts(ctx, chain._state)
            })
        }
    }

    for (const action of ["assign", "delete"]) {
        for (const indexed of [false, true]) {
            for (const delivery of ["ready", "synchronous", "pending"]) {
                it(`failed ${action} preserves a ${delivery} aliased placement, indexed=${indexed}`, async () => {
                    const ctx = context()
                    const pending = Promise.withResolvers()
                    const cause = new Error("storage write failed")
                    const rejected = new Error("retained input failed")
                    let fail = false
                    const chain = new runtime.Chain(runtime.import({
                        create() {
                            const child = new Proxy({ value: 4 }, {
                                set(target, key, value, receiver) {
                                    if (fail && key === "value") throw cause
                                    return Reflect.set(target, key, value, receiver)
                                },
                                deleteProperty(target, key) {
                                    if (fail && key === "value") throw cause
                                    return Reflect.deleteProperty(target, key)
                                },
                            })
                            this.left = child
                            this.right = child
                        },
                    }, ctx), ctx)
                    runtime.run(chain, [], "create", [], ctx, { mutationScopeDepth: 0 })
                    runtime.assignPath(chain, ["left", "value"], delivery === "ready" ? 4
                        : delivery === "synchronous" ? ready(4) : pending.promise, ctx)
                    if (indexed) buildRefIndex(chain._state, ctx)
                    fail = true
                    const result = action === "assign"
                        ? runtime.assignPath(chain, ["left", "value"], 9, ctx)
                        : runtime.deletePath(chain, ["left", "value"], ctx)
                    assert.equal(result.cause, cause)
                    assert.equal(result.kind, runtime.ERROR_KIND.PropertyMutationFailed)
                    const retained = runtime.lookupPath(chain, ["right", "value"], ctx)
                    fail = false
                    verifyRefCounts(ctx, chain._state)
                    if (delivery === "pending") {
                        pending.reject(rejected)
                        const error = await retained
                        assert.equal(error.cause, rejected)
                        assert.equal(error.errorContext, ctx.errorContext)
                    } else assert.equal(retained, 4)
                    assert.equal(ctx.execution.fatalError, null)
                    runtime.assignPath(chain, ["right", "value"], 8, ctx)
                    assert.equal(runtime.lookupPath(chain, ["right", "value"], ctx), 8)
                    verifyRefCounts(ctx, chain._state)
                })
            }
        }
    }
})
