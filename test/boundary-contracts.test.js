import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable, rejected } from "./ordered-thenable.js"

const turn = () => new Promise(setImmediate)

describe("import attribution and compound reporting", () => {
    for (const first of [false, true]) for (const ordered of [false, true])
    for (const sameCause of [false, true]) for (const sameContext of [false, true]) {
        it(`uses established sources: first=${first}, ordered=${ordered}, sameCause=${sameCause}, sameContext=${sameContext}`, async () => {
            const execution = new r.Execution()
            const a = { execution, errorContext: "first" }
            const b = { execution, errorContext: sameContext ? "first" : "second" }
            const cause = new Error("shared cause")
            const otherCause = sameCause ? cause : new Error("independent cause")
            const input = rejected(cause)
            const shared = { error: input }
            const pending = ordered ? new OrderedThenable() : Promise.withResolvers()
            const root = new r.Chain(r.import({ shared: pending.promise ?? pending, error: rejected(otherCause) }, a), a)
            if (first) { pending.resolve(shared); await turn() }
            const other = new r.Chain(r.import(shared, b), b)
            if (!first) { pending.resolve(shared); await turn() }
            const source = first ? a.errorContext : b.errorContext
            const leaf = r.lookupPath(other, ["error"], b)
            assert.equal(leaf.errorContext, source)
            assert.equal(r.lookupPath(root, ["shared", "error"], a), leaf)
            const independent = r.lookupPath(root, ["error"], a)
            const merged = sameCause && (first || sameContext)
            for (const report of [await r.getErrors(root, [], a), await r.export(root, [], a)]) {
                assert.equal(report.kind, r.ERROR_KIND.OperationInputFailed)
                assert.equal(report.errorContext, source === a.errorContext ? source : undefined)
                if (merged) {
                    assert.equal(report.name, "PoisonError")
                    assert.equal(report.message, cause.message)
                    assert.equal(report.cause, cause)
                    assert.equal(report.errors, undefined)
                } else {
                    assert.equal(report.name, "CompoundPoisonError")
                    assert.equal(report.message, "Multiple Errors")
                    assert.equal(report.errors.length, 2)
                    assert.deepEqual(new Set(report.errors), new Set([leaf, independent]))
                }
            }
            assert.equal(shared.error, input, "Attribution must not modify imported storage")
            assert.equal(execution.fatalError, null)
        })
    }
})

describe("native adoption identity", () => {
    for (const array of [false, true]) for (const pending of [false, true]) {
        it(`preserves a newly linked prepared reference: array=${array}, pending=${pending}`, async () => {
            const ctx = { execution: new r.Execution(), errorContext: "native adoption" }
            const source = new r.Chain(array ? [1] : { value: 1 }, ctx)
            const existing = r.lookupPath(source, [], ctx)
            const signal = Promise.withResolvers()
            const receiver = new r.Chain({
                adopt(supply, finish) { this.child = supply(); return finish(this.child) },
                unchanged() { return this.child },
            }, ctx)
            let returned
            const result = new r.Chain(r.run(receiver, [], "adopt", [
                () => existing,
                value => { returned = value; return pending ? signal.promise : value },
            ], ctx, { mutationScopeDepth: 0 }), ctx)
            if (pending) signal.resolve(returned)
            const first = await r.export(new r.Chain({
                source: r.lookupPath(source, [], ctx),
                adopted: r.lookupPath(receiver, ["child"], ctx),
                result: r.lookupPath(result, [], ctx),
            }, ctx), [], ctx)
            assert.equal(first.source, first.adopted, "Linking a prepared value preserves its identity")
            assert.equal(first.adopted, first.result, "The returned receiver child keeps its adopted identity")
            // A second native call now copies this same child as part of its receiver.
            await r.run(receiver, [], "unchanged", [], ctx, { mutationScopeDepth: 0 })
            const second = await r.export(new r.Chain({
                source: r.lookupPath(source, [], ctx),
                adopted: r.lookupPath(receiver, ["child"], ctx),
            }, ctx), [], ctx)
            assert.notEqual(second.source, second.adopted)
            r.assignPath(receiver, ["child", array ? 0 : "value"], 2, ctx)
            assert.equal(r.lookupPath(source, [array ? 0 : "value"], ctx), 1)
            assert.equal(r.lookupPath(result, [array ? 0 : "value"], ctx), 1)
            assert.equal(ctx.execution.fatalError, null)
        })
    }
})
