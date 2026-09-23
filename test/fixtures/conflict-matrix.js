import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { verifyRefCounts } from "../verify-refcounts.js"
import { verifyStorage } from "../verify-storage.js"

// Short conflicts on one target: a predecessor held pending, two queued commands,
// and a sibling creation (an order and length witness) before, between, or after
// them. An independent sequential model gives every expected observation. Both
// consistency verifiers run after each macrotask turn while the holds settle,
// and after each microtask turn in stepwise runs.
// The default run covers every predecessor/queued/queued triple once against an
// absent target and samples present targets; CASCADA_CONFLICT_MATRIX=full runs
// the complete product in both harness modes, optionally split for parallel
// processes with CASCADA_CONFLICT_PART=index/count.

const ABSENT = Symbol("absent")

class Model {
    constructor(initial, array) {
        this.array = array
        this.slots = new Map(Object.entries(initial).map(([key, value]) => [key, typeof value === "object" ? { ...value } : value]))
        this.order = Object.keys(initial)
        this.length = array ? initial.length : 0
    }

    get(key) {
        return this.slots.has(key) ? this.slots.get(key) : ABSENT
    }

    put(key, value) {
        if (value === ABSENT) {
            this.slots.delete(key)
            this.order = this.order.filter(other => other !== key)
            return
        }
        if (!this.slots.has(key)) this.order.push(key)
        this.slots.set(key, value)
        if (this.array && Number(key) >= this.length) this.length = Number(key) + 1
    }

    // Deletion and repair to absence never shrink an Array. A failed prefix
    // poisons its first failed placement and retains that placement's baseline;
    // rejected data is an ordinary Error without a baseline.
    apply(op, key, value) {
        const current = this.get(key)
        if (op === "set") this.put(key, value)
        else if (op === "del") this.put(key, ABSENT)
        else if (op === "rej") this.put(key, { error: true })
        else if (op === "prefix") {
            if (current?.error || current?.poison) return
            if (current !== ABSENT && typeof current === "object") this.put(key, { ...current, x: value })
            else this.put(key, { poison: true, baseline: current })
        } else if (op === "repair" && current?.poison) this.put(key, current.baseline)
    }

    show(key) {
        const value = this.get(key)
        if (value === ABSENT) return "undefined"
        if (value.error || value.poison) return "ERR"
        return typeof value === "object" ? `{x:${value.x}}` : String(value)
    }
}

// Guard the model against drift on transitions whose meaning the contracts fix.
{
    const model = new Model([0], true)
    model.apply("set", "3", 5)
    model.apply("del", "3")
    model.apply("noop", "3")
    assert.equal(model.show("3"), "undefined")
    model.apply("prefix", "5", 1)
    model.apply("repair", "5")
    assert.equal(model.show("5"), "undefined")
    assert.equal(model.length, 6)
    model.apply("rej", "0")
    model.apply("repair", "0")
    assert.equal(model.show("0"), "ERR")
    const record = new Model({ a: 1 }, false)
    record.apply("set", "b", 2)
    record.apply("del", "a")
    record.apply("set", "a", 3)
    assert.deepEqual(record.order, ["b", "a"])
}

const operation = (name, op, how, value) => ({ name, op, how, value })
const PREDECESSORS = [
    operation("noop-entry", "noop", "enter-noop"),
    operation("create-entry", "set", "enter-set", 50),
    operation("delete-entry", "del", "enter-delete"),
    operation("owner-noop", "noop", "owner-noop"),
    operation("owner-create", "set", "owner-set", 51),
    operation("owner-delete", "del", "owner-delete"),
    operation("pending-set", "set", "set-pending", 52),
    operation("failed-prefix-entry", "prefix", "enter-prefix", 53),
    operation("rejected-entry", "rej", "enter-reject"),
]
const QUEUED = [
    operation("set", "set", "set", 60),
    operation("pending-set", "set", "set-pending", 61),
    operation("delete", "del", "delete"),
    operation("prefix", "prefix", "prefix", 62),
    operation("repair", "repair", "repair"),
    operation("reject", "rej", "reject"),
    operation("ready-set-entry", "set", "enter-set-now", 63),
    operation("ready-delete-entry", "del", "enter-delete-now"),
    operation("delayed-noop-entry", "noop", "enter-noop"),
    operation("delayed-set-entry", "set", "enter-set", 64),
    operation("delayed-owner-set", "set", "owner-set", 65),
    operation("nested-delete", "del", "nested-delete"),
    operation("ready-noop-entry", "noop", "enter-noop-now"),
    operation("nested-noop", "noop", "nested-noop"),
    operation("ready-prefix-entry", "prefix", "enter-prefix-now", 66),
    operation("ready-repair-entry", "repair", "enter-repair-now"),
    operation("ready-reject-entry", "rej", "enter-reject-now"),
]
const SIBLING = operation("sibling", "set", "set", 77)

