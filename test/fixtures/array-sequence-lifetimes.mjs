import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { ArrayView } from "../../src/array-view.js"
import { OperationOwner } from "../../src/operation-lifecycle.js"

const tick = () => new Promise(setImmediate)
const mutate = { mutationScopeDepth: 0 }
async function collect() {
    for (let i = 0; i < 6; i++) { await tick(); global.gc() }
}

// Exit the issuing frame before collecting. The only host references to the
// child are the requested historical result and the weak observer.
function issue(method, projection, keep, ctx, width, slow) {
    const wrap = v => new r.Chain(v, ctx), root = wrap(["A", "B", "C"])
    const owner = wrap({ value: 7 }), child = r.lookupPath(owner, [], ctx), ref = new WeakRef(child)
    const model = ["A", "C"]
    r.run(root, [], "splice", [1, width.promise], ctx, mutate)
    let output = root, endpointLength
    if (method === "push" || method === "unshift") {
        endpointLength = r.run(root, [], method, [slow.promise, child], ctx, mutate)
        model[method]("slow", 7)
    } else if (method === "concat") {
        output = wrap(r.run(root, [], "concat", [[slow.promise, child]], ctx, {}))
        model.push("slow", 7)
    } else {
        const result = r.run(root, [], method, [0, 0, slow.promise, child], ctx, method === "splice" ? mutate : {})
        if (method === "toSpliced") output = wrap(result)
        model.unshift("slow", 7)
    }
    const original = output
    if (projection === "reverse") { output = wrap(r.run(output, [], "toReversed", [], ctx, {})); model.reverse() }
    if (projection === "slice") { output = wrap(r.run(output, [], "slice", [0, -1], ctx, {})); model.pop() }
    if (projection === "suffix") { output = wrap(r.run(output, [], "slice", [3], ctx, {})); model.splice(0, 3) }
    if (projection === "with") { output = wrap(r.run(output, [], "with", [0, "new"], ctx, {})); model[0] = "new" }
    const length = keep !== "discard" && (projection === "none" && endpointLength !== undefined ?
        endpointLength : r.lookupPath(output, ["length"], ctx))
    const saved = keep === "view" ? r.capturePath(output, [], ctx) :
        keep === "point" ? wrap(r.lookupPath(output, [model.indexOf(7)], ctx)) : undefined
    for (const holder of new Set([owner, root, original, output])) r.assignPath(holder, [], undefined, ctx)
    return { ref, saved, length, model }
}

async function history(method, projection, keep) {
    const ctx = { execution: new r.Execution(), errorContext: method }, width = Promise.withResolvers(), slow = Promise.withResolvers()
    const state = issue(method, projection, keep, ctx, width, slow)
    await collect()
    assert.equal(Boolean(state.ref.deref()), keep === "point" || keep === "view", [method, projection, keep].join("/"))
    width.resolve(1)
    if (keep !== "discard") assert.equal(await state.length, state.model.length)
    if (keep === "point") assert.equal(await r.lookupPath(state.saved, ["value"], ctx), 7)
    slow.resolve("slow")
    if (keep === "view") {
        const out = await r.export(state.saved, [], ctx)
        assert.deepEqual(out.map(x => x?.value ?? x), state.model)
        r.assignPath(state.saved, [], undefined, ctx)
    }
    state.saved = undefined
    assert.equal(ctx.execution.fatalError, null)
}

for (const method of ["push", "unshift", "splice", "toSpliced", "concat"]) {
    for (const projection of ["none", "slice", "reverse", "with"]) await history(method, projection, "length")
    for (const keep of ["point", "view"]) await history(method, "none", keep)
}
await history("push", "none", "discard")
// Index three crosses from the uncertain original width into the fixed
// tail. The answer to that crop's length question never needs the child.
for (const method of ["push", "concat"])
    for (const keep of ["length", "point", "view"]) await history(method, "suffix", keep)

