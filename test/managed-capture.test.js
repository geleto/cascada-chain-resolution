import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import * as runtime from "cascada-chain-resolution"
import { verifyRefCounts } from "./verify-refcounts.js"
import { OrderedThenable } from "./ordered-thenable.js"

describe("managed receiver capture", () => {
    it("releases discarded capture identities before pending Error collection", function () {
        this.timeout(25000)
        const result = spawnSync(process.execPath, [...process.execArgv, "--expose-gc", "--unhandled-rejections=strict",
            "test/fixtures/capture-output-identity-release.mjs"], { encoding: "utf8", timeout: 20000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    for (const managedClass of [false, true]) for (const mutation of [false, true])
    for (const inReceiver of [false, true]) for (const absent of [false, true]) {
        it(`rejects selection before output identity waits: class=${managedClass}, mutation=${mutation}, receiver=${inReceiver}, absent=${absent}`, async () => {
            const ctx = { execution: new runtime.Execution(), errorContext: "selection before assembly" }
            const source = new runtime.Chain([, 7, ,], ctx)
            const before = new runtime.Chain(runtime.lookupPath(source, [], ctx), ctx)
            const gate = Promise.withResolvers()
            const entry = runtime.enter(source, [0], ctx, true, () => gate.promise)
            runtime.run(source, [], "copyWithin", [0, 2, 3], ctx, { mutationScopeDepth: 0 })
            const pair = { a: runtime.lookupPath(before, [], ctx), b: runtime.lookupPath(source, [], ctx) }
            class Receiver {}
            if (managedClass) runtime.managedStateClass(Receiver)
            const data = managedClass ? new Receiver() : {}
            if (!absent) data.read = 17
            if (inReceiver) Object.assign(data, pair)
            const receiver = new runtime.Chain(data, ctx)
            const result = runtime.run(receiver, [], "read", inReceiver ? [] : [pair],
                ctx, mutation ? { mutationScopeDepth: 0 } : {})
            try {
                assert(!runtime.isPending(result, ctx), "Rejected selection needs no output alias partition")
                assert.equal(result.kind, absent ? runtime.ERROR_KIND.MissingFunction : runtime.ERROR_KIND.NotAFunction)
                if (mutation) assert.equal(runtime.getErrors(receiver, [], ctx), result)
                assert.equal(ctx.execution.fatalError, null)
            } finally {
                gate.resolve()
                await entry
                await result
            }
            verifyRefCounts(ctx, source._state, before._state, receiver._state)
        })
    }

    for (const array of [false, true]) {
        it(`captures each prepared descriptor once without invoking accessors: array=${array}`, () => {
            const ctx = { execution: new runtime.Execution(), errorContext: "single placement capture" }
            const reads = new Map()
            const data = array ? [1, , 3] : { first: 1, last: 3 }
            Object.defineProperty(data, array ? "1" : "accessor", {
                enumerable: true, get() { assert.fail("Graph capture must not invoke accessors") },
            })
            Object.defineProperty(data, array ? "4" : "hidden", { value: 4 })
            const source = new runtime.Chain(new Proxy(data, {
                getOwnPropertyDescriptor(target, key) {
                    reads.set(key, (reads.get(key) ?? 0) + 1)
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            }), ctx)
            reads.clear()
            const output = runtime.export(source, [], ctx)
            assert.deepEqual(output, array ? [1, , 3, , ,] : { first: 1, last: 3 })
            for (const key of array ? ["0", "1", "2", "4"] : ["first", "last", "accessor", "hidden"])
                assert.equal(reads.get(key), 1, `One descriptor read for ${key}`)
        })
    }

    for (const mutation of [false, true]) for (const lateReceiverError of [false, true]) for (const lateArgumentError of [false, true]) {
        it(`finishes failed joint preparation without argument identity: mutation=${mutation}, lateReceiverError=${lateReceiverError}, lateArgumentError=${lateArgumentError}`, async () => {
            const ctx = { execution: new runtime.Execution(), errorContext: "joint preparation" }
            const gate = Promise.withResolvers(), receiverError = Promise.withResolvers(), argumentError = Promise.withResolvers()
            const argument = new runtime.Chain(new Array(2), ctx)
            const entered = runtime.enter(argument, [0], ctx, true, () => gate.promise)
            runtime.run(argument, [], "copyWithin", [0, 1, 2], ctx, { mutationScopeDepth: 0 })
            const first = new Error("receiver"), second = new Error("argument")
            let calls = 0
            const receiver = new runtime.Chain({ bad: lateReceiverError ? receiverError.promise : runtime.createPoisonError(first, ctx, runtime.ERROR_KIND.OperationInputFailed),
                read() { calls++; return 1 } }, ctx)
            const args = [runtime.lookupPath(argument, [], ctx)]
            if (lateArgumentError) args.push(argumentError.promise)
            const result = runtime.run(receiver, [], "read", args, ctx, mutation ? { mutationScopeDepth: 0 } : {})
            let settled = false, error
            Promise.resolve(result).then(value => { settled = true; error = value })
            try {
                if (!lateReceiverError && !lateArgumentError) assert(runtime.isPoisonError(result),
                    "Complete Error capture must return synchronously")
                if (lateReceiverError || lateArgumentError) {
                    await new Promise(setImmediate)
                    assert.equal(settled, false, "Required Error collection must finish")
                }
                if (lateReceiverError) receiverError.reject(first)
                if (lateArgumentError) argumentError.reject(second)
                // Only the Error-bearing inputs settle; the argument's identity
                // stays undecided until the independent entry is released.
                for (let turn = 0; turn < 5 && !settled; turn++) await new Promise(setImmediate)
                assert.equal(settled, true, "Failed preparation must skip every identity-only wait")
                assert(runtime.isPoisonError(error))
                assert.deepEqual(new Set((error.errors ?? [error]).map(e => e.cause)),
                    new Set(lateArgumentError ? [first, second] : [first]))
                assert.equal(calls, 0)
                assert.equal(ctx.execution.fatalError, null)
            } finally {
                gate.resolve()
                await entered
                await result
            }
            verifyRefCounts(ctx, argument._state, receiver._state)
        })
    }

    it("prepares a lone argument without waiting for its identity", async () => {
        const ctx = { execution: new runtime.Execution(), errorContext: "successful joint preparation" }
        const gate = Promise.withResolvers(), argument = new runtime.Chain(new Array(2), ctx)
        const entered = runtime.enter(argument, [0], ctx, true, () => gate.promise)
        runtime.run(argument, [], "copyWithin", [0, 1, 2], ctx, { mutationScopeDepth: 0 })
        let calls = 0
        const receiver = new runtime.Chain({ read(value) { calls++; return value.length } }, ctx)
        const result = runtime.run(receiver, [], "read", [runtime.lookupPath(argument, [], ctx)], ctx, {})
        assert.equal(result, 2)
        assert.equal(calls, 1)
        gate.resolve()
        assert.equal(await result, 2)
        await entered
        assert.equal(calls, 1)
    })

    it("allocates one capture per logical node across multiple representations", () => {
        const result = spawnSync(process.execPath, [...process.execArgv, "--unhandled-rejections=strict",
            "test/fixtures/managed-capture-work.js"], { encoding: "utf8", timeout: 30000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    for (const array of [false, true]) for (const reversed of [false, true]) for (const create of [false, true]) {
        it(`joins delayed representations with captured shape: array=${array}, reversed=${reversed}, create=${create}`, async () => {
            const ctx = { execution: new runtime.Execution(), errorContext: "delayed representations" }
            const pause = Promise.withResolvers(), ready = new OrderedThenable()
            ready.resolve(1)
            const data = array ? [{ k: ready }] : { base: { k: ready } }
            const source = new runtime.Chain({ data, selected() { return this.data } }, ctx)
            const entered = runtime.enter(source, ["data", array ? 3 : "first"], ctx, true, inside =>
                pause.promise.then(() => { if (create) runtime.assignPath(inside, [], 4, ctx) }))
            if (!array) runtime.assignPath(source, ["data", "second"], 2, ctx)
            const copy = new runtime.Chain(runtime.run(source, [], "selected", [], ctx, {}), ctx)
            const pair = [runtime.lookupPath(source, ["data"], ctx), runtime.lookupPath(copy, [], ctx)]
            if (reversed) pair.reverse()
            const both = new runtime.Chain({ a: pair[0], b: pair[1], inspect() {
                return { same: this.a === this.b, keys: Object.keys(this.a),
                    length: Array.isArray(this.a) ? this.a.length : null,
                    value: (this.a.base ?? this.a[0]).k }
            } }, ctx)
            const result = new runtime.Chain(runtime.run(both, [], "inspect", [], ctx, {}), ctx)
            pause.resolve()
            await entered
            assert.deepEqual(await runtime.export(result, [], ctx), {
                same: true, keys: array ? create ? ["0", "3"] : ["0"]
                    : create ? ["base", "first", "second"] : ["base", "second"],
                length: array ? create ? 4 : 1 : null, value: 1,
            })
            verifyRefCounts(ctx, source._state, copy._state, both._state, result._state)
        })
    }

    for (const descriptor of [false, true]) for (const reversed of [false, true]) {
        it(`finishes Error collection after representation failure: descriptor=${descriptor}, reversed=${reversed}`, async () => {
            const ctx = { execution: new runtime.Execution(), errorContext: "representation failure" }
            const ready = new OrderedThenable(), pause = Promise.withResolvers()
            ready.resolve(1)
            let armed = false, calls = 0
            const cause = new Error("representation inspection"), late = new Error("late branch")
            const source = new runtime.Chain(new Proxy({ k: ready, self() { return this } }, {
                ownKeys(target) { if (armed && !descriptor) throw cause; return Reflect.ownKeys(target) },
                getOwnPropertyDescriptor(target, key) {
                    if (armed && descriptor && key === "self") throw cause
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            }), ctx)
            const copy = new runtime.Chain(runtime.run(source, [], "self", [], ctx, {}), ctx)
            const pair = [runtime.lookupPath(source, [], ctx), runtime.lookupPath(copy, [], ctx)]
            if (reversed) pair.reverse()
            const both = new runtime.Chain({ a: pair[0], b: pair[1], pending: pause.promise,
                inspect() { calls++; return this.a === this.b } }, ctx)
            armed = true
            const result = runtime.run(both, [], "inspect", [], ctx, {})
            pause.reject(late)
            const error = await result
            assert(runtime.isPoisonError(error))
            assert.equal(error.errors?.length, 2, "Both representation and late-branch Errors must be collected")
            assert.deepEqual(new Set(error.errors.map(error => error.cause)), new Set([cause, late]))
            assert.equal(calls, 0)
            assert.equal(ctx.execution.fatalError, null)
        })
    }
    for (const create of [false, true]) {
        it(`captures pending record presence and creation order, create=${create}`, async () => {
            const ctx = { execution: new runtime.Execution(), errorContext: "record shape capture" }
            const later = Promise.withResolvers()
            const chain = new runtime.Chain({ inspect() { return Object.keys(this).join(",") } }, ctx)
            const entered = runtime.enter(chain, ["first"], ctx, true, inside => later.promise.then(() => {
                if (create) runtime.assignPath(inside, [], 1, ctx)
            }))
            runtime.assignPath(chain, ["second"], 2, ctx)
            const result = runtime.run(chain, [], "inspect", [], ctx, {})
            later.resolve()
            await entered
            assert.equal(await result, create ? "inspect,first,second" : "inspect,second")
            verifyRefCounts(ctx, chain._state)
        })

        it(`captures pending Array growth and holes, create=${create}`, async () => {
            const ctx = { execution: new runtime.Execution(), errorContext: "Array shape capture" }
            const later = Promise.withResolvers()
            const chain = new runtime.Chain({ items: [1], inspect() {
                return `${this.items.length}:${Object.keys(this.items).join(",")}`
            } }, ctx)
            const entered = runtime.enter(chain, ["items", 3], ctx, true, inside => later.promise.then(() => {
                if (create) runtime.assignPath(inside, [], 4, ctx)
            }))
            const result = runtime.run(chain, [], "inspect", [], ctx, {})
            later.resolve()
            await entered
            assert.equal(await result, create ? "4:0,3" : "1:0")
            verifyRefCounts(ctx, chain._state)
        })
    }

    for (const pending of [false, true]) {
        it(`assembles aliases, cycles and sparse views from one capture, pending=${pending}`, async () => {
            const ctx = { execution: new runtime.Execution(), errorContext: "managed capture" }
            const later = Promise.withResolvers()
            let receiverLists = 0, siblingLists = 0
            const sibling = new Proxy({ n: 7 }, {
                ownKeys(target) { siblingLists++; return Reflect.ownKeys(target) },
            })
            const array = new runtime.Chain([sibling, , 3], ctx)
            const items = runtime.run(array, [], "slice", [0, 2], ctx, {})
            const receiver = new Proxy({
                items, left: sibling, right: sibling, value: pending ? later.promise : 5,
                inspect() {
                    assert.equal(this.self, this)
                    assert.equal(this.left, this.right)
                    assert.equal(this.left, this.items[0])
                    assert.equal(Array.isArray(this.items), true)
                    assert.equal(this.items.length, 2)
                    assert.equal(1 in this.items, false)
                    return { sum: this.left.n + this.value, child: this.left }
                },
            }, {
                ownKeys(target) { receiverLists++; return Reflect.ownKeys(target) },
            })
            receiver.self = receiver
            const chain = new runtime.Chain(receiver, ctx)
            receiverLists = siblingLists = 0
            const result = runtime.run(chain, [], "inspect", [], ctx, {})
            if (pending) later.resolve(5)
            const retained = new runtime.Chain(result, ctx)
            assert.equal(await runtime.lookupPath(retained, ["sum"], ctx), 12)
            assert.equal(receiverLists, 1)
            assert.equal(siblingLists, 1)
            assert.equal(await runtime.run(new runtime.Chain([sibling], ctx), [], "includes",
                [runtime.lookupPath(retained, ["child"], ctx)], ctx, {}), true)
            verifyRefCounts(ctx, chain._state, array._state)
        })
    }
})
