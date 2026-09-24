import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { createRandom, randomInteger } from "../native-equivalence-support.js"
import { ready } from "../ordered-thenable.js"
import { verifyRefCounts } from "../verify-refcounts.js"

// Seeded programs on a nested record and Array graph: assignment, deletion, subtree
// replacement, Array structure, retained lookups, and entries at any ancestor, optionally
// nested and delayed. Native JavaScript applied at each command's issuance is the model,
// including record key order. Containers start plain, imported, or shared with retained
// slice views. Holds are released between commands. Observed, verified-without-lookups,
// and uninstrumented runs must agree. Commands the model cannot apply, such as
// traversal through a primitive, are skipped: failure semantics belong to the other fixtures.

const INITIAL = () => ({ a: [{ x: [0, 1], y: 5 }, 2] })
const PATHS = [["a"], ["a", 0], ["a", 3], ["a", 0, "x"], ["a", 0, "y"], ["a", 0, "z"], ["a", 1],
    ["a", 0, "x", 1], ["a", 0, "x", 4], ["a", 0, "x", 0]]
const KINDS = ["set", "set", "set", "replace", "delete", "delete", "push", "pop", "length",
    "noop-entry", "noop-entry", "lookup", "lookup", "conflict", "conflict"]

const read = (root, path) => path.reduce((value, key) => value !== null && typeof value === "object" ? value[key] : undefined, root)
const isContainer = value => value !== null && typeof value === "object"

function display(value) {
    if (Error.isError(value)) return "ERR"
    if (value === undefined) return "u"
    if (Array.isArray(value)) return `[${value.length}:${[...Array(value.length).keys()].map(index => index in value ? display(value[index]) : "_").join(",")}]`
    if (isContainer(value)) return `{${Object.keys(value).map(key => `${key}=${display(value[key])}`).join(",")}}`
    return String(value)
}

function freshValue(kind, value) {
    return [() => value, () => ({ x: [value, value + 1], y: value }), () => [value], () => ({ q: value })][kind]()
}

// Placement writes need a container parent, and Arrays accept only index keys here.
function writable(root, path) {
    const parent = read(root, path.slice(0, -1))
    return isContainer(parent) && (!Array.isArray(parent) || typeof path.at(-1) === "number")
}

// Guard the model against drift on transitions whose meaning the contracts fix.
{
    const record = { x: 1, y: 2 }
    delete record.x
    record.x = 3
    assert.equal(display(record), "{y=2,x=3}")
    record.y = 4
    assert.equal(display(record), "{y=4,x=3}")
    const list = [1, 2]
    delete list[0]
    assert.equal(display(list), "[2:_,2]")
}

function generate(random) {
    const pick = list => list[randomInteger(random, list.length)]
    const steps = []
    for (let index = 0; index < 10; index++) {
        const path = pick(PATHS)
        steps.push({
            kind: pick(KINDS), path, value: 10 + index, shape: randomInteger(random, 4),
            payload: pick(["ready", "promise", "thenable"]), route: pick(["direct", "entry", "nested"]),
            delayed: random() < 0.5, mutable: random() < 0.7,
            // Entry split points, as fractions of the path length; resolved when the step runs.
            outer: random(), inner: random(),
            conflict: { predecessor: pick(["set", "delete"]), first: pick(["set", "delete"]), second: pick(["ready", "nested"]) },
            release: random() < 0.5, turns: randomInteger(random, 4), macrotask: random() < 0.25,
        })
    }
    return { container: pick(["plain", "imported", "view"]), steps }
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
    if (isContainer(result) && !Error.isError(result)) {
        const exported = await outcome(r.export(new r.Chain(result, ctx), [], ctx))
        if (exported.blocked) return "BLOCKED"
        return exported.error ? `REJECTED:${exported.error.message}` : display(exported.result)
    }
    return display(result)
}

