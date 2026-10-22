import assert from "node:assert/strict"
import * as r from "cascada-chain-resolution"
import { OrderedThenable } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const turn = () => new Promise(setImmediate)

// A supported earlier entry decides whether index 0 was written. A later
// copyWithin removes that destination from known data, leaving only its identity
// consequence pending. No internal publication or identity record is fabricated.
function identityPair(ctx) {
    const source = new r.Chain([, 7, ,], ctx)
    const before = new r.Chain(r.lookupPath(source, [], ctx), ctx)
    const gate = Promise.withResolvers()
    const entry = r.enter(source, [0], ctx, true, () => gate.promise)
    r.run(source, [], "copyWithin", [0, 2, 3], ctx, { mutationScopeDepth: 0 })
    return { gate, entry, source, before,
        pair: { left: r.lookupPath(before, [], ctx), right: r.lookupPath(source, [], ctx) } }
}

describe("Phase 5 surface intersections", () => {
    for (const route of ["export", "receiver", "argument", "snapshot-lookup", "snapshot-export"])
    for (const settledFirst of [false, true]) {
        it(`rejects only pending identity consumers on fatality through supported publication: ${route}, settled=${settledFirst}`, async () => {
            const reports = [], execution = new r.Execution(error => reports.push(error))
            const ctx = { execution, errorContext: "capture before fatality" }
            const work = identityPair(ctx)
            let entryOutcome, outcome, calls = 0
            Promise.resolve(work.entry).then(value => { entryOutcome = { value } }, error => { entryOutcome = { error } })
            const receiver = new r.Chain({ pair: work.pair, same() {
                calls++; return this.pair.left === this.pair.right
            } }, ctx)
            const api = r.externalState({ pair: work.pair, marker: 0, same(value) {
                calls++; return value.left === value.right
            } })
            const authority = new r.ContextChain({ api }, ctx, { api: {} })
            const held = new r.Chain(work.pair, ctx)
            let result = route === "export" ? r.export(held, [], ctx)
                : route === "receiver" ? r.run(receiver, [], "same", [], ctx, {})
                    : route === "argument" ? r.run(authority, ["api"], "same", [r.lookupPath(held, [], ctx)], ctx, {})
                        : (route === "snapshot-lookup" ? r.lookupPath : r.export)(authority, ["api", "pair"], ctx)
            if (route === "snapshot-lookup") {
                assert.equal(r.isPending(result, ctx), false, "managed snapshot reception finishes before alias assembly")
                result = r.export(new r.Chain(result, ctx), [], ctx)
            }
            assert(r.isPending(result, ctx), "the consumer must actually wait for captured identity")
            Promise.resolve(result).then(value => { outcome = { value } }, error => { outcome = { error } })
            if (route.startsWith("snapshot")) {
                assert.equal(r.assignPath(authority, ["api", "marker"], 2, ctx), undefined)
                assert.equal(api.marker, 2, "identity-only wait releases external access")
            }
            if (settledFirst) {
                work.gate.resolve()
                await work.entry
                await result
                assert.equal(outcome.error, undefined)
                if (route === "receiver" || route === "argument") assert.equal(outcome.value, true)
                else {
                    assert.equal(outcome.value.left, outcome.value.right)
                    assert.deepEqual(outcome.value.left, [, 7, ,])
                }
            }
            const delivered = outcome
            const cause = new Error("higher-runtime defect after supported capture")
            const fatalContext = { execution, errorContext: "causal fatal boundary" }
            assert.throws(() => r.runInternalStep(fatalContext, () => { throw cause }), r.isFatalError)
            await turn()
            const fatal = execution.fatalError
            try {
                assert.equal(fatal.cause, cause)
                assert.equal(fatal.errorContext, fatalContext.errorContext)
                if (settledFirst) assert.equal(outcome, delivered, "settled result never becomes a rejected history entry")
                else {
                    // Inspect completion before releasing the identity gate. A
                    // timeout or a never-settling result is not a sensitivity pass.
                    assert.equal(outcome?.error, fatal, "pending consumer rejects immediately on fatality")
                    assert.equal(entryOutcome?.error, fatal, "pending entry rejects immediately on fatality")
                }
                assert.equal(calls, settledFirst && (route === "argument" || route === "receiver") ? 1 : 0)
                assert.deepEqual(reports, [fatal])
            } finally {
                work.gate.resolve()
                await turn()
            }
            assert.equal(calls, settledFirst && (route === "argument" || route === "receiver") ? 1 : 0,
                "late identity delivery cannot resume failed native work")
            const other = { execution: new r.Execution(), errorContext: "independent healthy execution" }
            assert.deepEqual(r.export(new r.Chain({ healthy: true }, other), [], other), { healthy: true })
        })
    }

    for (const delivery of ["native", "ordered"]) for (const failed of [false, true]) {
        it(`settles shared indexed data after a search closes locally: ${delivery}, failed=${failed}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "short-circuit source" }
            const gate = delivery === "native" ? Promise.withResolvers() : new OrderedThenable()
            const chain = new r.Chain([gate.promise ?? gate, 1], ctx)
            const subscriptions = gate.subscriptions
            assert.equal(r.run(chain, [], "includes", [1], ctx, {}), true)
            if (delivery === "ordered") assert(gate.subscriptions > subscriptions,
                "the search subscribed to an earlier pending comparison before the later match")
            const collection = r.getErrors(chain, [], ctx)
            assert(r.isPending(collection, ctx), "live sibling builds/consumes the pending graph index")
            const cause = new Error("late shared failure")
            const child = { value: 9 }; child.self = child
            if (failed) gate.reject(cause)
            else gate.resolve(child)
            const error = await collection
            if (failed) {
                assert.equal(error.cause, cause)
                assert.equal(error.errorContext, ctx.errorContext)
                assert.equal(error.kind, r.ERROR_KIND.OperationInputFailed)
            } else {
                assert.equal(error, null)
                const output = r.export(chain, [0], ctx)
                assert.equal(output.self, output)
                assert.equal(output.value, 9)
            }
            verifyRefCounts(ctx, chain._state)
            assert.equal(ctx.execution.fatalError, null)
        })
    }
})
