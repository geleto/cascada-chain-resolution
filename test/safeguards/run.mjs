// Removes each registered safeguard in turn and runs the normal suite against
// it. Usage: node test/safeguards/run.mjs [--parallel=N] [--skip-baseline] [--full] [id ...]
// By default an entry runs only its listed witnesses; --full runs every test for
// each entry, which reports all affected tests but can take tens of minutes.
// See registry.mjs for entry fields and README.md in test/ for interpretation.
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { SAFEGUARDS } from "./registry.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const hook = pathToFileURL(fileURLToPath(new URL("./fault-hook.mjs", import.meta.url))).href
const args = process.argv.slice(2)
const parallel = Number(args.find(arg => arg.startsWith("--parallel="))?.split("=")[1] ?? 3)
const full = args.includes("--full")
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
    const env = { ...process.env, CASCADA_SAFEGUARD_FAULT: faults ? JSON.stringify(faults) : "" }
    env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import=${hook}`.trim()
    const grep = witnesses?.length
        ? ["--grep", witnesses.map(title => title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")] : []
    return new Promise(resolve => {
        const child = spawn(process.execPath, ["--unhandled-rejections=strict", "./node_modules/mocha/bin/mocha.js",
            "--reporter", "json-stream", ...grep, "test/**/*.test.js"], { cwd: root, env, stdio: ["ignore", "pipe", "ignore"] })
        let output = ""
        child.stdout.on("data", chunk => { output += chunk })
        const timer = setTimeout(() => child.kill(), 15 * 60 * 1000)
        child.on("close", () => {
            clearTimeout(timer)
            const titles = [], events = new Set()
            for (const line of output.split(/\r?\n/)) {
                if (!line.startsWith("[\"")) continue
                let event
                try { event = JSON.parse(line) } catch { continue }
                events.add(event[0])
                if (event[0] === "fail") titles.push(event[1].fullTitle)
            }
            resolve({ titles, completed: events.has("end") })
        })
    })
}

function classify(entry, { titles, completed }) {
    const note = completed ? "" : " (suite crashed)"
    if (titles.length === 0) return { status: completed ? (entry.open ? "open" : "lost") : "crashed", titles, note }
    const witnessed = entry.witnesses.some(witness => titles.some(title => title.includes(witness)))
    return { status: witnessed ? (entry.open ? "witnessed-but-open" : "witnessed") : "unlisted", titles, note }
}

if (!args.includes("--skip-baseline")) {
    const baseline = await runSuite()
    if (!baseline.completed || baseline.titles.length) {
        console.error(`Baseline suite is not clean (${baseline.completed ? baseline.titles.length + " failures" : "crashed"}); results would be meaningless.`)
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
        if (stale) result = { status: "stale", titles: [], detail: stale }
        else {
            // Listed witnesses run alone first: seconds instead of a full faulted suite.
            // Only a missing witness, an open entry, or --full needs every test.
            const quick = !full && !entry.open && entry.witnesses.length ? classify(entry, await runSuite(entry.faults, entry.witnesses)) : undefined
            result = quick?.status === "witnessed" ? { ...quick, quick: true } : classify(entry, await runSuite(entry.faults))
        }
        results.push({ entry, ...result })
        // A quick run sees only witnesses, so it cannot tell whether coverage is thin.
        const thin = !result.quick && result.titles.length === 1 ? " (thin: one failing test)" : ""
        console.log(`${result.status.padEnd(18)} ${entry.id}${thin}${result.titles.length ? ` - ${result.titles.length} failing` : ""}${result.note ?? ""}`)
        if (result.status === "unlisted") for (const title of result.titles.slice(0, 3)) console.log(`${"".padEnd(19)}${title}`)
        if (result.status === "stale") console.log(`${"".padEnd(19)}fault text no longer matches ${result.detail}`)
    }
}
await Promise.all(Array.from({ length: parallel }, worker))
const blocking = results.filter(result => ["lost", "stale", "unlisted", "crashed", "witnessed-but-open"].includes(result.status))
process.exitCode = blocking.length ? 1 : 0
