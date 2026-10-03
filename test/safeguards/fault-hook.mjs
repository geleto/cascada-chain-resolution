// Loaded through NODE_OPTIONS by run.mjs so spawned fixtures receive the same
// fault. It rewrites one source module in memory; files on disk stay unchanged.
import { registerHooks } from "node:module"

const spec = process.env.CASCADA_SAFEGUARD_FAULT
if (spec) {
    const edits = JSON.parse(spec)
    const root = new URL("../../", import.meta.url).href
    registerHooks({ load(url, context, next) {
        const result = next(url, context)
        const relevant = edits.filter(edit => url === root + edit.file)
        if (relevant.length === 0) return result
        let source = String(result.source).replaceAll("\r\n", "\n")
        for (const edit of relevant) {
            if (!source.includes(edit.find)) throw new Error(`Safeguard fault no longer matches ${edit.file}`)
            source = source.replace(edit.find, edit.replace)
        }
        return { ...result, source }
    } })
}