// The unresolved slice bound owns its numeric question. Only the retained
// slice owns the candidate data, even if the number remains pending.
async function pendingSliceBound(mode, hold, open) {
    const ctx = { execution: new r.Execution(), errorContext: "slice bound" }
    const end = Promise.withResolvers(), width = Promise.withResolvers()
    const wrap = value => new r.Chain(value, ctx, mode)
    function issue() {
        const owner = wrap({ n: 0 })
        r.assignPath(owner, ["n"], 1, ctx)
        const child = r.lookupPath(owner, [], ctx), source = wrap([child, "tail"])
        if (open) r.run(source, [], "splice", [1, width.promise], ctx, mutate)
        const result = wrap(r.run(source, [], "slice", [0, end.promise], ctx, {}))
        const length = r.lookupPath(result, ["length"], ctx)
        r.assignPath(source, [], undefined, ctx)
        if (hold) {
            r.assignPath(owner, ["n"], 9, ctx)
            assert.equal(r.lookupPath(owner, ["n"], ctx), 9)
        }
        r.assignPath(owner, [], undefined, ctx)
        if (!hold) r.assignPath(result, [], undefined, ctx)
        return { length, result, child: new WeakRef(child) }
    }
    const state = issue()
    await collect()
    assert.equal(Boolean(state.child.deref()), hold, ["slice bound data", mode, hold, open].join("/"))
    end.resolve(1)
    assert.equal(await state.length, 1)
    if (hold) {
        assert.deepEqual(await r.export(state.result, [], ctx), [{ n: 1 }])
        r.assignPath(state.result, [], undefined, ctx)
    }
    await collect()
    assert.equal(state.child.deref(), undefined)
    width.resolve(1)
}
for (const mode of [r.CHAIN_MODE.Unordered, r.CHAIN_MODE.Sequential])
    for (const hold of [false, true]) for (const open of [false, true]) await pendingSliceBound(mode, hold, open)

// A pending Complete result can still be handed to a new Chain after all
// existing holders are cleared. Its selected candidate keeps its old value.
async function completeSliceResult() {
    const ctx = { execution: new r.Execution(), errorContext: "Complete slice return" }
    const start = Promise.withResolvers(), end = Promise.withResolvers()
    const wrap = value => new r.Chain(value, ctx, r.CHAIN_MODE.Complete)
    function issue() {
        const owner = wrap({ n: 0 })
        r.assignPath(owner, ["n"], 1, ctx)
        const child = r.lookupPath(owner, [], ctx), source = wrap([child])
        const raw = r.run(source, [], "slice", [start.promise, end.promise], ctx, {})
        const holder = wrap(raw), length = r.lookupPath(holder, ["length"], ctx)
        for (const chain of [source, holder]) r.assignPath(chain, [], undefined, ctx)
        r.assignPath(owner, ["n"], 9, ctx)
        assert.equal(r.lookupPath(owner, ["n"], ctx), 9)
        r.assignPath(owner, [], undefined, ctx)
        return { raw, length, ref: new WeakRef(child) }
    }
    const state = issue()
    await collect()
    assert(state.ref.deref())
    start.resolve(0)
    end.resolve(1)
    assert.equal(await state.length, 1)
    const historical = wrap(await state.raw)
    assert.equal(r.lookupPath(historical, [0], ctx), state.ref.deref())
    assert.deepEqual(await r.export(historical, [], ctx), [{ n: 1 }])
}
await completeSliceResult()

// Either delivered bound can eliminate data while the other stays open.
// The remaining child must still survive mutation through its other owner.
function narrowSlice(mode, first, at) {
    const ctx = { execution: new r.Execution(), errorContext: "slice first bound" }
    const wrap = value => new r.Chain(value, ctx, mode)
    const children = [{ n: 0 }, { n: 1 }], refs = children.map(child => new WeakRef(child))
    const source = wrap(children), controls = [Promise.withResolvers(), Promise.withResolvers()]
    const output = wrap(r.run(source, [], "slice", controls.map(control => control.promise), ctx, {}))
    r.assignPath(source, [], null, ctx)
    controls[first].resolve(at)
    return { ctx, output, refs, first, other: controls[1 - first] }
}
const slices = Object.values(r.CHAIN_MODE).flatMap(mode => [0, 1].flatMap(first =>
    [1, -1].map(at => narrowSlice(mode, first, at))))