function handled(value) {
    if (value instanceof Promise) value.catch(() => {})
    return value
}

function rejection() {
    return handled(Promise.reject(new Error("rejected payload")))
}

function issue(command, chain, ctx, hold, key) {
    const path = ["a", key]
    switch (command.how) {
        case "enter-noop": return r.enter(chain, path, ctx, true, () => hold())
        case "enter-set": return r.enter(chain, path, ctx, true, inside => hold().then(() => r.assignPath(inside, [], command.value, ctx)))
        case "enter-delete": return r.enter(chain, path, ctx, true, inside => hold().then(() => r.deletePath(inside, [], ctx)))
        case "enter-prefix": return r.enter(chain, path, ctx, true, inside => hold().then(() => handled(r.assignPath(inside, ["x"], command.value, ctx))))
        case "enter-reject": return r.enter(chain, path, ctx, true, inside => hold().then(() => r.assignPath(inside, [], rejection(), ctx)))
        case "owner-noop": return r.enter(chain, ["a"], ctx, true, () => hold())
        case "owner-set": return r.enter(chain, ["a"], ctx, true, inside => hold().then(() => r.assignPath(inside, [key], command.value, ctx)))
        case "owner-delete": return r.enter(chain, ["a"], ctx, true, inside => hold().then(() => r.deletePath(inside, [key], ctx)))
        case "set": return r.assignPath(chain, path, command.value, ctx)
        case "set-pending": return r.assignPath(chain, path, hold().then(() => command.value), ctx)
        case "delete": return r.deletePath(chain, path, ctx)
        case "prefix": return r.assignPath(chain, [...path, "x"], command.value, ctx)
        case "repair": return r.repairPath(chain, path, ctx)
        case "reject": return r.assignPath(chain, path, rejection(), ctx)
        case "enter-set-now": return r.enter(chain, path, ctx, true, inside => r.assignPath(inside, [], command.value, ctx))
        case "enter-delete-now": return r.enter(chain, path, ctx, true, inside => r.deletePath(inside, [], ctx))
        case "enter-noop-now": return r.enter(chain, path, ctx, true, () => undefined)
        case "enter-prefix-now": return r.enter(chain, path, ctx, true, inside => handled(r.assignPath(inside, ["x"], command.value, ctx)))
        case "enter-repair-now": return r.enter(chain, path, ctx, true, inside => r.repairPath(inside, [], ctx))
        case "enter-reject-now": return r.enter(chain, path, ctx, true, inside => r.assignPath(inside, [], rejection(), ctx))
        case "nested-delete": return r.enter(chain, ["a"], ctx, true, inside => r.enter(inside, [key], ctx, true, element => r.deletePath(element, [], ctx)))
        case "nested-noop": return r.enter(chain, ["a"], ctx, true, inside => r.enter(inside, [key], ctx, true, () => undefined))
    }
    throw new Error(`Unknown command ${command.how}`)
}

const macrotask = () => new Promise(setImmediate)

// Settles to a value, an Error, or "BLOCKED" once no held input remains.
async function outcome(value) {
    let settled
    Promise.resolve(value).then(result => { settled = { result } }, error => { settled = { error } })
    for (let turn = 0; turn < 40 && !settled; turn++) await macrotask()
    return settled ?? { blocked: true }
}

function display({ result, error, blocked }) {
    if (blocked) return "BLOCKED"
    if (error) return `REJECTED:${error.message}`
    if (Error.isError(result)) return "ERR"
    if (result === undefined) return "undefined"
    return typeof result === "object" ? `{x:${result.x}}` : String(result)
}

