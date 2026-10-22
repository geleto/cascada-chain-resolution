import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { OrderedThenable } from "../ordered-thenable.js"

async function collect() {
    for (let index = 0; index < 30; index++) {
        await new Promise(setImmediate)
        global.gc()
    }
}

function arrayPreparation(method, ordered, mutation, failed, comparator = false) {
    const ctx = { execution: new r.Execution(), errorContext: "Array preparation disposal" }
    const gate = ordered ? new OrderedThenable() : Promise.withResolvers()
    const causes = [new Error("first failure"), new Error("remaining failure")]
    let payload = { payload: new Array(10000).fill(1) }, source, chain, armed = false, args
    if (method === "sort" || method === "toSorted") {
        source = new Proxy([0, payload, gate.promise ?? gate], {
            getOwnPropertyDescriptor(target, key) {
                if (armed && key === "0") throw causes[0]
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        chain = new r.Chain(source, ctx)
        armed = failed
        args = comparator ? [() => 0] : []
    } else {
        chain = new r.Chain([1, 2], ctx)
        const start = failed ? r.createPoisonError(causes[0], ctx, r.ERROR_KIND.OperationInputFailed) : 0
        args = method === "fill" ? [payload, start, gate.promise ?? gate] : [start, gate.promise ?? gate, payload]
    }
    const weak = new WeakRef(payload), sourceRef = source && new WeakRef(source)
    const result = r.run(chain, [], method, args, ctx, mutation ? { mutationScopeDepth: 0 } : {})
    if (source) r.assignPath(chain, [], undefined, ctx)
    payload = source = args = undefined
    return { ctx, chain, result, weak, sourceRef, failed, causes, settle() {
        if (failed) gate.reject(causes[1])
        else gate.resolve(1)
    } }
}

function pendingCall(mutation, retained) {
    const ctx = { execution: new r.Execution(), errorContext: "spent exported arguments" }
    const gate = Promise.withResolvers()
    let weak, held
    const chain = new r.Chain({ call(report, input, wait) {
        report(input)
        return wait()
    } }, ctx)
    const result = r.run(chain, [], "call", [value => {
        weak = new WeakRef(value)
        if (retained) held = value
    }, { payload: new Array(10000).fill(7) }, () => gate.promise], ctx, mutation ? { mutationScopeDepth: 0 } : {})
    return { ctx, chain, result, weak, retained, held: () => held, settle() { held = undefined; gate.resolve(1) } }
}

function searchPreparation(method, ordered, failed) {
    const ctx = { execution: new r.Execution(), errorContext: "search preparation disposal" }
    const gate = ordered ? new OrderedThenable() : Promise.withResolvers()
    const causes = [new Error("needle"), new Error("bound")]
    let payload = { payload: new Array(10000).fill(1) }
    const weak = new WeakRef(payload), chain = new r.Chain([payload], ctx)
    const result = r.run(chain, [], method,
        [failed ? r.createPoisonError(causes[0], ctx, r.ERROR_KIND.OperationInputFailed) : payload, gate.promise ?? gate], ctx, {})
    r.assignPath(chain, [], undefined, ctx)
    payload = undefined
    return { ctx, chain, result, weak, failed, causes, settle() {
        if (failed) gate.reject(causes[1])
        else gate.resolve(0)
    } }
}

function failedComparator() {
    const ctx = { execution: new r.Execution(), errorContext: "comparator failure" }, weak = []
    const chain = new r.Chain([{ payload: [1] }, { payload: [2] }], ctx)
    const cause = new Error("comparator failed")
    const result = r.run(chain, [], "toSorted", [(left, right) => {
        weak.push(new WeakRef(left), new WeakRef(right))
        throw cause
    }], ctx, {})
    r.assignPath(chain, [], undefined, ctx)
    assert.equal(result.cause, cause)
    return { ctx, chain, result, weak }
}

// Allocate the callback outside the runtime activation so only its own closure
// legitimately owns the payload. Retain unformatted results and executions.
function comparatorBundle(outcome, cause) {
    const payload = new Array(10000).fill(7)
    const comparator = () => {
        assert.equal(payload[0], 7)
        if (outcome === "throw") throw cause
        if (outcome === "object") return {}
        if (outcome === "promise") return Promise.resolve(0)
        return 0
    }
    return { comparator, weak: [new WeakRef(comparator), new WeakRef(payload)] }
}

function comparatorLifetime(method, outcome, pendingPreparation) {
    const ctx = { execution: new r.Execution(), errorContext: "comparator closure" }
    const cause = new Error("first cause"), laterCause = new Error("later cause")
    const gate = Promise.withResolvers()
    let bundle = comparatorBundle(outcome, cause)
    const weak = bundle.weak
    const chain = new r.Chain(pendingPreparation
        ? [outcome === "poison" ? r.createPoisonError(cause, ctx, r.ERROR_KIND.OperationInputFailed) : 2, gate.promise]
        : [2, 1], ctx)
    const result = r.run(chain, [], method, [bundle.comparator], ctx, {})
    bundle = undefined
    if (!pendingPreparation) assert.equal(r.isPoisonError(result), outcome !== "healthy")
    return { ctx, chain, result, weak, name: `${method}/${outcome}/${pendingPreparation}`, retained: pendingPreparation && outcome === "healthy", settle() {
        if (outcome === "poison") gate.reject(laterCause)
        else gate.resolve(1)
    }, verify(value) {
        if (outcome === "poison") assert.deepEqual(new Set((value.errors ?? [value]).map(error => error.cause)), new Set([cause, laterCause]))
        if (outcome === "throw") assert.equal(value.cause, cause)
        assert.equal(ctx.execution.fatalError, null)
    } }
}

const arrays = [], calls = []
const comparators = []
for (const method of ["sort", "toSorted"]) {
    for (const outcome of ["throw", "object", "promise", "healthy"])
        comparators.push(comparatorLifetime(method, outcome, false))
    for (const outcome of ["poison", "healthy"])
        comparators.push(comparatorLifetime(method, outcome, true))
}
const comparison = failedComparator()
for (const ordered of [false, true]) for (const failed of [false, true]) {
    for (const method of ["includes", "indexOf", "lastIndexOf"])
        arrays.push(searchPreparation(method, ordered, failed))
    for (const method of ["sort", "toSorted"]) for (const comparator of [false, true])
        arrays.push(arrayPreparation(method, ordered, false, failed, comparator))
    for (const mutation of [false, true]) for (const method of ["fill", "splice", "toSpliced"])
        if (!mutation || method !== "toSpliced") arrays.push(arrayPreparation(method, ordered, mutation, failed))
}
for (const mutation of [false, true]) for (const retained of [false, true]) calls.push(pendingCall(mutation, retained))
await collect()
for (const state of comparators) for (const weak of state.weak)
    assert.equal(weak.deref() !== undefined, state.retained, `Only unfinished successful sorting needs its comparator: ${state.name}`)
for (const weak of comparison.weak) assert.equal(weak.deref(), undefined, "Comparator diagnostics release exported copies")
for (const state of arrays) {
    assert.equal(state.weak.deref() !== undefined, !state.failed,
        "Known failure discards output while healthy preparation protects its inputs")
    if (state.failed && state.sourceRef) assert.equal(state.sourceRef.deref(), undefined)
}
for (const state of calls) {
    assert.equal(state.weak.deref() !== undefined, state.retained,
        "Only actual host use may retain exported arguments after invocation")
    if (state.retained) assert.equal(state.held().payload[0], 7)
}
for (const state of [...arrays, ...calls]) state.settle()
for (const state of comparators) { state.settle(); state.verify(await state.result) }
for (const state of arrays) {
    const result = await state.result
    if (state.failed) {
        assert(r.isPoisonError(result))
        assert.deepEqual(new Set((result.errors ?? [result]).map(error => error.cause)), new Set(state.causes))
    } else assert(!r.isPoisonError(result))
    assert.equal(state.ctx.execution.fatalError, null)
}
for (const state of calls) {
    assert.equal(await state.result, 1)
    assert.equal(state.ctx.execution.fatalError, null)
}
await collect()
for (const state of comparators) for (const weak of state.weak)
    assert.equal(weak.deref(), undefined, "Terminal sorting releases its comparator independently of diagnostics")
for (const state of [...arrays.filter(state => state.failed), ...calls])
    assert.equal(state.weak.deref(), undefined, "Completed failures and spent arguments release")