await collect()
for (const { ctx, output, refs, first, other } of slices) {
    const survivor = 1 - first
    assert.deepEqual(refs.map(ref => Boolean(ref.deref())), [survivor === 0, survivor === 1], "slice candidates")
    const alias = new r.Chain(refs[survivor].deref(), ctx)
    r.assignPath(alias, ["n"], 9, ctx)
    other.resolve(first === 0 ? 2 : 0)
    assert.deepEqual(await r.export(output, [], ctx), [{ n: survivor }])
}

// A known end rules out the suffix even if a pending negative start could
// consume the original length. The omitted data and its width have separate uses.
async function sliceExcludesTail(mode, startAt, borrow) {
    const ctx = { execution: new r.Execution(), errorContext: "slice excluded tail" }
    const start = Promise.withResolvers(), width = Promise.withResolvers()
    const wrap = value => new r.Chain(value, ctx, mode)
    function issue() {
        const owner = wrap({ n: 2 }), child = r.lookupPath(owner, [], ctx)
        const source = wrap(["first", child])
        const base = borrow ? wrap(r.run(source, [], "concat", [width.promise], ctx, {})) : source
        const result = wrap(r.run(base, [], "slice", [start.promise, 1], ctx, {}))
        for (const h of new Set([owner, source, base])) r.assignPath(h, [], undefined, ctx)
        return { result, child: new WeakRef(child) }
    }
    const state = issue()
    await collect()
    assert.equal(state.child.deref(), undefined, "slice end excludes the child")
    const cause = startAt === undefined && r.validationError("failed start", ctx, r.ERROR_KIND.OperationInputFailed)
    if (cause) start.reject(cause)
    else start.resolve(startAt)
    await tick()
    if (startAt === -1) assert.deepEqual(r.export(state.result, [], ctx), [])
    if (cause) {
        assert.equal(r.lookupPath(state.result, ["length"], ctx), 1)
        assert.equal(r.lookupPath(state.result, [0], ctx), cause)
        assert.equal(r.getErrors(state.result, [], ctx), cause)
    }
    width.resolve([])
    assert.deepEqual(await r.export(state.result, [], ctx), cause || (startAt === -1 ? [] : ["first"]))
}
for (const mode of [r.CHAIN_MODE.Unordered, r.CHAIN_MODE.Sequential])
    for (const at of [-1, -2, undefined]) for (const borrow of [false, true]) await sliceExcludesTail(mode, at, borrow)

// One operand already contains the child while a second has not chosen
// its width. A later capture must protect the logical data through COW.
async function separatedOperands(keep) {
    const ctx = { execution: new r.Execution(), errorContext: "concat operands" }
    const wait = Promise.withResolvers(), prefix = Promise.withResolvers()
    function issue() {
        const wrap = v => new r.Chain(v, ctx), item = wrap([{ n: 1 }]), source = wrap(["A"])
        const child = r.lookupPath(item, [0], ctx)
        const result = wrap(r.run(source, [], "concat", [prefix.promise, r.lookupPath(item, [], ctx), wait.promise], ctx, {}))
        const copy = wrap(r.run(result, [], "toReversed", [], ctx, {}))
        const length = r.lookupPath(copy, ["length"], ctx)
        r.assignPath(result, [], undefined, ctx)
        r.assignPath(item, [0, "n"], 9, ctx)
        for (const holder of [source, item]) r.assignPath(holder, [], undefined, ctx)
        if (!keep) r.assignPath(copy, [], undefined, ctx)
        return { ref: new WeakRef(child), copy, length }
    }
    const state = issue()
    await collect()
    assert.equal(Boolean(state.ref.deref()), keep)
    wait.resolve(["Z"])
    prefix.resolve(["B"])
    assert.equal(await state.length, 4)
    if (keep) assert.deepEqual(await r.export(state.copy, [], ctx), ["Z", { n: 1 }, "B", "A"])
}
await separatedOperands(false)
await separatedOperands(true)

