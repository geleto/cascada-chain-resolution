// A named failing test is insufficient when its child never reached the runtime
// assertion. Preserve those diagnostics separately from witnessed regressions.
function infrastructureFailure(failure) {
    const detail = JSON.stringify([failure.err ?? {}, failure.stack])
    if (/Timeout of \d+ms exceeded|ETIMEDOUT|worker deadline exceeded/.test(detail)) return "timeout"
    if (/SyntaxError:|ERR_MODULE_NOT_FOUND|Cannot find module|ERR_CHILD_PROCESS_STDIO_MAXBUFFER|spawn[^\n]*ENOENT|fault no longer matches|Missing traced function/.test(detail))
        return "startup"
}

function classifySafeguard(entry, { failures, completed, instrumented }) {
    if (!instrumented) return { status: "uninstrumented", titles: [], note: " (missing fault-loader receipt)" }
    const titles = failures.map(failure => failure.fullTitle)
    const note = completed ? "" : " (suite crashed)"
    const invalid = failures.map(failure => ({ failure, reason: infrastructureFailure(failure) })).filter(value => value.reason)
    if (invalid.length) return { status: "inconclusive", titles, note: ` (${invalid.map(value => value.reason).join(", ")})` }
    if (titles.length === 0) return { status: completed ? (entry.open ? "open" : "lost") : "crashed", titles, note }
    const witnessed = entry.witnesses.some(witness => titles.some(title => title.includes(witness)))
    return { status: witnessed ? (entry.open ? "witnessed-but-open" : "witnessed") : "unlisted", titles, note }
}

function faultReceipts(text) {
    const receipts = new Map()
    for (const line of text.split(/\r?\n/)) if (line.startsWith("[cascada-safeguard] ")) {
        const receipt = JSON.parse(line.slice("[cascada-safeguard] ".length))
        receipts.set(`${receipt.pid}:${receipt.edit}`, receipt)
    }
    return [...receipts.values()]
}

function witnessFaultReceipts(failure) {
    // Mocha json-stream emits err as a string and stack beside it. Other
    // reporters and our controls can supply a structured Error instead.
    const message = typeof failure.err === "string" ? failure.err : failure.err?.message ?? ""
    return faultReceipts(`${message}\n${failure.stack ?? failure.err?.stack ?? ""}`)
}

export { classifySafeguard, faultReceipts, witnessFaultReceipts }
