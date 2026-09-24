import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { createRandom, randomInteger } from "../native-equivalence-support.js"
import { OrderedThenable } from "../ordered-thenable.js"
import { verifyRefCounts } from "../verify-refcounts.js"

// Seeded programs on one Array: element entries, direct element commands,
// failure and repair, length assignment, structural methods, and observations
// issued directly, inside delayed read-only entries, or later on lookup
// snapshots. Holds are released between commands, so issuance happens before,
// during, and after earlier settlement. The model is an Array of slots that the
// native methods move; observations apply native semantics to the slot values.
// Compare observed, verified-without-extra-reads, and uninstrumented runs.
// The observation methods under test remain in all three modes.

// Slots: { value } is data, { error } ordinary Error data, and { poison,
// baseline, absent } a failed prefix retaining the slot it replaced.
function applyElement(slots, index, effect, value) {
    const current = slots[index]
    const present = index in slots
    if (effect === "set") slots[index] = { value }
    else if (effect === "delete") delete slots[index]
    else if (effect === "reject") slots[index] = { error: true }
    else if (effect === "prefix") {
        if (current?.error || current?.poison) return
        if (present && typeof current.value === "object" && current.value !== null) slots[index] = { value: { ...current.value, x: value } }
        else slots[index] = { poison: true, baseline: current, absent: !present }
    } else if (effect === "repair" && current?.poison) {
        if (current.absent) delete slots[index]
        else slots[index] = current.baseline
    }
}

const ERROR = { error: true } // Stands in for an Error element; never a search value.
const failed = slot => slot?.error || slot?.poison

function values(slots) {
    const result = new Array(slots.length)
    for (const key of Object.keys(slots)) result[key] = failed(slots[key]) ? ERROR : slots[key].value
    return result
}

function display(value) {
    if (value === ERROR || Error.isError(value)) return "ERR"
    if (value === undefined) return "u"
    if (Array.isArray(value)) {
        if (Object.values(value).includes(ERROR)) return "ERR"
        return `[${value.length}:${[...Array(value.length).keys()].map(index => index in value ? display(value[index]) : "_").join(",")}]`
    }
    if (typeof value === "object" && value !== null) return `{x:${value.x}}`
    return Number.isNaN(value) ? "NaN" : String(value)
}

// Guard the model and comparison against drift on transitions the contracts fix.
{
    const slots = [{ value: 0 }]
    applyElement(slots, 3, "prefix", 1)
    assert.equal(slots.length, 4)
    applyElement(slots, 3, "repair")
    assert.equal(display(values(slots)), "[4:0,_,_,_]")
    applyElement(slots, 0, "reject")
    applyElement(slots, 0, "repair")
    assert.equal(display(values(slots)), "ERR")
    assert.notEqual(display([, 7]), display([undefined, 7]))
    assert.notEqual(display([3, 7]), display([, 7]))
}

const VALUES = [0, 1, 2, undefined, NaN, "x", 7]
const INITIAL = [[0, { x: 1 }, 2], [0, , 2, undefined], [NaN, 1, 1, 0], [7], []]
const INDEXES = [undefined, 0, 1, 2, 3, 5, -1, -2, -4, Infinity, -Infinity, 9]
const EFFECTS = ["set", "delete", "noop", "pending", "prefix", "repair", "reject"]
const DIRECT = ["set", "pending", "delete", "prefix", "repair", "reject"]
const STRUCTURAL = {
    reverse: [[], slots => slots.reverse(), true],
    shift: [[], slots => slots.shift()],
    pop: [[], slots => slots.pop()],
    push: [[9], slots => slots.push({ value: 9 })],
    unshift: [[8], slots => slots.unshift({ value: 8 })],
    "splice-remove": [[1, 1], slots => slots.splice(1, 1)],
    "splice-insert": [[1, 0, 6], slots => slots.splice(1, 0, { value: 6 })],
}
const OBSERVATIONS = ["includes", "indexOf", "lastIndexOf", "at", "slice", "with", "concat"]
const ROUTES = ["direct", "entry", "snapshot"]

