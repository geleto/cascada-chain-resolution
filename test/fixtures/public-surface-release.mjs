// Strict public-operation lifetime catalogue, adapted from the independent review.
// Run with --expose-gc at default and --stack-trace-limit=1000.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
let failNextEntry = false, entryFailures = 0
globalThis.publicEntryFault = () => {
    if (!failNextEntry) return
    failNextEntry = false
    entryFailures++
    throw new Error('receiving entry defect')
}
const ownershipURL = new URL('../../src/ownership.js', import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== ownershipURL) return result
    const source = String(result.source), marker = '        expireReadyDeliveries(operationContext.execution)'
    assert(source.includes(marker), 'Receiving entry fault anchor changed')
    return { ...result, source: source.replace(marker, marker + '; globalThis.publicEntryFault()') }
} })
const r = await import('../../src/index.js')
assert(global.gc, 'Run with --expose-gc')
const turn = () => new Promise(setImmediate)
const settle = async n => { for (let i = 0; i < n; i++) { await turn(); global.gc() } }
const describe = v => r.isPoisonError(v) ? v.kind : v === undefined ? "undefined" : v === null ? "null"
    : typeof v === "object" ? (v.constructor?.name ?? "object") : String(v)
const prebuilt = new Error("prebuilt")
const throwing = new Proxy({}, { ownKeys() { throw prebuilt } })
const make = () => ({
    payload: new Array(16).fill(1), list: [1, 2, 3], text: "abc",
    box: { n: 1, fail() { throw prebuilt }, reject() { return Promise.reject(prebuilt) },
        corrupt() { this.bad = Promise.resolve(1) }, ok() { return { fresh: 1 } }, slow() { return Promise.resolve({ fresh: 2 }) } },
    bad: r.createPoisonError(prebuilt, {}, r.ERROR_KIND.OperationInputFailed), later: Promise.resolve({ v: 1 }), rejecting: Promise.reject(prebuilt),
})
// Each op(ctx, chain) -> result. `chain` holds an imported make() value.
const cases = {
    // lookups
    "lookup-ok-detached": (ctx, c) => r.lookupPath(c, ["box", "n"], ctx),
    "lookup-through-scalar": (ctx, c) => r.lookupPath(c, ["box", "n", "x"], ctx),
    "lookup-error-value": (ctx, c) => r.lookupPath(c, ["bad"], ctx),
    "lookup-pending-reject": (ctx, c) => r.lookupPath(c, ["rejecting"], ctx),
    "lookup-invalid-segment": (ctx, c) => r.lookupPath(c, [{}], ctx),
    "expression-invalid": (ctx, c) => r.lookupPathForExpression(c, ["box"], ctx),
    "expression-through-scalar": (ctx, c) => r.lookupPathForExpression(c, ["box", "n", "x"], ctx),
    // export / queries
    "export-error-value": (ctx, c) => r.export(c, ["bad"], ctx),
    "export-through-scalar": (ctx, c) => r.export(c, ["box", "n", "x"], ctx),
    "export-invalid-segment": (ctx, c) => r.export(c, [{}], ctx),
    "export-pending-reject": (ctx, c) => r.export(c, ["rejecting"], ctx),
    "export-ok": (ctx, c) => r.export(c, ["list"], ctx),
    "has-error": (ctx, c) => r.hasError(c, [], ctx),
    "get-errors": (ctx, c) => r.getErrors(c, [], ctx),
    "get-errors-through-scalar": (ctx, c) => r.getErrors(c, ["box", "n", "x"], ctx),
    // assignment / deletion / repair
    "assign-callable-then": (ctx, c) => r.assignPath(c, ["box", "then"], () => {}, ctx),
    "assign-pending-callable-then": (ctx, c) => r.assignPath(c, ["box", "then"], Promise.resolve(() => {}), ctx),
    "assign-through-scalar": (ctx, c) => r.assignPath(c, ["box", "n", "x"], 1, ctx),
    "assign-invalid-segment": (ctx, c) => r.assignPath(c, ["box", {}], 1, ctx),
    "assign-array-invalid-key": (ctx, c) => r.assignPath(c, ["list", "nope"], 1, ctx),
    "assign-rejecting-rhs": (ctx, c) => r.assignPath(c, ["box", "x"], Promise.reject(prebuilt), ctx),
    "delete-through-scalar": (ctx, c) => r.deletePath(c, ["box", "n", "x"], ctx),
    "repair-through-scalar": (ctx, c) => r.repairPath(c, ["box", "n", "x"], ctx),
    "repair-ok": (ctx, c) => r.repairPath(c, ["box"], ctx),
    // managed methods
    "run-observe-throw": (ctx, c) => r.run(c, ["box"], "fail", [], ctx, {}),
    "run-observe-reject": (ctx, c) => r.run(c, ["box"], "reject", [], ctx, {}),
    "run-observe-missing": (ctx, c) => r.run(c, ["box"], "absent", [], ctx, {}),
    "run-mutate-throw": (ctx, c) => r.run(c, ["box"], "fail", [], ctx, { mutationScopeDepth: 1 }),
    "run-mutate-reject": (ctx, c) => r.run(c, ["box"], "reject", [], ctx, { mutationScopeDepth: 1 }),
    "run-mutate-missing": (ctx, c) => r.run(c, ["box"], "absent", [], ctx, { mutationScopeDepth: 1 }),
    "run-mutate-receiver-invalid": (ctx, c) => r.run(c, ["box"], "corrupt", [], ctx, { mutationScopeDepth: 1 }),
    "run-on-scalar": (ctx, c) => r.run(c, ["box", "n"], "toFixed", [], ctx, { mutationScopeDepth: 2 }),
    "run-constructor": (ctx, c) => r.run(c, ["box"], "constructor", [], ctx, {}),
    "run-bad-argument": (ctx, c) => r.run(c, ["box"], "ok", [Promise.reject(prebuilt)], ctx, {}),
    "run-ok-fresh": (ctx, c) => r.run(c, ["box"], "ok", [], ctx, {}),
    "run-slow-fresh": (ctx, c) => r.run(c, ["box"], "slow", [], ctx, {}),
    // controlled Array methods
    "array-observe-bad-arg": (ctx, c) => r.run(c, ["list"], "join", [Promise.reject(prebuilt)], ctx, {}),
    "array-mutate-coercion": (ctx, c) => r.run(c, ["list"], "fill", [1, {}], ctx, { mutationScopeDepth: 1 }),
    "array-unsupported": (ctx, c) => r.run(c, ["list"], "customThing", [], ctx, {}),
    "string-method-missing": (ctx, c) => r.run(c, ["text"], "nope", [], ctx, {}),
    // entry
    "enter-callback-command-fails": (ctx, c) => r.enter(c, ["box"], ctx, true, entered => r.assignPath(entered, ["n", "x"], 1, ctx)),
    "enter-through-scalar": (ctx, c) => r.enter(c, ["box", "n", "x"], ctx, true, entered => r.assignPath(entered, ["y"], 1, ctx)),
    // reception
    "import-reflection-failure": (ctx, c) => r.lookupPath(new r.Chain(r.import({ throwing, keep: r.lookupPath(c, [], ctx) }, ctx), ctx), ["throwing"], ctx),
    "method-result-reflection-failure": (ctx, c) => r.lookupPath(new r.Chain(r.importMethodResult({ throwing, keep: r.lookupPath(c, ["payload"], ctx) }, ctx), ctx), ["throwing"], ctx),
}
const rows = []
for (const [name, op] of Object.entries(cases)) {
    const ctx = { execution: new r.Execution(), errorContext: name }
    let source = make()
    source.rejecting.catch(() => {})
    const weak = new WeakRef(source.payload)
    let chain = new r.Chain(r.import(source, ctx), ctx)
    source = undefined
    let result
    try { result = await op(ctx, chain) } catch (failure) { result = failure }
    // Results that legitimately contain graph data are reported, not judged.
    chain = undefined
    rows.push({ case: name, result: describe(result), weak, keep: [ctx, result] })
    result = undefined
}

