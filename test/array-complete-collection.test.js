import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import { ready } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = (execution = new runtime.Execution()) => ({ execution, errorContext: {} })
const leaves = error => error.errors ?? [error]
const flush = async () => {
    for (let index = 0; index < 12; index++) await Promise.resolve()
}

function assertCauses(error, expected) {
    assert(runtime.isPoisonError(error))
    const errors = leaves(error)
    assert.equal(errors.length, expected.length)
    for (const cause of expected) assert(errors.some(error => error.cause === cause))
}

describe("complete Array preparation", () => {
    for (const route of ["sort observation", "sort mutation", "toSorted"]) {
        for (const comparator of [false, true]) {
            for (const delivery of ["ready", "synchronous", "pending"]) {
                it(`${route} retains descriptor and value failures with ${delivery} inputs, comparator=${comparator}`, async () => {
                    const ctx = context()
                    const introduced = context(ctx.execution)
                    const first = new Error("first required input")
                    const last = new Error("last required input")
                    const reflection = new Error("middle descriptor")
                    const later = Promise.withResolvers()
                    const delivered = delivery === "ready" ? last
                        : delivery === "synchronous" ? ready(last) : later.promise
                    let fail = false
                    let calls = 0
                    const source = new Proxy([first, 0, delivered], {
                        getOwnPropertyDescriptor(target, key) {
                            if (fail && key === "1") throw reflection
                            return Reflect.getOwnPropertyDescriptor(target, key)
                        },
                    })
                    runtime.import(source, introduced)
                    const chain = new runtime.Chain(source, ctx)
                    fail = true
                    const work = runtime.run(
                        chain, [], route === "toSorted" ? route : "sort",
                        comparator ? [() => { calls++; return 0 }] : [], ctx,
                        route === "sort mutation" ? { mutationScopeDepth: 0 } : {},
                    )
                    if (delivery === "pending") {
                        assert(work instanceof Promise)
                        let settled = false
                        work.then(() => { settled = true })
                        await flush()
                        assert.equal(settled, false)
                        later.reject(last)
                    } else assert(runtime.isPoisonError(work))
                    const failure = await work
                    assertCauses(failure, [first, reflection, last])
                    for (const error of leaves(failure)) {
                        assert.equal(error.errorContext, error.cause === reflection
                            ? ctx.errorContext : introduced.errorContext)
                        assert.equal(error.kind, error.cause === reflection
                            ? runtime.ERROR_KIND.InvalidArrayOperation : runtime.ERROR_KIND.ContextValueFailed)
                    }
                    assert.equal(calls, 0)
                    assert.equal(ctx.execution.fatalError, null)
                    fail = false
                    verifyRefCounts(ctx, source, chain._state.value)
                    runtime.assignPath(chain, [], [2, 1], ctx)
                    assert.deepEqual(runtime.run(chain, [], "toSorted", [], ctx, {}), [1, 2])
                })
            }
        }
    }

    for (const method of ["sort", "toSorted"]) {
        it(`${method} continues value preparation after a captured placement becomes unreadable`, async () => {
            const ctx = context()
            const first = new Error("nested first")
            const last = new Error("nested last")
            const reflection = new Error("value read")
            const later = Promise.withResolvers()
            let reads = 0
            let fail = false
            const source = new Proxy([[first], 0, later.promise], {
                getOwnPropertyDescriptor(target, key) {
                    if (fail && key === "1" && ++reads === 2) throw reflection
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            runtime.import(source, ctx)
            const chain = new runtime.Chain(source, ctx)
            fail = true
            const work = runtime.run(chain, [], method, [], ctx, {})
            assert(work instanceof Promise)
            later.resolve([last])
            assertCauses(await work, [first, reflection, last])
            assert.equal(ctx.execution.fatalError, null)
            fail = false
            verifyRefCounts(ctx, source)
        })
    }

    for (const depth of [0, 1]) {
        for (const delivery of ["ready", "synchronous", "pending"]) {
            it(`flat(${depth}) preserves its required frontier with ${delivery} nested input`, async () => {
                const ctx = context()
                const first = new Error("first nested Array")
                const last = new Error("last nested Array")
                const reflection = new Error("middle descriptor")
                const later = Promise.withResolvers()
                let fail = false
                let nestedReads = 0
                const nested = cause => new Proxy([1], {
                    ownKeys() { nestedReads++; throw cause },
                })
                const delivered = delivery === "ready" ? nested(last)
                    : delivery === "synchronous" ? ready(nested(last)) : later.promise
                const source = new Proxy([nested(first), 0, delivered], {
                    getOwnPropertyDescriptor(target, key) {
                        if (fail && key === "1") throw reflection
                        return Reflect.getOwnPropertyDescriptor(target, key)
                    },
                })
                const chain = new runtime.Chain(source, ctx)
                fail = true
                const work = runtime.run(chain, [], "flat", [depth], ctx, {})
                if (depth && delivery === "pending") {
                    assert(work instanceof Promise)
                    let settled = false
                    work.then(() => { settled = true })
                    await flush()
                    assert.equal(settled, false)
                } else assert(runtime.isPoisonError(work))
                later.resolve(nested(last))
                assertCauses(await work, depth ? [first, reflection, last] : [reflection])
                assert.equal(nestedReads, depth ? 2 : 0)
                assert.equal(ctx.execution.fatalError, null)
            })
        }
    }

    for (const method of ["toSorted", "flat"]) {
        it(`${method} keeps complete collection inside sparse ArrayView bounds`, async () => {
            const ctx = context()
            const first = new Error("first")
            const last = new Error("last")
            const reflection = new Error("middle descriptor")
            let fail = false
            const nested = cause => method === "flat"
                ? new Proxy([1], { ownKeys() { throw cause } }) : cause
            const source = new Proxy([0, nested(first), , 0, nested(last), 0], {
                ownKeys(target) {
                    assert.equal(fail, false, "must not scan the entire backing")
                    return Reflect.ownKeys(target)
                },
                getOwnPropertyDescriptor(target, key) {
                    if (fail) {
                        assert.notEqual(key, "0")
                        assert.notEqual(key, "5")
                        if (key === "3") throw reflection
                    }
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const view = runtime.run(new runtime.Chain(source, ctx), [], "slice", [1, 5], ctx, {})
            fail = true
            const failure = runtime.run(new runtime.Chain(view, ctx), [], method, [], ctx, {})
            assertCauses(failure, [first, reflection, last])
            assert.equal(ctx.execution.fatalError, null)
        })
    }
})
