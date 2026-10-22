import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import * as metadata from "../../src/meta.js"

// Keep diagnostic stacks lazy. Formatting either stack can hide a retained
// reflection closure. Trap closures capture only the cause, never test inputs.
function failingTrap(cause) {
    return function () { throw cause ?? new Error("fresh inspection failure") }
}

function failingProperty(cause, key) {
    return function (target, selected) {
        if (selected === key) throw cause ?? new Error("fresh property failure")
        return Reflect.getOwnPropertyDescriptor(target, selected)
    }
}

function failingGet(cause, key) {
    return function (target, selected) {
        if (selected === key) throw cause ?? new Error("fresh getter failure")
        return Reflect.get(target, selected)
    }
}

function failureState(result, values, cause, kind, ctx) {
    assert(r.isPoisonError(result))
    assert.equal(result.kind, r.ERROR_KIND[kind])
    assert.equal(result.errorContext, ctx?.errorContext)
    if (cause) assert.equal(result.cause, cause)
    if (ctx) assert.equal(ctx.execution.fatalError, null)
    return { result, ctx, weak: values.map(value => new WeakRef(value)) }
}

function declarationCase(route, cause) {
    let result, values
    if (route === "class getter") {
        function Candidate() {}
        const source = new Proxy(Candidate, { get: failingGet(cause, "prototype") })
        values = [Candidate, source, Candidate.prototype]
        result = r.managedStateClass(source)
    } else if (route === "class prototype") {
        function Candidate() {}
        Candidate.prototype = new Proxy(Candidate.prototype,
            { getOwnPropertyDescriptor: failingProperty(cause, "then") })
        values = [Candidate, Candidate.prototype]
        result = r.managedStateClass(Candidate)
    } else if (route === "managed graph") {
        class Candidate {}
        const sibling = new Candidate()
        const child = new Proxy({}, { ownKeys: failingTrap(cause) })
        const source = { sibling, child }
        values = [source, sibling, child, Candidate.prototype]
        result = r.managedState(source)
        assert.equal(metadata.identityDeclarationOf(sibling), undefined)
    } else {
        const source = new Proxy({}, { get: failingGet(cause, "then") })
        values = [source]
        result = r[route](source)
    }
    return failureState(result, values, cause, "DeclarationReflectionFailed")
}

function classificationCase(route, cause) {
    const ctx = { execution: new r.Execution(), errorContext: route }
    const constructor = new Proxy(function Candidate() {},
        { getOwnPropertyDescriptor: failingProperty(cause, "prototype") })
    const prototype = route === "constructor" ? Object.assign(Object.create(null), { constructor })
        : new Proxy({}, { getPrototypeOf: failingTrap(cause) })
    const source = Object.create(prototype)
    const result = r.import(source, ctx)
    assert.equal(metadata.metaOf(source, ctx), undefined)
    return failureState(result, [source, prototype, constructor], cause, "ImportReflectionFailed", ctx)
}

function discoveryCase(route, cause) {
    const ctx = { execution: new r.Execution(), errorContext: route }
    const child = new Proxy({}, route === "availability descriptor"
        ? { getOwnPropertyDescriptor: failingProperty(cause, "then") }
        : route === "availability prototype" ? { getPrototypeOf: failingTrap(cause) } : {})
    const host = r.externalState(route === "native property"
        ? new Proxy({ child }, { getOwnPropertyDescriptor: failingProperty(cause, "child") }) : { child })
    const sibling = { value: 1 }, root = { sibling, host }
    const chain = new r.ContextChain(root, ctx, { host: { child: {} } })
    const result = r.lookupPath(chain, [], ctx)
    for (const value of [root, sibling, host, child]) assert.equal(metadata.metaOf(value, ctx), undefined)
    assert.equal(ctx.execution._externalIdentities.has(host), false)
    return failureState(result, [root, sibling, host, child], cause, "ImportReflectionFailed", ctx)
}

function snapshotDescriptor(target, key) {
    if (this.armed && this.route === "descriptor" && key === "then")
        throw this.cause ?? new Error("fresh snapshot descriptor failure")
    return Reflect.getOwnPropertyDescriptor(target, key)
}

function snapshotPrototype(target) {
    if (this.armed && ++this.count === 3 && this.route === "ascent")
        throw this.cause ?? new Error("fresh snapshot ascent failure")
    return Reflect.getPrototypeOf(target)
}

function snapshotCase(route, cause) {
    const ctx = { execution: new r.Execution(), errorContext: route }
    const handler = { route, cause, armed: false, count: 0,
        getOwnPropertyDescriptor: snapshotDescriptor, getPrototypeOf: snapshotPrototype }
    const prototype = new Proxy({}, handler), source = Object.create(prototype)
    assert.equal(r.managedState(source), source)
    const host = r.externalState({ value: source })
    const chain = new r.ContextChain({ host }, ctx, { host: {} })
    handler.armed = route !== "healthy"
    const result = r.lookupPath(chain, ["host", "value"], ctx)
    r.assignPath(chain, ["host", "value"], null, ctx)
    if (route !== "healthy")
        return failureState(result, [source, prototype], cause, "ExternalPropertyReadFailed", ctx)
    assert(!r.isPoisonError(result))
    return { ctx, result, weak: [new WeakRef(source)], retained: new WeakRef(prototype) }
}

function declarationControl() {
    const source = { value: 1 }
    return { result: r.externalState(source), weak: [], retained: new WeakRef(source) }
}

const cases = []
for (const fresh of [false, true]) {
    const cause = fresh ? undefined : new Error("prebuilt inspection failure")
    for (const route of ["externalState", "managedState", "class getter", "class prototype", "managed graph"])
        cases.push([`declaration ${route}, fresh=${fresh}`, declarationCase(route, cause)])
    for (const route of ["prototype", "constructor"])
        cases.push([`classification ${route}, fresh=${fresh}`, classificationCase(route, cause)])
    for (const route of ["native property", "availability descriptor", "availability prototype"])
        cases.push([`discovery ${route}, fresh=${fresh}`, discoveryCase(route, cause)])
    for (const route of ["descriptor", "ascent"])
        cases.push([`snapshot ${route}, fresh=${fresh}`, snapshotCase(route, cause)])
}
cases.push(["healthy snapshot", snapshotCase("healthy")], ["healthy declaration", declarationControl()])
for (let turn = 0; turn < 25; turn++) {
    await new Promise(setImmediate)
    global.gc()
}
const retained = cases.filter(([, state]) => state.weak.some(ref => ref.deref()))
assert.deepEqual(retained.map(([name]) => name), [], "Lazy diagnostics must release abandoned inputs")
for (const [, state] of cases) if (state.retained) assert(state.retained.deref(), "Healthy results remain live")
console.log(`${cases.length} inspection-failure retention cases passed`)
