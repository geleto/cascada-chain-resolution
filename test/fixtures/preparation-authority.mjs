// Trusted placement seams supplement the public result-contract tests.
import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { admitReadyValue, TYPE } from "../../src/language-values.js"
import { metaOf } from "../../src/meta.js"
import * as pv from "../../src/property-versions.js"
import { OrderedThenable } from "../ordered-thenable.js"
import { verifyParents } from "../verify-parents.js"
import * as trace from "../trace-state.js"

let overlays = 0, transitions = 0, histories = 0, cacheRefusals = 0
for (const array of [false, true])
for (const state of ["fixed", "absent", "pending", "recovery"])
for (const route of ["root", "wrapper", "late"]) {
    const execution = new r.Execution()
    const original = { execution, errorContext: { producer: true } }
    const later = { execution, errorContext: { result: true } }
    const key = array ? "0" : "x", source = array ? [17] : { x: 17 }
    admitReadyValue(source, original, array ? TYPE.Array : TYPE.Record, array ? undefined : Object.prototype)
    const pending = new OrderedThenable(), child = r.import({ n: 3 }, original)
    if (state === "pending") pv.assignProperty(source, key, pending, original, r.ERROR_KIND.AssignmentValueFailed)
    else pv.copyPlacement({ value: state === "absent" ? undefined : child, present: state !== "absent",
        recovery: state === "recovery" ? { value: 17, present: true } : undefined }, source, key, original, false)
    const version = pv.getPlacementVersion(source, key, original), subscriptions = pending.subscriptions
    assert(version)
    let held
    if (route === "late") {
        const signal = Promise.withResolvers()
        held = new r.Chain(r.importMethodResult({ source: signal.promise }, later), later)
        signal.resolve(source)
    } else held = new r.Chain(r.importMethodResult(route === "root" ? source : { source }, later), later)
    assert.equal(await r.lookupPath(held, route === "root" ? [] : ["source"], later), source)
    assert.equal(pv.getPlacementVersion(source, key, later), version, "Established version must remain authoritative")
    assert.equal(pending.subscriptions, subscriptions, "Preparation must not subscribe to an existing producer")
    assert.equal(metaOf(source, later).placementsInitialized, true)
    if (state === "pending") {
        const cause = new Error("original delivery")
        pending.reject(cause)
        const failure = await r.lookupPath(held, [...(route === "root" ? [] : ["source"]), key], later)
        assert.equal(failure.errorContext, original.errorContext)
        assert.equal(failure.kind, r.ERROR_KIND.AssignmentValueFailed)
        assert.equal(failure.cause, cause)
    } else assert.equal(r.lookupPath(held, [...(route === "root" ? [] : ["source"]), key], later),
        state === "absent" ? undefined : child)
    verifyParents(later, held._state)
    overlays++
}

// Transfer a real command's pending presence/position into an admitted but
// unprepared destination. Return it before that command publishes. The result
// boundary must neither replace its authority nor reinterpret its absence.
for (const array of [false, true]) for (const remove of [false, true])
for (const recovery of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: "original entry" }
    const later = { ...ctx, errorContext: "later result" }, gate = Promise.withResolvers()
    const key = array ? "0" : "x", source = new r.Chain(array ? [17, 8] : { x: 17, next: 8 }, ctx)
    const cause = new Error("entry value")
    const operation = r.enter(source, [key], ctx, true, inside => gate.promise.then(() =>
        remove ? r.deletePath(inside, [], ctx) : r.assignPath(inside, [], recovery ? r.createPoisonError(cause, ctx, r.ERROR_KIND.AssignmentValueFailed) : 23, ctx)))
    const destination = array ? [17, 8] : { x: 17, next: 8 }
    admitReadyValue(destination, ctx, array ? TYPE.Array : TYPE.Record, array ? undefined : Object.prototype)
    const captured = pv.capturePlacement(source._state.value, key, ctx)
    assert(captured.sourceVersion?.transition, "Fixture must transfer a real unfinished publication")
    pv.copyPlacement(captured, destination, key, ctx, false)
    const version = pv.getPlacementVersion(destination, key, ctx)
    const held = new r.Chain(r.importMethodResult(destination, later), later)
    assert.equal(pv.getPlacementVersion(destination, key, later), version)
    const output = r.export(held, [], later)
    assert(r.isPending(output, later))
    gate.resolve(); await operation
    const actual = await output
    if (recovery && !remove) {
        assert.equal(actual.cause, cause)
        assert.equal(actual.errorContext, ctx.errorContext)
    } else if (array) assert.deepEqual(actual, remove ? [, 8] : [23, 8])
    else assert.deepEqual(actual, remove ? { next: 8 } : { x: 23, next: 8 })
    verifyParents(later, held._state)
    transitions++
}

