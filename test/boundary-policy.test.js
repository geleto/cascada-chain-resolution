import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { ready, rejected, OrderedThenable } from "./ordered-thenable.js"

const context = () => ({ execution: new r.Execution(), errorContext: {} })

describe("receiving boundary policy", () => {
    for (const property of [false, true]) for (const delayed of [false, true])
    for (const pendingLeaf of [false, true]) {
        it(`gives stored Errors one kind through method results and prepared property references: property=${property}, delayed=${delayed}, pending=${pendingLeaf}`, async () => {
            const execution = new r.Execution()
            const first = { execution, errorContext: "host result" }
            const second = { execution, errorContext: "ordinary import" }
            const delivery = Promise.withResolvers(), leaf = Promise.withResolvers()
            const cause = new Error("shared stored failure")
            const input = pendingLeaf ? leaf.promise : rejected(cause)
            const shared = { bad: input }
            const value = { next: delayed ? delivery.promise : shared }
            const host = new r.Chain(r.externalState({ value, result() { return value } }), first)
            const received = new r.Chain(property ? r.lookupPath(host, ["value"], first)
                : r.run(host, [], "result", [], first, {}), first)
            const imported = new r.Chain(r.import(shared, second), second)
            delivery.resolve(shared)
            if (pendingLeaf) leaf.reject(cause)
            const failure = await r.getErrors(received, [], first)
            assert.equal(failure, await r.getErrors(imported, [], second))
            assert.equal(failure.kind, r.ERROR_KIND.OperationInputFailed)
            assert.equal(failure.errorContext, delayed ? second.errorContext : first.errorContext)
            assert.equal(failure.cause, cause)
            assert.equal(shared.bad, input)
            assert.equal(execution.fatalError, null)
        })
    }

    for (const pending of [false, true]) {
        it(`protects previously imported records received through a property: pending=${pending}`, async () => {
            const ctx = context(), delivery = Promise.withResolvers(), data = { n: 1 }
            r.import(data, ctx)
            const source = new r.Chain(r.externalState({ data: pending ? delivery.promise : data }), ctx)
            const result = new r.Chain(r.lookupPath(source, ["data"], ctx), ctx)
            delivery.resolve(data)
            assert.equal(await r.lookupPath(result, ["n"], ctx), 1)
            await r.assignPath(result, ["n"], 2, ctx)
            assert.equal(await r.lookupPath(result, ["n"], ctx), 2)
            assert.equal(data.n, 1)
            assert.equal((await r.lookupPath(source, ["data"], ctx)).n, 1)
        })
    }

    for (const target of ["receiver", "registered"]) for (const timing of ["ready", "sync", "direct", "nested"]) {
        it(`keeps completed external effects through result admission: ${target}/${timing}`, async () => {
            const ctx = context(), pending = Promise.withResolvers()
            const resource = r.externalState({})
            const service = r.externalState({
                n: 0,
                change() {
                    this.n++
                    const value = target === "receiver" ? this : resource
                    const result = { value: timing === "nested" ? pending.promise : value }
                    return timing === "direct" ? Promise.resolve(result) :
                        timing === "sync" ? ready(result) : result
                },
                next() { return ++this.n },
            })
            const chain = new r.ContextChain({ service, resource }, ctx, { service: {}, resource: {} })
            const result = new r.Chain(r.run(chain, ["service"], "change", [], ctx,
                { mutationScopeDepth: 1 }), ctx)
            pending.resolve(target === "receiver" ? service : resource)
            const failure = await r.getErrors(result, [], ctx)
            if (target === "receiver") {
                assert.equal(failure.kind, r.ERROR_KIND.ExternalCapabilityEscape)
                assert.equal(failure.errorContext, ctx.errorContext)
            } else {
                assert.equal(failure, null, "An inert reference grants no authority")
                assert.equal((await r.lookupPath(result, ["value"], ctx)).kind, r.ERROR_KIND.ExternalLocationConflict)
                assert.equal((await r.export(result, [], ctx)).kind, r.ERROR_KIND.ExternalCapabilityEscape)
            }
            assert.equal(await r.getErrors(chain, [], ctx), null)
            assert.equal(await r.run(chain, ["service"], "next", [], ctx, { mutationScopeDepth: 1 }), 2)
            assert.equal(await r.repairPath(chain, ["service"], ctx), undefined)
            assert.equal(service.n, 2)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const form of ["throw", "reject", "return poison"]) {
        it(`retains scope poisoning for native method failure: ${form}`, async () => {
            const ctx = context(), cause = new Error("native failure")
            const service = r.externalState({ n: 0, change() {
                this.n++
                if (form === "throw") throw cause
                return form === "reject" ? Promise.reject(cause) : r.createPoisonError(cause, ctx, r.ERROR_KIND.InvocationFailed)
            }, next() { return ++this.n } })
            const chain = new r.ContextChain({ service }, ctx, { service: {} })
            const failure = await r.run(chain, ["service"], "change", [], ctx, { mutationScopeDepth: 1 })
            assert.equal(failure.cause, cause)
            assert.equal(failure.kind, r.ERROR_KIND.InvocationFailed)
            assert.equal(await r.getErrors(chain, [], ctx), failure)
            assert.equal(await r.run(chain, ["service"], "next", [], ctx, { mutationScopeDepth: 1 }), failure)
            assert.equal(service.n, 1)
            await r.repairPath(chain, ["service"], ctx)
            assert.equal(await r.run(chain, ["service"], "next", [], ctx, { mutationScopeDepth: 1 }), 2)
        })
    }

    for (const shape of ["record", "array", "managed class", "external record", "external class"])
    for (const timing of ["ready", "sync", "pending"]) for (const importedFirst of [false, true]) {
        it(`uses the same category before and after explicit import: ${shape}/${timing}/${importedFirst}`, async () => {
            const ctx = context(), pending = Promise.withResolvers()
            // A contextual leaf isolates category selection from the open
            // first-preparer attribution problem.
            const poison = r.createPoisonError(new Error("data"), ctx, r.ERROR_KIND.ContextValueFailed)
            class Data { constructor() { this.bad = poison } }
            const raw = shape === "array" ? [poison] :
                shape.includes("class") ? new Data() : { bad: poison }
            if (shape === "managed class") r.managedState(raw)
            if (shape === "external record") r.externalState(raw)
            const managed = !shape.startsWith("external")
            let other
            if (importedFirst) other = new r.Chain(r.import(raw, ctx), ctx)
            const source = new r.Chain(r.externalState({
                value: timing === "pending" ? pending.promise : timing === "sync" ? ready(raw) : raw,
            }), ctx)
            const read = new r.Chain(r.lookupPath(source, ["value"], ctx), ctx)
            pending.resolve(raw)
            assert.equal(await r.getErrors(read, [], ctx), managed ? poison : null)
            if (!importedFirst) other = new r.Chain(r.import(raw, ctx), ctx)
            assert.equal(await r.getErrors(other, [], ctx), managed ? poison : null)
            if (!managed) assert.equal(await r.export(read, [], ctx), raw)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const boundary of ["lookup", "export"])
    for (const timing of ["ready", "sync", "native", "ordered"])
    for (const settledFirst of [false, true]) {
        it(`keeps managed child access stable after property reception: ${boundary}/${timing}/${settledFirst}`, async () => {
            const execution = new r.Execution()
            const first = { execution, errorContext: "receive child" }
            const later = { execution, errorContext: "use native child" }
            const cause = new Error("native property")
            const record = { n: 1, e: cause, describe() { return `n=${this.n}` } }
            Object.defineProperty(record, "hidden", { value: 7 })
            const pending = timing === "ordered" ? new OrderedThenable() : Promise.withResolvers()
            const value = timing === "ready" ? record : timing === "sync" ? ready(record) :
                timing === "ordered" ? pending : pending.promise
            class Api { later = value; now = record }
            const chain = new r.ContextChain({ api: new Api() }, first)
            const checkReceived = value => {
                if (boundary === "lookup") assert.equal(value, record)
                else {
                    assert.notEqual(value, record)
                    assert.equal(value.n, 1)
                    assert.equal(value.e, cause)
                    assert.equal(value.hidden, undefined)
                }
            }
            const received = boundary === "lookup" ? r.lookupPath(chain, ["api", "later"], first)
                : r.export(chain, ["api", "later"], first)
            if (settledFirst) {
                pending.resolve(record)
                checkReceived(await received)
            }
            const call = r.run(chain, ["api", "now"], "describe", [], later, {})
            const hidden = r.lookupPath(chain, ["api", "now", "hidden"], later)
            const failure = r.lookupPath(chain, ["api", "now", "e"], later)
            if (!settledFirst) pending.resolve(record)
            checkReceived(await received)
            assert.equal(await call, "n=1")
            assert.equal(await hidden, undefined)
            const error = await failure
            assert.equal(error, cause)
            assert.equal(execution.fatalError, null)
        })
    }
})
