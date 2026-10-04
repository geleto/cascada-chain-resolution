import assert from "node:assert/strict"
import * as r from "../src/index.js"

function errorData() {
    const ctx = { execution: new r.Execution(), errorContext: "original poison" }
    return [new Error("ordinary Error data"), r.validationError("ordinary poison data", ctx, r.ERROR_KIND.PropertyValidation)]
}

function fatalError() {
    const ctx = { execution: new r.Execution(), errorContext: "original fatal" }
    try { r.failExecution(ctx, new Error("original defect")) }
    catch (fatal) { return fatal }
}

function setup(route, candidate, pending, throwing = false) {
    const reports = [], ctx = { execution: new r.Execution(error => reports.push(error)), errorContext: { route, pending } }
    const signal = Promise.withResolvers()
    const makeChild = () => Object.defineProperty({ value: 7 }, "then", throwing
        ? { get() { throw candidate } } : { value: candidate })
    const source = route === "managed" ? {
        change() { this.child = makeChild(); return pending ? signal.promise : undefined },
    } : [pending ? signal.promise : 2, 1]
    const chain = new r.Chain(r.import(source, ctx), ctx)
    const run = () => r.run(chain, [], route === "managed" ? "change" : route, route === "managed" ? [] : [makeChild], ctx,
        route === "managed" || route === "sort" ? { mutationScopeDepth: 0 } : {})
    return { reports, ctx, signal, source, chain, run }
}

describe("managed and comparator then protocol probes", () => {
    for (const pending of [false, true]) {
        it(`ignores non-callable hidden Error candidates before applying each result contract, pending=${pending}`, async () => {
            for (const route of ["managed", "sort", "toSorted"]) for (const candidate of errorData()) {
                const { ctx, reports, signal, source, chain, run } = setup(route, candidate, pending)
                const outcome = run()
                assert.equal(outcome instanceof Promise, pending)
                signal.resolve(route === "managed" ? undefined : 2)
                const value = await outcome
                if (route === "managed") {
                    assert.equal(value, undefined)
                    assert.deepEqual(r.export(chain, ["child"], ctx), { value: 7 })
                    assert.equal(Object.hasOwn(source, "child"), false)
                } else {
                    assert(r.isPoisonError(value))
                    assert.equal(value.kind, r.ERROR_KIND.InvalidCallbackResult)
                    assert.equal(value.errorContext, ctx.errorContext)
                }
                assert.equal(ctx.execution.fatalError, null)
                assert.deepEqual(reports, [])
                assert.equal(r.import(8, ctx), 8)
            }
        })

        it(`submits exact hidden FatalError candidates before successful validation or ordinary rejection, pending=${pending}`, async () => {
            for (const route of ["managed", "sort", "toSorted"]) {
                const fatal = fatalError()
                const { ctx, reports, signal, source, run } = setup(route, fatal, pending)
                const sibling = r.import(new Promise(() => {}), ctx)
                const siblingOutcome = sibling.then(() => assert.fail("sibling succeeded"), error => error)
                if (pending) {
                    const outcome = run()
                    signal.resolve(route === "managed" ? undefined : 2)
                    await assert.rejects(outcome, error => error === fatal)
                } else assert.throws(run, error => error === fatal)
                assert.equal(ctx.execution.fatalError, fatal)
                assert.equal(await siblingOutcome, fatal)
                assert.deepEqual(reports, [fatal])
                assert.throws(() => r.import(8, ctx), error => error === fatal)
                if (route === "managed") assert.equal(Object.hasOwn(source, "child"), false)
            }
        })

        it(`classifies the supported then getter throw at its own boundary, pending=${pending}`, async () => {
            for (const route of ["managed", "sort", "toSorted"]) for (const cause of errorData()) {
                const { ctx, reports, signal, run } = setup(route, cause, pending, true)
                const outcome = run()
                signal.resolve(route === "managed" ? undefined : 2)
                const failure = await outcome
                assert(r.isPoisonError(failure))
                if (r.isPoisonError(cause)) assert.equal(failure, cause)
                else {
                    assert.equal(failure.cause, cause)
                    assert.equal(failure.errorContext, ctx.errorContext)
                    assert.equal(failure.kind, route === "managed" ? r.ERROR_KIND.InvalidManagedReceiver : r.ERROR_KIND.ThenAccessFailed)
                }
                assert.equal(ctx.execution.fatalError, null)
                assert.deepEqual(reports, [])
                assert.equal(r.import(8, ctx), 8)
            }
        })
    }
})
