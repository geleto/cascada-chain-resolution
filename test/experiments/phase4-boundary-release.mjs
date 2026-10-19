// Strict public witnesses; production is expected to fail until Phase 4 lands.
// Run separately at the default stack depth and with --stack-trace-limit=50:
// node --expose-gc test/experiments/phase4-boundary-release.mjs
import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { OrderedThenable } from "../ordered-thenable.js"

assert(global.gc, "Run with --expose-gc")
const turn = () => new Promise(setImmediate)
const collect = async () => {
    for (let index = 0; index < 30; index++) { await turn(); global.gc() }
}
const states = []

async function externalCall(mode, mutation) {
    const ctx = { execution: new r.Execution(), errorContext: `${mode}/${mutation}` }
    let cause = new Error("prebuilt failure")
    const pending = mode === "ordered-reject" ? new OrderedThenable() : Promise.withResolvers()
    const resource = r.externalState({})
    let argument
    const api = r.externalState({
        call(record, input, finish) { record(input); return finish(this) },
    })
    const chain = new r.ContextChain({ api, resource }, ctx, { api: {}, resource: {} })
    const output = r.run(chain, ["api"], "call", [
        value => { argument = new WeakRef(value) },
        { payload: new Array(10000).fill(1) },
        receiver => {
            if (mode === "direct-receiver") return receiver
            if (mode === "direct-capability") return resource
            if (mode === "fresh-throw") throw (cause = new Error("fresh native failure"))
            if (mode === "sync-reject") return { then(_resolve, reject) { return reject(cause) } }
            return mode === "ordered-reject" ? pending : pending.promise
        },
    ], ctx, mutation ? { mutationScopeDepth: 1 } : {})
    if (mode === "ordered-reject" || mode === "native-reject") pending.reject(cause)
    const error = await output
    assert(r.isPoisonError(error))
    assert.equal(error.errorContext, ctx.errorContext)
    assert.equal(error.kind, mode.startsWith("direct-")
        ? r.ERROR_KIND.ExternalCapabilityEscape : r.ERROR_KIND.InvocationFailed)
    if (!mode.startsWith("direct-")) assert.equal(error.cause, cause)
    return { name: `external/${ctx.errorContext}`, ctx, chain, error, refs: [argument] }
}

async function lateDelivery(route, mode, pendingSibling) {
    const ctx = { execution: new r.Execution(), errorContext: `${route}/${mode}/${pendingSibling}` }
    const pending = Promise.withResolvers()
    const never = Promise.withResolvers()
    const cause = new Error("late failure")
    const resource = r.externalState({})
    let root, payload
    const make = () => {
        const fresh = { payload: new Array(10000).fill(1), later: pending.promise }
        if (pendingSibling) fresh.unfinished = never.promise
        root = new WeakRef(fresh)
        payload = new WeakRef(fresh.payload)
        return fresh
    }
    const context = new r.ContextChain({ resource, api: r.externalState({ get() { return make() } }) },
        ctx, { resource: {}, api: {} })
    let held = new r.Chain(route === "external-call"
        ? await r.run(context, ["api"], "get", [], ctx, {})
        : route === "import" ? r.import(make(), ctx) : r.importMethodResult(make(), ctx), ctx)
    await collect()
    assert(root.deref() && payload.deref(), "A retained result still owns its data")
    if (mode === "reject") pending.reject(cause)
    else pending.resolve(mode === "capability" ? resource : cause)
    const error = await r.lookupPath(held, ["later"], ctx)
    assert(r.isPoisonError(error))
    assert.equal(error.errorContext, ctx.errorContext)
    assert.equal(error.kind, mode === "capability" ? r.ERROR_KIND.ExternalCapabilityEscape
        : route === "import" ? r.ERROR_KIND.ContextValueFailed : r.ERROR_KIND.InvocationFailed)
    if (mode !== "capability") assert.equal(error.cause, cause)
    if (pendingSibling) r.assignPath(held, [], undefined, ctx)
    held = undefined
    // Keep the unresolved source and context alive, but discard the result holder.
    // The completed delivery must not retain its former destination via an Error.
    return { name: `late/${ctx.errorContext}`, ctx, context, never, error, refs: [root, payload] }
}

function managedThrow(mutation) {
    const ctx = { execution: new r.Execution(), errorContext: `managed fresh throw/${mutation}` }
    let argument, cause
    const chain = new r.Chain({ call(record, input, finish) { record(input); return finish() } }, ctx)
    const error = r.run(chain, [], "call", [
        value => { argument = new WeakRef(value) },
        { payload: new Array(10000).fill(1) },
        () => { throw (cause = new Error("fresh managed failure")) },
    ], ctx, mutation ? { mutationScopeDepth: 0 } : {})
    assert.equal(error.kind, r.ERROR_KIND.InvocationFailed)
    assert.equal(error.cause, cause)
    if (mutation) assert.equal(r.repairPath(chain, [], ctx), undefined)
    // The exact cause's native CallSite can itself retain the method receiver.
    // Require release of the runtime action closure's exported arguments;
    // receiver collection with a prebuilt cause has its separate strict probe.
    return { name: ctx.errorContext, ctx, chain, error, refs: [argument] }
}

for (const mutation of [false, true]) states.push(managedThrow(mutation))

for (const mutation of [false, true])
for (const mode of ["native-reject", "sync-reject", "ordered-reject",
    "direct-capability", "direct-receiver", "fresh-throw"])
    states.push(await externalCall(mode, mutation))

for (const route of ["method-result", "import", "external-call"])
for (const mode of ["reject", "capability", "error-value"])
for (const pendingSibling of [false, true]) {
    // Ordinary import preserves an inert capability; its later lookup failure
    // tests a separate path lifetime, not preparation's completed delivery.
    if (route === "import" && mode === "capability") continue
    states.push(await lateDelivery(route, mode, pendingSibling))
}

await collect()
const retained = states.filter(state => state.refs.some(ref => ref.deref())).map(state => state.name)
assert.deepEqual(retained, [], "Completed boundary work retained spent private data")
console.log(`${states.length} boundary release cases passed`)