// A retained slice still needs the open operand. Its excluded endpoint
// can retire even if an unknown argument could reach the capacity limit.
async function croppedConcat(back, unbounded, keepOne) {
    const ctx = { execution: new r.Execution(), errorContext: "cropped concat" }
    const width = Promise.withResolvers(), wrap = value => new r.Chain(value, ctx)
    function issue() {
        const owner = wrap({ n: 1 }), child = r.lookupPath(owner, [], ctx)
        const slots = keepOne ? ["candidate", child] : [child]
        const fixed = wrap(back ? slots.reverse() : slots)
        const base = wrap([]), open = wrap(["a", "b", "c"])
        if (!unbounded) r.run(open, [], "splice", [keepOne ? 0 : 1, width.promise], ctx, mutate)
        const a = r.lookupPath(fixed, [], ctx), b = unbounded ? width.promise : r.lookupPath(open, [], ctx)
        const operands = keepOne ? [b, a] : [a, b]
        const result = wrap(r.run(base, [], "concat", back ? operands.reverse() : operands, ctx, {}))
        const bounds = keepOne ? (back ? [-1] : [0, 1]) : (back ? [0, -1] : [1])
        const slice = wrap(r.run(result, [], "slice", bounds, ctx, {}))
        for (const h of [owner, fixed, base, open, result]) r.assignPath(h, [], undefined, ctx)
        return { slice, ref: new WeakRef(child) }
    }
    const { slice, ref } = issue()
    await collect()
    assert.equal(ref.deref(), undefined, ["excluded concat endpoint", back, unbounded, keepOne].join("/"))
    if (keepOne) width.resolve(unbounded ? [] : Infinity)
    else width.resolve(unbounded ? ["a", "c"] : 1)
    assert.deepEqual(await r.export(slice, [], ctx), keepOne ? ["candidate"] : ["a", "c"])
}
for (const back of [false, true]) for (const unbounded of [false, true])
    for (const keepOne of [false, true]) await croppedConcat(back, unbounded, keepOne)

// A still-unclassified concat argument could make a later insertion
// overflow. Its direct result never needs the receiver's first payload.
async function possibleSpliceOverflow(insert) {
    const ctx = { execution: new r.Execution(), errorContext: "splice capacity" }
    const part = Promise.withResolvers(), at = Promise.withResolvers(), count = Promise.withResolvers()
    const wrap = value => new r.Chain(value, ctx)
    function issue() {
        const owner = wrap({ n: 1 }), child = r.lookupPath(owner, [], ctx), base = wrap([child])
        const array = wrap(r.run(base, [], "concat", [part.promise], ctx, {}))
        const args = [at.promise, count.promise]
        if (insert) args.push("X")
        const removed = wrap(r.run(array, [], "splice", args, ctx, mutate))
        const length = r.lookupPath(array, ["length"], ctx)
        for (const h of [owner, base, array]) r.assignPath(h, [], undefined, ctx)
        return { ref: new WeakRef(child), length, removed }
    }
    const { ref, length, removed } = issue()
    count.resolve(0)
    if (insert) at.resolve(1)
    await collect()
    assert.equal(ref.deref(), undefined)
    if (insert) assert(r.lookupPath(removed, [], ctx) instanceof Promise)
    else assert.deepEqual(r.export(removed, [], ctx), [])
    part.resolve(["end"])
    assert.equal(await length, insert ? 3 : 2)
    assert.deepEqual(await r.export(removed, [], ctx), [])
    at.resolve(1)
}
for (const insert of [false, true]) await possibleSpliceOverflow(insert)