function generate(random) {
    const pick = list => list[randomInteger(random, list.length)]
    const initial = pick(INITIAL)
    const delivery = pick(["native", "ordered"])
    // Half the element commands share one index, so conflicting commands on
    // the same element, including its creation and removal, occur often.
    const hot = randomInteger(random, 5)
    const steps = []
    for (let step = 0; step < 14; step++) {
        const roll = randomInteger(random, 22)
        const index = random() < 0.5 ? hot : randomInteger(random, 7), value = pick(VALUES)
        if (roll < 6) steps.push({ kind: "entry", index, effect: pick(EFFECTS), value, delayed: random() < 0.6 })
        else if (roll < 10) steps.push({ kind: "direct", index, effect: pick(DIRECT), value })
        else if (roll < 13) steps.push({ kind: "structural", name: pick(Object.keys(STRUCTURAL)), route: pick(["direct", "entry"]) })
        else if (roll < 14) steps.push({ kind: "length", length: randomInteger(random, 7) })
        else if (roll < 17) steps.push({ kind: "observe", route: pick(ROUTES), ...observation(random, pick) })
        else if (roll < 19) steps.push({ kind: "read" })
        else if (roll < 20) steps.push({ kind: "settle" })
        // A delayed entry, a queued direct command, and a ready no-op entry on one
        // element: the short conflict whose leftover state later steps then consume.
        else steps.push({ kind: "conflict", index: hot, value, predecessor: pick(["noop", "set", "delete", "prefix", "reject"]),
            first: pick(["delete", "repair", "set", "prefix"]), nested: random() < 0.5 })
        steps.at(-1).release = random() < 0.5
        steps.at(-1).turns = randomInteger(random, 4)
    }
    return { initial, delivery, steps }
}

function observation(random, pick) {
    const method = pick(OBSERVATIONS)
    const index = pick(INDEXES)
    if (method === "at") return { method, args: [index] }
    if (method === "slice") {
        const end = pick(INDEXES)
        return { method, args: end === undefined ? index === undefined ? [] : [index] : [index ?? 0, end] }
    }
    if (method === "with") return { method, args: [index ?? 0, pick(VALUES)] }
    if (method === "concat") return { method, args: [[9]] }
    return { method, args: index === undefined ? [pick(VALUES)] : [pick(VALUES), index] }
}

function expectedObservation(slots, { method, args }) {
    try {
        return display(values(slots)[method](...args))
    } catch {
        return "ERR" // with() outside the Array produces a validation Error.
    }
}

async function outcome(value) {
    let settled
    Promise.resolve(value).then(result => { settled = { result } }, error => { settled = { error } })
    for (let turn = 0; turn < 40 && !settled; turn++) await new Promise(setImmediate)
    return settled ?? { blocked: true }
}

async function describeOutcome(value, ctx) {
    const { result, error, blocked } = await outcome(value)
    if (blocked) return "BLOCKED"
    if (error) return `REJECTED:${error.message}`
    if (result !== null && typeof result === "object" && !Error.isError(result)) {
        const exported = await outcome(r.export(new r.Chain(result, ctx), [], ctx))
        if (exported.blocked) return "BLOCKED"
        return exported.error ? `REJECTED:${exported.error.message}` : display(exported.result)
    }
    return display(result)
}

