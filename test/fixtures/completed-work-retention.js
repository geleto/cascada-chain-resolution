import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { metaOf } from "../../src/meta.js"
import { rejected, OrderedThenable } from "../ordered-thenable.js"

const context = name => ({ execution: new r.Execution(), errorContext: name })
const collect = async () => {
    for (let index = 0; index < 20; index++) {
        await new Promise(setImmediate)
        global.gc()
    }
}

function terminalSearchCase(method, availability, matched) {
    const ctx = context("terminal search"), pending = Promise.withResolvers()
    let candidate, needle, entry
    if (availability === "identity") {
        const source = new r.Chain({ k: 1 }, ctx)
        const before = new r.Chain(r.lookupPath(source, [], ctx), ctx)
        entry = r.enter(source, ["absent"], ctx, true, inside => pending.promise.then(() => {
            if (!matched) r.assignPath(inside, [], 1, ctx)
        }))
        candidate = r.lookupPath(source, [], ctx)
        needle = r.lookupPath(before, [], ctx)
    } else {
        candidate = pending.promise
        needle = 7
    }
    const consumed = { data: new Array(10000).fill(42) }
    const array = method === "lastIndexOf" ? [candidate, consumed] : [consumed, candidate]
    const source = new r.Chain(array, ctx)
    const result = r.run(source, [], method, [needle], ctx, {})
    r.assignPath(source, [], null, ctx)
    return { ctx, source, result, weak: [new WeakRef(array), new WeakRef(consumed)],
        async finish() {
            pending.resolve(matched ? 7 : 8)
            await entry
            assert.equal(await result, method === "includes" ? matched : !matched ? -1 : method === "indexOf" ? 1 : 0)
        },
    }
}

async function unfinishedSearchControl(method) {
    function issue() {
        const ctx = context("unfinished search"), pending = Promise.withResolvers()
        const array = method === "indexOf" ? [pending.promise, 7] : [7, pending.promise]
        const source = new r.Chain(array, ctx)
        const result = r.run(source, [], method, [7], ctx, {})
        r.assignPath(source, [], null, ctx)
        return { ctx, source, pending, result, weak: new WeakRef(array) }
    }
    const state = issue()
    await collect()
    assert(state.weak.deref(), "An unresolved earlier candidate must preserve later candidates")
    state.pending.resolve(8)
    assert.equal(await state.result, method === "indexOf" ? 1 : 0)
}

function reflectionCase(route, descendant, descriptor, fresh) {
    const ctx = context(route), cause = new Error("prebuilt reflection failure")
    let armed = route === "import"
    const traps = {
        ownKeys(target) {
            if (armed && !descriptor) throw fresh ? new Error("fresh listing failure") : cause
            return Reflect.ownKeys(target)
        },
        getOwnPropertyDescriptor(target, key) {
            if (armed && descriptor && key === "k") throw fresh ? new Error("fresh descriptor failure") : cause
            return Reflect.getOwnPropertyDescriptor(target, key)
        },
    }
    const fault = new Proxy({ k: 1 }, traps)
    const source = descendant ? { child: fault, healthy: { k: 2 } } : fault
    const holder = route === "import" || route === "result" ? undefined : new r.Chain(source, ctx)
    const api = r.externalState({ source, get() { return this.source }, clear() { this.source = null } })
    const native = new r.ContextChain({ api }, ctx, { api: {} })
    armed = true
    let error = route === "import" ? r.import(source, ctx)
        : route === "lookup" ? r.lookupPath(native, ["api", "source"], ctx)
        : route === "native export" ? r.export(native, ["api", "source"], ctx)
        : route === "result" ? r.run(native, ["api"], "get", [], ctx, {})
        : route === "export" ? r.export(holder, [], ctx)
        : r[route](holder, [], ctx)
    if (route === "import" || route === "result") error = r.getErrors(new r.Chain(error, ctx), [], ctx)
    if (route === "hasError") assert.equal(error, true)
    else assert(r.isPoisonError(error), route)
    r.run(native, ["api"], "clear", [], ctx, { mutationScopeDepth: 1 })
    if (holder) r.assignPath(holder, [], null, ctx)
    return { ctx, holder, native, error, weak: [new WeakRef(source), new WeakRef(fault)] }
}

