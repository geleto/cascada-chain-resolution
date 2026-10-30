import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { ready, rejected, OrderedThenable } from "../ordered-thenable.js"

function fail(cause) { throw cause ?? new Error("fresh boundary failure") }
function traps(cause, weak, key) {
    return {
        armed: true,
        getPrototypeOf(target) { if (this.armed) fail(cause); return Reflect.getPrototypeOf(target) },
        ownKeys(target) { if (this.armed) fail(cause); return Reflect.ownKeys(target) },
        getOwnPropertyDescriptor(target, selected) {
            if (this.armed && selected === key) fail(cause)
            return Reflect.getOwnPropertyDescriptor(target, selected)
        },
        set(target, selected, value) {
            if (typeof value === "object" && value !== null) weak.push(new WeakRef(value))
            if (this.armed) fail(cause)
            return Reflect.set(target, selected, value)
        },
        deleteProperty(target, selected) { if (this.armed) fail(cause); return Reflect.deleteProperty(target, selected) },
    }
}

function installInvalidChild(cause, weak) {
    return function () {
        const child = new Proxy({ value: 1 }, { ownKeys: traps(cause, weak).ownKeys, armed: true })
        this.child = child
        weak.push(new WeakRef(this), new WeakRef(child))
        return 7
    }
}

async function issue(route, cause) {
    const ctx = { execution: new r.Execution(), errorContext: route }, weak = []
    let error
    if (route === "method selection") {
        const handler = traps(cause, weak, "read")
        const prototype = new Proxy({ read() { return 7 } },
            { getOwnPropertyDescriptor: handler.getOwnPropertyDescriptor, armed: true })
        const source = Object.create(prototype)
        assert.equal(r.managedState(source), source)
        const chain = new r.Chain(r.import(source, ctx), ctx)
        error = r.run(chain, [], "read", [], ctx, {})
        weak.push(new WeakRef(source), new WeakRef(prototype))
    } else if (route === "receiver validation" || route === "recovered receiver validation") {
        const source = { change: installInvalidChild(cause, weak) }
        const recovered = route === "recovered receiver validation", pending = Promise.withResolvers()
        const chain = new r.Chain(recovered ? { then: pending.promise } : source, ctx)
        if (recovered) {
            r.assignPath(chain, ["then"], () => 0, ctx)
        }
        const path = recovered ? ["then"] : []
        error = r.run(chain, path, "change", [], ctx, { mutationScopeDepth: path.length, repair: recovered })
        if (recovered) { pending.resolve(source); error = await error }
        weak.push(new WeakRef(source))
    } else if (route === "repair scope preflight") {
        const api = r.externalState({}), source = { P: { api } }, argument = { value: 1 }
        const chain = new r.ContextChain(source, ctx, { P: { api: {} } })
        error = r.run(chain, ["P"], "missing", [argument], ctx, { mutationScopeDepth: 1, repair: true })
        weak.push(new WeakRef(chain), new WeakRef(source), new WeakRef(source.P), new WeakRef(api), new WeakRef(argument))
    } else if (route === "native classification" || route === "native availability") {
        const child = route === "native classification"
            ? new Proxy({ then: 0 }, { getPrototypeOf() { fail(cause) } })
            : new Proxy({}, { get(target, key) { if (key === "then") fail(cause); return Reflect.get(target, key) } })
        const host = r.externalState({ child })
        const chain = new r.ContextChain({ host }, ctx, { host: {} })
        error = r.lookupPath(chain, ["host", "child", "value"], ctx)
        weak.push(new WeakRef(child), new WeakRef(host))
    } else if (route === "Array keys" || route === "Array view descriptor") {
        const handler = traps(cause, weak)
        // Keep the handler mutable without retaining the inspected source.
        const arrayHandler = route === "Array keys" ? { ownKeys: handler.ownKeys, armed: false }
            : { getOwnPropertyDescriptor: traps(cause, weak, "0").getOwnPropertyDescriptor, armed: false }
        const array = new Proxy([1, 2], arrayHandler)
        let chain = new r.Chain(array, ctx)
        if (route === "Array view descriptor") chain = new r.Chain(r.run(chain, [], "slice", [], ctx, {}), ctx)
        arrayHandler.armed = true
        error = route === "Array keys" ? r.export(chain, [], ctx) : r.lookupPath(chain, ["0"], ctx)
        weak.push(new WeakRef(array))
    } else if (route === "conversion") {
        const opaque = r.externalState({ value: 1 }), nested = [opaque], source = [nested]
        const chain = new r.Chain(source, ctx)
        error = r.run(chain, [], "join", [], ctx, {})
        weak.push(new WeakRef(source), new WeakRef(nested), new WeakRef(opaque))
    } else {
        const native = route.startsWith("native"), deleting = route.endsWith("delete")
        const handler = traps(cause, weak)
        const storageHandler = route === "storage extensibility" ? { isExtensible() { fail(cause) } }
            : route === "storage descriptor" ? { getOwnPropertyDescriptor: traps(cause, weak, "value").getOwnPropertyDescriptor, armed: false }
            : undefined
        const target = { value: 1 }, source = new Proxy(target, storageHandler ?? (
            deleting ? { deleteProperty: handler.deleteProperty, armed: true }
                : { set: handler.set, armed: true }))
        const chain = native ? new r.ContextChain({ host: r.externalState(source) }, ctx, { host: {} })
            : new r.Chain(source, ctx)
        const input = { child: {} }
        if (storageHandler) storageHandler.armed = true
        error = deleting ? r.deletePath(chain, native ? ["host", "value"] : ["value"], ctx)
            : r.assignPath(chain, native ? ["host", "value"] : [route === "storage extensibility" ? "newKey" : "value"], input, ctx)
        assert(r.isPoisonError(error))
        weak.push(new WeakRef(source), new WeakRef(target), new WeakRef(input), new WeakRef(input.child))
    }
    assert(r.isPoisonError(error), route)
    assert.equal(error.errorContext, ctx.errorContext)
    if (route === "repair scope preflight") assert.equal(error.kind, r.ERROR_KIND.PropertyValidation)
    else if (route !== "conversion") {
        if (cause) assert.equal(error.cause, cause, route)
        else assert(Error.isError(error.cause), route)
    } else assert.equal(error.kind, r.ERROR_KIND.ScalarConversionFailed)
    assert.equal(ctx.execution.fatalError, null)
    return { ctx, error, weak }
}

