import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { normalizeModuleURL } from "../module-url.js"

const target = normalizeModuleURL(new URL("../../src/external-access.js", import.meta.url))
globalThis.nativeAuthorityVisits = 0
let hooked = false
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (normalizeModuleURL(url) !== target) return result
    const source = String(result.source), marker = "for (identity of identities ?? []) {"
    assert(source.includes(marker))
    hooked = true
    return { ...result, source: source.replace(marker, marker + " globalThis.nativeAuthorityVisits++;") }
} })
const r = await import("../../src/index.js")
const { OrderedThenable } = await import("../ordered-thenable.js")

for (const deferred of [false, true]) for (const depth of [8, 32, 128]) {
    let value = 7
    for (let index = 0; index < depth; index++) value = r.externalState({ next: value })
    const ctx = { execution: new r.Execution(), errorContext: "native path work" }
    const chain = new r.Chain(value, ctx)
    const keys = Array.from({ length: depth }, () => deferred ? new OrderedThenable() : "next")
    globalThis.nativeAuthorityVisits = 0
    const result = r.lookupPath(chain, keys, ctx)
    if (deferred) for (const key of keys) key.resolve("next")
    assert.equal(await result, 7)
    assert(globalThis.nativeAuthorityVisits > 0, "The retained-identity work hook must execute")
    assert(globalThis.nativeAuthorityVisits <= depth * 2,
        `Repeated unchanged prefix scans: depth=${depth}, visits=${globalThis.nativeAuthorityVisits}`)
}
assert(hooked)
console.log("Linear native authority work across ready and deferred path keys")
