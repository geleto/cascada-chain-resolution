import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable, ready, rejected } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { verifyLiveness } from "./verify-parents.js"

const leaves = error => error.errors ?? [error]
const turn = () => new Promise(setImmediate)

describe("Phase 5 receiving boundary intersections", () => {
    for (const mode of ["native", "ordered"])
    for (const firstQuery of ["getErrors", "hasError"])
    for (const reject of [false, true])
    for (const array of [false, true])
    it(`re-enters retired external-property query data without stale indexes: ${mode}/${firstQuery}/reject=${reject}/array=${array}`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: "query reception" }
        const reveal = mode === "ordered" ? new OrderedThenable() : Promise.withResolvers()
        const child = mode === "ordered" ? new OrderedThenable() : Promise.withResolvers()
        const branch = array ? [child.promise ?? child] : { child: child.promise ?? child }
        const data = array ? [reveal.promise ?? reveal] : { reveal: reveal.promise ?? reveal }
        const host = new r.Chain(r.externalState({ data }), ctx)
        const queries = [firstQuery, firstQuery === "getErrors" ? "hasError" : "getErrors"]
        const results = queries.map(query => {
            const result = r[query](host, ["data"], ctx)
            result.catch(() => {}) // Keep every result handled if another assertion exposes a fatal defect.
            assert.equal(result instanceof Promise, true)
            verifyLiveness(ctx, [data], new Set(), "The query captures placements without retaining its source root")
            return result
        })
        reveal.resolve(branch)
        await turn()
        const cause = new Error("nested rejection")
        if (reject) child.reject(cause)
        else child.resolve(7)
        for (const [index, result] of results.entries()) {
            const value = await result
            if (queries[index] === "hasError") assert.equal(value, reject)
            else if (reject) {
                assert.equal(value.cause, cause)
                assert.equal(value.kind, r.ERROR_KIND.OperationInputFailed)
            } else assert.equal(value, null)
        }
        verifyLiveness(ctx, [data, branch], new Set())
        for (let reentry = 0; reentry < 2; reentry++) {
            const found = r.getErrors(host, ["data"], ctx)
            if (reject) {
                assert.equal(found.cause, cause)
                assert.equal(found.kind, r.ERROR_KIND.OperationInputFailed)
                assert.equal(found.errorContext, ctx.errorContext)
            } else assert.equal(found, null)
            assert.equal(r.hasError(host, ["data"], ctx), reject)
            verifyLiveness(ctx, [data, branch], new Set())
        }
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const mode of ["ready", "synchronous", "native", "ordered"])
    for (const failedReceiver of [false, true])
    it(`separates receiver adoption, retained arguments and independent result poison: ${mode}, failed=${failedReceiver}`, async () => {
        const execution = new r.Execution()
        const ctx = { execution, errorContext: "receiver introduction" }
        const laterCtx = { execution, errorContext: "later host return" }
        const receiverCause = new Error("receiver failure"), resultCause = new Error("result failure")
        const healthyError = new Error("healthy native data")
        const direct = mode === "ordered" ? new OrderedThenable() : Promise.withResolvers()
        const nested = Promise.withResolvers(), retained = Promise.withResolvers()
        const sourceInput = { child: { value: 1 }, items: [1] }
        const receiver = new r.Chain({ install(copy, retain) {
            this.saved = copy
            this.invoke = () => 42 // Stored only: result import cannot admit this leaf.
            if (failedReceiver) this.invalid = r.createPoisonError(receiverCause, ctx, r.ERROR_KIND.InvalidManagedReceiver)
            const output = { first: copy, second: copy, healthyError, bad: rejected(resultCause), later: nested.promise }
            retain(output)
            return mode === "ready" ? output : mode === "synchronous" ? ready(output)
                : (direct.promise ?? direct).then(() => output)
        } }, ctx)
        const result = r.run(receiver, [], "install", [r.import(sourceInput, ctx), retained.resolve], ctx,
            { mutationScopeDepth: 0 })
        const resultHolder = new r.Chain(result, ctx) // Retain the immediate handoff before suspension.
        assert.equal(result instanceof Promise, mode === "native" || mode === "ordered")
        direct.resolve()
        const value = await r.lookupPath(resultHolder, [], ctx)
        const hostOutput = await retained.promise
        assert.equal(hostOutput.first, hostOutput.second)
        assert.notEqual(hostOutput.first, sourceInput, "Native arguments are detached")
        assert.equal(hostOutput.healthyError, healthyError)
        if (failedReceiver) {
            assert.deepEqual(new Set(leaves(value).map(error => error.cause)), new Set([receiverCause, resultCause]))
            assert(leaves(value).every(error => error.errorContext === ctx.errorContext))
            assert(leaves(value).some(error => error.kind === r.ERROR_KIND.OperationInputFailed && error.cause === resultCause))
            const scope = r.getErrors(receiver, [], ctx)
            assert.equal(scope.cause, receiverCause)
            assert.equal(scope.kind, r.ERROR_KIND.InvalidManagedReceiver)
            assert.equal(r.repairPath(receiver, [], ctx), undefined)
            assert.equal(r.lookupPath(receiver, ["saved"], ctx), undefined)
        } else {
            assert.equal(r.run(receiver, [], "invoke", [], ctx, {}), 42)
            assert.equal(r.hasError(receiver, [], ctx), false)
            assert.equal(r.lookupPath(resultHolder, ["healthyError"], ctx), healthyError)
            const failure = r.lookupPath(resultHolder, ["bad"], ctx)
            assert.equal(failure.cause, resultCause)
            assert.equal(failure.kind, r.ERROR_KIND.OperationInputFailed)
            assert.equal(failure.errorContext, ctx.errorContext)
            assert.equal(r.assignPath(receiver, ["saved", "child", "value"], 2, ctx), undefined)
        }
        // The direct outcome is complete while its independent nested result is
        // still pending; retained copies must survive later reception and writes.
        const host = new r.Chain(r.externalState({ read() { return hostOutput.first } }), laterCtx)
        const received = new r.Chain(r.run(host, [], "read", [], laterCtx, {}), laterCtx)
        assert.equal(r.assignPath(received, ["child", "value"], 3, laterCtx), undefined)
        assert.equal(r.assignPath(received, ["items", 0], 3, laterCtx), undefined)
        assert.deepEqual(hostOutput.first, { child: { value: 1 }, items: [1] })
        assert.deepEqual(sourceInput, { child: { value: 1 }, items: [1] })
        assert.deepEqual(r.export(received, [], laterCtx), { child: { value: 3 }, items: [3] })
        nested.resolve(7)
        await turn()
        verifyRefCounts(ctx, receiver._state, resultHolder._state, received._state)
        assert.equal(execution.fatalError, null)
    })

    for (const mode of ["synchronous", "native", "ordered"])
    for (const failureStage of ["classification", "shape"])
    for (const copyRoute of ["cow", "entry"])
    it(`keeps failed aliases local and late authority unavailable through copying: ${mode}/${failureStage}/${copyRoute}`, async () => {
        const ctx = { execution: new r.Execution(), errorContext: "original preparation" }
        const cause = new Error("unreadable source")
        const resource = r.externalState({ value: 1 })
        let inspections = 0
        const broken = new Proxy({ resource }, failureStage === "classification"
            ? { getPrototypeOf() { inspections++; throw cause } }
            : { ownKeys() { inspections++; throw cause } })
        const alias = mode === "ordered" ? new OrderedThenable() : Promise.withResolvers()
        const indirect = mode === "ordered" ? new OrderedThenable() : Promise.withResolvers()
        const delivered = (value, gate) => mode === "synchronous" ? ready(value) : gate.promise ?? gate
        const input = { first: broken, second: broken, late: delivered(broken, alias),
            indirect: delivered(resource, indirect), healthy: { value: 1 } }
        const source = new r.ContextChain(input, ctx,
            { first: { resource: {} }, second: { resource: {} }, late: { resource: {} }, indirect: {} })
        const first = r.lookupPath(source, ["first"], ctx)
        assert.equal(first.cause, cause)
        assert.equal(first.kind, r.ERROR_KIND.ImportReflectionFailed)
        assert.equal(r.lookupPath(source, ["second"], ctx), first)
        alias.resolve(broken)
        indirect.resolve(resource)
        assert.equal(await r.lookupPath(source, ["late"], ctx), first)
        assert.equal(await r.lookupPath(source, ["indirect"], ctx), resource)
        assert.equal(inspections, 1, "Discovery and later delivery reuse this preparation's failure")
        const retained = new r.Chain(r.lookupPath(source, [], ctx), ctx)
        if (copyRoute === "cow") r.assignPath(source, ["healthy", "value"], 2, ctx)
        else await r.enter(source, ["indirect"], ctx, true, () => undefined)
        const context = new r.ContextChain(r.lookupPath(source, [], ctx), ctx, { indirect: {} })
        const denied = r.assignPath(context, ["indirect", "value"], 2, ctx)
        assert.equal(denied.kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(resource.value, 1)
        assert.equal(r.getErrors(retained, [], ctx), first)
        assert.equal(r.lookupPath(retained, ["healthy", "value"], ctx), 1)
        assert.equal(inspections, 1, "Copying neither inspects the failed source nor grants authority")
        // A new explicit ready write is a different origin and may grant authority.
        r.assignPath(source, ["indirect"], resource, ctx)
        const direct = new r.ContextChain(r.lookupPath(source, [], ctx), ctx, { indirect: {} })
        assert.equal(r.assignPath(direct, ["indirect", "value"], 3, ctx), undefined)
        assert.equal(resource.value, 3)
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const mode of ["native", "ordered"])
    it(`keeps healthy Error data and exact poison sources through a failed property query: ${mode}`, async () => {
        const execution = new r.Execution()
        const ctx = { execution, errorContext: "property query" }
        const rawCause = new Error("same cause"), reflectionCause = new Error("query reflection")
        const healthy = new Error("healthy")
        const first = r.createPoisonError(rawCause, { execution, errorContext: -0 }, r.ERROR_KIND.InvocationFailed)
        const second = r.createPoisonError(rawCause, { execution, errorContext: +0 }, r.ERROR_KIND.InvocationFailed)
        const reveal = mode === "ordered" ? new OrderedThenable() : Promise.withResolvers()
        const child = Promise.withResolvers()
        let scans = 0
        const branch = new Proxy({ child: child.promise }, { ownKeys(target) {
            if (++scans === 3) throw reflectionCause
            return Reflect.ownKeys(target)
        } })
        const data = { healthy, first, second, reveal: reveal.promise ?? reveal }
        const host = new r.Chain(r.externalState({ data }), ctx)
        assert.equal(r.getErrors(host, [], ctx), null, "An external root is opaque")
        const collection = r.getErrors(host, ["data"], ctx)
        assert.equal(collection instanceof Promise, true)
        assert.equal(r.hasError(host, ["data"], ctx), true)
        assert.equal(r.lookupPath(host, ["data", "healthy"], ctx), healthy)
        reveal.resolve(branch)
        const failure = await collection
        assert.equal(failure.kind, r.ERROR_KIND.QueryReflectionFailed)
        assert.equal(failure.cause, reflectionCause)
        assert.equal(failure.errorContext, ctx.errorContext)
        assert.equal(scans, 3, "The failure occurred in query work after shared reception/indexing")
        child.resolve(7)
        const recovered = await r.getErrors(host, ["data"], ctx)
        assert.deepEqual(new Set(leaves(recovered)), new Set([first, second]))
        assert.equal(recovered.errorContext, undefined)
        assert(leaves(recovered).some(error => Object.is(error.errorContext, -0)))
        assert(leaves(recovered).some(error => Object.is(error.errorContext, +0)))
        assert.equal(r.lookupPath(host, ["data", "reveal", "child"], ctx), 7)
        assert.equal(execution.fatalError, null)
    })
})
