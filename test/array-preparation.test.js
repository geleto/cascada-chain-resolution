import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import { ready } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { hasReadLease } from "../src/meta.js"

const deliveries = {
    ready: value => value,
    synchronous: ready,
    pending: value => Promise.resolve(value),
}
const context = () =>
    Object.freeze({
        execution: new runtime.Execution(),
        errorContext: Object.freeze({ operation: "Array preparation" }),
    })
const leaves = error => error.errors ?? [error]

function unreadableArray(cause) {
    return new Proxy([1], {
        ownKeys() {
            throw cause
        },
    })
}

describe("Array copy placement capture", () => {
    const methods = [
        ["toReversed", []],
        ["with", [2, 7]],
        ["toSpliced", [2, 1, 7]],
    ]

    for (const [method, args] of methods) for (const publication of ["absent", "pending"]) {
        it(`${method} preserves imported-result publication before ${publication} data`, async () => {
            const ctx = context(), hold = Promise.withResolvers(), data = Promise.withResolvers()
            const source = new runtime.Chain([1, 2, 3], ctx)
            const entry = runtime.enter(source, [0], ctx, true, inner => hold.promise.then(() => {
                if (publication === "absent") runtime.deletePath(inner, [], ctx)
                else runtime.assignPath(inner, [], data.promise, ctx)
            }))
            const captured = runtime.lookupPath(source, [], ctx)
            const host = new runtime.Chain(runtime.externalState({ result() { return captured } }), ctx)
            const imported = runtime.run(host, [], "result", [], ctx, {})
            assert(!(imported instanceof Promise), "Nested pending work does not delay result import")
            const copy = new runtime.Chain(imported, ctx)
            const result = runtime.run(copy, [], method, args, ctx, {})
            assert(result instanceof Promise, "Array copying needs the preceding entry's presence")
            let output
            const completed = Promise.resolve(result).then(value => { output = new runtime.Chain(value, ctx) })
            hold.resolve()
            await entry
            await new Promise(setImmediate)
            assert(output, "Publication must not wait for ordinary pending data")
            data.resolve(8)
            await completed
            const expected = [8, 2, 3]
            if (publication === "absent") delete expected[0]
            assert.deepStrictEqual(await runtime.export(output, [], ctx), expected[method](...args))
            verifyRefCounts(ctx, source._state, copy._state, output._state)
        })
    }

    for (const [method, args] of methods) for (const change of ["replace", "delete", "descendant"]) {
        it(`${method} preserves earlier values while awaiting presence, later ${change}`, async () => {
            const ctx = context(), source = [1, { n: 2 }, 3]
            const chain = new runtime.Chain(source, ctx), hold = Promise.withResolvers()
            const entry = runtime.enter(chain, [0], ctx, true, () => hold.promise)
            const result = runtime.run(chain, [], method, args, ctx, {})
            if (change === "replace") runtime.assignPath(chain, [1], { n: 9 }, ctx)
            else if (change === "delete") runtime.deletePath(chain, [1], ctx)
            else runtime.assignPath(chain, [1, "n"], 9, ctx)
            hold.resolve()
            await entry
            const output = new runtime.Chain(await result, ctx)
            assert.deepStrictEqual(runtime.export(output, [], ctx), [1, { n: 2 }, 3][method](...args))
            assert.equal(hasReadLease(source, ctx), false)
            verifyRefCounts(ctx, chain._state.value, output._state.value)
        })
    }

    for (const [method, args] of [...methods, ["flat", [0]]]) for (const copied of [false, true]) for (const nested of [false, true]) {
        it(`${method} finishes presence before pending element data, copied=${copied}, nested=${nested}`, async () => {
            const ctx = context(), data = Promise.withResolvers(), hold = Promise.withResolvers()
            const chain = new runtime.Chain([1, 2, 3], ctx)
            const change = inside => hold.promise.then(() => {
                runtime.assignPath(inside, [], data.promise, ctx)
            })
            let nestedEntry
            const entry = runtime.enter(chain, [0], ctx, true, inside => {
                if (!nested) return change(inside)
                nestedEntry = runtime.enter(inside, [], ctx, true, change)
            })
            const observed = copied ? new runtime.Chain(runtime.run(chain, [], "slice", [], ctx, {}), ctx) : chain
            const result = runtime.run(observed, [], method, args, ctx, {})
            let output
            const completed = Promise.resolve(result).then(value => { output = new runtime.Chain(value, ctx) })
            hold.resolve()
            await Promise.all([entry, nestedEntry])
            await new Promise(setImmediate)
            try {
                assert(output, "Known presence must expose the copied Array without waiting for element data")
                assert.equal(runtime.lookupPath(output, ["length"], ctx), 3)
                assert.equal(runtime.lookupPath(output, [1], ctx), 2)
                assert.equal(hasReadLease(observed._state.value, ctx), false)
            } finally { data.resolve(8) }
            await completed
            assert.deepStrictEqual(await runtime.export(output, [], ctx), [8, 2, 3][method](...args))
            verifyRefCounts(ctx, chain._state.value, observed._state.value, output._state.value)
        })
    }

    for (const method of ["with", "toSpliced"]) for (const [delivery, deliver] of Object.entries(deliveries)) {
        it(`${method} protects its ${delivery} payload while awaiting source presence`, async () => {
            const ctx = context(), payload = { n: 2 }, hold = Promise.withResolvers()
            const argument = new runtime.Chain(payload, ctx), chain = new runtime.Chain([1, 2], ctx)
            const entry = runtime.enter(chain, [0], ctx, true, () => hold.promise)
            const args = method === "with" ? [1, deliver(payload)] : [1, 1, deliver(payload)]
            const result = runtime.run(chain, [], method, args, ctx, {})
            await new Promise(setImmediate)
            runtime.assignPath(argument, ["n"], 9, ctx)
            hold.resolve()
            await entry
            const output = new runtime.Chain(await result, ctx)
            assert.deepStrictEqual(runtime.export(output, [], ctx), [1, { n: 2 }])
            assert.deepStrictEqual(runtime.export(argument, [], ctx), { n: 9 })
            assert.equal(hasReadLease(payload, ctx), false)
            verifyRefCounts(ctx, chain._state.value, argument._state.value, output._state.value)
        })
    }

    for (const [method, args, expected] of [
        ["with", [0, 7], [7, 2]],
        ["with", [-2, 7], [7, 2]],
        ["toSpliced", [0, 1], [2]],
        ["toSpliced", [0, 2], []],
        ["toSpliced", [0, 1, 7], [7, 2]],
    ]) {
        it(`${method} skips discarded pending presence: ${args}`, async () => {
            const ctx = context(), chain = new runtime.Chain([1, 2], ctx), hold = Promise.withResolvers()
            const entry = runtime.enter(chain, [0], ctx, true, () => hold.promise)
            try {
                const result = runtime.run(chain, [], method, args, ctx, {})
                assert(!(result instanceof Promise), "Discarded placements cannot delay the result")
                assert.deepStrictEqual(runtime.export(new runtime.Chain(result, ctx), [], ctx), expected)
                assert.equal(hasReadLease(chain._state.value, ctx), false)
            } finally { hold.resolve(); await entry }
        })
    }
})

