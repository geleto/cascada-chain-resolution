import assert from "node:assert/strict"
import {
    Chain, assignPath, deferred, exportValue, getErrors, lookupPath,
    runtime, testOperationContext,
} from "./support.js"

describe("Error union identity", () => {
    it("reuses a complete input, including equivalent contextualized leaves", () => {
        const ctx = testOperationContext({ line: 1 })
        const cause = new Error("first")
        const first = runtime.createPoisonError(cause, ctx, runtime.ERROR_KIND.InvocationFailed)
        const equivalent = runtime.createPoisonError(cause, ctx, first.kind)
        const second = runtime.validationError("second", ctx, runtime.ERROR_KIND.PropertyValidation)
        const compound = runtime.combineErrors([first, second], "original message")
        for (const error of [first, compound]) {
            assert.equal(runtime.combineErrors([error], "later"), error)
            assert.equal(runtime.combineErrors([error, error], "later"), error)
            assert.equal(runtime.combineErrors(new Set([error]), "later"), error)
        }
        for (const inputs of [
            [compound, first], [first, compound], [equivalent, compound],
            [compound, equivalent, second],
        ]) assert.equal(runtime.combineErrors(inputs, "later"), compound)
        assert.equal(compound.message, "original message")
        assert.equal(compound.errorContext, ctx.errorContext)
        assert.deepEqual(compound.errors, [first, second])
        assert(Object.isFrozen(compound))
        assert(Object.isFrozen(compound.errors))

        for (const independent of [
            runtime.createPoisonError(new Error("new cause"), ctx, first.kind),
            runtime.createPoisonError(cause, testOperationContext({ line: 1 }), first.kind),
            runtime.createPoisonError(cause, ctx, runtime.ERROR_KIND.IteratorFailed),
        ]) {
            const union = runtime.combineErrors([compound, independent], "enlarged")
            assert.notEqual(union, compound)
            assert.deepEqual(new Set(union.errors), new Set([first, second, independent]))
        }
    })

    for (const pending of [false, true]) {
        for (const completeInput of [false, true]) {
            it(`collects overlapping compounds, pending=${pending}, completeInput=${completeInput}`, async () => {
                const ctx = testOperationContext()
                const leaves = ["first", "shared", "third"].map(message =>
                    runtime.validationError(message, ctx, runtime.ERROR_KIND.PropertyValidation),
                )
                const left = runtime.combineErrors(leaves.slice(0, 2), "left")
                const right = runtime.combineErrors(leaves.slice(1), "right")
                const delivery = deferred()
                const last = completeInput ? runtime.combineErrors(leaves, "complete") : right
                const branch = completeInput ? { left, right } : { left }
                branch.last = pending ? delivery.promise : last
                const chain = new Chain(branch)
                const collection = getErrors(chain, [])
                const exported = exportValue(chain, [])
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
            const ctx = testOperationContext()
            const first = runtime.validationError("first", ctx, runtime.ERROR_KIND.PropertyValidation)
            const second = runtime.validationError("second", ctx, first.kind)
            const compound = runtime.combineErrors([first, second], "original")
            const delivery = deferred()
            const branch = { compound, child: first, repeated: compound }
            branch.self = branch
            const chain = new Chain({ branch: pending ? delivery.promise : branch })
            const collection = getErrors(chain, [])
            const exported = exportValue(chain, [])
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

            const target = new Chain({ value: 0 })
            const assigned = assignPath(target, ["value"], pending ? Promise.resolve(compound) : compound)
            await assigned
            assert.equal(await lookupPath(target, ["value", "blocked"]), compound)
            assert.equal(getErrors(target, ["value"]), compound)
            assert.equal(exportValue(target, ["value"]), compound)
        })
    }
})