async function runProgram({ initial, delivery, steps }, seed, mode, coverage) {
    const observed = mode === "observed", instrumented = mode !== "bare"
    coverage.add(`harness:${mode}`)
    const random = createRandom(seed ^ 0x5bd1e995)
    const slots = initial.map(value => ({ value }))
    for (let index = 0; index < initial.length; index++) if (!(index in initial)) delete slots[index]
    const ctx = { execution: new r.Execution(), errorContext: {} }
    const chain = new r.Chain({ a: structuredClone(initial) }, ctx)
    if (instrumented) r.hasError(chain, [], ctx)
    const holds = [], checks = [], snapshots = [], roots = [chain]
    let phase = "before-release"
    const hold = () => {
        const held = Promise.withResolvers()
        holds.push({ release: () => held.resolve() })
        return held.promise
    }
    // Pending payloads use native Promises or ordered custom thenables.
    const input = (value, rejected) => {
        if (delivery === "native") {
            const held = Promise.withResolvers()
            held.promise.catch(() => {})
            holds.push({ release: () => rejected ? held.reject(new Error("rejected payload")) : held.resolve(value) })
            return held.promise
        }
        const source = new OrderedThenable()
        holds.push({ release: () => rejected ? source.reject(new Error("rejected payload")) : source.resolve(value) })
        return source
    }
    const element = (target, path, effect, value) => {
        if (effect === "set") return r.assignPath(target, path, value, ctx)
        if (effect === "pending") return r.assignPath(target, path, input(value), ctx)
        if (effect === "delete") return r.deletePath(target, path, ctx)
        if (effect === "prefix") return r.assignPath(target, [...path, "x"], value, ctx)
        if (effect === "repair") return r.repairPath(target, path, ctx)
        if (effect === "reject") return r.assignPath(target, path, input(undefined, true), ctx)
        return undefined
    }
    const keep = (value, expected, label) => {
        if (value instanceof Promise) value.catch(() => {})
        if (expected !== undefined) checks.push({ got: value, want: expected, label })
        return value
    }
    const releaseOne = async () => {
        const [held] = holds.splice(randomInteger(random, holds.length), 1)
        held.release()
        if (phase === "before-release") phase = "after-release"
    }
    // verifyRefCounts also runs the storage oracle.
    const verify = () => { if (instrumented) verifyRefCounts(ctx, ...roots.map(root => root._state)) }
    // Release every hold, verifying consistency between turns, until no hold remains.
    const settle = async () => {
        do {
            while (holds.length) {
                await releaseOne()
                for (let turn = 0; turn < 3; turn++) {
                    await Promise.resolve()
                    verify()
                }
                await new Promise(setImmediate)
                verify()
            }
            for (let turn = 0; turn < 3; turn++) {
                await new Promise(setImmediate)
                verify()
            }
        } while (holds.length)
    }
    for (const step of steps) {
        const after = phase
        if (step.kind === "entry") {
            coverage.add(`entry:${step.effect}:${step.delayed ? "delayed" : "ready"}`)
            applyElement(slots, step.index, step.effect === "pending" ? "set" : step.effect, step.value)
            const act = inside => element(inside, [], step.effect, step.value)
            keep(r.enter(chain, ["a", step.index], ctx, true, inside => step.delayed ? hold().then(() => act(inside)) : act(inside)))
        } else if (step.kind === "direct") {
            coverage.add(`direct:${step.effect}`)
            applyElement(slots, step.index, step.effect === "pending" ? "set" : step.effect, step.value)
            keep(element(chain, ["a", step.index], step.effect, step.value))
        } else if (step.kind === "structural") {
            coverage.add(`structural:${step.name}:${step.route}`)
            const [args, apply, returnsReceiver] = STRUCTURAL[step.name]
            const method = step.name.startsWith("splice") ? "splice" : step.name
            const nativeResult = apply(slots)
            const expected = returnsReceiver ? display(values(slots))
                : Array.isArray(nativeResult) ? display(values(nativeResult))
                    : typeof nativeResult === "number" ? String(nativeResult)
                        : nativeResult === undefined ? "u" : failed(nativeResult) ? "ERR" : display(nativeResult.value)
            const call = step.route === "direct"
                ? r.run(chain, ["a"], method, args, ctx, { mutationScopeDepth: 1 })
                : r.enter(chain, ["a"], ctx, true, inside => r.run(inside, [], method, args, ctx, { mutationScopeDepth: 0 }))
            keep(call, expected, `${step.route} ${method}(${args})`)
        } else if (step.kind === "length") {
            coverage.add("length")
            slots.length = step.length
            keep(r.assignPath(chain, ["a", "length"], step.length, ctx))
        } else if (step.kind === "observe") {
            coverage.add(`observe:${step.method}:${step.route}`)
            coverage.add(`observe:${step.route}:${after}`)
            const expected = expectedObservation(slots, step)
            const label = `${step.route} ${step.method}(${step.args.map(display)})`
            if (step.route === "direct") keep(r.run(chain, ["a"], step.method, step.args, ctx, {}), expected, label)
            else if (step.route === "entry") keep(r.enter(chain, ["a"], ctx, false, inside => hold().then(() => r.run(inside, [], step.method, step.args, ctx, {}))), expected, label)
            else snapshots.push({ snapshot: keep(r.lookupPath(chain, ["a"], ctx)), step, expected, label })
        } else if (step.kind === "conflict") {
            coverage.add(`conflict:${step.predecessor}:${step.first}:${step.nested ? "nested" : "ready"}`)
            for (const effect of [step.predecessor, step.first]) applyElement(slots, step.index, effect, step.value)
            keep(r.enter(chain, ["a", step.index], ctx, true, inside => hold().then(() => element(inside, [], step.predecessor, step.value))))
            keep(element(chain, ["a", step.index], step.first, step.value))
            keep(step.nested
                ? r.enter(chain, ["a"], ctx, true, inside => r.enter(inside, [step.index], ctx, true, () => undefined))
                : r.enter(chain, ["a", step.index], ctx, true, () => undefined))
        } else if (step.kind === "settle") {
            // Later commands issue after complete draining as well as during settlement.
            coverage.add("settle")
            await settle()
            phase = "after-settle"
        } else if (observed) {
            coverage.add("read")
            const want = values(slots)
            for (let index = 0; index < want.length + 2; index++)
                keep(r.lookupPath(chain, ["a", index], ctx), index in want ? display(want[index]) : "u", `read a[${index}]`)
            keep(r.lookupPath(chain, ["a", "length"], ctx), String(want.length), "read length")
        }
        coverage.add(`step:${after}`)
        verify()
        if (step.release && holds.length) await releaseOne()
        for (let turn = 0; turn < step.turns; turn++) {
            await Promise.resolve()
            verify()
        }
    }
    // Snapshot observations run after every later command was issued; each still sees its fork.
    for (const { snapshot, step, expected, label } of snapshots) {
        const run = value => {
            const fork = new r.Chain({ s: value }, ctx)
            roots.push(fork)
            return r.run(fork, ["s"], step.method, step.args, ctx, {})
        }
        keep(snapshot instanceof Promise ? snapshot.then(run) : run(snapshot), expected, label)
    }
    coverage.add(`delivery:${delivery}`)
    await settle()
    const errors = []
    for (const { got, want, label } of checks) {
        const actual = await describeOutcome(got, ctx)
        if (actual !== want) errors.push(`${label}: got ${actual} want ${want}`)
    }
    const final = await describeOutcome(r.export(chain, ["a"], ctx), ctx)
    const expectedFinal = display(values(slots))
    if (final !== expectedFinal) errors.push(`final: got ${final} want ${expectedFinal}`)
    const length = await outcome(r.lookupPath(chain, ["a", "length"], ctx))
    if (length.result !== slots.length) errors.push(`final length: got ${length.result} want ${slots.length}`)
    verify()
    assert.equal(ctx.execution.fatalError, null)
    return { errors, final }
}

const programs = Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 16) * 6
const start = Number(process.env.CASCADA_SEQUENCE_START ?? 0)
const coverage = new Set()
let runs = 0
for (let index = start; index < programs; index++) {
    const seed = (0x2c1b3c6d + Math.imul(index, 0x9e3779b9)) >>> 0
    const program = generate(createRandom(seed))
    const finals = []
    for (const mode of ["observed", "verified", "bare"]) {
        let result
        try {
            result = await runProgram(program, seed, mode, coverage)
        } catch (error) {
            result = { errors: [`threw ${error?.stack ?? error}`] }
        }
        runs++
        if (result.errors.length) {
            throw new Error(`program ${index} (seed ${seed}, harness=${mode}) failed:\n  ${result.errors.join("\n  ")}\n` +
                `program: ${JSON.stringify(program, (key, value) => typeof value === "number" && !Number.isFinite(value) ? String(value) : value)}`)
        }
        finals.push(result.final)
    }
    if (new Set(finals).size !== 1) throw new Error(`program ${index} (seed ${seed}): harness modes disagree: ${JSON.stringify(finals)}`)
}
console.log(JSON.stringify({ programs: programs - start, runs, coverage: [...coverage].sort() }))