describe("Array preparation boundaries", () => {
    for (const [delivery, deliver] of Object.entries(deliveries)) {
        for (const method of ["flat", "concat"]) {
            it(`${method} attributes nested reflection failure with ${delivery} input`, async () => {
                const ctx = context()
                const cause = new Error("Array reflection")
                const input = deliver(unreadableArray(cause))
                const chain = new runtime.Chain(
                    method === "flat" ? [input] : [],
                    ctx,
                )
                const result = runtime.run(
                    chain,
                    [],
                    method,
                    method === "flat" ? [1] : [input],
                    ctx,
                    {},
                )
                if (delivery !== "pending")
                    assert(runtime.isPoisonError(result))
                const failure = await result
                assert.equal(failure.cause, cause)
                assert.equal(failure.errorContext, ctx.errorContext)
                assert.equal(
                    failure.kind,
                    runtime.ERROR_KIND.InvalidArrayOperation,
                )
                assert.equal(ctx.execution.fatalError, null)
            })
        }

        it(`flat collects both cyclic branches with ${delivery} input`, async () => {
            const ctx = context()
            const cycles = [[], []]
            for (const cycle of cycles) cycle.push(cycle)
            const chain = new runtime.Chain(cycles.map(deliver), ctx)
            const result = runtime.run(chain, [], "flat", [Infinity], ctx, {})
            if (delivery !== "pending") assert(runtime.isPoisonError(result))
            const failure = await result
            assert.equal(leaves(failure).length, 2)
            for (const error of leaves(failure)) {
                assert.equal(
                    error.kind,
                    runtime.ERROR_KIND.InvalidArrayOperation,
                )
                assert.equal(error.errorContext, ctx.errorContext)
            }
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state.value)
        })

        it(`join collects nested conversion failures with ${delivery} input`, async () => {
            const ctx = context()
            const causes = [
                new Error("first element"),
                new Error("second element"),
            ]
            const inputs = causes.map(cause =>
                deliver(
                    new Proxy([1], {
                        getOwnPropertyDescriptor(target, key) {
                            if (key === "0") throw cause
                            return Reflect.getOwnPropertyDescriptor(target, key)
                        },
                    }),
                ),
            )
            const chain = new runtime.Chain(inputs, ctx)
            const failure = await runtime.run(chain, [], "join", [], ctx, {})
            assert.deepEqual(
                new Set(leaves(failure).map(error => error.cause)),
                new Set(causes),
            )
            for (const error of leaves(failure)) {
                assert.equal(
                    error.kind,
                    runtime.ERROR_KIND.ScalarConversionFailed,
                )
                assert.equal(error.errorContext, ctx.errorContext)
            }
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const method of ["flat", "concat"]) {
        it(`${method} keeps collecting after a ready branch fails`, async () => {
            const ctx = context()
            const later = Promise.withResolvers()
            const causes = [
                new Error("ready branch"),
                new Error("later branch"),
            ]
            const inputs = [unreadableArray(causes[0]), later.promise]
            const chain = new runtime.Chain(
                method === "flat" ? inputs : [],
                ctx,
            )
            let completed = false
            const result = runtime.run(
                chain,
                [],
                method,
                method === "flat" ? [1] : inputs,
                ctx,
                {},
            )
            assert(result instanceof Promise)
            const outcome = result.then(value => {
                completed = true
                return value
            })
            await Promise.resolve()
            assert.equal(completed, false)
            later.resolve(unreadableArray(causes[1]))
            const failure = await outcome
            assert.deepEqual(
                new Set(leaves(failure).map(error => error.cause)),
                new Set(causes),
            )
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const pending of [false, true]) {
        it(`indexOf recovers reflection failure in its next step, pending=${pending}`, async () => {
            const ctx = context()
            const cause = new Error("next element")
            let fail = true
            const receiver = new Proxy([pending ? Promise.resolve(1) : 1, 2], {
                getOwnPropertyDescriptor(target, key) {
                    if (fail && key === "1") throw cause
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const chain = new runtime.Chain(receiver, ctx)
            const failure = await runtime.run(
                chain,
                [],
                "indexOf",
                [3],
                ctx,
                {},
            )
            assert.equal(failure.cause, cause)
            assert.equal(failure.kind, runtime.ERROR_KIND.InvalidArrayOperation)
            assert.equal(failure.errorContext, ctx.errorContext)
            assert.equal(ctx.execution.fatalError, null)
            fail = false
            verifyRefCounts(ctx, chain._state.value)
        })
    }

    it("keeps an adjacent internal failure fatal in nested preparation", () => {
        const ctx = context()
        const child = runtime.import([1], ctx)
        const chain = new runtime.Chain([child], ctx)
        const cause = new Error("corrupt admission facts")
        Object.defineProperty(ctx.execution._metadata.get(child), "type", {
            get() {
                throw cause
            },
        })
        assert.throws(
            () => runtime.run(chain, [], "flat", [1], ctx, {}),
            failure => {
                assert(runtime.isFatalError(failure))
                assert.equal(failure.cause, cause)
                assert.equal(ctx.execution.fatalError, failure)
                return true
            },
        )
    })
})
