// Prepared-result policy, finalization and isolation regressions.
import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { OrderedThenable } from "../ordered-thenable.js"
import { verifyLiveness, verifyParents } from "../verify-parents.js"

const leaves = error => error?.errors ? error.errors.flatMap(leaves) : error ? [error] : []
const turn = () => new Promise(setImmediate)
let policyCases = 0, finalizationCases = 0, otherCases = 0

// Two calls disagree about their exact receiver. Reusing one prepared graph
// must preserve the FIRST producer's rule, even after retirement or delivery.
for (const producer of ["ordinary-import", "method-result"])
for (const route of ["root", "wrapper", "late"])
for (const array of [false, true])
for (const mode of ["native", "ordered"])
for (const retired of [false, true])
for (const outcome of ["first-receiver", "second-receiver", "registered", "rejection"])
for (const delivered of [false, true]) {
    const label = [producer, route, array, mode, retired, outcome, delivered].join("/")
    const execution = new r.Execution()
    const first = { execution, errorContext: { label, call: 1 } }
    const second = { execution, errorContext: { label, call: 2 } }
    const signal = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
    const rawPending = signal.promise ?? signal
    const shared = array ? [rawPending] : { value: rawPending }
    const key = array ? "0" : "value"
    const later = Promise.withResolvers()
    const a = r.externalState({ result() { return shared } })
    const b = r.externalState({ result() {
        return route === "root" ? shared : route === "wrapper" ? { shared } : { shared: later.promise }
    } })
    const resource = r.externalState({ read() { return 9 } })
    const authority = new r.ContextChain({ service: r.externalState({ a, b }), resource },
        first, { service: {}, resource: {} })
    const original = new r.Chain(producer === "ordinary-import" ? r.import(shared, first)
        : r.run(authority, ["service", "a"], "result", [], first, {}), first)
    assert.equal(r.lookupPath(original, [], first), shared, label)
    const cause = new Error(label)
    const value = outcome === "first-receiver" ? a : outcome === "second-receiver" ? b : resource
    const deliver = () => outcome === "rejection" ? signal.reject(cause) : signal.resolve(value)
    if (delivered) { deliver(); await turn() }
    if (retired) {
        r.assignPath(original, [], null, first)
        verifyLiveness(first, [shared], new Set())
    }
    const received = new r.Chain(r.run(authority, ["service", "b"], "result", [], second,
        { mutationScopeDepth: 1 }), second)
    if (route === "late") { later.resolve(shared); await turn() }
    const path = route === "root" ? [] : ["shared"]
    assert.equal(await r.lookupPath(received, path, second), shared, label)
    if (!delivered) deliver()
    const errors = leaves(await r.getErrors(received, [], second))
    const restricted = producer === "method-result" && outcome === "first-receiver"
    if (restricted || outcome === "rejection") {
        assert.equal(errors.length, 1, label)
        assert.equal(errors[0].errorContext, first.errorContext, label)
        assert.equal(errors[0].kind, restricted ? r.ERROR_KIND.ExternalCapabilityEscape :
            r.ERROR_KIND.OperationInputFailed, label)
        if (outcome === "rejection") assert.equal(errors[0].cause, cause, label)
    } else {
        assert.equal(errors.length, 0, label)
        const actual = await r.lookupPath(received, [...path, key], second)
        if (outcome === "registered") assert.equal(actual.kind, r.ERROR_KIND.ExternalLocationConflict, label)
        else assert.equal(actual, value, label)
    }
    assert.equal(await r.getErrors(authority, ["service"], second), null, label)
    assert.equal(r.run(authority, ["resource"], "read", [], second, {}), 9, label)
    verifyParents(second, received._state)
    assert.equal(execution.fatalError, null, label)
    policyCases++
}

// Finalization owns newly stored state; result-only rejection cannot roll back
// a valid receiver. Keep the old holder and verify repair and exact attribution.
for (const klass of [false, true]) for (const registered of [false, true])
for (const form of ["store-return", "store-undefined", "store-self", "store-scalar", "return-only"])
for (const timing of ["ready", "sync", "native", "ordered"]) {
    const label = [klass, registered, form, timing].join("/")
    const ctx = { execution: new r.Execution(), errorContext: { label } }
    const later = { ...ctx, errorContext: { later: label } }
    const resource = r.externalState({ read() { return 7 } })
    const authority = new r.ContextChain({ resource }, ctx, registered ? { resource: {} } : undefined)
    class Receiver {
        n = 0
        change(supply, form, finish) {
            this.n++
            const fresh = { resource: supply() }; fresh.self = fresh
            if (form !== "return-only") this.x = fresh
            return finish(form === "store-undefined" ? undefined : form === "store-self" ? this :
                form === "store-scalar" ? 42 : fresh)
        }
        bump() { return ++this.n }
    }
    if (klass) r.managedStateClass(Receiver)
    const raw = klass ? new Receiver() : { n: 0, change: Receiver.prototype.change, bump: Receiver.prototype.bump }
    const chain = new r.Chain(r.import(raw, ctx), ctx)
    const before = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
    const pending = timing === "native" ? Promise.withResolvers() : new OrderedThenable()
    let returned
    const finish = value => {
        returned = value
        return timing === "ready" ? value : timing === "sync" ? { then(resolve) { return resolve(value) } }
            : pending.promise ?? pending
    }
    const operation = r.run(chain, [], "change", [() => resource, form, finish], ctx, { mutationScopeDepth: 0 })
    if (timing === "native" || timing === "ordered") {
        assert(r.isPending(operation, ctx), "The direct completion must actually suspend")
        pending.resolve(returned)
    }
    const result = await operation, scope = await r.getErrors(chain, [], later)
    if (registered && form !== "return-only") {
        assert(r.isPoisonError(scope), `Stored capability must poison the introducing scope: ${label}`)
        assert.equal(scope.kind, r.ERROR_KIND.ExternalCapabilityEscape, label)
        assert.equal(scope.errorContext, ctx.errorContext, label)
        assert(leaves(result).includes(scope), label)
        assert.equal(await r.run(chain, [], "bump", [], later, { mutationScopeDepth: 0 }), scope, label)
        await r.repairPath(chain, [], later)
        assert.equal(r.lookupPath(chain, ["n"], later), 0, label)
        assert.equal(r.lookupPath(chain, ["x"], later), undefined, label)
    } else {
        assert.equal(scope, null, label)
        assert.equal(r.isPoisonError(result), false, label)
        if (registered) assert.equal(r.export(new r.Chain(result, ctx), [], ctx).kind,
            r.ERROR_KIND.ExternalCapabilityEscape, label)
        assert.equal(await r.run(chain, [], "bump", [], later, { mutationScopeDepth: 0 }), 2, label)
    }
    assert.equal(r.lookupPath(before, ["n"], later), 0, label)
    assert.equal(r.lookupPath(before, ["x"], later), undefined, label)
    assert.equal(r.run(authority, ["resource"], "read", [], later, {}), 7, label)
    assert.equal(ctx.execution.fatalError, null, label)
    finalizationCases++
}