// Pushing and prepending can owe a numeric result or a new capacity Error.
// Reversing the same Array owes the receiver itself on success.
async function endpointResult(method) {
    const ctx = { execution: new r.Execution(), errorContext: method }, part = Promise.withResolvers()
    const wrap = value => new r.Chain(value, ctx)
    function issue() {
        const owner = wrap({ n: 1 }), child = r.lookupPath(owner, [], ctx), base = wrap(["a", child, "z"])
        const array = wrap(r.run(base, [], "concat", [part.promise], ctx, {}))
        const result = r.run(array, [], method, method === "reverse" ? [] : ["x"], ctx, mutate)
        for (const h of [owner, base, array]) r.assignPath(h, [], undefined, ctx)
        return { ref: new WeakRef(child), result }
    }
    const { ref, result } = issue()
    await collect()
    assert.equal(Boolean(ref.deref()), method === "reverse", method)
    part.resolve(["end"])
    if (method === "reverse") assert.deepEqual(await r.export(wrap(result), [], ctx), ["end", "z", { n: 1 }, "a"])
    else assert.equal(await result, 5)
}
for (const method of ["push", "unshift", "reverse"]) await endpointResult(method)

// The start can establish that a prefix will never be removed while the
// count stays pending. Only a direct removed result still owns the suffix.
async function removedCandidates(method, empty, mode, open) {
    const ctx = { execution: new r.Execution(), errorContext: "possible removed slots" }
    const at = Promise.withResolvers(), count = Promise.withResolvers(), earlier = open && Promise.withResolvers()
    const wrap = value => new r.Chain(value, ctx, mode)
    function issue() {
        const owners = [wrap({ n: 1 }), wrap({ n: 2 })]
        const kids = owners.map(h => r.lookupPath(h, [], ctx)), array = wrap(kids)
        const first = earlier && wrap(r.run(array, [], "splice", [1, earlier.promise], ctx, mutate))
        const value = r.run(array, [], method, [at.promise, count.promise, "insert"], ctx, method === "splice" ? mutate : {})
        const result = wrap(value), output = method === "splice" ? array : result
        if (mode === r.CHAIN_MODE.Unordered) assert.equal(r.run(output, [], "includes", ["insert"], ctx, {}), true)
        const length = r.lookupPath(output, ["length"], ctx)
        for (const h of [...owners, array, output]) r.assignPath(h, [], undefined, ctx)
        return { first, result, length, refs: kids.map(child => new WeakRef(child)) }
    }
    const { first, result, length, refs } = issue()
    if (empty) count.resolve(0)
    else at.resolve(1)
    await collect()
    assert.equal(refs[0].deref(), undefined)
    // The earlier splice also owes its own removed result.
    assert.equal(Boolean(refs[1].deref()), open || !empty && method === "splice")
    if (earlier) {
        earlier.resolve(0)
        assert.deepEqual(await r.export(first, [], ctx), [])
    }
    if (empty) at.resolve(1)
    else count.resolve(1)
    assert.equal(await length, empty ? 3 : 2)
    if (method === "splice") assert.deepEqual(await r.export(result, [], ctx), empty ? [] : [{ n: 2 }])
}
for (const mode of [r.CHAIN_MODE.Unordered, r.CHAIN_MODE.Sequential])
    for (const method of ["splice", "toSpliced"])
        for (const empty of [false, true])
            for (const open of [false, true]) await removedCandidates(method, empty, mode, open)

