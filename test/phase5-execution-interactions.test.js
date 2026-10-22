import assert from "node:assert/strict"
import * as r from "cascada-chain-resolution"
import { metaOf } from "../src/meta.js"
import { OrderedThenable } from "./ordered-thenable.js"

describe("Phase 5 independent execution interactions", () => {
    for (const mode of ["native", "ordered"]) {
        it(`keeps failed preparation and late delivery local through retirement and fatality: ${mode}`, async () => {
            const reports = [], healthyReports = []
            const first = { execution: new r.Execution(error => reports.push(error)), errorContext: "first import" }
            const second = { execution: new r.Execution(error => healthyReports.push(error)), errorContext: "second import" }
            const gate = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
            const cause = new Error("stable inaccessible shape")
            let inspections = 0
            const inaccessible = new Proxy({}, { ownKeys() { inspections++; throw cause } })
            const input = { bad: inaccessible, late: gate.promise ?? gate, healthy: { n: 1 } }
            const a = new r.Chain(r.import(input, first), first)
            const b = new r.Chain(r.import(input, second), second)
            const poisonA = r.lookupPath(a, ["bad"], first)
            const poisonB = r.lookupPath(b, ["bad"], second)
            assert.equal(inspections, 2, "each execution performs its own first inspection")
            for (const [poison, ctx] of [[poisonA, first], [poisonB, second]]) {
                assert.equal(poison.kind, r.ERROR_KIND.ImportReflectionFailed)
                assert.equal(poison.cause, cause)
                assert.equal(poison.errorContext, ctx.errorContext)
            }
            assert.notEqual(poisonA, poisonB)

            r.assignPath(a, [], undefined, first)
            assert.equal(metaOf(input, first).relationshipsActive, false, "first root actually retired")
            assert.equal(metaOf(input, second).relationshipsActive, true, "second root remains active")
            const reentered = new r.Chain(r.import(input, first), first)
            assert.equal(metaOf(input, first).relationshipsActive, true)
            assert.equal(r.lookupPath(reentered, ["bad"], first), poisonA)
            assert.equal(inspections, 2, "cached re-entry performs no host inspection")
            const failedCollection = r.getErrors(reentered, [], first)
            const healthyCollection = r.getErrors(b, [], second)
            assert(r.isPending(failedCollection, first))
            assert(r.isPending(healthyCollection, second))
            const fatalCause = new Error("valid higher-runtime work escaped")
            const rejected = assert.rejects(failedCollection, error => error === first.execution.fatalError)
            assert.throws(() => r.runInternalStep(first, () => { throw fatalCause }), r.isFatalError)
            await rejected

            gate.resolve(inaccessible)
            assert.equal(await healthyCollection, poisonB, "late alias reuses this preparation's original poison")
            assert.equal(r.lookupPath(b, ["late"], second), poisonB)
            assert.equal(inspections, 2, "fatal execution stops; live execution reuses failed inspection")
            r.assignPath(b, ["healthy", "n"], 9, second)
            assert.deepEqual(r.export(b, ["healthy"], second), { n: 9 })
            assert.deepEqual(input.healthy, { n: 1 })
            assert.equal(second.execution.fatalError, null)
            assert.equal(reports.length, 1)
            assert.equal(reports[0].cause, fatalCause)
            assert.deepEqual(healthyReports, [])
        })
    }

    it("does not transfer earlier category or authority conflicts into later independent admission", () => {
        class Resource {
            value = 3
            read() { return this.value }
        }
        const host = new Resource()
        const first = { execution: new r.Execution(), errorContext: "external admission" }
        const second = { execution: new r.Execution(), errorContext: "managed admission" }
        const external = new r.ContextChain({ host }, first, { host: {} })
        assert.equal(r.lookupPath(external, ["host", "value"], first), 3)
        r.managedStateClass(Resource)
        const managed = new r.ContextChain({ host }, second, { host: {} })
        // No native access is pending, and the first execution never mutates host.
        const conflict = new r.ContextChain({ host }, first, { host: {} })
        assert.equal(r.getErrors(external, ["host"], first).kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(r.getErrors(conflict, ["host"], first).kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(r.getErrors(managed, [], second), null)
        r.assignPath(managed, ["host", "value"], 8, second)
        assert.equal(r.run(managed, ["host"], "read", [], second, {}), 8)
        assert.equal(host.value, 3)
        const exported = r.export(managed, ["host"], second)
        const third = { execution: new r.Execution(), errorContext: "export then import" }
        const transferred = new r.Chain(r.import(exported, third), third)
        assert.equal(r.run(transferred, [], "read", [], third, {}), 8)
        assert.equal(first.execution.fatalError, null)
        assert.equal(second.execution.fatalError, null)
    })
})
