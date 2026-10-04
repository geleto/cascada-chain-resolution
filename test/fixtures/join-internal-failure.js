// A fault in the captured intrinsic is trusted work, not a host-call failure.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

let fault
let faultStage
globalThis.failTrustedJoin = stage => {
    if (!fault || stage !== faultStage) return
    const cause = fault
    fault = undefined
    throw cause
}
const target = new URL("../../src/language-conversion.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== target) return result
    const source = String(result.source)
    const marker = "const arrayJoin = Array.prototype.join"
    assert(source.includes(marker), "Join fault anchor needs updating")
    const preparation = "finishContainerCopy(joined, shape)"
    assert(source.includes(preparation), "Join preparation fault anchor needs updating")
    const stringConversion = "const stringConcat = String.prototype.concat"
    assert(source.includes(stringConversion), "String conversion fault anchor needs updating")
    assert(source.includes("+primitive"), "Number conversion fault anchor needs updating")
    return { ...result, source: source.replace(marker,
        `const nativeJoin = Array.prototype.join
const arrayJoin = function (...args) {
    globalThis.failTrustedJoin("intrinsic")
    return Reflect.apply(nativeJoin, this, args)
}`).replace(preparation, `globalThis.failTrustedJoin("preparation")
        ${preparation}`).replace(stringConversion,
        `const nativeConcat = String.prototype.concat
const stringConcat = function (...args) {
    globalThis.failTrustedJoin("string conversion")
    return Reflect.apply(nativeConcat, this, args)
}`).replace("+primitive", `(globalThis.failTrustedJoin("number conversion"), +primitive)`) }
} })
const r = await import("../../src/index.js")

for (const pending of [false, true])
for (const stage of ["intrinsic", "preparation", "string conversion", "number conversion"])
for (const reason of stage === "intrinsic" ? ["Error", "poison"] : ["Error", "RangeError", "poison"]) {
    const reports = [], execution = new r.Execution(error => reports.push(error))
    const initialize = { execution, errorContext: "initialization" }
    const ctx = { execution, errorContext: `join pending=${pending} stage=${stage} reason=${reason}` }
    const signal = pending ? Promise.withResolvers() : undefined
    const numeric = stage === "number conversion"
    const chain = new r.Chain(numeric ? ["a", "b"] : signal?.promise ?? ["a", "b"], initialize)
    const sibling = r.import(new Promise(() => {}), initialize)
    const siblingOutcome = sibling.then(value => ({ value }), error => ({ error }))
    const cause = reason === "poison" ? r.validationError("escaped intrinsic poison", initialize,
        r.ERROR_KIND.ScalarConversionFailed) : reason === "RangeError"
        ? new RangeError("unexpected preparation defect") : new Error("join implementation defect")
    fault = cause
    faultStage = stage
    let result, failed
    try {
        result = r.run(chain, [], numeric ? "at" : "join", numeric ? [signal?.promise ?? 0] : [], ctx, {})
    } catch (error) { failed = error }
    const outcome = Promise.resolve(result).then(value => ({ value }), error => ({ error }))
    assert.equal(result instanceof Promise, pending)
    signal?.resolve(numeric ? 0 : ["a", "b"])
    const observed = await outcome
    const fatal = execution.fatalError
    assert.equal(fault, undefined, "The fault must be reached")
    assert(r.isFatalError(fatal))
    assert.equal(fatal.cause, cause)
    assert.equal(fatal.errorContext, ctx.errorContext)
    assert.equal(pending ? observed.error : failed, fatal)
    assert.equal((await siblingOutcome).error, fatal)
    assert.deepEqual(reports, [fatal])
    assert.throws(() => r.run(chain, [], "join", [], ctx, {}), error => error === fatal)
}
