// Strict Phase 4 receiver identity and independent nested-data lifetime checks.
import assert from "node:assert/strict";
import * as r from "../../src/index.js";
import { ready, OrderedThenable } from "../ordered-thenable.js";
assert(global.gc, "Run with --expose-gc");
const executions = [];
const context = name => { const execution = new r.Execution(); executions.push(execution); return {execution, errorContext:{name}}; };
const turn = () => new Promise(setImmediate);
async function collect() { for (let i = 0; i < 15; i++) { await turn(); global.gc(); } }
function allErrors(error) { return error?.errors ? error.errors.flatMap(allErrors) : error ? [error] : []; }
async function evaluate() {
const forms = ["direct", "direct-sync", "direct-fulfilled", "direct-pending",
    "wrapper", "wrapper-sync", "wrapper-fulfilled", "wrapper-pending", "wrapper-ordered",
    "two-segments", "cycle-pending", "array-pending"];
let behavior = 0;
for (const registered of [false, true]) for (const mutation of [false, true]) for (const form of forms) {
    const ctx = context(form), deferred = Promise.withResolvers(), next = Promise.withResolvers(), ordered = new OrderedThenable();
    const child = r.externalState({ count: 0, result() {
        if (mutation) this.count++;
        if (form === "direct") return this;
        if (form === "direct-sync") return ready(this);
        if (form === "direct-fulfilled") return Promise.resolve(this);
        if (form === "direct-pending") return deferred.promise;
        if (form === "wrapper") return {value: this};
        if (form === "wrapper-sync") return {value: ready(this)};
        if (form === "wrapper-fulfilled") return {value: Promise.resolve(this)};
        if (form === "wrapper-ordered") return {value: ordered};
        if (form === "array-pending") return [deferred.promise];
        const result = {value: deferred.promise};
        if (form === "cycle-pending") result.self = result;
        return result;
    }});
    const parent = r.externalState({child});
    const chain = new r.ContextChain({service:parent},ctx,registered ? {service:{child:{}}} : {service:{}});
    const result = r.run(chain,["service","child"],"result",[],ctx,mutation ? {mutationScopeDepth:1} : {});
    const independent = form.includes("wrapper") && form !== "wrapper" && form !== "wrapper-sync" ||
        ["two-segments", "cycle-pending", "array-pending"].includes(form);
    if (independent) assert(!(result instanceof Promise), form);
    if (form === "direct-pending") deferred.resolve(child);
    const held = new r.Chain(await result,ctx);
    if (form === "two-segments") {
        deferred.resolve({next:next.promise});
        await turn();
        next.resolve(child);
    } else if (form === "wrapper-ordered") ordered.resolve(child);
    else deferred.resolve(child);
    const errors = allErrors(await r.getErrors(held,[],ctx));
    assert.equal(errors.length,1,form);
    assert.equal(errors[0].kind,r.ERROR_KIND.ExternalCapabilityEscape,form);
    assert.equal(errors[0].errorContext,ctx.errorContext,form);
    const scopeError = await r.getErrors(chain,["service"],ctx);
    assert.equal(!!scopeError,mutation && !independent,form);
    assert.equal(child.count,mutation ? 1 : 0,form);
    assert.equal(ctx.execution.fatalError,null);
    behavior++;
}
for (const form of ["direct","wrapper","pending"]) {
    const ctx = context("observation only");
    const child = r.externalState({result() {return form === "direct" ? this :
        {value: form === "pending" ? Promise.resolve(this) : this};}});
    const held = new r.Chain(await r.run(new r.Chain(child,ctx),[],"result",[],ctx,{}),ctx);
    assert.equal(await r.lookupPath(held,form === "direct" ? [] : ["value"],ctx),child);
    behavior++;
}
{
    const ctx = context("primitive receiver");
    const chain = new r.ContextChain({service:r.externalState({text:"hello"})},ctx,{service:{}});
    assert.equal(r.run(chain,["service","text"],"toUpperCase",[],ctx,{}),"HELLO");
    behavior++;
}
{
    const ctx = context("function receiver");
    const child = function () {};
    child.result = function () {return {value:Promise.resolve(this)};};
    const chain = new r.ContextChain({service:r.externalState({child})},ctx,{service:{}});
    const held = new r.Chain(r.run(chain,["service","child"],"result",[],ctx,{}),ctx);
    assert.equal((await r.lookupPath(held,["value"],ctx)).kind,r.ERROR_KIND.ExternalCapabilityEscape);
    behavior++;
}
{
    const ctx = context("per-call identity"), pending = Promise.withResolvers();
    const a = r.externalState({result() {return {value:pending.promise}}});
    const b = r.externalState({result() {return {value:pending.promise}}});
    const chain = new r.ContextChain({service:r.externalState({a,b})},ctx,{service:{}});
    const first = new r.Chain(r.run(chain,["service","a"],"result",[],ctx,{}),ctx);
    const second = new r.Chain(r.run(chain,["service","b"],"result",[],ctx,{}),ctx);
    await collect();
    pending.resolve(a);
    assert.equal((await r.lookupPath(first,["value"],ctx)).kind,r.ERROR_KIND.ExternalCapabilityEscape);
    assert.equal(await r.lookupPath(second,["value"],ctx),a);
    behavior++;
}
async function lifetimeCase(form, mutation) {
    const ctx = context("lifetime " + form), pending = Promise.withResolvers(), next = Promise.withResolvers();
    const cause = new Error("result reflection failed");
    const fault = new Proxy({}, {ownKeys() {throw cause;}});
    let child = r.externalState({payload: {items: new Array(10000).fill(7)}, count:0, result() {
        if (mutation) this.count++;
        const result = form === "discarded" ? {pending:pending.promise, fault} : {pending:pending.promise};
        return form === "direct-promise" ? Promise.resolve(result) : result;
    }});
    const weak = [new WeakRef(child), new WeakRef(child.payload)];
    const parent = r.externalState({child, drop() {this.child = undefined}});
    const chain = new r.ContextChain({service:parent},ctx,{service:{}});
    const held = new r.Chain(await r.run(chain,["service","child"],"result",[],ctx,
        mutation ? {mutationScopeDepth:1} : {}),ctx);
    if (form === "segments") {
        pending.resolve({next:next.promise});
        await turn();
    }
    const drop = r.run(chain,["service"],"drop",[],ctx,{mutationScopeDepth:1});
    assert(!(drop instanceof Promise),"Nested data must not prolong external reservation");
    assert.equal(drop,undefined);
    assert.equal(parent.child,undefined);
    child = undefined;
    return {ctx,held,chain,pending,next,weak,form,async finish() {
        pending.resolve(7); next.resolve(7);
        if (form === "discarded") {
            const errors = allErrors(await r.getErrors(held,[],ctx));
            assert(errors.some(error => error.cause === cause));
        } else assert.equal(await r.lookupPath(held,form === "segments" ? ["pending","next"] : ["pending"],ctx),7);
    }};
}
const states = [];
for (const form of ["nested","direct-promise","segments","discarded"])
for (const mutation of [false,true]) states.push(await lifetimeCase(form,mutation));
await collect();
const collected = states.map(state => state.weak.every(weak => weak.deref() === undefined));
assert.deepEqual(collected, states.map(() => true),
    "A strong policy retains the receiver; weak identity membership must not");
for (const state of states) await state.finish();
await collect();
const collectibleAfterDelivery = states.filter(state => state.weak.every(weak => weak.deref() === undefined)).length;
assert.equal(collectibleAfterDelivery,states.length);
{
    const ctx = context("direct result retention"), pending = Promise.withResolvers();
    const events = [];
    let child = r.externalState({result() {events.push("start"); return pending.promise;}});
    const weak = new WeakRef(child);
    const parent = r.externalState({child,drop() {events.push("drop"); this.child=undefined}});
    const chain = new r.ContextChain({service:parent},ctx,{service:{}});
    const result = r.run(chain,["service","child"],"result",[],ctx,{});
    const drop = r.run(chain,["service"],"drop",[],ctx,{mutationScopeDepth:1});
    child = undefined;
    await collect();
    assert(weak.deref(),"Direct result still owns the receiver");
    assert.deepEqual(events,["start"]);
    pending.resolve(7);
    assert.equal(await result,7);
    await drop;
    assert.deepEqual(events,["start","drop"]);
    await collect();
    assert.equal(weak.deref(),undefined);
}
return {behaviorCases:behavior,
    receiverLifetimes:states.length,collectibleWhileNestedPending:collected.filter(Boolean).length,collectibleAfterDelivery,
    directResultLifetimeControls:1};
}
const summary = await evaluate();
console.log(JSON.stringify({...summary, executionsKeptAlive:executions.length}));