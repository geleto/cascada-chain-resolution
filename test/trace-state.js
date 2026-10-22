// Test-process state only. Runtime source is instrumented by trace-runtime.js;
// production modules contain no tracer hooks, counters, or allocation registry.
import { appendFileSync } from "node:fs"
const stack = []
const counters = new Map()
let enabled = false
let reported = false
let copies
const publication = new Set([
    "replacePlacement", "commitPlacementVersion", "commitPromiseVersion",
    "installPlacementGate", "installMutationVersion", "copyPlacement",
    // A resumed no-op writer can discard an absent overlay after publication.
    // The physical slot is already absent, so this cleanup changes no edge.
    "detachAbsentVersion",
    "prepareInput", "commitPreparedInput",
])
const construction = new Set([
    "prepareInput", "assembleCapturedGraph", "snapshotExternalValue",
    "shallowCopyPathContainer", "createArrayFromRemap", "validateReceiver",
    "createRemap", "exportValues", "fixture",
])

function receipt(event, name) {
    if (process.env.CASCADA_TRACE_RECEIPT_FILE)
        appendFileSync(process.env.CASCADA_TRACE_RECEIPT_FILE, JSON.stringify({
            event, name, pid: process.pid, parent: process.ppid, script: process.argv[1],
        }) + "\n")
}
function count(name) {
    counters.set(name, (counters.get(name) ?? 0) + 1)
}
// Only the rewritten production wrappers call this. Test fixture scopes and
// manual trace counters do not establish runtime-worker execution.
function runtimeHit(name) {
    if (!reported) { reported = true; receipt("executed", name) }
}
function enter(name, args) {
    if ((name === "runExternalAction" || name === "thenValue") &&
        stack.some(frame => frame.name === "commitPreparedInput"))
        throw new Error(`Preparation commit invoked ${name}`)
    if (["writeLanguageProperty", "deleteLanguageProperty", "installPlacementVersion", "detachPlacementVersion",
        "defineCopyProperty"].includes(name) &&
        !stack.some(frame => publication.has(frame.name) || construction.has(frame.name)))
        throw new Error(`Untracked placement route: ${name}`)
    stack.push({ name, args })
    count(name)
}
function leave() { stack.pop() }
function fixture(write, ...args) {
    enter("fixture", args)
    try { return write(...args) } finally { leave() }
}
function enable() { if (!enabled) receipt("loaded"); enabled = true }
function reset() { counters.clear() }
function counts() { return Object.fromEntries(counters) }
function trackCopies() { return copies = [] }
function allocated(value) { copies?.push(new WeakRef(value)) }

export { enter, leave, fixture, count, runtimeHit, enable, enabled, reset, counts, trackCopies, allocated }