function observe(chain, ctx, keys, array) {
    // Issue every read synchronously at this program position.
    const reads = keys.map(key => outcome(r.lookupPath(chain, ["a", key], ctx)))
    if (array) reads.push(outcome(r.lookupPath(chain, ["a", "length"], ctx)))
    return Promise.all(reads).then(results => {
        const values = results.slice(0, keys.length).map(display).join(" ")
        return array ? `${values} len=${display(results.at(-1))}` : values
    })
}

function verify(ctx, chain) {
    verifyRefCounts(ctx, chain._state)
    verifyStorage(ctx, chain._state)
}

// A stale fact can exist only between microtasks and be gone by the next
// macrotask, so stepwise runs verify after every microtask turn.
async function runCase({ array, target, predecessor, first, second, sibling, release, observed, stepwise }) {
    const initial = array ? [0, { x: 1 }, 2] : { k0: 0, k1: { x: 1 } }
    const keys = array ? ["0", "1", "2", "3", "4", "5"] : ["k0", "k1", "k2", "k3"]
    const siblingKey = array ? "5" : "k3"
    const model = new Model(initial, array)
    const ctx = { execution: new r.Execution(), errorContext: {} }
    const chain = new r.Chain({ a: structuredClone(initial) }, ctx)
    r.hasError(chain, [], ctx) // Keep the live index maintained through every transition.
    const holds = []
    const hold = () => {
        const held = Promise.withResolvers()
        holds.push(held)
        return held.promise
    }
    const steps = [["predecessor", predecessor], ["first", first], ["second", second]]
    steps.splice(sibling, 0, ["sibling", SIBLING])
    const expected = () => keys.map(key => model.show(key)).join(" ") + (array ? ` len=${model.length}` : "")
    const intermediate = []
    const errors = []
    try {
        for (const [role, command] of steps) {
            const key = role === "sibling" ? siblingKey : target
            model.apply(command.op, key, command.value)
            handled(issue(command, chain, ctx, hold, key))
            if (observed && role === "first") intermediate.push({ want: expected(), got: observe(chain, ctx, keys, array) })
        }
        verify(ctx, chain)
        // Release the predecessor first or last; holds created by callbacks follow in FIFO order.
        if (release === "predecessor-last" && holds.length > 1) holds.push(holds.shift())
        do {
            while (holds.length) {
                holds.shift().resolve()
                for (let turn = 0; turn < 12; turn++) {
                    await Promise.resolve()
                    if (stepwise) verify(ctx, chain)
                }
                await macrotask()
                verify(ctx, chain)
            }
            for (let turn = 0; turn < 3; turn++) await macrotask()
        } while (holds.length)
        for (const { want, got } of intermediate) {
            const actual = await got
            if (actual !== want) errors.push(`intermediate got [${actual}] want [${want}]`)
        }
        const final = await observe(chain, ctx, keys, array)
        if (final !== expected()) errors.push(`final got [${final}] want [${expected()}]`)
        // Order and presence witness: replacing an Error keeps its position.
        for (const key of keys) if (model.show(key) === "ERR") {
            handled(r.assignPath(chain, ["a", key], "E", ctx))
            model.slots.set(key, "E")
        }
        const exported = await outcome(r.export(chain, ["a"], ctx))
        const shape = value => array
            ? `${value.length}:${[...Array(value.length).keys()].map(index => index in value ? "P" : "_").join("")}`
            : Object.keys(value).join(",")
        const expectedShape = array
            ? `${model.length}:${[...Array(model.length).keys()].map(index => model.slots.has(String(index)) ? "P" : "_").join("")}`
            : model.order.join(",")
        const actualShape = exported.blocked ? "BLOCKED" : exported.error ? "REJECTED" : Error.isError(exported.result) ? `ERR:${exported.result.kind}` : shape(exported.result)
        if (actualShape !== expectedShape) errors.push(`shape got ${actualShape} want ${expectedShape}`)
        verify(ctx, chain)
        return { errors, final }
    } catch (error) {
        errors.push(`threw ${ctx.execution.fatalError?.message ?? error?.stack ?? error}`)
        return { errors }
    }
}