function completedFailureHistoryCase(pending) {
    const ctx = context("completed failure history"), weak = []
    const unreadable = () => new Proxy({}, { ownKeys() { throw new Error("unreadable input") } })
    const first = unreadable(), second = unreadable()
    const chain = new r.Chain(r.import({ first, second: pending ? Promise.resolve(second) : second }, ctx), ctx)
    const error = r.lookupPath(chain, ["first"], ctx)
    const later = r.lookupPath(chain, ["second"], ctx)
    if (pending) later.then(value => weak.push(new WeakRef(value)))
    else weak.push(new WeakRef(later))
    r.assignPath(chain, [], null, ctx)
    // A live host key must not retain another failure through a completed history.
    return { ctx, chain, error, second, weak, finish() { assert.equal(weak.length, 1) } }
}

function externalQuerySourceCase(query) {
    const ctx = context("external query source"), pending = Promise.withResolvers()
    const data = { value: pending.promise }
    const api = r.externalState({ data })
    const chain = new r.Chain(api, ctx)
    const result = r[query](chain, ["data"], ctx)
    return { ctx, result, weak: [api, chain, data].map(value => new WeakRef(value)), async finish() {
        pending.resolve(0)
        assert.equal(await result, query === "hasError" ? false : null)
    } }
}

function failedPreparationHistoryCase(trap) {
    const ctx = context("failed preparation history"), pending = Promise.withResolvers()
    const failed = new Proxy({}, { [trap]() { throw new Error("unreadable input") } })
    const source = { failed, later: pending.promise }
    const chain = new r.Chain(r.import(source, ctx), ctx)
    const error = r.lookupPath(chain, ["failed"], ctx)
    assert(r.isPoisonError(error))
    const result = r.lookupPath(chain, ["later"], ctx)
    r.assignPath(chain, [], null, ctx)
    return { ctx, chain, error, result, pending, weak: [new WeakRef(source), new WeakRef(failed)] }
}

function entryCase() {
    const ctx = context("entry"), pending = Promise.withResolvers()
    const old = { unused: { payload: 1 } }, chain = new r.Chain({ branch: old }, ctx)
    const result = r.enter(chain, ["branch"], ctx, true, inside => {
        r.assignPath(inside, [], { replacement: 2 }, ctx)
        return pending.promise
    })
    return { ctx, chain, result, pending, weak: [new WeakRef(old)] }
}

function mutationCase(array, nested, action) {
    const ctx = context("mutation")
    const old = array ? [1, { payload: 1 }] : { n: 1, unrelated: { payload: 1 } }
    const chain = new r.Chain(nested ? { branch: old } : old, ctx)
    const prefix = nested ? ["branch"] : [], path = [...prefix, array ? 0 : "n"]
    const error = action === "run" ? r.run(chain, path, "missing", [], ctx, { mutationScopeDepth: prefix.length })
        : action === "length" ? r.assignPath(chain, [...prefix, "length"], -1, ctx, prefix.length)
        : action === "assign" ? r.assignPath(chain, [...path, "missing"], 1, ctx, prefix.length)
        : r.deletePath(chain, [...path, "missing"], ctx, prefix.length)
    assert(r.isPoisonError(error))
    r.repairPath(chain, prefix, ctx)
    r.assignPath(chain, prefix, { replacement: 2 }, ctx)
    return { ctx, chain, error, weak: [new WeakRef(old)] }
}

