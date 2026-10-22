import assert from "node:assert/strict"
import * as r from "../../src/index.js"
const results = []
const context = () => ({ execution: new r.Execution(), errorContext: "category audit" })
async function check(name, action) {
    try { await action(); results.push({ name, pass: true }) }
    catch (error) { results.push({ name, pass: false, message: error.message.split("\n")[0] }) }
}
const shapes = ["record", "array", "managed class", "managed instance", "external record",
    "external array", "class", "external override", "Date", "Map", "Set", "Uint8Array", "Error"]
function make(shape) {
    class Data {
        value = 7
        read() { return this.value }
        self() { return this }
    }
    class Opaque {
        #value = 7
        read() { return this.#value }
    }
    if (shape === "managed class" || shape === "external override") r.managedStateClass(Data)
    const value = shape === "record" || shape === "external record" ? { value: 7 } :
        shape === "array" || shape === "external array" ? [7] :
        shape === "class" ? new Opaque() :
        shape === "Date" ? new Date(0) :
        shape === "Map" ? new Map([["value", 7]]) :
        shape === "Set" ? new Set([7]) :
        shape === "Error" ? new Error("healthy data") :
        shape === "Uint8Array" ? new Uint8Array([7]) : new Data()
    if (shape === "managed instance") r.managedState(value)
    if (shape.startsWith("external")) r.externalState(value)
    return { value, managed: ["record", "array", "managed class", "managed instance"].includes(shape) }
}
for (const shape of shapes)
for (const route of ["readonly property", "readonly method", "mutable property", "mutable method", "direct export"]) {
    await check(`${shape}: ${route}`, async () => {
        const ctx = context()
        const { value, managed } = make(shape)
        let getterCalls = 0
        Object.defineProperty(value, "ignored", {
            enumerable: true, configurable: true,
            get() { getterCalls++; return 99 },
        })
        const mutable = route.startsWith("mutable") || route === "direct export"
        const api = r.externalState({ object: value, getObject() { return value } })
        const chain = mutable ? new r.ContextChain({ api }, ctx, { api: {} }) : new r.Chain(r.import(api, ctx), ctx)
        const path = mutable ? ["api"] : []
        const result = route === "direct export" ? await r.export(chain, [...path, "object"], ctx) :
            route.endsWith("method") ? await r.run(chain, path, "getObject", [], ctx, {}) :
                await r.lookupPath(chain, [...path, "object"], ctx)
        assert.equal(r.isPoisonError(result), false)
        const exported = route === "direct export" ? result : await r.export(new r.Chain(result, ctx), [], ctx)
        if (managed) {
            assert.notEqual(exported, value)
            assert.equal(Object.hasOwn(exported, "ignored"), false)
            assert.equal(Object.getPrototypeOf(exported), Object.getPrototypeOf(value))
        } else assert.equal(exported, value)
        assert.equal(getterCalls, 0)
        if (!managed && route !== "direct export")
            assert.equal(result, value)
        assert.equal(ctx.execution.fatalError, null)
    })
}
for (const direct of [false, true]) await check(`nested opaque aliases, direct export=${direct}`, async () => {
    const ctx = context()
    const { value: opaque } = make("class")
    const root = { opaque, alias: opaque }
    root.self = root
    const chain = new r.ContextChain({ api: r.externalState({ object: root }) }, ctx, { api: {} })
    const result = direct ? await r.export(chain, ["api", "object"], ctx) :
        await r.lookupPath(chain, ["api", "object"], ctx)
    assert.equal(result.opaque, opaque)
    assert.equal(result.opaque, result.alias)
    assert.equal(result.self, result)
})
await check("opaque poison remains opaque; managed poison is collected", async () => {
    const ctx = context()
    const poison = r.createPoisonError(new Error("leaf"), ctx, r.ERROR_KIND.OperationInputFailed)
    const opaque = r.externalState({ poison })
    const chain = new r.ContextChain({ api: r.externalState({ object: { opaque } }) }, ctx, { api: {} })
    const result = await r.lookupPath(chain, ["api", "object"], ctx)
    assert.equal(r.isPoisonError(result), false)
    assert.equal(result.opaque, opaque)
    assert.equal(await r.getErrors(new r.Chain(result, ctx), [], ctx), null)
    const bad = new r.ContextChain({ api: r.externalState({ object: { poison } }) }, ctx, { api: {} })
    assert.equal(await r.lookupPath(bad, ["api", "object"], ctx), poison)
})
await check("registered external class cannot escape", async () => {
    const ctx = context()
    const { value: child } = make("class")
    const chain = new r.ContextChain({ api: r.externalState({ child, wrapped: { child } }) }, ctx, { api: { child: {} } })
    assert.equal((await r.lookupPath(chain, ["api", "child"], ctx)).kind, r.ERROR_KIND.ExternalCapabilityEscape)
    assert.equal((await r.lookupPath(chain, ["api", "wrapped"], ctx)).kind, r.ERROR_KIND.ExternalCapabilityEscape)
})
await check("snapshot does not consume nested Promise", async () => {
    const ctx = context()
    let subscriptions = 0
    const pending = { then(resolve) { subscriptions++; resolve(7) } }
    const chain = new r.ContextChain({ api: r.externalState({ object: { pending } }) }, ctx, { api: {} })
    assert.equal((await r.lookupPath(chain, ["api", "object"], ctx)).kind, r.ERROR_KIND.InvalidExternalSnapshot)
    assert.equal(subscriptions, 0)
})
await check("internal managed copy preserves an instance-only declaration", async () => {
    const ctx = context()
    const { value } = make("managed instance")
    const chain = new r.Chain(r.import(value, ctx), ctx)
    const copied = await r.run(chain, [], "self", [], ctx, {})
    const copyChain = new r.Chain(copied, ctx)
    assert.notEqual(await r.export(copyChain, [], ctx), copied)
    assert.equal(await r.run(copyChain, [], "read", [], ctx, {}), 7)
})
await check("host export is a new identity; instance-only declaration is not inherited", async () => {
    const ctx = context()
    const { value } = make("managed instance")
    const exported = await r.export(new r.Chain(r.import(value, ctx), ctx), [], ctx)
    const again = new r.Chain(r.import(exported, ctx), ctx)
    assert.equal(await r.export(again, [], ctx), exported)
})
await check("class registration also classifies newly exported host instances", async () => {
    const ctx = context()
    const { value } = make("managed class")
    const exported = await r.export(new r.Chain(r.import(value, ctx), ctx), [], ctx)
    const again = new r.Chain(r.import(exported, ctx), ctx)
    assert.notEqual(await r.export(again, [], ctx), exported)
})
for (const shape of ["managed class", "managed instance", "class", "external override"])
for (const first of ["property", "import"])
for (const delivery of ["sync", "promise"]) await check(`delivery ${shape} ${first} ${delivery}`, async () => {
    const ctx = context()
    const { value, managed } = make(shape)
    let subscriptions = 0
    const signal = Promise.withResolvers()
    const available = delivery === "sync" ? { then(resolve) { subscriptions++; return resolve(value) } } : signal.promise
    const api = new r.Chain(r.import(r.externalState({ object: available }), ctx), ctx)
    let direct, property
    if (first === "property") {
        property = r.lookupPath(api, ["object"], ctx)
        direct = r.import(value, ctx)
    } else {
        direct = r.import(value, ctx)
        property = r.lookupPath(api, ["object"], ctx)
    }
    signal.resolve(value)
    const pair = new r.Chain({ direct, property: await property }, ctx)
    const output = await r.export(pair, [], ctx)
    assert.equal(output.direct, output.property)
    if (managed) assert.notEqual(output.direct, value)
    else assert.equal(output.direct, value)
    assert.equal(subscriptions, delivery === "sync" ? 1 : 0)
})
await check("registered class does not opt in subclasses", async () => {
    class Parent { value = 7 }
    class Child extends Parent {}
    r.managedStateClass(Parent)
    const ctx = context(), value = new Child()
    const api = new r.ContextChain({ api: r.externalState({ object: value }) }, ctx, { api: {} })
    assert.equal(await r.lookupPath(api, ["api", "object"], ctx), value)
})
await check("Array subclasses retain controlled Array classification", async () => {
    class Items extends Array {}
    const value = new Items(1, 2), ctx = context()
    const api = new r.ContextChain({ api: r.externalState({ object: value }) }, ctx, { api: {} })
    const output = await r.lookupPath(api, ["api", "object"], ctx)
    assert.equal(Object.getPrototypeOf(output), Array.prototype)
    const sliced = await r.run(new r.Chain(output, ctx), [], "slice", [0], ctx, {})
    assert.deepEqual(await r.export(new r.Chain(sliced, ctx), [], ctx), [1, 2])
})
await check("declared external Array subclass stays exact", async () => {
    class Items extends Array {}
    const value = r.externalState(new Items(1, 2)), ctx = context()
    const api = new r.ContextChain({ api: r.externalState({ object: value }) }, ctx, { api: {} })
    assert.equal(await r.lookupPath(api, ["api", "object"], ctx), value)
})
await check("mutable data snapshot precedes the next native mutation", async () => {
    const ctx = context(), object = { value: 7 }
    const api = r.externalState({ object, change() { this.object.value = 8 } })
    const chain = new r.ContextChain({ api }, ctx, { api: {} })
    const before = new r.Chain(await r.lookupPath(chain, ["api", "object"], ctx), ctx)
    await r.run(chain, ["api"], "change", [], ctx, { mutationScopeDepth: 1 })
    assert.equal(await r.lookupPath(before, ["value"], ctx), 7)
    const after = new r.Chain(await r.lookupPath(chain, ["api", "object"], ctx), ctx)
    assert.equal(await r.lookupPath(after, ["value"], ctx), 8)
})
await check("metadata queries do not turn into native value reads", async () => {
    const ctx = context()
    let reads = 0
    const api = r.externalState({ get object() { reads++; throw new Error("not selected") } })
    const chain = new r.ContextChain({ api }, ctx, { api: {} })
    assert.equal(await r.hasError(chain, ["api"], ctx), false)
    assert.equal(await r.getErrors(chain, ["api", "object"], ctx), null)
    assert.equal(reads, 0)
})
for (const shape of ["record", "array", "managed class", "managed instance"])
await check(`registration keeps ${shape} managed`, async () => {
    const ctx = context()
    const { value } = make(shape)
    const chain = new r.ContextChain({ api: r.externalState({ object: value }) }, ctx, { api: { object: {} } })
    const result = await r.lookupPath(chain, ["api", "object"], ctx)
    assert.equal(r.isPoisonError(result), false)
    assert.notEqual(result, value)
})
await check("registration cannot cross managed storage inside an external owner", async () => {
    const ctx = context()
    class Service { read() { return 7 } }
    const service = new Service()
    const chain = new r.ContextChain({
        api: r.externalState({ data: { service } }),
        service,
    }, ctx, { api: { data: { service: {} } }, service: {} })
    assert.equal(await r.run(chain, ["service"], "read", [], ctx, {}), 7)
})
console.log(JSON.stringify({
    total: results.length,
    passed: results.filter(result => result.pass).length,
    failures: results.filter(result => !result.pass),
}, null, 2))

assert.equal(results.filter(result => !result.pass).length, 0, "Stable receiving category contract failed")
