import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { normalizeModuleURL } from "./module-url.js"

// Work fixtures declare exact source edits; this is their common loader and
// receipt protocol. Keep counter state and semantic assertions in each fixture.
// A disabled loader must leave the expected modules unreceived, not report a
// successful zero-work measurement.
export function instrumentRuntime(changes, enabled = true) {
    const targets = new Map([...changes].map(([file, edits]) =>
        [normalizeModuleURL(new URL(`../src/${file}`, import.meta.url)), { edits, loads: 0 }]))
    registerHooks({ load(url, context, next) {
        const loaded = next(url, context)
        const target = targets.get(normalizeModuleURL(url))
        if (!enabled || !target) return loaded
        let source = String(loaded.source).replaceAll("\r\n", "\n")
        for (const [anchor, replacement, count = 1] of target.edits) {
            const matches = typeof anchor === "string"
                ? source.split(anchor).length - 1 : [...source.matchAll(anchor)].length
            assert.equal(matches, count, `Runtime counter anchor: ${url}: ${anchor}`)
            source = source.replaceAll(anchor, replacement)
        }
        target.loads++
        return { ...loaded, source }
    } })
    return message => {
        for (const [url, target] of targets)
            assert.equal(target.loads, 1, `${message}: ${url}`)
    }
}
