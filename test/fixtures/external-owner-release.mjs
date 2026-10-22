// Strict completed external-authority lifetime witness. Keep the unformatted
// Error and execution, but release the ContextChain that legitimately owns the
// native resource. Prebuilt causes avoid retaining it through a host CallSite.
// node --expose-gc --stack-trace-limit=50 test/fixtures/external-owner-release.mjs
import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { IdentityPublication, inheritIdentity } from "../../src/captured-identity.js"

assert(global.gc, "Run with --expose-gc")
const turn = () => new Promise(setImmediate)

async function issue(mode, mutation = false, blocked = false) {
    const ctx = { execution: new r.Execution(), errorContext: `${mode}/${mutation}/${blocked}` }
    const cause = new Error("prebuilt external failure")
    const pending = Promise.withResolvers()
    pending.promise.catch(() => {})
    const reservation = Promise.withResolvers()
    let calls = 0
    const resource = r.externalState({ call() {
        calls++
        if (mode === "healthy") return 1
        if (mode === "receiver") return this
        if (mode === "reject") return pending.promise
        throw cause
    } })
    resource.hold = () => reservation.promise
    if (mode === "getter") Object.defineProperty(resource, "call", { get() { throw cause } })
    if (mode === "missing") delete resource.call
    if (mode === "read") Object.defineProperty(resource, "field", { get() { throw cause } })
    if (mode === "write" || mode === "delete") Object.defineProperty(resource, "field", { value: 1 })
    let holder = new r.ContextChain({ resource }, ctx, { resource: {} })
    const predecessor = blocked ? r.run(holder, ["resource"], "hold", [], ctx, { mutationScopeDepth: 1 }) : undefined
    let output
    if (mode === "binding-write") output = r.assignPath(holder, ["resource"], 1, ctx)
    else if (mode === "binding-delete") output = r.deletePath(holder, ["resource"], ctx)
    else if (mode === "repair") output = r.repairPath(holder, ["resource", {}], ctx)
    else if (mode === "read") output = r.lookupPath(holder, ["resource", "field"], ctx)
    else if (mode === "write") output = r.assignPath(holder, ["resource", "field"], 2, ctx, 1)
    else if (mode === "delete") output = r.deletePath(holder, ["resource", "field"], ctx, 1)
    else output = r.run(holder, ["resource"], "call", [], ctx, mutation ? { mutationScopeDepth: 1 } : {})
    if (blocked) { assert.equal(calls, 0, "Queued call ran before its reservation"); reservation.resolve(0); await predecessor }
    if (mode === "reject") pending.reject(cause)
    const delivered = await output
    const error = blocked && ["write", "delete", "binding-write", "binding-delete"].includes(mode)
        ? await r.getErrors(holder, ["resource"], ctx) : delivered
    if (mode === "healthy") assert.equal(error, 1)
    else {
        assert(r.isPoisonError(error), `${mode} must finish with Error data`)
        assert.equal(error.errorContext, ctx.errorContext)
    }
    holder = undefined
    return { ctx, error, weak: new WeakRef(resource) }
}

const states = []
for (const mode of ["healthy", "receiver", "throw", "reject", "getter", "missing"])
    for (const mutation of [false, true]) states.push(await issue(mode, mutation))
for (const mode of ["read", "write", "delete", "repair", "binding-write", "binding-delete"]) states.push(await issue(mode))
for (const mode of ["healthy", "receiver", "throw", "reject", "getter", "missing"])
    for (const mutation of [false, true]) states.push(await issue(mode, mutation, true))
for (const mode of ["read", "write", "delete", "repair", "binding-write", "binding-delete"]) states.push(await issue(mode, false, true))

// This trusted identity seam isolates an identity-only wait from data work
// which would legitimately retain the receiver. The existing snapshot fixture
// checks captured child sources; this also checks the external authority root.
function snapshot(route) {
    const ctx = { execution: new r.Execution(), errorContext: `snapshot/${route}` }
    const a = new r.Chain({ value: 7 }, ctx), b = new r.Chain({ value: 7 }, ctx)
    const left = r.lookupPath(a, [], ctx), right = r.lookupPath(b, [], ctx)
    inheritIdentity(left, right, ctx)
    const publication = new IdentityPublication(ctx)
    publication.capture(right)
    publication.suspend()
    const resource = r.externalState({ pair: { a: left, b: right } })
    const holder = new r.ContextChain({ resource }, ctx, { resource: {} })
    const result = (route === "lookup" ? r.lookupPath : r.export)(holder, ["resource", "pair"], ctx)
    assert.equal(r.isPending(result, ctx), route === "export")
    const held = route === "lookup" ? new r.Chain(result, ctx) : undefined
    assert.equal(r.assignPath(holder, ["resource", "pair"], null, ctx), undefined)
    r.assignPath(a, [], null, ctx)
    r.assignPath(b, [], null, ctx)
    return { ctx, publication, result, held, weak: new WeakRef(resource) }
}
const snapshots = [snapshot("lookup"), snapshot("export")]
states.push(...snapshots)

function pendingCall(mutation) {
    const ctx = { execution: new r.Execution(), errorContext: `pending/${mutation}` }
    const cause = new Error("prebuilt deferred failure")
    const gate = Promise.withResolvers()
    const resource = r.externalState({ call() { return gate.promise } })
    const holder = new r.ContextChain({ resource }, ctx, { resource: {} })
    const result = r.run(holder, ["resource"], "call", [], ctx, mutation ? { mutationScopeDepth: 1 } : {})
    assert(r.isPending(result, ctx))
    return { ctx, cause, gate, result, weak: new WeakRef(resource) }
}
const pending = [pendingCall(false), pendingCall(true)]
for (let index = 0; index < 30; index++) { await turn(); global.gc() }
assert.deepEqual(states.filter(state => state.weak.deref()).map(state => state.ctx.errorContext), [],
    "Completed external work retains a resource after its authority holder is released")
for (const state of pending) {
    assert(state.weak.deref(), "A direct pending call still requires its receiver")
    state.gate.reject(state.cause)
    state.error = await state.result
    assert(r.isPoisonError(state.error))
}
for (const state of snapshots) {
    state.publication.finish(false)
    const output = state.held ? await r.export(state.held, [], state.ctx) : await state.result
    assert.equal(output.a, output.b)
    assert.deepEqual(output.a, { value: 7 })
}
for (let index = 0; index < 30; index++) { await turn(); global.gc() }
assert(pending.every(state => !state.weak.deref()), "Completed direct calls retain their receivers")
console.log(`${states.length + pending.length} external authority-release cases passed`)
