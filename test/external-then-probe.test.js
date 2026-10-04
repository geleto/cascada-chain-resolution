import assert from "node:assert/strict"
import * as r from "../src/index.js"

const routes = {
    intermediate: (chain, ctx) => r.lookupPath(chain, ["api", "source", "child", "value"], ctx),
    receiver: (chain, ctx) => r.run(chain, ["api", "source", "child"], "read", [], ctx, {}),
    snapshot: (chain, ctx) => r.lookupPath(chain, ["api", "source"], ctx),
    export: (chain, ctx) => r.export(chain, ["api", "source"], ctx),
}

function setup(child, pending, errorContext) {
    const reports = [], ctx = { execution: new r.Execution(error => reports.push(error)), errorContext }
    const signal = Promise.withResolvers()
    const api = r.externalState({ source: { child }, wait() { return signal.promise } })
    const chain = new r.ContextChain({ api }, ctx, { api: {} })
    const wait = pending ? r.run(chain, ["api"], "wait", [], ctx, { mutationScopeDepth: 1 }) : undefined
    return { ctx, reports, signal, api, chain, wait }
}

function errors() {
    const ctx = { execution: new r.Execution(), errorContext: "original Error data" }
    const raw = new Error("non-callable then data")
    const poison = r.validationError("non-callable poison data", ctx, r.ERROR_KIND.PropertyValidation)
    const compound = r.combineErrors([poison, r.validationError("second", ctx, r.ERROR_KIND.InvalidArrayOperation)])
    return [raw, poison, compound]
}

function fatalError() {
    const ctx = { execution: new r.Execution(), errorContext: "original fatal" }
    try { r.failExecution(ctx, new Error("original defect")) }
    catch (fatal) { return fatal }
}

describe("external then protocol probes", () => {
    for (const pending of [false, true]) {
        it(`ignores non-callable hidden Error data on native paths and snapshots, pending=${pending}`, async () => {
            for (const candidate of errors()) for (const [route, operation] of Object.entries(routes)) {
                const child = Object.defineProperty({ value: 7, read() { return this.value } }, "then", { value: candidate })
                const { ctx, reports, signal, api, chain, wait } = setup(child, pending, { route, pending })
                const outcome = operation(chain, ctx)
                assert.equal(outcome instanceof Promise, pending)
                signal.resolve()
                await wait
                const value = await outcome
                if (route === "intermediate" || route === "receiver") assert.equal(value, 7)
                else {
                    assert.deepEqual(value, { child: { value: 7, read: child.read } })
                    assert.notEqual(value, api.source)
                    assert.notEqual(value.child, child)
                    assert.equal(Object.hasOwn(value.child, "then"), false)
                }
                assert.equal(child.then, candidate)
                assert.equal(ctx.execution.fatalError, null)
                assert.deepEqual(reports, [])
                assert.equal(r.import(8, ctx), 8)
            }
        })

        it(`propagates an exact hidden FatalError candidate at every native probe, pending=${pending}`, async () => {
            for (const [route, operation] of Object.entries(routes)) {
                const fatal = fatalError()
                const child = Object.defineProperty({ value: 7, read() { return this.value } }, "then", { value: fatal })
                const { ctx, reports, signal, chain, wait } = setup(child, pending, { route, pending })
                const sibling = r.import(new Promise(() => {}), ctx)
                const siblingOutcome = sibling.then(() => assert.fail("sibling succeeded"), error => error)
                if (pending) {
                    const outcome = operation(chain, ctx)
                    signal.resolve()
                    await assert.rejects(outcome, error => error === fatal)
                    await wait
                } else assert.throws(() => operation(chain, ctx), error => error === fatal)
                assert.equal(ctx.execution.fatalError, fatal)
                assert.equal(await siblingOutcome, fatal)
                assert.deepEqual(reports, [fatal])
                assert.throws(() => r.import(8, ctx), error => error === fatal)
            }
        })

        it(`retains supported then lookup failures as recoverable poison, pending=${pending}`, async () => {
            for (const cause of errors()) for (const [route, operation] of Object.entries(routes)) {
                const child = Object.defineProperty({ value: 7, read() { return this.value } }, "then", {
                    get() { throw cause },
                })
                const { ctx, reports, signal, chain, wait } = setup(child, pending, { route, pending })
                const outcome = operation(chain, ctx)
                signal.resolve()
                await wait
                const failure = await outcome
                assert(r.isPoisonError(failure))
                if (r.isPoisonError(cause)) assert.equal(failure, cause)
                else {
                    assert.equal(failure.cause, cause)
                    assert.equal(failure.kind, r.ERROR_KIND.ExternalPropertyReadFailed)
                    assert.equal(failure.errorContext, ctx.errorContext)
                }
                assert.equal(ctx.execution.fatalError, null)
                assert.deepEqual(reports, [])
                assert.equal(r.import(8, ctx), 8)
            }
        })
    }
})