function queryFailure(collectErrors) {
    const ctx = { execution: new r.Execution(), errorContext: `query-reflection/${collectErrors}` }
    const cause = new Error("prebuilt query failure")
    let armed = false
    const payload = [1, 2, 3]
    const source = new Proxy({ payload }, { ownKeys(target) {
        if (armed) throw cause
        return Reflect.ownKeys(target)
    } })
    const holder = new r.Chain(r.import(source, ctx), ctx)
    armed = true
    const result = (collectErrors ? r.getErrors : r.hasError)(holder, [], ctx)
    if (collectErrors) {
        assert.equal(result.kind, r.ERROR_KIND.QueryReflectionFailed)
        assert.equal(result.cause, cause)
    } else assert.equal(result, true)
    return { case: ctx.errorContext, result: describe(result), weak: new WeakRef(payload), keep: [ctx, result] }
}

const expected = {
  "lookup-ok-detached": "1",
  "lookup-through-scalar": "ScalarLookup",
  "lookup-error-value": "OperationInputFailed",
  "lookup-pending-reject": "OperationInputFailed",
  "lookup-invalid-segment": "InvalidPathSegment",
  "expression-invalid": "InvalidExpressionValue",
  "expression-through-scalar": "ScalarLookup",
  "export-error-value": "OperationInputFailed",
  "export-through-scalar": "ScalarLookup",
  "export-invalid-segment": "InvalidPathSegment",
  "export-pending-reject": "OperationInputFailed",
  "export-ok": "Array",
  "has-error": "true",
  "get-errors": "OperationInputFailed",
  "get-errors-through-scalar": "ScalarLookup",
  "assign-callable-then": "PropertyValidation",
  "assign-pending-callable-then": "undefined",
  "assign-through-scalar": "ScalarLookup",
  "assign-invalid-segment": "InvalidPathSegment",
  "assign-array-invalid-key": "PropertyValidation",
  "assign-rejecting-rhs": "undefined",
  "delete-through-scalar": "ScalarLookup",
  "repair-through-scalar": "ScalarLookup",
  "repair-ok": "undefined",
  "run-observe-throw": "InvocationFailed",
  "run-observe-reject": "InvocationFailed",
  "run-observe-missing": "MissingFunction",
  "run-mutate-throw": "InvocationFailed",
  "run-mutate-reject": "InvocationFailed",
  "run-mutate-missing": "MissingFunction",
  "run-mutate-receiver-invalid": "InvalidManagedReceiver",
  "run-on-scalar": "UnsupportedMutation",
  "run-constructor": "NotAFunction",
  "run-bad-argument": "OperationInputFailed",
  "run-ok-fresh": "Object",
  "run-slow-fresh": "Object",
  "array-observe-bad-arg": "OperationInputFailed",
  "array-mutate-coercion": "Array",
  "array-unsupported": "MissingFunction",
  "string-method-missing": "MissingFunction",
  "enter-callback-command-fails": "ScalarLookup",
  "enter-through-scalar": "ScalarLookup",
  "import-reflection-failure": "ImportReflectionFailed",
  "method-result-reflection-failure": "ImportReflectionFailed"
}
for (const row of rows) assert.equal(row.result, expected[row.case], row.case)
rows.push(queryFailure(false), queryFailure(true))
// A valid operation can encounter an internal defect before its core callback
// starts. Input release surrounds that receiving boundary, including its guard.
function entryFailure(managed) {
    const ctx = { execution: new r.Execution(() => {}), errorContext: `entry-failure/${managed}` }
    const holder = new r.Chain({}, ctx)
    let source = { child: { value: 1 } }, failure
    const weak = new WeakRef(source)
    failNextEntry = true
    try {
        if (managed) r.import(source, ctx)
        else r.assignPath(holder, ['slot'], source, ctx)
    } catch (error) { failure = error }
    source = undefined
    assert(r.isFatalError(failure))
    assert.equal(failure.cause.message, 'receiving entry defect')
    return { case: ctx.errorContext, weak, keep: [ctx, failure] }
}
rows.push(entryFailure(false), entryFailure(true))
assert.equal(entryFailures, 2)
await settle(30)
// A returned descendant remains observable: its reverse placement relationships
// may retain the source. This is a live-output control, not a release obligation.
const failures = rows.filter(row => row.case !== 'array-mutate-coercion' && row.weak.deref()).map(row => row.case)
assert.deepEqual(failures, [], 'Completed public commands retain dropped source graphs')
console.log(rows.length + ' public-surface lifetime cases passed')
