import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { ready, OrderedThenable } from "../ordered-thenable.js"

// Every input settles. Use actual poison, not ordinary Error-valued data.
let cases = 0
for (const method of [false, true]) for (const array of [false, true])
for (const timing of ["ready", "sync", "native", "ordered"])
for (const descriptorFailure of [false, true]) {
    const ctx = { execution: new r.Execution(), errorContext: "import" }
    const reflect = new Error("unreadable")
    const firstCause = new Error("first"), lastCause = new Error("last")
    const first = r.createPoisonError(firstCause, ctx, r.ERROR_KIND.OperationInputFailed)
    const last = r.createPoisonError(lastCause, ctx, r.ERROR_KIND.OperationInputFailed)
    const tail = Promise.withResolvers()
    const target = array ? [first, 0, tail.promise, 3] :
        { first, bad: 0, last: tail.promise, safe: 3 }
    const key = array ? "1" : "bad"
    let failedReads = 0
    const child = new Proxy(target, descriptorFailure ? {
        getOwnPropertyDescriptor(target, name) {
            if (name === key) { failedReads++; throw reflect }
            return Reflect.getOwnPropertyDescriptor(target, name)
        },
    } : { ownKeys() { throw reflect } })
    if (!array) target.self = child
    const pending = timing === "ordered" ? new OrderedThenable() : Promise.withResolvers()
    const delivered = timing === "ready" ? child : timing === "sync" ? ready(child) :
        timing === "ordered" ? pending : pending.promise
    const root = { safe: 1, child: delivered, alias: delivered }
    root.self = root
    const chain = new r.Chain((method ? r.importMethodResult : r.import)(root, ctx), ctx)
    pending.resolve(child)
    assert.equal(await r.lookupPath(chain, ["safe"], ctx), 1)
    const collection = r.getErrors(chain, [], ctx)
    if (descriptorFailure) assert(r.isPending(collection, ctx))
    assert.equal(await r.hasError(chain, [], ctx), true)
    tail.resolve(last)
    const initial = await collection
    const causeSet = async path => {
        const error = await r.getErrors(chain, path, ctx)
        return new Set((error?.errors ?? (error ? [error] : [])).map(error => error.cause))
    }
    const expected = new Set(descriptorFailure ? [firstCause, reflect, lastCause] : [reflect])
    assert.deepEqual(new Set((initial.errors ?? [initial]).map(error => error.cause)), expected)
    assert.deepEqual(await causeSet([]), expected)
    assert.deepEqual(await causeSet(["child"]), expected)
    if (descriptorFailure) {
        assert.equal(await r.lookupPath(chain, ["child", array ? 3 : "safe"], ctx), 3)
        assert.equal(await r.lookupPath(chain, ["child", array ? 0 : "first"], ctx), first)
        assert.equal(await r.lookupPath(chain, ["child", array ? 2 : "last"], ctx), last)
        await r.assignPath(chain, ["child", array ? 3 : "safe"], 4, ctx)
        assert.equal(await r.lookupPath(chain, ["child", array ? 3 : "safe"], ctx), 4)
        assert.equal(await r.lookupPath(chain, ["alias", array ? 3 : "safe"], ctx), 3)
        assert.deepEqual(await causeSet(["child"]), expected)
        assert.equal(failedReads, 1, "An installed poison overlay must prevent reinspection")
    }
    assert.equal(ctx.execution.fatalError, null)
    cases++
}
console.log(JSON.stringify({ cases }))