// A live unordered copy can expose old occurrences before their final ranks.
// Once the cut excludes a child, waiting for an unrelated suffix must release it.
async function liveSpliceCopy(keep, countPending) {
    const ctx = { execution: new r.Execution(), errorContext: "live splice copy" }
    const earlier = Promise.withResolvers(), start = Promise.withResolvers(), count = Promise.withResolvers()
    const wrap = value => new r.Chain(value, ctx, r.CHAIN_MODE.Unordered)
    function issue() {
        const owner = wrap({ n: 0 })
        r.assignPath(owner, ["n"], 1, ctx)
        const child = r.lookupPath(owner, [], ctx), input = wrap([child, "b", "c", "d"])
        r.run(input, [], "splice", [2, earlier.promise], ctx, mutate)
        const output = wrap(r.run(input, [], "toSpliced", [start.promise, countPending ? count.promise : 1, "X"], ctx, {}))
        for (const holder of [owner, input]) r.assignPath(holder, [], undefined, ctx)
        return { output, ref: new WeakRef(child) }
    }
    const { output, ref } = issue()
    start.resolve(keep ? 1 : 0)
    if (countPending) { await tick(); count.resolve(1) }
    await collect()
    assert.equal(Boolean(ref.deref()), keep)
    earlier.resolve(1)
    assert.deepEqual(await r.export(output, [], ctx), keep ? [{ n: 1 }, "X", "d"] : ["X", "b", "d"])
}
for (const keep of [false, true]) for (const countPending of [false, true]) await liveSpliceCopy(keep, countPending)

// A single reader needs B or the insertion once one deletion is known.
// The original coordinate of B survives narrowing before or after the read.
async function pendingSplicePoint(beforeRead, keep, chooseInsertion) {
    const ctx = { execution: new r.Execution(), errorContext: "splice point after count" }
    const start = Promise.withResolvers(), count = Promise.withResolvers()
    function issue() {
        const a = { n: 0 }, b = { n: 1 }, source = new r.Chain([a, b], ctx)
        const view = new r.Chain(r.run(source, [], "toSpliced", [start.promise, count.promise, "X"], ctx, {}), ctx)
        r.assignPath(source, [], null, ctx)
        return { view, refs: [new WeakRef(a), new WeakRef(b)] }
    }
    const { view, refs } = issue()
    if (beforeRead) { count.resolve(1); await tick() }
    const point = r.capturePath(view, [1], ctx)
    if (!keep) r.assignPath(view, [], null, ctx)
    if (!beforeRead) count.resolve(1)
    await collect()
    assert.deepEqual(refs.map(ref => Boolean(ref.deref())), [keep, true])
    start.resolve(chooseInsertion ? 1 : 0)
    assert.deepEqual(await r.export(point, [], ctx), chooseInsertion ? "X" : { n: 1 })
}
for (const beforeRead of [false, true]) for (const keep of [false, true])
    await pendingSplicePoint(beforeRead, keep, beforeRead !== keep)

async function spliceControl(method, pending, keep, mode) {
    const ctx = { execution: new r.Execution(), errorContext: method }
    const start = Promise.withResolvers(), count = Promise.withResolvers(), wrap = v => new r.Chain(v, ctx, mode)
    const failed = pending === "failed start" && r.validationError("start", ctx, r.ERROR_KIND.InvalidArrayOperation)
    function issue() {
        const input = wrap(["A", "B"]), owner = wrap({ value: 7 })
        const child = r.lookupPath(owner, [], ctx), ref = new WeakRef(child)
        const args = [failed || (pending === "count" ? 1 : start.promise), pending === "start" ? 0 : count.promise, child]
        const result = r.run(input, [], method, args, ctx, method === "splice" ? mutate : {})
        const returned = wrap(result), output = method === "splice" ? input : returned
        const length = r.lookupPath(output, ["length"], ctx)
        const point = keep ? r.capturePath(output, [1], ctx, mode) : undefined
        for (const holder of new Set([owner, input, output])) r.assignPath(holder, [], undefined, ctx)
        return { length, point, ref, removed: method === "splice" ? returned : undefined }
    }
    const state = issue()
    await collect()
    assert.equal(Boolean(state.ref.deref()), keep, [method, pending, keep, mode].join("/"))
    if (mode === r.CHAIN_MODE.Sequential) { start.resolve(1); await tick(); count.resolve(1) }
    else { count.resolve(1); await tick(); start.resolve(1) }
    assert.equal(await state.length, pending === "start" || failed ? 3 : 2)
    if (keep) assert.deepEqual(await r.export(state.point, [], ctx), { value: 7 })
    if (state.removed) {
        if (failed) assert.equal(await r.lookupPath(state.removed, [], ctx), failed)
        else assert.deepEqual(await r.export(state.removed, [], ctx), pending === "start" ? [] : ["B"])
    }
    assert.equal(ctx.execution.fatalError, null)
}
for (const mode of [r.CHAIN_MODE.Unordered, r.CHAIN_MODE.Sequential]) for (const method of ["splice", "toSpliced"]) {
    for (const pending of ["count", "start", "both"]) for (const keep of [false, true]) await spliceControl(method, pending, keep, mode)
    await spliceControl(method, "failed start", false, mode)
}

