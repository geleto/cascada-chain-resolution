import * as runtime from "../src/index.js"
import { Chain, assignPath, export as exportValue, getErrors, lookupPath, Execution } from "../src/index.js"
import assert from "node:assert/strict"
import { setImmediate } from "node:timers/promises"
import { deferred } from "./support.js"

describe("Error union identity", () => {
    it("reuses a complete input, including equivalent contextualized leaves", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const ctx = { ...testContext, errorContext: { line: 1 } }
        const cause = new Error("first")
        const first = runtime.createPoisonError(cause, ctx, runtime.ERROR_KIND.InvocationFailed)
        const equivalent = runtime.createPoisonError(cause, ctx, first.kind)
        const second = runtime.validationError("second", ctx, runtime.ERROR_KIND.PropertyValidation)
        const compound = runtime.combineErrors([first, second])
        for (const error of [first, compound]) {
            assert.equal(runtime.combineErrors([error]), error)
            assert.equal(runtime.combineErrors([error, error]), error)
            assert.equal(runtime.combineErrors(new Set([error])), error)
        }
        for (const inputs of [
            [compound, first], [first, compound], [equivalent, compound],
            [compound, equivalent, second],
        ]) assert.equal(runtime.combineErrors(inputs), compound)
        assert.equal(compound.message, "Multiple Errors")
        assert.equal(compound.errorContext, ctx.errorContext)
        assert.deepEqual(compound.errors, [first, second])
        assert(Object.isFrozen(compound))
        assert(Object.isFrozen(compound.errors))

        for (const independent of [
            runtime.createPoisonError(new Error("new cause"), ctx, first.kind),
            runtime.createPoisonError(cause, { ...testContext, errorContext: { line: 1 } }, first.kind),
            runtime.createPoisonError(cause, ctx, runtime.ERROR_KIND.IteratorFailed),
        ]) {
            const union = runtime.combineErrors([compound, independent])
            assert.notEqual(union, compound)
            assert.deepEqual(new Set(union.errors), new Set([first, second, independent]))
        }
    })

    it("requires every leaf to share the same opaque source", () => {
        const source = { line: 1 }
        const ctx = { execution: new Execution(), errorContext: source }
        const leaf = errorContext => runtime.validationError("failure",
            { ...ctx, errorContext }, runtime.ERROR_KIND.PropertyValidation)
        const common = runtime.combineErrors([leaf(source), leaf(source)])
        for (const otherSource of [{ line: 1 }, undefined]) {
            const other = leaf(otherSource)
            for (const inputs of [[common, other], [other, common]]) {
                const compound = runtime.combineErrors(inputs)
                assert.equal(compound.message, "Multiple Errors")
                assert.equal(compound.errorContext, undefined)
                assert.equal(compound.kind, runtime.ERROR_KIND.PropertyValidation)
                assert.deepEqual(new Set(compound.errors), new Set([...common.errors, other]))
            }
        }
        assert.equal(common.errorContext, source)
    })

    for (const [name, sources] of [
        ["signed zero", [-0, +0, -0]],
        ["negative zero", [-0, -0, -0]],
        ["NaN", [NaN, NaN, NaN]],
    ]) for (const pending of [false, true]) for (const completeInput of [false, true])
    for (const reverse of [false, true]) {
        it(`keeps exact primitive sources in query/export: ${name}, pending=${pending}, complete=${completeInput}, reverse=${reverse}`, async () => {
            const ctx = { execution: new Execution(), errorContext: "collector" }
            const causes = [new Error("shared"), new Error("other")]
            const leaves = sources.map((errorContext, index) => runtime.createPoisonError(
                causes[index === 2 ? 1 : 0], { ...ctx, errorContext }, runtime.ERROR_KIND.InvocationFailed))
            const inputs = completeInput
                ? [runtime.combineErrors(leaves), runtime.combineErrors([...leaves].reverse())]
                : leaves
            const order = inputs.map((_, index) => index)
            if (reverse) order.reverse()
            const deliveries = inputs.map(() => deferred())
            const chain = new Chain(pending ? deliveries.map(input => input.promise) : order.map(index => inputs[index]), ctx)
            const outcomes = [getErrors(chain, [], ctx), exportValue(chain, [], ctx)]
            if (pending) for (const index of order) {
                deliveries[index].resolve(inputs[index])
                await setImmediate()
            }
            for (const result of await Promise.all(outcomes)) {
                assert(result instanceof runtime.CompoundPoisonError)
                assert.equal(result.message, "Multiple Errors")
                assert.equal(result.kind, runtime.ERROR_KIND.InvocationFailed)
                assert.equal(result.errorContext, name === "signed zero" ? undefined : sources[0])
                assert.equal(result.errors.length, name === "signed zero" ? 3 : 2)
                for (const leaf of leaves) assert(result.errors.some(error =>
                    error.cause === leaf.cause && Object.is(error.errorContext, leaf.errorContext)))
                assert(result.errors.every(error => leaves.includes(error)))
                if (completeInput) assert(inputs.includes(result))
            }
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const sameSource of [false, true]) {
        for (const completeInput of [false, true]) {
            for (const order of [[0, 1], [1, 0]]) {
                it(`keeps query/export diagnostics stable, sameSource=${sameSource}, completeInput=${completeInput}, order=${order}`, async () => {
                    const ctx = { execution: new Execution(), errorContext: "collector" }
                    const sources = [{ line: 1 }, { line: 1 }]
                    const leaves = sources.map((source, index) => runtime.createPoisonError(
                        new Error(`failure ${index}`),
                        { ...ctx, errorContext: sameSource ? sources[0] : source },
                        runtime.ERROR_KIND.InvocationFailed,
                    ))
                    const inputs = completeInput
                        ? [runtime.combineErrors(leaves), runtime.combineErrors([...leaves].reverse())]
                        : leaves
                    const deliveries = [deferred(), deferred()]
                    const chain = new Chain({ first: deliveries[0].promise, second: deliveries[1].promise }, ctx)
                    const collection = getErrors(chain, [], ctx)
                    const exported = exportValue(chain, [], ctx)
                    assert(collection instanceof Promise)
                    assert(exported instanceof Promise)
                    for (const index of order) {
                        deliveries[index].resolve(inputs[index])
                        await setImmediate()
                    }
                    for (const result of await Promise.all([collection, exported])) {
                        assert(result instanceof runtime.CompoundPoisonError)
                        assert.equal(result.message, "Multiple Errors")
                        assert.equal(result.errorContext, sameSource ? sources[0] : undefined)
                        assert.equal(result.kind, runtime.ERROR_KIND.InvocationFailed)
                        assert.deepEqual(new Set(result.errors), new Set(leaves))
                        if (completeInput) assert(inputs.includes(result))
                    }
                })
            }
        }
    }

    for (const pending of [false, true]) {
        for (const completeInput of [false, true]) {
            it(`collects overlapping compounds, pending=${pending}, completeInput=${completeInput}`, async () => {
                const testContext = { execution: new Execution(), errorContext: "test operation" }
                const ctx = testContext
                const leaves = ["first", "shared", "third"].map(message =>
                    runtime.validationError(message, ctx, runtime.ERROR_KIND.PropertyValidation),
                )
                const left = runtime.combineErrors(leaves.slice(0, 2))
                const right = runtime.combineErrors(leaves.slice(1))
                const delivery = deferred()
                const last = completeInput ? runtime.combineErrors(leaves) : right
                const branch = completeInput ? { left, right } : { left }
                branch.last = pending ? delivery.promise : last
                const chain = new Chain(branch, testContext)
                const collection = getErrors(chain, [], testContext)
                const exported = exportValue(chain, [], testContext)
                if (pending) {
                    assert(collection instanceof Promise)
                    assert(exported instanceof Promise)
                    delivery.resolve(last)
                } else {
                    assert(runtime.isPoisonError(collection))
                    assert(runtime.isPoisonError(exported))
                }
                for (const result of await Promise.all([collection, exported])) {
                    assert(result instanceof runtime.CompoundPoisonError)
                    assert.equal(result.errors.length, leaves.length)
                    assert.deepEqual(new Set(result.errors), new Set(leaves))
                    if (completeInput) assert.equal(result, last)
                }
            })
        }

        it(`preserves repeated compounds through public collection and publication, pending=${pending}`, async () => {
            const testContext = { execution: new Execution(), errorContext: "test operation" }
            const ctx = testContext
            const first = runtime.validationError("first", ctx, runtime.ERROR_KIND.PropertyValidation)
            const second = runtime.validationError("second", ctx, first.kind)
            const compound = runtime.combineErrors([first, second])
            const delivery = deferred()
            const branch = { compound, child: first, repeated: compound }
            branch.self = branch
            const chain = new Chain({ branch: pending ? delivery.promise : branch }, testContext)
            const collection = getErrors(chain, [], testContext)
            const exported = exportValue(chain, [], testContext)
            if (pending) {
                assert(collection instanceof Promise)
                assert(exported instanceof Promise)
                delivery.resolve(branch)
            } else {
                assert.equal(collection, compound)
                assert.equal(exported, compound)
            }
            assert.equal(await collection, compound)
            assert.equal(await exported, compound)

            const target = new Chain({ value: 0 }, testContext)
            const assigned = assignPath(target, ["value"], pending ? Promise.resolve(compound) : compound, testContext)
            await assigned
            assert.equal(await lookupPath(target, ["value", "blocked"], testContext), compound)
            assert.equal(getErrors(target, ["value"], testContext), compound)
            assert.equal(exportValue(target, ["value"], testContext), compound)
        })
    }
})