function invocationCase(method, pending, comparator, imported, klass) {
    const ctx = context("invocation"), signal = pending ? Promise.withResolvers() : undefined
    const first = new Error("first"), second = new Error("second"), child = { unrelated: 1 }
    const nested = [signal?.promise ?? rejected(second)]
    let calls = 0
    class Receiver { inspect() { calls++; return 1 } }
    if (klass) r.managedStateClass(Receiver)
    const receiver = method === "inspect"
        ? Object.assign(klass ? new Receiver() : { inspect() { calls++; return 1 } }, { child, first: rejected(first), nested })
        : [rejected(first), nested, child]
    const chain = new r.Chain(imported ? r.import(receiver, ctx) : receiver, ctx)
    const result = r.run(chain, [], method, comparator ? [() => { calls++; return 0 }] : [], ctx, {})
    r.assignPath(chain, [], null, ctx)
    const refs = [receiver, child, nested].map(value => new WeakRef(value))
    return { ctx, chain, result, weak: refs,
        async finish() {
            signal?.reject(second)
            const error = await result
            assert(error.errors.some(leaf => leaf.cause === first))
            assert(error.errors.some(leaf => leaf.cause === second))
            assert.equal(calls, 0)
        },
    }
}

function materializedIdentityCase(klass, imported) {
    const ctx = context("materialized identity"), ready = new OrderedThenable()
    ready.resolve(1)
    class Receiver { self() { return this } }
    if (klass) r.managedStateClass(Receiver)
    const original = Object.assign(klass ? new Receiver() : { self: Receiver.prototype.self }, { child: { k: ready } })
    original.child.parent = original
    const source = new r.Chain(imported ? r.import(original, ctx) : original, ctx)
    const result = new r.Chain(r.run(source, [], "self", [], ctx, {}), ctx)
    r.assignPath(source, [], null, ctx)
    return { ctx, source, result, weak: [new WeakRef(original), new WeakRef(original.child)],
        async finish() {
            const output = await r.export(result, [], ctx)
            assert.equal(output.child.k, 1)
            assert.equal(output.child.parent, output)
        },
    }
}

function failedRepresentationCaptureCase(reversed) {
    const ctx = context("failed representation capture"), ready = new OrderedThenable(), pending = Promise.withResolvers()
    ready.resolve(1)
    const original = new r.Chain({ child: { k: ready }, self() { return this } }, ctx)
    const copy = new r.Chain(r.run(original, [], "self", [], ctx, {}), ctx)
    const pair = [r.lookupPath(original, [], ctx), r.lookupPath(copy, [], ctx)]
    if (reversed) pair.reverse()
    const receiver = { a: pair[0], b: pair[1], pending: pending.promise,
        inspect() { throw new Error("Must not invoke") } }
    const both = new r.Chain(receiver, ctx), first = new Error("first"), second = new Error("second")
    const result = r.run(both, [], "inspect", [rejected(first)], ctx, {})
    for (const chain of [original, copy, both]) r.assignPath(chain, [], null, ctx)
    return { ctx, original, copy, both, result, weak: [receiver, ...pair].map(value => new WeakRef(value)),
        async finish() {
            pending.reject(second)
            const error = await result
            assert.deepEqual(new Set(error.errors.map(error => error.cause)), new Set([first, second]))
        },
    }
}

function discardedLengthForksCase() {
    const ctx = context("discarded length forks"), pause = Promise.withResolvers()
    const source = new r.Chain([0], ctx), weak = []
    const entry = r.enter(source, [3], ctx, true, () => pause.promise)
    for (let index = 0; index < 40; index++) {
        const fork = new r.Chain(r.lookupPath(source, [], ctx), ctx)
        r.assignPath(fork, [0], index, ctx)
        const copy = r.lookupPath(fork, [], ctx)
        weak.push(new WeakRef(copy), new WeakRef(metaOf(copy, ctx).arrayRange.lengthState))
        r.assignPath(fork, [], null, ctx)
    }
    return { ctx, source, entry, weak, async finish() {
        pause.resolve()
        await entry
        assert.deepEqual(await r.export(source, [], ctx), [0])
    } }
}