// A Complete mutation can still fail the whole receiver. Even after a root
// assignment is issued, the queued push must capture its original argument.
async function completeMutation(fail, snapshot) {
    const ctx = { execution: new r.Execution(), errorContext: "complete publication" }
    const count = Promise.withResolvers(), wrap = value => new r.Chain(value, ctx, r.CHAIN_MODE.Complete)
    function issue() {
        const source = wrap(["A", "B"]), owner = wrap({ n: 1 }), child = r.lookupPath(owner, [], ctx)
        r.run(source, [], "splice", [1, count.promise], ctx, mutate)
        const length = r.run(source, [], "push", [child], ctx, mutate)
        const held = snapshot && r.capturePath(source, [], ctx)
        r.assignPath(owner, ["n"], 9, ctx)
        r.assignPath(owner, [], 0, ctx)
        r.assignPath(source, [], 0, ctx)
        return { length, held, final: r.lookupPath(source, [], ctx), ref: new WeakRef(child) }
    }
    const state = issue()
    assert(r.isPending(state.final, ctx))
    assert(r.isPending(state.length, ctx))
    await collect()
    assert(state.ref.deref())
    if (fail) count.reject(new Error("count"))
    else count.resolve(1)
    const result = await state.length
    if (fail) assert(r.isPoisonError(result))
    else assert.equal(result, 2)
    assert.equal(await state.final, 0)
    if (snapshot) {
        if (fail) assert.equal(await r.lookupPath(state.held, [], ctx), result)
        else assert.deepEqual(await r.export(state.held, [], ctx), ["A", { n: 1 }])
        r.assignPath(state.held, [], 0, ctx)
    }
    await collect()
    assert.equal(state.ref.deref(), undefined)
    assert.equal(ctx.execution.fatalError, null)
}
for (const fail of [false, true]) for (const held of [false, true]) await completeMutation(fail, held)

// A ready cut already identifies the removed child. Capacity can delay the
// direct result beyond retirement of both the source and its successor.
for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) {
    const ctx = { execution: new r.Execution(), errorContext: "removed child" }, width = Promise.withResolvers()
    const wrap = value => new r.Chain(value, ctx, mode), owner = wrap({ n: 0 })
    r.assignPath(owner, ["n"], 1, ctx)
    const source = wrap([r.lookupPath(owner, [], ctx)])
    const output = wrap(r.run(source, [], "concat", [width.promise], ctx, {}))
    r.assignPath(source, [], 0, ctx)
    const removed = r.run(output, [], "splice", [0, 1, "X", "Y"], ctx, mutate)
    assert(r.isPending(removed, ctx))
    const saved = wrap(removed)
    r.assignPath(output, [], 0, ctx)
    await tick()
    r.assignPath(owner, ["n"], 9, ctx)
    width.resolve([])
    assert.deepEqual(await r.export(saved, [], ctx), [{ n: 1 }])
    assert.equal(r.lookupPath(owner, ["n"], ctx), 9)
}

