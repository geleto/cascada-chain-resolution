import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import { buildRefIndex } from "../src/refcounts.js"
import { OrderedThenable, ready } from "./ordered-thenable.js"
import * as metadata from "../src/meta.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = (execution = new runtime.Execution()) => ({ execution, errorContext: {} })
const leaves = error => error.errors ?? [error]
const causes = error => new Set(leaves(error).map(leaf => leaf.cause))

describe("complete publication failures", () => {
    for (const delayed of [false, true]) {
        it(`keeps an assigned Error and failed entry write-through together, delayed=${delayed}`, async () => {
            const ctx = context(), inputContext = context(ctx.execution)
            const original = runtime.import(new Error("assigned failure"), inputContext)
            const publication = new Error("refused entry write")
            const physical = { value: 1 }, hold = Promise.withResolvers()
            let refuses = true
            const chain = new runtime.Chain(new Proxy(physical, {
                set(target, key, value, receiver) {
                    if (refuses && key === "value") throw publication
                    return Reflect.set(target, key, value, receiver)
                },
            }), ctx)
            const result = runtime.enter(chain, ["value"], ctx, true, inside => {
                const assign = () => runtime.assignPath(inside, [], original, ctx)
                return delayed ? hold.promise.then(assign) : assign()
            })
            hold.resolve()
            const failure = await result
            assert.equal(leaves(failure).length, 2)
            assert(leaves(failure).includes(original))
            const added = leaves(failure).find(error => error.cause === publication)
            assert.equal(added.kind, runtime.ERROR_KIND.PropertyMutationFailed)
            assert.equal(added.errorContext, ctx.errorContext)
            assert.equal(await runtime.lookupPath(chain, ["value"], ctx), failure)
            assert.equal(physical.value, 1)
            refuses = false
            await runtime.repairPath(chain, ["value"], ctx)
            assert.equal(runtime.lookupPath(chain, ["value"], ctx), 1)
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const array of [false, true]) {
        for (const entryDepth of [0, 1, 2]) {
            for (const action of ["assign", "create", "delete", "call ready", "call synchronous", "call pending"]) {
                it(`keeps refused ${action} local and repairable, array=${array}, entry depth=${entryDepth}`, async () => {
                    const ctx = context(), pending = Promise.withResolvers()
                    const failure = new Error("refused publication")
                    const creates = action === "create"
                    const key = array ? creates ? "5" : "1" : "value"
                    const original = action.startsWith("call") ? {
                        count: 0,
                        change() {
                            this.count++
                            return action === "call pending" ? pending.promise
                                : action === "call synchronous" ? ready(7) : 7
                        },
                    } : 1
                    const physical = array ? [10] : { sibling: 10 }
                    if (!creates) physical[key] = original
                    let refuses = true
                    const source = new Proxy(physical, Object.fromEntries(
                        ["set", "defineProperty", "deleteProperty"].map(trap => [trap, (...args) => {
                            if (refuses && args[1] === key) throw failure
                            return Reflect[trap](...args)
                        }])))
                    const chain = new runtime.Chain(source, ctx)
                    const mutate = (chain, path) => action.startsWith("call")
                        ? runtime.run(chain, path, "change", [], ctx, { mutationScopeDepth: path.length })
                        : action === "delete" ? runtime.deletePath(chain, path, ctx)
                            : runtime.assignPath(chain, path, 2, ctx)
                    const execute = (chain, path, depth) => depth === 0 ? mutate(chain, path)
                        : runtime.enter(chain, path, ctx, true, inside => execute(inside, [], depth - 1))
                    const work = execute(chain, [key], entryDepth)
                    pending.resolve(7)
                    const result = await work
                    assert.equal(result.cause, failure)
                    assert.equal(result.errorContext, ctx.errorContext)
                    assert.equal(result.kind, runtime.ERROR_KIND.PropertyMutationFailed)
                    assert.equal(await runtime.lookupPath(chain, [key], ctx), result)
                    assert.equal(runtime.lookupPath(chain, [array ? 0 : "sibling"], ctx), 10)
                    assert.equal(Object.hasOwn(physical, key), !creates)
                    assert.equal(physical[key], creates ? undefined : original)
                    if (array) assert.equal(runtime.lookupPath(chain, ["length"], ctx), creates ? 6 : 2)
                    verifyRefCounts(ctx, chain._state)

                    refuses = false
                    assert.equal(await runtime.repairPath(chain, [key], ctx), undefined)
                    const restored = await runtime.lookupPath(chain, [key], ctx)
                    assert.equal(restored, creates ? undefined : original)
                    const output = await runtime.export(chain, [], ctx)
                    assert.equal(Object.hasOwn(output, key), !creates)
                    if (array) assert.equal(output.length, creates ? 6 : 2)
                    if (action.startsWith("call")) assert.equal(original.count, 0)
                    assert.equal(ctx.execution.fatalError, null)
                    verifyRefCounts(ctx, chain._state)
                })
            }
        }
    }

    it("completes a captured gate before a later operation advances its logical version", async () => {
        const ctx = context()
        const later = context(ctx.execution)
        const pending = Promise.withResolvers()
        const chain = new runtime.Chain({ receiver: { change() { return pending.promise } } }, ctx)
        const work = runtime.run(chain, ["receiver"], "change", [], ctx, { mutationScopeDepth: 1 })
        // This issued mutation resumes on the first operation's gate, then
        // replaces that logical receiver with its own path-validation failure.
        runtime.assignPath(chain, ["receiver", Symbol("invalid segment")], 1, later)
        pending.resolve(7)
        assert.equal(await work, 7, "later work cannot add Errors to the earlier result")
        const failure = await runtime.lookupPath(chain, ["receiver"], later)
        assert.equal(failure.errorContext, later.errorContext)
        assert.equal(failure.kind, runtime.ERROR_KIND.InvalidPathSegment)
        assert.equal(ctx.execution.fatalError, null)
        verifyRefCounts(ctx, chain._state)
    })

    for (const delivery of ["ready", "synchronous", "pending"]) {
        for (const succeeds of [false, true]) {
            it(`retains the ${delivery} managed outcome when receiver publication fails, succeeds=${succeeds}`, async () => {
                const ctx = context()
                const hostFailure = new Error("host failure")
                const publicationFailure = new Error("receiver publication")
                const pending = Promise.withResolvers()
                const receiver = {
                    n: 0,
                    change() {
                        this.n = 1
                        const result = succeeds ? 7 : hostFailure
                        return delivery === "ready" ? result
                            : delivery === "synchronous" ? ready(result) : pending.promise
                    },
                }
                const root = new Proxy({ receiver }, {
                    set(target, key, value, receiver) {
                        // Installing a gate succeeds; publishing its final value fails.
                        if (key === "receiver" && !(value instanceof Promise)) throw publicationFailure
                        return Reflect.set(target, key, value, receiver)
                    },
                })
                const chain = new runtime.Chain(root, ctx)
                runtime.lookupPath(chain, ["receiver"], ctx) // Protect the original receiver.
                const work = runtime.run(chain, ["receiver"], "change", [], ctx, { mutationScopeDepth: 1 })
                if (delivery === "pending") {
                    assert(work instanceof Promise)
                    if (succeeds) pending.resolve(7)
                    else pending.reject(hostFailure)
                } else assert(runtime.isPoisonError(work))
                const result = await work
                const graph = await runtime.lookupPath(chain, ["receiver"], ctx)
                const expected = new Set(succeeds ? [publicationFailure] : [hostFailure, publicationFailure])
                assert.deepEqual(causes(result), expected)
                assert.deepEqual(causes(graph), expected)
                assert.equal(leaves(result).length, expected.size)
                for (const error of leaves(result)) {
                    assert.equal(error.errorContext, ctx.errorContext)
                    assert.equal(error.kind, error.cause === hostFailure
                        ? runtime.ERROR_KIND.InvocationFailed : runtime.ERROR_KIND.PropertyMutationFailed)
                }
                assert.equal(receiver.n, 0)
                assert.equal(metadata.hasReadLease(receiver, ctx), false)
                assert.equal(ctx.execution.fatalError, null)
                verifyRefCounts(ctx, chain._state)
            })
        }
    }

    for (const pendingAncestor of [false, true]) {
        it(`retains every failure through a ${pendingAncestor ? "pending" : "ready"} ancestor writeback`, async () => {
            const ctx = context()
            const expected = ["host", "target publication", "ancestor publication"].map(message => new Error(message))
            const pending = Promise.withResolvers()
            let targetFailed = false
            const parent = new Proxy({ receiver: { fail() { return expected[0] } } }, {
                set(target, key, value, receiver) {
                    if (runtime.isPoisonError(value)) {
                        targetFailed = true
                        throw expected[1]
                    }
                    return Reflect.set(target, key, value, receiver)
                },
            })
            const root = new Proxy({ parent: pendingAncestor ? pending.promise : parent }, {
                set(target, key, value, receiver) {
                    // Fail the actual ancestor replacement, including the
                    // copied parent carrying its property's logical poison.
                    if (targetFailed && key === "parent" && value !== parent && !(value instanceof Promise)) throw expected[2]
                    return Reflect.set(target, key, value, receiver)
                },
            })
            const chain = new runtime.Chain(root, ctx)
            const work = runtime.run(chain, ["parent", "receiver"], "fail", [], ctx, { mutationScopeDepth: 2 })
            if (pendingAncestor) pending.resolve(parent)
            else assert(runtime.isPoisonError(work))
            const result = await work
            const graph = await runtime.lookupPath(chain, ["parent", "receiver"], ctx)
            assert.deepEqual(causes(result), new Set(expected))
            assert.deepEqual(causes(graph), new Set(expected))
            assert.equal(leaves(result).length, 3)
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state)
        })
    }

    it("retains selected failures when copying their containing node also fails", () => {
        const ctx = context()
        const expected = ["host", "publication", "copy"].map(message => new Error(message))
        let copying = false
        const source = new Proxy({ receiver: { fail() { return expected[0] } } }, {
            set(target, key, value, receiver) {
                if (runtime.isPoisonError(value)) {
                    copying = true
                    throw expected[1]
                }
                return Reflect.set(target, key, value, receiver)
            },
            ownKeys(target) {
                if (copying) {
                    copying = false
                    throw expected[2]
                }
                return Reflect.ownKeys(target)
            },
        })
        const chain = new runtime.Chain(source, ctx)
        const result = runtime.run(chain, ["receiver"], "fail", [], ctx, { mutationScopeDepth: 1 })
        assert.deepEqual(causes(result), new Set(expected))
        assert.deepEqual(causes(runtime.lookupPath(chain, [], ctx)), new Set(expected))
        assert.equal(ctx.execution.fatalError, null)
        verifyRefCounts(ctx, chain._state)
    })

    it("retains the required managed result when final publication fails", async () => {
        const ctx = context()
        const hostFailure = new Error("later host rejection")
        const publicationFailure = new Error("final publication")
        const pending = Promise.withResolvers()
        const receiver = { change() { return pending.promise } }
        const chain = new runtime.Chain(new Proxy({ receiver }, {
            set() { throw publicationFailure },
        }), ctx)
        const work = runtime.run(chain, ["receiver"], "change", [], ctx, { mutationScopeDepth: 1 })
        assert(work instanceof Promise)
        assert(runtime.lookupPath(chain, ["receiver"], ctx) instanceof Promise)
        pending.reject(hostFailure)
        assert.deepEqual(causes(await work), new Set([hostFailure, publicationFailure]))
        assert.equal(metadata.hasReadLease(receiver, ctx), false)
        assert.equal(ctx.execution.fatalError, null)
        runtime.assignPath(chain, [], { healthy: 1 }, ctx)
        assert.equal(runtime.lookupPath(chain, ["healthy"], ctx), 1)
        verifyRefCounts(ctx, chain._state)
    })

    for (const method of ["pop", "shift"]) {
        it(`${method} retains a pending removed Error after parent publication fails without delaying repair`, async () => {
            const ctx = context()
            const introduced = context(ctx.execution)
            const original = runtime.import(new Error("removed value"), introduced)
            const publicationFailure = new Error("parent publication")
            const pending = Promise.withResolvers()
            const items = [pending.promise]
            const chain = new runtime.Chain(new Proxy({ items }, {
                set() { throw publicationFailure },
            }), ctx)
            runtime.lookupPath(chain, ["items"], ctx) // Mutation needs a replacement.
            const work = runtime.run(chain, ["items"], method, [], ctx, { mutationScopeDepth: 1 })
            assert(work instanceof Promise)
            const graphFailure = runtime.lookupPath(chain, ["items"], ctx)
            assert.equal(graphFailure.cause, publicationFailure)
            assert.equal(metadata.hasReadLease(items, ctx), false)
            runtime.assignPath(chain, [], { healthy: 1 }, ctx)
            assert.equal(runtime.lookupPath(chain, ["healthy"], ctx), 1)
            pending.reject(original)
            const result = await work
            assert.deepEqual(new Set(leaves(result)), new Set([original, graphFailure]))
            assert.equal(original.errorContext, introduced.errorContext)
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, items, chain._state)
        })
    }

    for (const stage of ["descriptor", "write"]) {
        for (const indexed of [false, true]) {
            for (const repeated of [false, true]) {
                it(`preserves rejected input through optional ${stage} failure, indexed=${indexed}, repeated=${repeated}`, async () => {
                    const ctx = context()
                    const introduced = context(ctx.execution)
                    const cause = new Error("input rejection")
                    const original = runtime.import(cause, introduced)
                    const publication = repeated ? original : new Error("publication failure")
                    const later = Promise.withResolvers()
                    let fail = false
                    const physical = { value: later.promise }
                    const source = new Proxy(physical, {
                        getOwnPropertyDescriptor(target, key) {
                            if (fail && stage === "descriptor" && key === "value") {
                                fail = false
                                throw publication
                            }
                            return Reflect.getOwnPropertyDescriptor(target, key)
                        },
                        set(target, key, value, receiver) {
                            if (fail && stage === "write") throw publication
                            return Reflect.set(target, key, value, receiver)
                        },
                    })
                    const chain = new runtime.Chain(source, ctx)
                    if (indexed) buildRefIndex(source, ctx)
                    const work = runtime.lookupPath(chain, ["value"], ctx)
                    fail = true
                    later.reject(original)
                    const result = await work
                    fail = false
                    assert.equal(result, original)
                    assert.equal(original.errorContext, introduced.errorContext)
                    assert.equal(physical.value, later.promise)
                    assert.equal(runtime.lookupPath(chain, ["value"], ctx), result)
                    assert.deepEqual(new Set(leaves(runtime.getErrors(chain, [], ctx))), new Set(leaves(result)))
                    assert.equal(ctx.execution.fatalError, null)
                    verifyRefCounts(ctx, source)
                })
            }
        }
    }

    it("retains required index failure when optional settlement writeback also fails", async () => {
        const ctx = context()
        const causes = ["index preparation", "write"].map(message => new Error(message))
        const later = new OrderedThenable()
        let fail = false
        const physical = { value: later }
        const source = new Proxy(physical, {
            set(target, key, value, receiver) {
                if (fail) throw causes[1]
                return Reflect.set(target, key, value, receiver)
            },
        })
        const chain = new runtime.Chain(source, ctx)
        buildRefIndex(source, ctx)
        const work = runtime.lookupPath(chain, ["value"], ctx)
        fail = true
        later.resolve(new Proxy([1], { ownKeys() { throw causes[0] } }))
        later.flush()
        const result = await work
        fail = false
        assert.equal(result.cause, causes[0])
        assert.equal(result.kind, runtime.ERROR_KIND.PropertyMutationFailed)
        assert.equal(physical.value, later)
        assert.equal(runtime.lookupPath(chain, ["value"], ctx), result)
        assert.equal(ctx.execution.fatalError, null)
        verifyRefCounts(ctx, source)
    })

    for (const method of ["pop", "shift"]) {
        for (const pending of [false, true]) {
            it(`${method} publishes receiver failure while retaining its ${pending ? "pending" : "ready"} result Error`, async () => {
                const ctx = context()
                const introduced = context(ctx.execution)
                const original = runtime.import(new Error("removed value"), introduced)
                const publication = new Error("Array replay")
                const later = Promise.withResolvers()
                const removed = pending ? later.promise : original
                const source = new Proxy(method === "pop" ? [2, removed] : [removed, 2], {
                    set(target, key, value, receiver) {
                        if (key === "length") throw publication
                        return Reflect.set(target, key, value, receiver)
                    },
                })
                const chain = new runtime.Chain(new Proxy({ items: source }, { set() { throw publication } }), ctx)
                buildRefIndex(source, ctx)
                const work = runtime.run(chain, ["items"], method, [], ctx, { mutationScopeDepth: 1 })
                const receiverFailure = runtime.lookupPath(chain, ["items"], ctx)
                assert.equal(receiverFailure.cause, publication)
                assert.equal(receiverFailure.kind, runtime.ERROR_KIND.PropertyMutationFailed)
                if (pending) {
                    assert(work instanceof Promise)
                    later.reject(original)
                } else assert(runtime.isPoisonError(work))
                const result = await work
                assert.equal(leaves(result).length, 2)
                assert(leaves(result).includes(original))
                assert(leaves(result).includes(receiverFailure))
                assert.equal(ctx.execution.fatalError, null)
                verifyRefCounts(ctx, source, receiverFailure)
                runtime.assignPath(chain, [], [3], ctx)
                assert.equal(runtime.run(chain, [], "pop", [], ctx, { mutationScopeDepth: 0 }), 3)
            })
        }
    }
})