function healthyControl() {
    const ctx = { execution: new r.Execution(), errorContext: "healthy control" }, weak = []
    const handler = traps(undefined, weak)
    const host = r.externalState(new Proxy({ value: 1 }, { set: handler.set, armed: false }))
    const chain = new r.ContextChain({ host }, ctx, { host: {} })
    assert.equal(r.assignPath(chain, ["host", "value"], { child: { value: 7 } }, ctx), undefined)
    return { ctx, chain, weak, value: host.value }
}

async function failedKey(timing, entered, rejects) {
    const ctx = { execution: new r.Execution(), errorContext: `key/${timing}/${entered}/${rejects}` }
    const source = { x: 1 }, chain = new r.Chain({ a: source }, ctx)
    const cause = new Error("failed key"), value = rejects ? cause : {}
    const pending = timing === "native" ? Promise.withResolvers() : timing === "ordered" ? new OrderedThenable() : undefined
    const key = pending?.promise ?? pending ?? (rejects ? rejected(value) : timing === "ready" ? value : ready(value))
    const entry = entered ? r.enter(chain, ["a"], ctx, true, inside => r.assignPath(inside, [key, "y"], 1, ctx)) :
        r.assignPath(chain, ["a", key, "y"], 1, ctx)
    const result = r.lookupPath(chain, ["a"], ctx)
    if (rejects) pending?.reject(value)
    else pending?.resolve(value)
    const error = await result
    await entry
    assert.equal(error.kind, r.ERROR_KIND[rejects ? "PathSegmentFailed" : "InvalidPathSegment"])
    assert.equal(await r.repairPath(chain, ["a"], ctx), undefined)
    assert.deepEqual(await r.export(chain, ["a"], ctx), { x: 1 })
    return { ctx, error, weak: [new WeakRef(source), new WeakRef(chain)] }
}

function pendingWriteControl(native) {
    const ctx = { execution: new r.Execution(), errorContext: "pending write control" }
    const signal = Promise.withResolvers(), input = { child: { value: 9 } }
    const host = native ? r.externalState({ hold() { return signal.promise } }) : undefined
    const chain = native ? new r.ContextChain({ host }, ctx, { host: {} }) : new r.Chain(signal.promise, ctx)
    const earlier = native ? r.run(chain, ["host"], "hold", [], ctx, { mutationScopeDepth: 1 }) : undefined
    const path = native ? ["host", "value"] : ["value"]
    assert.equal(r.assignPath(chain, path, input, ctx), undefined)
    const result = r.export(chain, path, ctx)
    return { ctx, chain, async finish() {
        signal.resolve(native ? 7 : {})
        await earlier
        assert.deepEqual(await result, { child: { value: 9 } })
    } }
}

const states = []
for (const timing of ["ready", "synchronous", "native", "ordered"])
for (const entered of [false, true])
for (const rejects of [false, true]) {
    const state = await failedKey(timing, entered, rejects)
    states.push([state.ctx.errorContext, state])
}
states.push(["repair scope preflight", await issue("repair scope preflight")])
for (const fresh of [false, true])
for (const route of ["method selection", "receiver validation", "recovered receiver validation", "native classification", "native availability", "Array keys",
    "Array view descriptor", "conversion", "native write", "native delete", "storage write", "storage delete",
    "storage extensibility", "storage descriptor"]) {
    const cause = fresh ? undefined : new Error("prebuilt boundary failure")
    states.push([`${route}, fresh=${fresh}`, await issue(route, cause)])
}
const healthy = healthyControl()
const pending = [pendingWriteControl(false), pendingWriteControl(true)]
for (let turn = 0; turn < 30; turn++) {
    await new Promise(setImmediate)
    global.gc()
}
const retained = states.filter(([, state]) => state.weak.some(ref => ref.deref())).map(([name]) => name)
assert.deepEqual(retained, [], "Completed failures must release discarded graphs without formatting stacks")
assert.equal(healthy.weak.length, 1)
assert.equal(healthy.weak[0].deref(), healthy.value)
assert.deepEqual(healthy.value, { child: { value: 7 } })
for (const control of pending) await control.finish()
console.log(`${states.length} mutation-failure retention cases and three live-value controls passed`)
