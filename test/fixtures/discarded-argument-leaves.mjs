import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { OrderedThenable } from "../ordered-thenable.js"

async function collect() {
    for (let index = 0; index < 30; index++) {
        await new Promise(setImmediate)
        global.gc()
    }
}

function start(kind, failure, ordered) {
    const ctx = { execution: new r.Execution(), errorContext: "discarded argument leaves" }
    const deferred = () => ordered ? new OrderedThenable() : Promise.withResolvers()
    const gate = deferred(), tail = deferred(), discovery = deferred()
    const causes = [new Error("first"), new Error("nested late"), new Error("later root")]
    let result, calls = 0
    const weak = (() => {
        const leaf = kind === "function" ? () => 42 : new Error("healthy ordinary Error")
        const first = new r.Chain({
            bad: failure === "ready" ? r.createPoisonError(causes[0], ctx, r.ERROR_KIND.ContextValueFailed)
                : failure === "late" ? discovery.promise ?? discovery : 1,
            nested: gate.promise ?? gate,
        }, ctx)
        const api = new r.Chain(r.externalState({ consume(first, value) {
            calls++
            return typeof value === "function" ? value() : value.message
        } }), ctx)
        result = r.run(api, [], "consume", [r.lookupPath(first, [], ctx), leaf,
            ...(failure ? [tail.promise ?? tail] : [])], ctx, {})
        assert(r.isPending(result, ctx))
        return new WeakRef(leaf)
    })()
    if (failure === "late") discovery.reject(causes[0])
    return { kind, failure, ctx, weak, result, causes, calls: () => calls, settle() {
        if (failure) { tail.reject(causes[2]); gate.reject(causes[1]) }
        else gate.resolve(1)
    } }
}

const trials = []
for (const kind of ["function", "error"])
for (const failure of [false, "ready", "late"])
for (const ordered of [false, true]) trials.push(start(kind, failure, ordered))
await collect()
for (const trial of trials) assert.equal(trial.weak.deref() !== undefined, !trial.failure,
    "Discarded leaves release during required collection; live arguments remain available")
for (const trial of trials) trial.settle()
for (const trial of trials) {
    const result = await trial.result
    if (trial.failure) {
        assert(r.isPoisonError(result))
        assert.equal(trial.calls(), 0)
        assert.deepEqual(new Set(result.errors.map(error => error.cause)), new Set(trial.causes))
    } else {
        assert.equal(trial.calls(), 1)
        assert.equal(result, trial.kind === "function" ? 42 : "healthy ordinary Error")
    }
    assert.equal(trial.ctx.execution.fatalError, null)
}
await collect()
for (const trial of trials) assert.equal(trial.weak.deref(), undefined, "Completed arguments release")