// Growing call history around a fixed graph must add no interior inspection or
// owning subscription. Fresh wrappers cost their own edge, not another walk.
for (const size of [16, 64, 256]) for (const wrapper of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: "original producer" }
    const pending = new OrderedThenable()
    let reads = 0
    const target = { pending, child: { n: 1 } }; target.self = target
    const source = new Proxy(target, { ownKeys(value) { reads++; return Reflect.ownKeys(value) } })
    target.self = source
    const first = new r.Chain(r.import(source, ctx), ctx)
    const initialReads = reads, initialSubscriptions = pending.subscriptions
    const copies = trace.enabled ? trace.trackCopies() : undefined
    let last
    for (let index = 0; index < size; index++) {
        const call = { ...ctx, errorContext: { index } }
        const next = new r.Chain(r.importMethodResult(wrapper ? { source } : source, call), call)
        assert.equal(r.lookupPath(next, wrapper ? ["source"] : [], call), source)
        if (last) r.assignPath(last, [], null, ctx)
        last = next
    }
    assert.equal(reads, initialReads, "Prepared-return history must not inspect the interior again")
    assert.equal(pending.subscriptions, initialSubscriptions, "Prepared-return history must not resubscribe")
    if (copies) {
        assert(trace.counts().prepareInput > 0, "Required preparation instrumentation must run")
        assert.equal(copies.length, 0, "Prepared returns must allocate no validation copies")
    }
    pending.resolve(7)
    const actual = await r.export(last, wrapper ? ["source"] : [], ctx)
    assert.equal(actual.self, actual)
    assert.equal(actual.pending, 7)
    assert.equal(r.lookupPath(first, ["child", "n"], ctx), 1)
    histories++
}

for (const array of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: "original raw placement" }
    const later = { ...ctx, errorContext: "prepared return" }, signal = Promise.withResolvers()
    const child = { n: 7 }, key = array ? "0" : "value"
    let refusals = 0
    const raw = array ? [signal.promise] : { value: signal.promise }
    const source = new Proxy(raw, { set(target, property, value, receiver) {
        if (property === key && value === child) { refusals++; throw new Error("Optional cache refused") }
        return Reflect.set(target, property, value, receiver)
    } })
    const first = new r.Chain(source, ctx)
    const received = new r.Chain(r.importMethodResult(r.lookupPath(first, [], ctx), later), later)
    signal.resolve(child)
    assert.equal(await r.lookupPath(received, [key], later), child)
    assert.equal(await r.lookupPath(first, [key], ctx), child)
    assert(refusals > 0, "Fixture must reach an optional physical cache write")
    assert.equal(r.getErrors(received, [], later), null)
    assert.equal(r.lookupPath(first, [], ctx), r.lookupPath(received, [], later))
    assert.equal(raw[key], signal.promise, "Rejected cache write leaves host storage unchanged")
    verifyParents(later, first._state, received._state)
    cacheRefusals++
}
console.log(JSON.stringify({ overlays, transitions, histories, cacheRefusals }))
