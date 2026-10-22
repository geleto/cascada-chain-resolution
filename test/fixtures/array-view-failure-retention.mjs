import assert from "node:assert/strict"
import * as r from "../../src/index.js"

assert(global.gc)

// Trap methods capture no source or receiver. Keep both diagnostic stacks lazy:
// reading either stack can release the very runtime closure under examination.
function inspect(handler, kind) {
    if (!handler.armed) return
    const ordinal = handler.counts[kind] = (handler.counts[kind] ?? 0) + 1
    if (handler.fault?.kind === kind && handler.fault.ordinal === ordinal) {
        handler.cause ??= new Error(`fresh Array storage ${kind} failure`)
        throw handler.cause
    }
}

function handlerFor(fault, fresh) {
    return {
        armed: false, counts: {}, fault,
        cause: fresh ? undefined : new Error("prebuilt Array storage failure"),
        get(target, key, receiver) {
            if (key === "length") inspect(this, "lengthRead")
            return Reflect.get(target, key, receiver)
        },
        isExtensible(target) {
            inspect(this, "extensible")
            return Reflect.isExtensible(target)
        },
        getOwnPropertyDescriptor(target, key) {
            if (key === "length") inspect(this, "lengthDescriptor")
            return Reflect.getOwnPropertyDescriptor(target, key)
        },
        set(target, key, value, receiver) {
            if (key === "length") inspect(this, "lengthWrite")
            return Reflect.set(target, key, value, receiver)
        },
        defineProperty(target, key, descriptor) {
            inspect(this, key === "length" ? "lengthDefine" : "indexDefine")
            return Reflect.defineProperty(target, key, descriptor)
        },
    }
}

function issue(fault, fresh = true, live = false, readyPayload = false, method = "push") {
    const label = (fault ? `${fault.kind}:${fault.ordinal}/fresh=${fresh}` : live ? "healthy live" : "healthy discarded") +
        `/readyPayload=${readyPayload}/${method}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    const input = Promise.withResolvers(), handler = handlerFor(fault, fresh)
    const raw = [0], source = new Proxy(raw, handler), chain = new r.Chain(source, ctx)
    const payload = readyPayload ? { n: 1 } : input.promise
    const weak = [new WeakRef(source), new WeakRef(raw), ...(readyPayload ? [new WeakRef(payload)] : [])]
    handler.armed = true
    const result = r.run(chain, [], method, method === "concat" ? [[payload]] : [payload], ctx,
        method === "concat" ? {} : { mutationScopeDepth: 0 })
    const counts = { ...handler.counts }
    handler.armed = false
    if (fault) {
        assert(r.isPoisonError(result), `${label}: reached storage failure must stay recoverable`)
        assert.equal(result.cause, handler.cause, `${label}: preserve the exact cause`)
        assert.equal(result.kind, method === "concat" ? r.ERROR_KIND.InvocationFailed : r.ERROR_KIND.PropertyMutationFailed)
        assert.equal(result.errorContext, label)
    } else assert.equal(result, 2)
    assert.equal(ctx.execution.fatalError, null)
    // Explicit replacement releases the failed mutation's recovery baseline too.
    if (!live) r.assignPath(chain, [], null, ctx)
    input.resolve(1)
    return { label, ctx, chain, input, result, weak, counts }
}

function derive(method, ordinal, fresh = true) {
    const label = `${method}/lengthRead:${ordinal ?? "healthy"}/fresh=${fresh}`
    const ctx = { execution: new r.Execution(), errorContext: label }
    const handler = handlerFor(ordinal ? { kind: "lengthRead", ordinal } : undefined, fresh)
    const raw = [0, 1, 2], source = new Proxy(raw, handler), chain = new r.Chain(source, ctx)
    const weak = [new WeakRef(source), new WeakRef(raw)]
    handler.armed = true
    let result = r.run(chain, [], method, [], ctx, method === "slice" ? {} : { mutationScopeDepth: 0 })
    const counts = { ...handler.counts }
    handler.armed = false
    if (ordinal) {
        assert(r.isPoisonError(result), `${label}: reached length failure must stay recoverable`)
        assert.equal(result.cause, handler.cause)
        assert.equal(result.kind, method === "slice" ? r.ERROR_KIND.InvocationFailed : r.ERROR_KIND.PropertyMutationFailed)
        assert.equal(result.errorContext, label)
    } else if (method === "slice") {
        const held = new r.Chain(result, ctx)
        result = r.export(held, [], ctx)
        assert.deepEqual(result, [0, 1, 2])
        r.assignPath(held, [], null, ctx)
    } else assert.equal(result, method === "pop" ? 2 : 0)
    assert.equal(ctx.execution.fatalError, null)
    r.assignPath(chain, [], null, ctx)
    return { label, ctx, chain, result, weak, counts }
}

// Enumerate actual reached boundaries, rather than pinning incidental read counts.
// This still sweeps newly introduced reads and keeps every selected failure live
// until collection, so removing one redundant read cannot hide another leak.
const healthy = issue(), cases = []
assert(healthy.counts.lengthRead > 0)
assert(healthy.counts.extensible > 0)
assert(healthy.counts.lengthDescriptor > 0)
assert(healthy.counts.lengthWrite > 0)
assert(healthy.counts.lengthDefine > 0)
assert(healthy.counts.indexDefine > 0)
for (const fresh of [false, true]) for (const [kind, count] of Object.entries(healthy.counts))
    for (let ordinal = 1; ordinal <= count; ordinal++) cases.push(issue({ kind, ordinal }, fresh))
const healthyPayload = issue(undefined, true, false, true)
for (const fresh of [false, true])
    for (let ordinal = 1; ordinal <= healthyPayload.counts.indexDefine; ordinal++)
        cases.push(issue({ kind: "indexDefine", ordinal }, fresh, false, true))
for (const fresh of [false, true]) cases.push(issue({ kind: "indexDefine", ordinal: 1 }, fresh, false, true, "concat"))
const derivedControls = ["slice", "pop", "shift"].map(method => {
    const control = derive(method)
    assert(control.counts.lengthRead > 0)
    for (const fresh of [false, true])
        for (let ordinal = 1; ordinal <= control.counts.lengthRead; ordinal++) cases.push(derive(method, ordinal, fresh))
    return control
})
const live = issue(undefined, true, true)

async function collect() {
    for (let turn = 0; turn < 30; turn++) {
        await new Promise(setImmediate)
        global.gc()
    }
}

await collect()
assert.deepEqual(r.export(live.chain, [], live.ctx), [0, 1])
assert(live.weak.every(ref => ref.deref()), "A live owner must retain its backing")
const retained = [...cases, healthy, healthyPayload, ...derivedControls]
    .filter(state => state.weak.some(ref => ref.deref())).map(state => state.label)
assert.deepEqual(retained, [], "Unformatted Array storage failures must release discarded backing")
r.assignPath(live.chain, [], null, live.ctx)
await collect()
assert(live.weak.every(ref => ref.deref() === undefined), "Releasing the last healthy owner must release its backing")
console.log(JSON.stringify({ failures: cases.length, controls: 4 + derivedControls.length, boundaries: healthy.counts }))
