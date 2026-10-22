import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { OrderedThenable, ready } from "./ordered-thenable.js"

// Preparation order may choose attribution, but never stored Error kind or
// whether an inert result reference is accepted. Every input settles.
function delivery(mode, value) {
    if (mode === "ready") return { value, finish() {} }
    if (mode === "synchronous") return { value: ready(value), finish() {} }
    const signal = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
    return {
        value: mode === "native" ? signal.promise : signal,
        finish() { signal.resolve(value) },
    }
}

function contexts() {
    const execution = new r.Execution()
    return {
        first: { execution, errorContext: "earlier preparation" },
        later: { execution, errorContext: "later preparation" },
    }
}

async function failedSibling(mode, methodResult, failing) {
    const { first, later } = contexts()
    const cause = new Error("stored poison")
    const leaf = r.createPoisonError(cause, first, r.ERROR_KIND.OperationInputFailed)
    const inner = { ok: 1, leaf }
    inner.self = inner
    const failure = new Proxy({}, {
        ownKeys() { throw new Error("enumeration failure") },
    })
    const tail = delivery(mode, failing ? failure : { ok: 2 })
    const root = { child: inner, tail: tail.value }
    const earlier = new r.Chain(
        methodResult ? r.importMethodResult(root, first) : r.import(root, first), first)
    const other = new r.Chain(r.import(inner, later), later)
    const observation = r.getErrors(other, [], later)
    tail.finish()
    const error = await observation
    const earlierErrors = await r.getErrors(earlier, [], first)
    assert.equal(error, leaf)
    assert.equal(await r.lookupPath(other, ["ok"], later), 1)
    assert.equal(first.execution.fatalError, null)
    const members = earlierErrors?.errors ?? [earlierErrors]
    assert(members.some(error => error === leaf) || (!methodResult && failing))
    return { source: error.errorContext, kind: error.kind }
}

async function conditionalResult(mode, shared) {
    const { first, later } = contexts()
    const capability = r.externalState({})
    const authority = new r.ContextChain({ capability }, first, { capability: {} })
    const inner = { capability }
    const input = delivery(mode, shared ? inner : { ok: 1 })
    const earlier = new r.Chain(r.import({ next: input.value }, first), first)
    const result = r.importMethodResult(inner, later)
    input.finish()
    const value = await result
    assert.equal(await r.getErrors(earlier, [], first), null)
    assert.equal(r.getErrors(authority, [], first), null)
    assert.equal(first.execution.fatalError, null)
    return r.isPoisonError(value)
        ? { kind: value.kind, source: value.errorContext }
        : { preserved: value === inner }
}

// A global preparation queue would withhold the very value used to supply
// this earlier input. The scalar field has no attribution or policy dependency.
async function healthyProgress(independent) {
    const { first, later } = contexts()
    const signal = Promise.withResolvers()
    const earlier = new r.Chain(r.import({ ok: 1, next: signal.promise }, first), first)
    const clean = independent ? new r.Chain(r.import({ ok: 1 }, later), later) : earlier
    const value = r.lookupPath(clean, ["ok"], later)
    assert.equal(value, 1)
    signal.resolve({ value })
    assert.equal(await r.lookupPath(earlier, ["next", "value"], first), 1)
    assert.equal(first.execution.fatalError, null)
}

describe("shared input reception order", () => {
    for (const methodResult of [false, true]) for (const failing of [false, true])
    for (const mode of ["ready", "synchronous", "native", "ordered"]) {
        it(`preserves kind through competing preparations: method=${methodResult}, failure=${failing}, delivery=${mode}`, async () => {
            const result = await failedSibling(mode, methodResult, failing)
            assert.equal(result.kind, r.ERROR_KIND.OperationInputFailed)
            assert.equal(result.source, "earlier preparation")
        })
    }
    for (const shared of [false, true]) for (const mode of ["ready", "synchronous", "native", "ordered"]) {
        it(`accepts inert results independently of earlier discovery: shared=${shared}, delivery=${mode}`, async () => {
            assert.deepEqual(await conditionalResult(mode, shared), { preserved: true })
        })
    }
    for (const independent of [false, true]) {
        it(`keeps available fields usable during import: independent=${independent}`, () => healthyProgress(independent))
    }
})