async function runProgram({ container, steps }, seed, mode, coverage) {
    const observed = mode === "observed", instrumented = mode !== "bare"
    coverage.add(`harness:${mode}`)
    const random = createRandom(seed ^ 0x27d4eb2f)
    const model = INITIAL()
    const ctx = { execution: new r.Execution(), errorContext: {} }
    const host = INITIAL(), hostBefore = display(host)
    const chain = new r.Chain(container === "imported" ? { a: r.import(host.a, ctx) } : INITIAL(), ctx)
    const checks = []
    const keep = (value, want, label) => {
        if (value instanceof Promise) value.catch(() => {})
        if (want !== undefined) checks.push({ got: value, want, label })
        return value
    }
    if (container === "view") {
        // Retained slices share backing and must keep their captured values.
        keep(r.run(chain, ["a"], "slice", [0, 2], ctx, {}), display(model.a.slice(0, 2)), "retained slice a")
        keep(r.run(chain, ["a", 0, "x"], "slice", [0, 2], ctx, {}), display(model.a[0].x.slice(0, 2)), "retained slice a[0].x")
    }
    if (instrumented) r.hasError(chain, [], ctx)
    const holds = []
    const hold = () => {
        const held = Promise.withResolvers()
        holds.push(held)
        return held.promise
    }
    const verify = () => { if (instrumented) verifyRefCounts(ctx, chain._state) }
    let phase = "before-release"
    for (const step of steps) {
        const { kind, path } = step
        let value = freshValue(step.shape, step.value)
        const payload = () => step.payload === "ready" ? value
            : step.payload === "promise" ? hold().then(() => value) : ready(value)
        // Split the path for entry routes: outer is a proper, non-empty prefix when possible.
        const outerLength = Math.max(1, Math.min(path.length, 1 + Math.floor(step.outer * path.length)))
        const outer = path.slice(0, outerLength), rest = path.slice(outerLength)
        const innerLength = rest.length ? 1 + Math.floor(step.inner * rest.length) : 0
        const body = action => step.delayed ? (inside => hold().then(() => action(inside))) : action
        const route = (command, relativeRoute = step.route) => {
            if (relativeRoute === "direct") return command(chain, path)
            if (relativeRoute === "nested" && rest.length) {
                return r.enter(chain, outer, ctx, true, body(inside => r.enter(inside, rest.slice(0, innerLength), ctx, true,
                    body(nested => command(nested, rest.slice(innerLength))))))
            }
            return r.enter(chain, outer, ctx, true, body(inside => command(inside, rest)))
        }
        if (kind === "lookup") {
            if (observed) {
                const through = path.slice(0, -1).every((_, index) => isContainer(read(model, path.slice(0, index + 1))))
                keep(r.lookupPath(chain, path, ctx), through ? display(read(model, path)) : "ERR", `lookup ${path.join(".")}`)
                coverage.add(`lookup:${phase}`)
            }
        } else if (kind === "noop-entry") {
            keep(r.enter(chain, path, ctx, step.mutable, step.delayed ? () => hold() : () => undefined))
            coverage.add(`noop-entry:${step.mutable ? "mutable" : "readonly"}:${step.delayed ? "delayed" : "ready"}`)
        } else if (kind === "set" || kind === "replace" || kind === "delete") {
            if (!writable(model, path) || kind === "replace" && path.length > 2) continue
            if (kind === "replace") value = { x: [step.value], y: 0 }
            const parent = read(model, path.slice(0, -1))
            if (kind === "delete") delete parent[path.at(-1)]
            else parent[path.at(-1)] = structuredClone(value)
            keep(route((owner, relative) => kind === "delete" ? r.deletePath(owner, relative, ctx) : r.assignPath(owner, relative, payload(), ctx)))
            coverage.add(`${kind}:${step.route}`)
            if (kind !== "delete") coverage.add(`payload:${step.payload}`)
        } else if (kind === "push" || kind === "pop" || kind === "length") {
            const target = read(model, path)
            if (!Array.isArray(target)) continue
            const length = step.value % 5
            if (kind === "push") target.push(structuredClone(value))
            else if (kind === "pop") target.pop()
            else target.length = length
            keep(route((owner, relative) => kind === "length" ? r.assignPath(owner, [...relative, "length"], length, ctx)
                : r.run(owner, relative, kind, kind === "push" ? [payload()] : [], ctx, { mutationScopeDepth: relative.length })))
            coverage.add(`${kind}:${step.route}`)
        } else if (kind === "conflict") {
            // A delayed entry at an ancestor, a direct command, and a no-op entry on one placement.
            if (path.length < 2 || !writable(model, path)) continue
            const { predecessor, first, second } = step.conflict
            const target = path.slice(outerLength)
            const apply = (effect, payload) => {
                const parent = read(model, path.slice(0, -1))
                if (effect === "delete") delete parent[path.at(-1)]
                else parent[path.at(-1)] = structuredClone(payload)
            }
            const predecessorValue = value
            apply(predecessor, predecessorValue)
            keep(r.enter(chain, outer, ctx, true, inside => hold().then(() => predecessor === "delete"
                ? r.deletePath(inside, target, ctx) : r.assignPath(inside, target, predecessorValue, ctx))))
            if (observed) keep(r.lookupPath(chain, path, ctx), display(read(model, path)), "conflict predecessor")
            const nextValue = freshValue(step.shape, step.value + 100)
            if (writable(model, path)) {
                apply(first, nextValue)
                keep(first === "delete" ? r.deletePath(chain, path, ctx) : r.assignPath(chain, path, nextValue, ctx))
            }
            keep(second === "nested"
                ? r.enter(chain, outer, ctx, true, inside => r.enter(inside, target, ctx, true, () => undefined))
                : r.enter(chain, path, ctx, true, () => undefined))
            coverage.add(`conflict:${predecessor}:${first}:${second}`)
        }
        coverage.add(`step:${phase}`)
        verify()
        if (step.release && holds.length) {
            holds.splice(randomInteger(random, holds.length), 1)[0].resolve()
            if (phase === "before-release") phase = "after-release"
        }
        for (let turn = 0; turn < step.turns; turn++) {
            await Promise.resolve()
            verify()
        }
        if (step.macrotask) {
            await new Promise(setImmediate)
            verify()
        }
    }
    coverage.add(`container:${container}`)
    do {
        while (holds.length) {
            holds.splice(randomInteger(random, holds.length), 1)[0].resolve()
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
    const errors = []
    for (const { got, want, label } of checks) {
        const actual = await describeOutcome(got, ctx)
        // A lookup through a primitive fails; its Error kind is not the subject here.
        if (actual !== want && !(want === "ERR" && actual === "ERR")) errors.push(`${label}: got ${actual} want ${want}`)
    }
    const final = await describeOutcome(r.export(chain, ["a"], ctx), ctx)
    if (final !== display(model.a)) errors.push(`final: got ${final} want ${display(model.a)}`)
    if (container === "imported" && display(host) !== hostBefore) errors.push(`imported data changed: ${display(host)} was ${hostBefore}`)
    verify()
    assert.equal(ctx.execution.fatalError, null)
    return { errors, final }
}

const programs = Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 16) * 6
const start = Number(process.env.CASCADA_SEQUENCE_START ?? 0)
const coverage = new Set()
let runs = 0
for (let index = start; index < programs; index++) {
    const seed = (0x6a09e667 + Math.imul(index, 0x9e3779b9)) >>> 0
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
                `program: ${JSON.stringify(program)}`)
        }
        finals.push(result.final)
    }
    if (new Set(finals).size !== 1) throw new Error(`program ${index} (seed ${seed}): harness modes disagree: ${JSON.stringify(finals)}`)
}
console.log(JSON.stringify({ programs: programs - start, runs, coverage: [...coverage].sort() }))
