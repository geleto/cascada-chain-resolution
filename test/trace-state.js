// Test-process state only. Runtime source is instrumented by trace-runtime.js;
// production modules contain no tracer hooks, counters, or allocation registry.
const stack = []
const counters = new Map()
let enabled = false
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

function count(name) { counters.set(name, (counters.get(name) ?? 0) + 1) }
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
function enable() { enabled = true }
function reset() { counters.clear() }
function counts() { return Object.fromEntries(counters) }
function trackCopies() { return copies = [] }
function allocated(value) { copies?.push(new WeakRef(value)) }

export { enter, leave, fixture, count, enable, enabled, reset, counts, trackCopies, allocated }
