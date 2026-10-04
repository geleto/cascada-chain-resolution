import assert from "node:assert/strict"
import * as r from "../src/index.js"

describe("external Array length action boundaries", () => {
    for (const pending of [false, true]) for (const behavior of ["success", "refused", "throw", "throw poison", "invalid length", "reentry"]) {
        it(`separates descriptor reflection from native length conversion: ${behavior}, pending=${pending}`, async () => {
            const reports = [], execution = new r.Execution(error => reports.push(error))
            const setup = { execution, errorContext: "setup" }
            const ctx = { execution, errorContext: { behavior, pending } }
            const nested = { execution, errorContext: "forbidden nested operation" }
            const unrelated = new r.Chain({ value: 1 }, setup)
            const cause = behavior === "throw poison"
                ? r.validationError("descriptor trap", setup, r.ERROR_KIND.PropertyValidation)
                : new Error("descriptor trap")
            const signal = Promise.withResolvers()
            let armed = false, coercions = 0, observedFatal
            const target = [{ work() { return 42 } }]
            target.hold = () => signal.promise
            if (behavior === "refused") Object.defineProperty(target, "length", { writable: false })
            const api = r.externalState(new Proxy(target, {
                getOwnPropertyDescriptor(target, key) {
                    if (armed && key === "length") {
                        if (behavior === "throw" || behavior === "throw poison") throw cause
                        if (behavior === "reentry") {
                            try { r.lookupPath(unrelated, ["value"], nested) }
                            catch (fatal) { observedFatal = fatal }
                        }
                    }
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            }))
            const chain = new r.ContextChain({ api }, setup, { api: { 0: {} } })
            const wait = pending ? r.run(chain, ["api"], "hold", [], setup, { mutationScopeDepth: 1 }) : undefined
            const siblingSignal = Promise.withResolvers()
            const siblingOutcome = r.import(siblingSignal.promise, setup)
                .then(value => ({ value }), error => ({ error }))
            const length = { valueOf() { coercions++; return behavior === "invalid length" ? 1.5 : 2 } }
            armed = true
            let result
            if (behavior === "reentry" && !pending) {
                assert.throws(() => r.assignPath(chain, ["api", "length"], length, ctx, 1), error => error === observedFatal)
            } else result = r.assignPath(chain, ["api", "length"], length, ctx, 1)
            const query = behavior === "reentry" ? undefined : r.getErrors(chain, ["api"], ctx)
            signal.resolve()
            await wait
            if (behavior === "reentry") {
                const fatal = execution.fatalError
                assert(r.isFatalError(fatal))
                assert.equal(fatal, observedFatal)
                assert.equal(fatal.errorContext, nested.errorContext)
                assert.equal(coercions, 0, "failed descriptor reflection must stop before a separate coercion action")
                assert.equal(target.length, 1)
                assert.equal((await siblingOutcome).error, fatal)
                assert.deepEqual(reports, [fatal])
                assert.throws(() => r.import(8, ctx), error => error === fatal)
                return
            }
            const failure = await query
            if (behavior === "success") {
                assert.equal(result, undefined)
                assert.equal(failure, null)
                assert.equal(target.length, 2)
                assert.equal(coercions, 2)
            } else {
                assert(r.isPoisonError(failure))
                if (behavior === "throw poison") assert.equal(failure, cause)
                else {
                    assert.equal(failure.kind, r.ERROR_KIND.ExternalPropertyWriteFailed)
                    assert.equal(failure.errorContext, ctx.errorContext)
                    if (behavior === "throw") assert.equal(failure.cause, cause)
                    if (behavior === "invalid length") assert(failure.cause instanceof RangeError)
                }
                assert.equal(target.length, 1)
                assert.equal(coercions, behavior === "invalid length" ? 2 : 0)
            }
            assert.equal(execution.fatalError, null)
            assert.deepEqual(reports, [])
            siblingSignal.resolve(8)
            assert.deepEqual(await siblingOutcome, { value: 8 })
            assert.equal(r.lookupPath(unrelated, ["value"], ctx), 1)
        })
    }
})
