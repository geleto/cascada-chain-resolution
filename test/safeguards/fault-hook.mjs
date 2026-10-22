// Loaded through NODE_OPTIONS by run.mjs so spawned fixtures receive the same
// fault. It rewrites one source module in memory; files on disk stay unchanged.
import { registerHooks } from "node:module"
import { normalizeModuleURL } from "../module-url.js"

const spec = process.env.CASCADA_SAFEGUARD_FAULT
if (spec) {
    const edits = JSON.parse(spec)
    const root = new URL("../../", import.meta.url)
    registerHooks({ load(url, context, next) {
        const result = next(url, context)
        const relevant = edits.map((edit, index) => ({ ...edit, index })).filter(edit =>
            normalizeModuleURL(url) === normalizeModuleURL(new URL(edit.file, root)))
        if (relevant.length === 0) return result
        let source = String(result.source).replaceAll("\r\n", "\n")
        for (const edit of relevant) {
            if (!source.includes(edit.find)) throw new Error(`Safeguard fault no longer matches ${edit.file}`)
            source = source.replace(edit.find, edit.replace)
            if (process.env.CASCADA_SAFEGUARD_RECEIPTS === "1")
                console.error(`[cascada-safeguard] ${JSON.stringify({ pid: process.pid, edit: edit.index, file: edit.file })}`)
        }
        return { ...result, source }
    } })
}
