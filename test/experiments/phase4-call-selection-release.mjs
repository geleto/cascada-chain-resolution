// Allocation tracing observes exported copies that a failing method getter never
// receives. node --expose-gc
// --stack-trace-limit=1000 test/experiments/phase4-call-selection-release.mjs
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

assert(global.gc, "Run with --expose-gc")
let copies, loaded = false
globalThis.phase4SelectionCopy = value => copies?.push(new WeakRef(value))
const target = new URL("../../src/managed-capture.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== target) return result
    const source = String(result.source), marker = "initializeCopy?.(node.copy, node)"
    assert.equal(source.split(marker).length, 2, "Allocation hook anchor changed")
    loaded = true
    return { ...result, source: source.replace(marker, "globalThis.phase4SelectionCopy(node.copy); " + marker) }
} })
const r = await import("../../src/index.js")
assert(loaded, "Allocation hook did not load")
function issue(mutation) {
    const ctx = { execution: new r.Execution(), errorContext: `getter/${mutation}` }
    let cause
    const api = r.externalState({})
    // The host chooses a stack that starts at its caller. This removes only the
    // host getter's own receiver frame, exposing runtime action captures. The
    // runtime must preserve this exact cause and must not format its stack.
    function getCall() {
        cause = new Error("fresh getter failure")
        Error.captureStackTrace(cause, getCall)
        throw cause
    }
    Object.defineProperty(api, "call", { get: getCall })
    const holder = new r.ContextChain({ api }, ctx, { api: {} })
    copies = []
    const error = r.run(holder, ["api"], "call", [{ payload: [1, 2, 3] }], ctx,
        mutation ? { mutationScopeDepth: 1 } : {})
    assert.equal(error.kind, r.ERROR_KIND.InvocationFailed)
    assert.equal(error.cause, cause)
    assert(copies.length >= 2, "The tracer must observe argument export")
    return { ctx, error, refs: [new WeakRef(api), ...copies] }
}
const states = [issue(false), issue(true)]
for (let i = 0; i < 30; i++) { await new Promise(setImmediate); global.gc() }
assert(states.every(state => state.refs.every(ref => !ref.deref())),
    "Method selection failure retains its receiver or unused exported arguments")
console.log("Both fresh method-getter failure routes release receiver and arguments")
