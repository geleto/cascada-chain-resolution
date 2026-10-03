import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import * as runtime from "cascada-chain-resolution"
import { verifyRefCounts } from "./verify-refcounts.js"
import { OrderedThenable } from "./ordered-thenable.js"

describe("managed receiver capture", () => {
    it("allocates one capture per logical node across multiple representations", () => {
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
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
                    assert.equal(this.left, sibling, "An unchanged observation child keeps its identity")
                    assert.equal(Array.isArray(this.items), true)
                    assert.equal(this.items.length, 2)
                    assert.equal(1 in this.items, false)
                    return this.left.n + this.value
                },
            }, {
                ownKeys(target) { receiverLists++; return Reflect.ownKeys(target) },
            })
            receiver.self = receiver
            const chain = new runtime.Chain(receiver, ctx)
            receiverLists = siblingLists = 0
            const result = runtime.run(chain, [], "inspect", [], ctx, {})
            if (pending) later.resolve(5)
            assert.equal(await result, 12)
            assert.equal(receiverLists, 1)
            assert.equal(siblingLists, 1)
            verifyRefCounts(ctx, chain._state, array._state)
        })
    }
})
