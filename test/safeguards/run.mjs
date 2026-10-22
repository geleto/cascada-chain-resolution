// Removes each registered safeguard in turn and runs the normal suite against
// it. Usage: node test/safeguards/run.mjs [--parallel=N] [--skip-baseline] [--full] [id ...]
// By default an entry runs only its listed witnesses; --full runs every test for
// each entry, which reports all affected tests but can take tens of minutes.
// See registry.mjs for entry fields and README.md in test/ for interpretation.
import { spawn } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { SAFEGUARDS } from "./registry.mjs"
import { classifySafeguard as classify, faultReceipts, witnessFaultReceipts } from "./evidence.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const hook = pathToFileURL(fileURLToPath(new URL("./fault-hook.mjs", import.meta.url))).href
const args = process.argv.slice(2)
const parallel = Number(args.find(arg => arg.startsWith("--parallel="))?.split("=")[1] ?? 3)
const full = args.includes("--full")
const reportPath = args.find(arg => arg.startsWith("--report="))?.slice("--report=".length)
const selected = args.filter(arg => !arg.startsWith("--"))
const unknown = selected.filter(id => !SAFEGUARDS.some(entry => entry.id === id))
if (unknown.length) throw new Error(`Unknown safeguard ids: ${unknown.join(", ")}`)

// A fault must match current source; otherwise its entry is stale, not passing.
function staleEdit(entry) {
    for (const edit of entry.faults) {
        const source = readFileSync(join(root, edit.file), "utf8").replaceAll("\r\n", "\n")
        if (!source.includes(edit.find)) return edit.file
    }
}

// The streaming reporter records each failure as it happens, so a fault that
// later crashes the suite still names the tests it broke. Other stdout is ignored.
function runSuite(faults, witnesses) {
    const env = { ...process.env, CASCADA_SAFEGUARD_FAULT: faults ? JSON.stringify(faults) : "",
        CASCADA_SAFEGUARD_RECEIPTS: "1" }
    env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import=${hook}`.trim()
    const grep = witnesses?.length
        ? ["--grep", witnesses.map(title => title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")] : []
    return new Promise(resolve => {
        const child = spawn(process.execPath, ["--unhandled-rejections=strict", "./node_modules/mocha/bin/mocha.js",
            "--reporter", "json-stream", "--timeout", "30000", ...grep, "test/**/*.test.js"], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
        let output = "", diagnostics = ""
        child.stdout.on("data", chunk => { output += chunk })
        child.stderr.on("data", chunk => { diagnostics += chunk })
        const timer = setTimeout(() => child.kill(), 15 * 60 * 1000)
        child.on("close", (exitCode, signal) => {
            clearTimeout(timer)
            const failures = [], events = new Set()
            for (const line of output.split(/\r?\n/)) {
                if (!line.startsWith("[\"")) continue
                let event
                try { event = JSON.parse(line) } catch { continue }
                events.add(event[0])
                if (event[0] === "fail") failures.push(event[1])
            }
            const receipts = new Set()
            const workerReceipts = faultReceipts(diagnostics)
            for (const receipt of workerReceipts) {
                if (receipt.pid === child.pid) receipts.add(receipt.edit)
            }
            // Subprocess wrappers include their child's captured diagnostics in
            // the failed assertion. Keep those receipts attached to that exact
            // witness, distinct from source loading in the Mocha parent.
            for (const failure of failures)
                failure.workerReceipts = witnessFaultReceipts(failure)
            resolve({ failures, completed: events.has("end"), exitCode, signal, pid: child.pid, workerReceipts,
                diagnostics: diagnostics.slice(-16384),
                instrumented: !faults || faults.every((_, index) => receipts.has(index)) })
        })
    })
}

if (!args.includes("--skip-baseline")) {
    const baseline = await runSuite()
    if (!baseline.completed || baseline.failures.length) {
        console.error(`Baseline suite is not clean (${baseline.completed ? baseline.failures.length + " failures" : "crashed"}); results would be meaningless.`)
        process.exit(2)
    }
}

const queue = SAFEGUARDS.filter(entry => selected.length === 0 || selected.includes(entry.id))
const results = []
async function worker() {
    while (queue.length) {
        const entry = queue.shift()
        const stale = staleEdit(entry)
        let result
        const attempts = []
        if (stale) result = { status: "stale", titles: [], detail: stale }
        else {
            // Listed witnesses run alone first: seconds instead of a full faulted suite.
            // Only a missing witness, an open entry, or --full needs every test.
            let quick
            if (!full && !entry.open && entry.witnesses.length) {
                const evidence = await runSuite(entry.faults, entry.witnesses)
                attempts.push({ scope: "witnesses", ...evidence })
                quick = classify(entry, evidence)
            }
            if (quick?.status === "witnessed") result = { ...quick, quick: true }
            else {
                const evidence = await runSuite(entry.faults)
                attempts.push({ scope: "full", ...evidence })
                result = classify(entry, evidence)
            }
        }
        results.push({ entry, ...result, attempts })
        if (reportPath) writeFileSync(reportPath, JSON.stringify(results, null, 2) + "\n")
        // A quick run sees only witnesses, so it cannot tell whether coverage is thin.
        const thin = !result.quick && result.titles.length === 1 ? " (thin: one failing test)" : ""
        console.log(`${result.status.padEnd(18)} ${entry.id}${thin}${result.titles.length ? ` - ${result.titles.length} failing` : ""}${result.note ?? ""}`)
        if (result.status === "unlisted") for (const title of result.titles.slice(0, 3)) console.log(`${"".padEnd(19)}${title}`)
        if (result.status === "stale") console.log(`${"".padEnd(19)}fault text no longer matches ${result.detail}`)
    }
}
await Promise.all(Array.from({ length: parallel }, worker))
const blocking = results.filter(result => ["lost", "stale", "unlisted", "crashed", "uninstrumented", "inconclusive", "witnessed-but-open"].includes(result.status))
process.exitCode = blocking.length ? 1 : 0
