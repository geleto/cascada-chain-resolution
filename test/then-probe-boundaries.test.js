import assert from "node:assert/strict"
import * as r from "../src/index.js"

describe("then protocol probe boundaries", () => {
    for (const pending of [false, true]) {
        it(`preserves a non-callable native Error-valued then property, pending=${pending}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "ordinary then data" }
            const candidate = new Error("non-callable then data")
            const source = Object.defineProperty({ value: 1 }, "then", { value: candidate })
            const input = { child: source }
            const signal = pending ? Promise.withResolvers() : undefined
            const result = r.import(signal?.promise ?? input, ctx)
            signal?.resolve(input)
            assert.equal(await result, input)
            assert.equal(source.then, candidate)
            assert.equal(ctx.execution.fatalError, null)
            assert.equal(r.hasError(new r.Chain(input, ctx), [], ctx), false)
        })

        it(`fails with the exact FatalError-valued then candidate, pending=${pending}`, async () => {
            const producer = { execution: new r.Execution(), errorContext: "earlier fatal source" }
            let fatal
            try { r.failExecution(producer, new Error("earlier internal defect")) }
            catch (error) { fatal = error }
            const reports = [], ctx = { execution: new r.Execution(error => reports.push(error)), errorContext: "receiving import" }
            const sibling = r.import(new Promise(() => {}), ctx)
            const siblingOutcome = sibling.then(() => assert.fail("Sibling succeeded"), error => error)
            const source = Object.defineProperty({ value: 1 }, "then", { value: fatal })
            const input = { child: source }
            if (pending) {
                const signal = Promise.withResolvers()
                const result = r.import(signal.promise, ctx)
                signal.resolve(input)
                await assert.rejects(result, error => error === fatal)
            } else {
                assert.throws(() => r.import(input, ctx), error => error === fatal)
            }
            assert.equal(ctx.execution.fatalError, fatal)
            assert.equal(await siblingOutcome, fatal)
            assert.deepEqual(reports, [fatal])
        })
    }
})
