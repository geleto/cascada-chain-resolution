import assert from "node:assert/strict"
import * as r from "../src/index.js"
import * as metadata from "../src/meta.js"

function opaqueReason(revoked) {
    let calls = 0
    const inspect = () => { calls++; throw new Error("Thrown reason must remain opaque") }
    const { proxy, revoke } = Proxy.revocable({}, {
        get: inspect,
        getPrototypeOf: inspect,
        getOwnPropertyDescriptor: inspect,
        ownKeys: inspect,
    })
    if (revoked) revoke()
    return { reason: proxy, calls: () => calls }
}

describe("action throw boundaries", () => {
    for (const revoked of [false, true]) {
        it(`preserves an opaque host throw without inspecting its cause, revoked=${revoked}`, () => {
            const { reason, calls } = opaqueReason(revoked)
            const context = { execution: new r.Execution(), errorContext: "host call" }
            const source = r.externalState({ fail() { throw reason } })
            const chain = new r.Chain(source, context)
            const failure = r.run(chain, [], "fail", [], context, {})
            assert(r.isPoisonError(failure))
            assert.equal(failure.kind, r.ERROR_KIND.InvocationFailed)
            assert.equal(failure.cause, reason)
            assert.equal(failure.errorContext, context.errorContext)
            assert.equal(context.execution.fatalError, null)
            assert.equal(calls(), 0)
        })

        it(`keeps an opaque internal throw fatal without inspecting it, revoked=${revoked}`, () => {
            const { reason, calls } = opaqueReason(revoked)
            const reports = []
            const context = { execution: new r.Execution(error => reports.push(error)), errorContext: "internal work" }
            let failure
            try { r.runInternalStep(context, () => { throw reason }) }
            catch (error) { failure = error }
            assert(r.isFatalError(failure))
            assert.equal(failure.cause, reason)
            assert.equal(failure.errorContext, context.errorContext)
            assert.equal(context.execution.fatalError, failure)
            assert.deepEqual(reports, [failure])
            assert.equal(calls(), 0)
        })

        it(`preserves an opaque declaration throw without recording a declaration, revoked=${revoked}`, () => {
            const { reason, calls } = opaqueReason(revoked)
            const source = new Proxy({}, { get() { throw reason } })
            const failure = r.externalState(source)
            assert(Error.isError(failure))
            assert.equal(failure.cause, reason)
            assert.equal(metadata.identityDeclarationOf(source), undefined)
            assert.equal(calls(), 0)
        })
    }
})
