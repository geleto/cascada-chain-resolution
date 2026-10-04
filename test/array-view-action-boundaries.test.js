import assert from "node:assert/strict"
import * as r from "../src/index.js"

describe("Array view backing actions", () => {
    for (const pending of [false, true]) {
        it(`performs no physical write after a backing read closes execution, pending=${pending}`, async () => {
            const reports = [], execution = new r.Execution(error => reports.push(error))
            const ctx = { execution, errorContext: "concat" }
            const nested = { execution, errorContext: "forbidden nested read" }
            const unrelated = new r.Chain({ value: 1 }, ctx)
            let armed = false, afterDescriptor = false, writesAfterFatal = 0, observedFatal
            const root = new r.Chain(r.import({ create() {
                // A native managed mutation introduces ordinary runtime-owned
                // storage; imported storage would not take a sharing route.
                this.values = new Proxy([1, 2], {
                    get(target, key, receiver) {
                        if (armed && afterDescriptor && key === "length") {
                            afterDescriptor = false
                            try { r.lookupPath(unrelated, ["value"], nested) }
                            catch (fatal) { observedFatal = fatal }
                        }
                        return Reflect.get(target, key, receiver)
                    },
                    getOwnPropertyDescriptor(target, key) {
                        if (armed && key === "length") afterDescriptor = true
                        return Reflect.getOwnPropertyDescriptor(target, key)
                    },
                    set(target, key, value, receiver) {
                        if (execution.fatalError !== null) writesAfterFatal++
                        return Reflect.set(target, key, value, receiver)
                    },
                })
            } }, ctx), ctx)
            r.run(root, [], "create", [], ctx, { mutationScopeDepth: 0 })
            const array = new r.Chain(r.lookupPath(root, ["values"], ctx), ctx)
            r.run(array, [], "slice", [0], ctx, {})
            const signal = Promise.withResolvers(), siblingSignal = Promise.withResolvers()
            const siblingOutcome = r.import(siblingSignal.promise, ctx).then(value => ({ value }), error => ({ error }))
            armed = true
            let result, synchronousFailure
            try { result = r.run(array, [], "concat", [pending ? signal.promise : [3]], ctx, {}) }
            catch (fatal) { synchronousFailure = fatal }
            signal.resolve([3])
            const outcome = await Promise.resolve(result).then(value => ({ value }), error => ({ error }))
            assert.equal(writesAfterFatal, 0)
            const fatal = execution.fatalError
            if (fatal !== null) {
                assert.equal(fatal, observedFatal)
                assert.equal(fatal.errorContext, nested.errorContext)
                assert.equal(pending ? outcome.error : synchronousFailure, fatal)
                assert.equal((await siblingOutcome).error, fatal)
                assert.deepEqual(reports, [fatal])
            } else {
                // Reusing the already captured length avoids the extra read,
                // so there may be no attempted re-entry at all.
                const output = new r.Chain(outcome.value, ctx)
                armed = false
                assert.deepEqual(r.export(output, [], ctx), [1, 2, 3])
                assert.deepEqual(r.export(array, [], ctx), [1, 2])
                assert.deepEqual(reports, [])
                siblingSignal.resolve(8)
                assert.deepEqual(await siblingOutcome, { value: 8 })
            }
        })
    }
})
