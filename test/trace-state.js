// Test-process state only. Runtime source is instrumented by trace-runtime.js;
// production modules contain no tracer hooks, counters, or allocation registry.
const stack = []
const counters = new Map()
let enabled = false
let copies
const publication = new Set([
    "replacePlacement", "commitPlacementVersion", "commitPromiseVersion",
    "installPlacementGate", "installMutationVersion", "copyPlacement",
    "prepareInput", "normalizeRawPropertyValue",
])
const construction = new Set([
    "prepareInput", "copyCompleteGraph", "snapshotExternalValue",
    "shallowCopyPathContainer", "createArrayFromRemap", "validateReceiver",
    "createRemap", "exportValues", "exportCopy", "fixture",
])

function count(name) { counters.set(name, (counters.get(name) ?? 0) + 1) }
function enter(name, args) {
    if ((name === "runExternalAction" || name === "runSubscription") &&
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
function exportCopy(write, ...args) {
    enter("exportCopy", args)
    try { return write(...args) } finally { leave() }
}
function fixture(write, ...args) {
    enter("fixture", args)
    try { return write(...args) } finally { leave() }
}
function admission(value, context) {
    const index = stack.findLastIndex(frame => frame.name === "normalizeRawPropertyValue")
    if (index < 0 || stack.slice(0, index).some(frame => construction.has(frame.name) || publication.has(frame.name))) return
    if (context.execution._metadata.get(stack[index].args[0])?.placementsInitialized)
        throw new Error("Ordinary read first admitted a managed child of a prepared owner")
}
function enable() { enabled = true }
function reset() { counters.clear() }
function counts() { return Object.fromEntries(counters) }
function trackCopies() { return copies = [] }
function allocated(value) { copies?.push(new WeakRef(value)) }

export { enter, leave, exportCopy, fixture, count, admission, enable, enabled, reset, counts, trackCopies, allocated }