for (const mode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered]) {
    for (const indirect of [false, true]) for (const keep of [false, true]) await sliceCycle(mode, indirect, keep)
    for (const kind of ["point", "range"]) await readAfterRetirement(mode, kind)
}

async function sliceCycle(mode, indirect, keep) {
    const ctx = { execution: new r.Execution(), errorContext: "slice cycle" }
    const wrap = value => new r.Chain(value, ctx, mode), end = Promise.withResolvers()
    function issue() {
        const item = Promise.withResolvers(), source = wrap([item.promise])
        const output = wrap(r.run(source, [], "slice", [0, end.promise], ctx, {}))
        const root = r.lookupPath(output, [], ctx)
        const payload = indirect ? { back: root, tag: 1 } : root
        const alias = keep && indirect && wrap(payload)
        const length = r.lookupPath(output, ["length"], ctx)
        item.resolve(payload)
        return { source, output, length, alias, ref: new WeakRef(root) }
    }
    const { source, output, length, alias, ref } = issue()
    await tick()
    r.assignPath(source, [], undefined, ctx)
    if (!keep) r.assignPath(output, [], undefined, ctx)
    if (alias) {
        r.assignPath(alias, ["tag"], 2, ctx)
        assert.equal(r.lookupPath(alias, ["tag"], ctx), 2)
        r.assignPath(alias, [], undefined, ctx)
    }
    await collect()
    assert.equal(Boolean(ref.deref()), keep, "only a real holder should keep the pending cycle")
    assert(r.isPending(length, ctx))
    end.resolve(1)
    assert.equal(await length, 1)
    if (keep) {
        const exported = await r.export(output, [], ctx)
        assert.equal(indirect ? exported[0].back : exported[0], exported)
        if (indirect) assert.equal(exported[0].tag, 1)
    }
}

async function readAfterRetirement(mode, kind) {
    const ctx = { execution: new r.Execution(), errorContext: kind }
    const wrap = value => new r.Chain(value, ctx, mode)
    const item = Promise.withResolvers(), end = Promise.withResolvers(), nested = { n: 1 }
    const source = wrap([item.promise]), alias = wrap(nested)
    const output = wrap(r.run(source, [], "slice", [0, end.promise], ctx, {}))
    const read = kind === "point" ? r.lookupPath(output, [0, "old", "n"], ctx) : r.export(output, [], ctx)
    assert(r.isPending(read, ctx))
    r.assignPath(source, [], undefined, ctx)
    r.assignPath(output, [], undefined, ctx)
    item.resolve({ old: nested })
    await tick()
    r.assignPath(alias, ["n"], 2, ctx)
    assert.equal(r.lookupPath(alias, ["n"], ctx), 2)
    end.resolve(1)
    assert.deepEqual(await read, kind === "point" ? 1 : [{ old: { n: 1 } }])
}

// The first removable exact reader can leave before the numeric producer.
// The shared notification must not retain that reader's source context.
{
    const ctx = { execution: new r.Execution(), errorContext: "width producer" }
    const source = new r.Chain(["A", "B", "C"], ctx), count = Promise.withResolvers()
    r.run(source, [], "splice", [1, count.promise], ctx, mutate)
    function readAndRelease() {
        const op = { execution: ctx.execution, errorContext: { reader: 1 } }
        const owner = new OperationOwner(op)
        const capture = ArrayView.captureLength(r.lookupPath(source, [], ctx), op, owner)
        assert(r.isPending(capture.read(), op))
        owner.close()
        return [new WeakRef(owner), new WeakRef(op)]
    }
    const refs = readAndRelease()
    const length = r.lookupPath(source, ["length"], ctx)
    await collect()
    assert(refs.every(ref => !ref.deref()), "a released length reader remained reachable")
    count.resolve(1)
    assert.equal(await length, 2)
}

console.log("Array shape and data lifetimes verified")