function managedArgumentCase(klass, imported) {
    const ctx = context("managed argument")
    class Receiver { inspect() { throw new Error("Must not invoke") } }
    if (klass) r.managedStateClass(Receiver)
    const child = { unrelated: 1 }, receiver = Object.assign(klass ? new Receiver() : { inspect: Receiver.prototype.inspect }, { child })
    const chain = new r.Chain(imported ? r.import(receiver, ctx) : receiver, ctx)
    const error = r.run(chain, [], "inspect", [[rejected(new Error("first")), rejected(new Error("second"))]], ctx, {})
    assert(r.isPoisonError(error))
    r.assignPath(chain, [], null, ctx)
    return { ctx, chain, error, weak: [new WeakRef(receiver), new WeakRef(child)] }
}

function issueJointArgument(chain, ctx, nested) {
    const marker = () => 123
    return { result: r.run(chain, [], "inspect", [nested ? { marker } : marker], ctx, {}),
        weak: [new WeakRef(marker)] }
}

function jointPreparationCase(nested, deferredError) {
    const ctx = context("joint preparation"), first = new Error("first"), second = new Error("second")
    const early = Promise.withResolvers(), late = Promise.withResolvers()
    let calls = 0
    const chain = new r.Chain({ first: deferredError ? early.promise : rejected(first), late: late.promise,
        inspect() { calls++; return 1 } }, ctx)
    const state = issueJointArgument(chain, ctx, nested)
    assert(state.result instanceof Promise)
    if (deferredError) early.reject(first)
    return { ctx, chain, ...state, async finish() {
        assert.equal(calls, 0)
        late.reject(second)
        const error = await state.result
        assert.deepEqual(new Set(error.errors.map(leaf => leaf.cause)), new Set([first, second]))
        assert.equal(calls, 0)
    } }
}

async function jointPreparationSuccessControl(nested) {
    const ctx = context("successful joint preparation"), pending = Promise.withResolvers()
    const chain = new r.Chain({ ready: pending.promise,
        inspect(value) { return (nested ? value.marker : value)() } }, ctx)
    const state = issueJointArgument(chain, ctx, nested)
    await collect()
    assert(state.weak[0].deref(), "Successful preparation must retain arguments until invocation")
    pending.resolve(1)
    assert.equal(await state.result, 123)
    await collect()
    assert.equal(state.weak[0].deref(), undefined, "Completed invocation must release its arguments")
}

function receiverCaptureCase(waitAt, klass, imported) {
    const ctx = context("receiver source capture"), pending = Promise.withResolvers()
    class Receiver {
        inspect() { return this.child.n + this.value }
        later(wait) { return wait().then(() => this.inspect()) }
    }
    if (klass) r.managedStateClass(Receiver)
    const source = Object.assign(klass ? new Receiver() : {
        inspect: Receiver.prototype.inspect, later: Receiver.prototype.later,
    }, { child: { n: 3 }, value: waitAt === "receiver" ? pending.promise : 4 })
    const chain = new r.Chain(imported ? r.import(source, ctx) : source, ctx)
    const result = r.run(chain, [], waitAt === "result" ? "later" : "inspect",
        waitAt === "argument" ? [pending.promise] : waitAt === "result" ? [() => pending.promise] : [], ctx, {})
    r.assignPath(chain, [], null, ctx)
    return { ctx, result, weak: [source, source.child, chain, chain._state].map(value => new WeakRef(value)), async finish() {
        pending.resolve(4)
        assert.equal(await result, 7, "Pending work uses captured state after the sources are collected")
    } }
}

function sourceOwnerCase(route) {
    const ctx = context("source owner"), pending = Promise.withResolvers()
    const chain = new r.Chain(route === "pop" ? [pending.promise] : { branch: { value: pending.promise } }, ctx)
    const result = route === "pop" ? r.run(chain, [], "pop", [], ctx, { mutationScopeDepth: 0 })
        : route === "lookup" ? r.lookupPath(chain, ["branch", "value"], ctx)
        : r[route](chain, ["branch"], ctx)
    r.assignPath(chain, [], null, ctx)
    return { ctx, result, weak: [new WeakRef(chain), new WeakRef(chain._state)], async finish() {
        pending.resolve(4)
        assert.deepEqual(await result, route === "export" ? { value: 4 }
            : route === "hasError" ? false : route === "getErrors" ? null : 4)
    } }
}

