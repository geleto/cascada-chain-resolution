// A live registered identity must not retain a discarded context's siblings.
// Registration itself remains permanent. Run with --expose-gc.
import assert from "node:assert/strict"
import * as r from "../../src/index.js"

assert(global.gc, "Run with --expose-gc")
const collect = async () => {
    for (let i = 0; i < 30; i++) { await new Promise(setImmediate); global.gc() }
}
function setup(keepContext) {
    const ctx = { execution: new r.Execution(), errorContext: "initial registration" }
    const survivor = r.externalState({ read() { return 1 } })
    const sibling = r.externalState({ payload: [1, 2, 3] })
    const holder = new r.ContextChain({ survivor, sibling }, ctx, { survivor: {}, sibling: {} })
    return { ctx, survivor, holder: keepContext ? holder : undefined, weak: new WeakRef(sibling) }
}
const dropped = setup(false), live = setup(true)
function conflicted() {
    const first = setup(true)
    const sibling = r.externalState({ payload: [4, 5, 6] })
    const second = new r.ContextChain({ survivor: first.survivor, sibling }, first.ctx,
        { survivor: {}, sibling: {} })
    const error = r.getErrors(second, [], first.ctx)
    assert.equal(error.kind, r.ERROR_KIND.ExternalLocationConflict)
    return { ctx: first.ctx, survivor: first.survivor, error, refs: [first.weak, new WeakRef(sibling)] }
}
const conflictOnly = conflicted()
await collect()
assert.equal(dropped.weak.deref(), undefined, "Registry retains a dropped context's sibling")
assert(live.weak.deref(), "A live context still owns its registered siblings")
assert.equal(r.run(live.holder, ["survivor"], "read", [], live.ctx, {}), 1)
assert(conflictOnly.refs.every(ref => !ref.deref()), "Rejected import Error retains discarded context resources")

// Collection cannot turn the surviving identity back into observation-only
// state or grant it a new canonical binding in the same execution.
const alias = new r.Chain(dropped.survivor, dropped.ctx)
assert.equal(r.run(alias, [], "read", [], dropped.ctx, {}).kind, r.ERROR_KIND.ExternalLocationConflict)
const nextCtx = { execution: dropped.ctx.execution, errorContext: "competing after collection" }
const next = new r.ContextChain({ survivor: dropped.survivor }, nextCtx, { survivor: {} })
const conflict = r.getErrors(next, [], nextCtx)
assert.equal(conflict.kind, r.ERROR_KIND.ExternalLocationConflict)
assert.equal(conflict.errorContext, nextCtx.errorContext)
assert.equal(r.run(next, ["survivor"], "read", [], nextCtx, {}), conflict)
assert.equal(r.repairPath(next, ["survivor"], nextCtx), conflict)

const second = new r.ContextChain({ survivor: live.survivor }, live.ctx, { survivor: {} })
const liveConflict = r.getErrors(second, [], live.ctx)
assert.equal(r.getErrors(live.holder, [], live.ctx), null,
    "Rejected registration must preserve the original context")
assert.equal(liveConflict.kind, r.ERROR_KIND.ExternalLocationConflict)
console.log("Registration collection, live-context and rejected-registration controls passed")