// Fresh and cached result references obey the same capability policy.
{
    const ctx = { execution: new r.Execution(), errorContext: "repeated fresh rejection" }
    const resource = r.externalState({}), raw = { resource }
    const authority = new r.ContextChain({ resource }, ctx, { resource: {} })
    const service = new r.Chain(r.externalState({ result() { return raw } }), ctx)
    for (let i = 0; i < 8; i++) {
        const returned = new r.Chain(r.run(service, [], "result", [], ctx, {}), ctx)
        assert.equal(r.getErrors(returned, [], ctx), null)
        assert.equal(r.export(returned, [], ctx).kind, r.ERROR_KIND.ExternalCapabilityEscape)
        r.assignPath(returned, [], undefined, ctx)
    }
    const imported = new r.Chain(r.import(raw, ctx), ctx)
    const received = new r.Chain(r.run(service, [], "result", [], ctx, {}), ctx)
    assert.equal(r.lookupPath(received, [], ctx), r.lookupPath(imported, [], ctx))
    assert.equal(r.getErrors(received, [], ctx), null)
    assert.equal(r.hasError(authority, [], ctx), false)
    otherCases++
}

// Returned exported arguments are new data, even if native code returns them
// unchanged. A separately retained original must never become their alias.
for (const mutation of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: "export is not an identity round trip" }
    const raw = { n: 1 }; raw.self = raw
    const original = new r.Chain(raw, ctx)
    const host = new r.Chain({ echo(value) { return { a: value, b: value } } }, ctx)
    const returned = new r.Chain(r.run(host, [], "echo", [r.lookupPath(original, [], ctx)], ctx,
        mutation ? { mutationScopeDepth: 0 } : {}), ctx)
    const batch = new r.Chain({ original: r.lookupPath(original, [], ctx), returned: r.lookupPath(returned, [], ctx) }, ctx)
    const out = await r.export(batch, [], ctx)
    assert.notEqual(out.original, out.returned.a)
    assert.equal(out.returned.a, out.returned.b)
    assert.equal(out.returned.a.self, out.returned.a)
    r.assignPath(returned, ["a", "n"], 2, ctx)
    assert.equal(r.lookupPath(original, ["n"], ctx), 1)
    assert.equal(r.lookupPath(returned, ["b", "n"], ctx), 1)
    otherCases++
}

// The same HOST input is prepared independently in each execution. Receiving
// an inert reference never transfers the other execution's access authority.
for (const mode of ["ready", "sync", "native", "ordered"]) {
    const first = { execution: new r.Execution(), errorContext: "first host import" }
    const second = { execution: new r.Execution(), errorContext: "independent host return" }
    const resource = r.externalState({})
    const signal = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
    const data = mode === "ready" ? resource : mode === "sync" ? { then(resolve) { return resolve(resource) } }
        : signal.promise ?? signal
    const raw = { data }
    const original = new r.Chain(r.import(raw, first), first)
    const authority = new r.ContextChain({ resource }, second, { resource: {} })
    const service = new r.Chain(r.externalState({ result() { return raw } }), second)
    const received = new r.Chain(r.run(service, [], "result", [], second, {}), second)
    if (mode === "native" || mode === "ordered") signal.resolve(resource)
    assert.equal(await r.getErrors(received, [], second), null)
    assert.equal((await r.export(received, [], second)).kind, r.ERROR_KIND.ExternalCapabilityEscape)
    assert.equal((await r.lookupPath(received, ["data"], second)).kind, r.ERROR_KIND.ExternalLocationConflict)
    assert.equal(await r.getErrors(original, [], first), null)
    assert.equal(await r.lookupPath(original, ["data"], first), resource)
    assert.equal(r.hasError(authority, [], second), false)
    otherCases++
}

console.log(JSON.stringify({ policyCases, finalizationCases, otherCases }))