const cases = []
for (const pending of [false, true])
    cases.push([`completed failure history, pending=${pending}`, () => completedFailureHistoryCase(pending)])
for (const query of ["hasError", "getErrors"])
    cases.push([`external query source, ${query}`, () => externalQuerySourceCase(query)])
for (const trap of ["getPrototypeOf", "ownKeys"])
    cases.push([`failed preparation history, ${trap}`, () => failedPreparationHistoryCase(trap)])
for (const route of ["lookup", "export", "hasError", "getErrors", "pop"])
    cases.push([`source owner, route=${route}`, () => sourceOwnerCase(route)])
for (const waitAt of ["receiver", "argument", "result"])
for (const klass of [false, true]) for (const imported of [false, true])
    cases.push([`receiver capture, wait=${waitAt}, class=${klass}, imported=${imported}`,
        () => receiverCaptureCase(waitAt, klass, imported)])
for (const route of ["import", "lookup", "native export", "result", "export", "hasError", "getErrors"])
for (const descendant of [false, true]) for (const descriptor of [false, true]) for (const fresh of [false, true]) {
    cases.push([`${route}, descendant=${descendant}, descriptor=${descriptor}, fresh=${fresh}`,
        () => reflectionCase(route, descendant, descriptor, fresh)])
}
cases.push(["entry", entryCase])
cases.push(["discarded length forks", discardedLengthForksCase])
for (const nested of [false, true]) for (const deferredError of [false, true])
    cases.push([`joint preparation, nested=${nested}, deferredError=${deferredError}`,
        () => jointPreparationCase(nested, deferredError)])
for (const reversed of [false, true])
    cases.push([`failed representation capture, reversed=${reversed}`, () => failedRepresentationCaptureCase(reversed)])
for (const array of [false, true]) for (const nested of [false, true])
for (const action of array ? ["run", "assign", "delete", "length"] : ["run", "assign", "delete"])
    cases.push([`mutation ${action}, array=${array}, nested=${nested}`, () => mutationCase(array, nested, action)])
for (const method of ["sort", "toSorted"]) for (const pending of [false, true]) for (const comparator of [false, true])
    cases.push([`invocation ${method}, pending=${pending}, comparator=${comparator}`, () => invocationCase(method, pending, comparator)])
for (const imported of [false, true]) for (const klass of [false, true]) {
    cases.push([`materialized identity, imported=${imported}, class=${klass}`, () => materializedIdentityCase(klass, imported)])
    for (const pending of [false, true])
        cases.push([`invocation managed, pending=${pending}, imported=${imported}, class=${klass}`, () => invocationCase("inspect", pending, false, imported, klass)])
    cases.push([`invocation argument, imported=${imported}, class=${klass}`, () => managedArgumentCase(klass, imported)])
}

const selected = process.argv[2]
for (const method of ["includes", "indexOf", "lastIndexOf"])
for (const availability of ["value", "identity"]) for (const matched of [false, true])
    cases.push([`terminal search, method=${method}, availability=${availability}, matched=${matched}`,
        () => terminalSearchCase(method, availability, matched)])
const states = cases.filter(([name]) => !selected || name.startsWith(selected)).map(([name, issue]) => [name, issue()])
await collect()
const retained = states.filter(([, state]) => state.weak.some(weak => weak.deref() !== undefined)).map(([name]) => name)
for (const [, state] of states) await state.finish?.()
for (const [, state] of states) if (state.pending) {
    state.pending.resolve(0)
    assert.equal(await state.result, 0)
}
assert.deepEqual(retained, [], "Spent source references must be released while results stay retained")
if (!selected || "joint preparation".startsWith(selected))
    for (const nested of [false, true]) await jointPreparationSuccessControl(nested)
if (!selected || "terminal search".startsWith(selected))
    for (const method of ["indexOf", "lastIndexOf"]) await unfinishedSearchControl(method)
console.log(`${states.length} completed-work retention cases passed`)