function* completeCases() {
    for (const array of [false, true]) for (const target of array ? ["4", "0", "1"] : ["k2", "k0", "k1"])
        for (const predecessor of PREDECESSORS) for (const first of QUEUED) for (const second of QUEUED)
            for (const sibling of [1, 2, 3]) for (const release of ["predecessor-first", "predecessor-last"])
                yield { array, target, predecessor, first, second, sibling, release, observed: false, paired: true }
}

// Each triple gets one of the 24 container/sibling/release/mode combinations in
// rotation, so every combination meets many predecessors and queued commands.
// Every eighth triple also compares both harness modes; every 32nd verifies
// after each microtask turn, which the complete run does throughout.
function* sampledCases() {
    let index = 0
    for (const predecessor of PREDECESSORS) for (const first of QUEUED) for (const second of QUEUED) {
        const triple = index++
        const rotation = combination => ({
            array: combination % 2 === 1,
            sibling: 1 + Math.floor(combination / 2) % 3,
            release: Math.floor(combination / 6) % 2 ? "predecessor-last" : "predecessor-first",
            observed: Math.floor(combination / 12) % 2 === 1,
        })
        const absent = rotation(triple % 24)
        yield { ...absent, target: absent.array ? "4" : "k2", predecessor, first, second, paired: triple % 8 === 0, stepwise: triple % 32 === 0 }
        if (triple % 8 === 4) {
            const present = rotation(Math.floor(triple / 8) % 24)
            const value = Math.floor(triple / 8) % 2
            yield { ...present, target: present.array ? String(value) : `k${value}`, predecessor, first, second, paired: false }
        }
    }
}

const full = process.env.CASCADA_CONFLICT_MATRIX === "full"
const [partIndex, partCount] = (process.env.CASCADA_CONFLICT_PART ?? "0/1").split("/").map(Number)
const coverage = { mode: full ? "full" : "sampled", cases: 0, runs: 0, paired: 0, triples: new Set(), absentTriples: new Set(), dimensions: new Set() }
const failures = []
let position = 0
for (const testCase of full ? completeCases() : sampledCases()) {
    if (position++ % partCount !== partIndex) continue
    const modes = testCase.paired ? [testCase.observed, !testCase.observed] : [testCase.observed]
    const finals = []
    for (const observed of modes) {
        const { errors, final } = await runCase({ ...testCase, observed, stepwise: full || testCase.stepwise })
        coverage.runs++
        finals.push(final)
        const label = `${testCase.array ? "array" : "record"} target=${testCase.target} predecessor=${testCase.predecessor.name} ` +
            `first=${testCase.first.name} second=${testCase.second.name} sibling@${testCase.sibling} ${testCase.release} observed=${observed}`
        if (errors.length) failures.push(`${label}\n    ${errors.join("\n    ")}`)
    }
    if (modes.length === 2) {
        coverage.paired++
        if (finals[0] !== undefined && finals[1] !== undefined && finals[0] !== finals[1])
            failures.push(`paired runs disagree for ${testCase.predecessor.name}/${testCase.first.name}/${testCase.second.name}: [${finals[0]}] vs [${finals[1]}]`)
    }
    coverage.cases++
    const triple = `${testCase.predecessor.name}/${testCase.first.name}/${testCase.second.name}`
    coverage.triples.add(triple)
    if (testCase.target === "4" || testCase.target === "k2") coverage.absentTriples.add(triple)
    coverage.dimensions.add(`container:${testCase.array ? "array" : "record"}`)
    coverage.dimensions.add(`target:${testCase.target === "4" || testCase.target === "k2" ? "absent" : "present"}`)
    coverage.dimensions.add(`sibling:${testCase.sibling}`)
    coverage.dimensions.add(`release:${testCase.release}`)
    coverage.dimensions.add(`observed:${testCase.observed}`)
}
if (failures.length) {
    console.error(`${failures.length} failing runs; first ${Math.min(12, failures.length)}:\n${failures.slice(0, 12).join("\n")}`)
    process.exit(1)
}
console.log(JSON.stringify({
    ...coverage,
    triples: coverage.triples.size,
    absentTriples: coverage.absentTriples.size,
    dimensions: [...coverage.dimensions].sort(),
}))
