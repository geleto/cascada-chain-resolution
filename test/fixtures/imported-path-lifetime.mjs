import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { OrderedThenable } from "../ordered-thenable.js"
import * as trace from "../trace-state.js"

const turn = () => new Promise(setImmediate)
assert(global.gc, "Run the lifetime fixture with --expose-gc")

function capture(route, failed) {
    const ctx = { execution: new r.Execution(), errorContext: "joint capture lifetime" }
    const key = new OrderedThenable(), data = Promise.withResolvers()
    const poison = r.createPoisonError(new Error("known child failure"), ctx, r.ERROR_KIND.OperationInputFailed)
    let child = { wait: data.promise, known: failed ? poison : 1 }
    let branch = { child }, root = { branch, unrelated: { unused: true } }
    const refs = { root: new WeakRef(root), branch: new WeakRef(branch), child: new WeakRef(child) }
    const chain = new r.ContextChain(root, ctx)
    const result = route === "export" ? r.export(chain, ["branch", key], ctx) : r.getErrors(chain, ["branch", key], ctx)
    r.assignPath(chain, [], null, ctx)
    root = branch = child = undefined
    return { ctx, key, data, refs, result, poison, chain }
}

let lifetimeCases = 0
for (const stackLimit of [10, 50, 1000]) {
    Error.stackTraceLimit = stackLimit
    for (const route of ["export", "query"]) for (const failed of [false, true]) {
        const test = capture(route, failed)
        for (let i = 0; i < 4; i++) { await turn(); global.gc() }
        assert(test.refs.branch.deref(), "unresolved key still requires its source branch")
        test.key.resolve("child")
        for (let i = 0; i < 20; i++) { await turn(); global.gc() }
        for (const [name, ref] of Object.entries(test.refs))
            assert.equal(ref.deref(), undefined, `${route}/${failed}/${stackLimit}: captured ${name} outlived source access`)
        const late = r.createPoisonError(new Error("late child failure"), test.ctx, r.ERROR_KIND.OperationInputFailed)
        test.data.resolve(failed ? late : 7)
        const result = await test.result
        if (failed) assert.deepEqual(new Set(result.errors ?? [result]), new Set([test.poison, late]))
        else if (route === "query") assert.equal(result, null)
        else assert.deepEqual(result, { wait: 7, known: 1 })
        assert.equal(test.ctx.execution.fatalError, null)
        lifetimeCases++
    }
}

// One fixed graph, N independent path captures and one shared imported source.
// Output size is N; each export needs its own logical capture. Issuing or
// settling the history must not add quadratic work around that graph.
const work = []
for (const n of [16, 32, 64]) {
    const ctx = { execution: new r.Execution(), errorContext: "joint path work" }
    let inspections = 0
    const data = new OrderedThenable()
    const child = new Proxy({ value: data }, { ownKeys(target) { inspections++; return Reflect.ownKeys(target) } })
    const chain = new r.ContextChain({ branch: { child } }, ctx)
    const keys = [], outputs = []
    trace.reset()
    for (let i = 0; i < n; i++) {
        const key = new OrderedThenable()
        keys.push(key)
        outputs.push(r.export(chain, ["branch", key], ctx))
    }
    const issuance = trace.counts()
    for (const key of keys) key.resolve("child")
    await turn()
    const partial = trace.counts()
    assert.equal(inspections, n + 1, "one import and one required shape capture per output")
    const subscriptions = data.subscriptions
    data.resolve(7)
    for (const output of await Promise.all(outputs)) assert.deepEqual(output, { value: 7 })
    await turn()
    const completion = trace.counts()
    assert.equal(inspections, n + 1, "settlement adds no host shape inspection")
    assert.equal(ctx.execution.fatalError, null)
    work.push({ n, subscriptions, issuance, partial, completion })
}
if (trace.enabled) {
    const sum = counts => Object.values(counts).reduce((total, value) => total + value, 0)
    for (let i = 1; i < work.length; i++) for (const stage of ["issuance", "partial", "completion"])
        assert(sum(work[i][stage]) <= sum(work[i - 1][stage]) * 2.4 + 20,
            `joint ${stage} work must scale with required captures: ${JSON.stringify(work)}`)
}
for (let i = 1; i < work.length; i++)
    assert(work[i].subscriptions <= work[i - 1].subscriptions * 2 + 2, "raw source subscription work remains linear")
console.log(JSON.stringify({ lifetimeCases, traced: trace.enabled, work }))
