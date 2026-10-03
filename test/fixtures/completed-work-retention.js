import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { metaOf } from "../../src/meta.js"
import { OrderedThenable } from "../ordered-thenable.js"

const context = name => ({ execution: new r.Execution(), errorContext: name })
const collect = async () => {
    for (let index = 0; index < 20; index++) {
        await new Promise(setImmediate)
        global.gc()
    }
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
    const holder = route === "import" ? undefined : new r.Chain(source, ctx)
    const api = r.externalState({ source, get() { return this.source }, clear() { this.source = null } })
    const native = new r.ContextChain({ api }, ctx, { api: {} })
    armed = true
    const error = route === "import" ? r.import(source, ctx)
        : route === "lookup" ? r.lookupPath(native, ["api", "source"], ctx)
        : route === "native export" ? r.export(native, ["api", "source"], ctx)
        : route === "result" ? r.run(native, ["api"], "get", [], ctx, {})
        : route === "export" ? r.export(holder, [], ctx)
        : r[route](holder, [], ctx)
    assert(r.isPoisonError(error), route)
    r.run(native, ["api"], "clear", [], ctx, { mutationScopeDepth: 1 })
    if (holder) r.assignPath(holder, [], null, ctx)
    return { ctx, holder, native, error, weak: [new WeakRef(source), new WeakRef(fault)] }
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
    const nested = [signal?.promise ?? second]
    let calls = 0
    class Receiver { inspect() { calls++; return 1 } }
    if (klass) r.managedStateClass(Receiver)
    const receiver = method === "inspect"
        ? Object.assign(klass ? new Receiver() : { inspect() { calls++; return 1 } }, { child, first, nested })
        : [first, nested, child]
    const chain = new r.Chain(imported ? r.import(receiver, ctx) : receiver, ctx)
    const result = r.run(chain, [], method, comparator ? [() => { calls++; return 0 }] : [], ctx, {})
    r.assignPath(chain, [], null, ctx)
    return { ctx, chain, result, weak: [receiver, child, nested].map(value => new WeakRef(value)),
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
    const result = r.run(both, [], "inspect", [first], ctx, {})
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
    const error = r.run(chain, [], "inspect", [[new Error("first"), new Error("second")]], ctx, {})
    assert(r.isPoisonError(error))
    r.assignPath(chain, [], null, ctx)
    return { ctx, chain, error, weak: [new WeakRef(receiver), new WeakRef(child)] }
}

const cases = []
for (const route of ["import", "lookup", "native export", "result", "export", "hasError", "getErrors"])
for (const descendant of [false, true]) for (const descriptor of [false, true]) for (const fresh of [false, true]) {
    cases.push([`${route}, descendant=${descendant}, descriptor=${descriptor}, fresh=${fresh}`,
        () => reflectionCase(route, descendant, descriptor, fresh)])
}
cases.push(["entry", entryCase])
cases.push(["discarded length forks", discardedLengthForksCase])
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
const states = cases.filter(([name]) => !selected || name.startsWith(selected)).map(([name, issue]) => [name, issue()])
await collect()
const retained = states.filter(([, state]) => state.weak.some(weak => weak.deref() !== undefined)).map(([name]) => name)
for (const [, state] of states) await state.finish?.()
for (const [, state] of states) if (state.pending) {
    state.pending.resolve(0)
    assert.equal(await state.result, 0)
}
assert.deepEqual(retained, [], "Finished work must release sources while its unformatted Error stays retained")
console.log(`${states.length} completed-work retention cases passed`)
