// Extended delivery differential, adapted from the Phase 3 review's exhaustive
// pair probe. The ready execution is the oracle, not runtime identity metadata.
// It complements semantic models: shared ready bugs and Error attribution need
// their explicit regressions. Run with an optional shard argument, e.g. 0/8.
import assert from "node:assert/strict"
import { createRandom } from "../native-equivalence-support.js"
import * as r from "../../src/index.js"
import { OrderedThenable, ready } from "../ordered-thenable.js"
import { verifyRefCounts } from "../verify-refcounts.js"
import { modelPublications } from "./publication-model.js"

const CAPTURE_PATHS = [[], ["a"], ["c", "y"], ["a", "s"], ["c", "s"], ["b"], ["a", "x"], ["c"]]

function makeDeferred(mode) {
    if (mode === "sync") return { wrap: value => ready(value), settle() {} }
    if (mode === "native") {
        const d = Promise.withResolvers()
        return { wrap: value => { d.value = value; return d.promise }, settle: () => d.resolve(d.value) }
    }
    const t = new OrderedThenable()
    return { wrap: value => { t.value = value; return t }, settle: () => { if (!t.outcome) t.resolve(t.value); t.flush() } }
}

async function execute(program, mode, random, profile) {
    const ctx = { execution: new r.Execution(), errorContext: "publication pairs" }
    const shared = { m: 1 }
    const host = { a: { x: 1, s: shared, inc() { this.x++; return this.x }, get() { return this.x } }, b: [1, , 3], c: { y: { z: 1 }, s: shared } }
    if (profile.cycle) host.c.y.self = host.c.y
    const source = new r.Chain(profile.imported ? r.import(host, ctx) : host, ctx)
    const deferreds = [], captures = [], tasks = []
    const capture = () => { for (const path of CAPTURE_PATHS) captures.push(new r.Chain(r.lookupPath(source, path, ctx), ctx)) }
    const issue = (chain, commands) => {
        for (const command of commands) {
            const { kind, path, scope } = command
            if (kind === "assign") {
                let value = command.value.type === "num" ? command.value.n
                    : command.value.type === "obj" ? { n: 1 }
                    : r.lookupPath(chain, command.value.path, ctx)
                // Host code may not retain a raw managed result across later
                // commands (handoff contract), so only scalars use host deferreds.
                if (command.pending && mode !== "ready" && command.value.type === "num") {
                    const d = makeDeferred(mode)
                    deferreds.push(d)
                    value = d.wrap(value)
                }
                tasks.push(r.assignPath(chain, path, value, ctx, scope))
            } else if (kind === "delete") tasks.push(r.deletePath(chain, path, ctx, scope))
            else if (kind === "repair") tasks.push(r.repairPath(chain, path, ctx))
            else if (kind === "fail") tasks.push(r.assignPath(chain, path, 5, ctx, scope))
            else if (kind === "array") {
                let args = command.args
                if (command.pendingArg !== undefined && mode !== "ready") {
                    const d = makeDeferred(mode)
                    deferreds.push(d)
                    args = args.map((v, i) => i === command.pendingArg ? d.wrap(v) : v)
                }
                tasks.push(r.run(chain, path, command.method, args, ctx, { mutationScopeDepth: scope }))
            }
            else if (kind === "method") tasks.push(r.run(chain, path, command.method, [], ctx,
                command.mutate ? { mutationScopeDepth: scope } : {}))
            else if (kind === "enter") {
                if (mode === "ready" || !command.async) {
                    tasks.push(r.enter(chain, path, ctx, true, inside => { issue(inside, command.body) }))
                } else {
                    const d = makeDeferred(mode)
                    deferreds.push(d)
                    const gate = d.wrap(true)
                    tasks.push(r.enter(chain, path, ctx, true, inside => gate.then(() => { issue(inside, command.body) })))
                }
            }
        }
    }
    capture()
    program.forEach(command => { issue(source, [command]); capture() })
    const values = captures.map(chain => r.lookupPath(chain, [], ctx))
    const observations = []
    for (let i = 0; i < captures.length; i++)
        observations.push({ label: `export ${i}`, result: r.export(captures[i], [], ctx) })
    const P = CAPTURE_PATHS.length, steps = values.length / P
    const compare = (i, j, method = "includes", extra) => {
        const items = extra === undefined ? [values[j]] : [values[extra], values[j]]
        const list = new r.Chain(items, ctx)
        observations.push({ label: `${method} ${i} in ${extra === undefined ? "" : extra + ","}${j}`,
            result: r.run(list, [], method, [values[i]], ctx, {}) })
    }
    for (let t = 0; t + 1 < steps; t++) for (let p = 0; p < P; p++) {
        compare(t * P + p, (t + 1) * P + p)
        if (p === 6) compare(t * P + p, (t + 1) * P + p, "indexOf", (t + 1) * P)
    }
    for (let t = 0; t < steps; t++) compare(t * P + 3, t * P + 4)
    for (let p = 0; p < P; p++) compare(p, (steps - 1) * P + p, "lastIndexOf")
    const order = deferreds.map((_, index) => index)
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (const index of order) {
        deferreds[index].settle()
        await new Promise(setImmediate)
    }
    // Releases can issue nested commands. Drain every source created by them.
    for (let index = order.length; index < deferreds.length; index++) {
        deferreds[index].settle()
        await new Promise(setImmediate)
    }
    const settled = observations.map(() => false)
    observations.forEach((o, k) => Promise.resolve(o.result).then(() => { settled[k] = true }, () => { settled[k] = true }))
    for (let turn = 0; turn < 20 && settled.includes(false); turn++) await new Promise(setImmediate)
    const outcome = {}
    for (let k = 0; k < observations.length; k++) {
        const { label, result } = observations[k]
        if (!settled[k]) { outcome[label] = "UNSETTLED"; continue }
        outcome[label] = normalize(await result)
    }
    assert.equal(ctx.execution.fatalError, null)
    verifyRefCounts(ctx, source._state, ...captures.map(c => c._state))
    assert(!Object.values(outcome).includes("UNSETTLED"), "unfinished after every source was released")
    await Promise.all(tasks)
    return outcome
}

function normalize(value) {
    const ids = new Map()
    const walk = value => {
        if (r.isPoisonError(value) || value instanceof Error) return "E"
        if (value === null || typeof value !== "object") return typeof value === "function" ? "fn" : value === undefined ? "undef" : value
        if (ids.has(value)) return `#${ids.get(value)}`
        ids.set(value, ids.size)
        if (Array.isArray(value)) {
            const out = []
            for (let i = 0; i < value.length; i++) out.push(i in value ? walk(value[i]) : "<hole>")
            return out
        }
        const out = {}
        for (const key of Object.keys(value)) out[key] = walk(value[key])
        return out
    }
    return JSON.stringify(walk(value))
}

// Vocabulary of single top-level commands with absolute paths.
const LEAVES = [["a", "x"], ["a", "k"], ["a", "s", "m"], ["c", "y", "z"], ["c", "y", "w"], ["c", "s", "m"],
    ["b", 0], ["b", 1], ["b", 3], ["b", 5], ["a"], ["c", "y"], ["a", "s"]]
const ANCHORS = [[], ["a"], ["c"], ["c", "y"], ["a", "s"], ["c", "s"], ["b"], ["a", "k"], ["b", 1], ["b", 5]]
const ARRAY_CALLS = [["fill", [7, 1, 2]], ["fill", [7, 1, 1]], ["reverse", []], ["copyWithin", [0, 1, 2]],
    ["copyWithin", [0, 0]], ["sort", []], ["push", []], ["push", [9]], ["pop", []], ["splice", [0, 0]], ["splice", [1, 1]]]

function vocabulary() {
    const entries = [], others = []
    const scopes = path => [...new Set([path.length, 0, Math.min(1, path.length)])]
    for (const anchor of ANCHORS) {
        const leaf = ["a", "k"].join() === anchor.join() || anchor[0] === "b" && anchor.length === 2
        const bodies = [[], [{ kind: "repair", path: [] }], [{ kind: "assign", path: [], value: { type: "num", n: 1 }, scope: 0 }],
            [{ kind: "delete", path: [], scope: 0 }]]
        if (!leaf) bodies.push([{ kind: "delete", path: ["zz"], scope: 0 }], [{ kind: "delete", path: ["zz"], scope: 1 }])
        for (const body of bodies) entries.push({ kind: "enter", path: anchor, body, async: true })
    }
    for (const [outer, inner] of [[[], ["a", "k"]], [["a"], ["k"]], [["b"], [1]], [["c"], ["y"]]])
        for (const after of [[], [{ kind: "delete", path: inner, scope: 0 }], [{ kind: "delete", path: inner, scope: inner.length }]])
            entries.push({ kind: "enter", path: outer, async: true, body: [{ kind: "enter", path: inner, body: [], async: true }, ...after] })
    const pendingAssigns = []
    for (const path of LEAVES) for (const scope of [path.length, 0]) {
        pendingAssigns.push({ kind: "assign", path, value: { type: "num", n: 1 }, pending: true, scope })
    }
    pendingAssigns.push({ kind: "assign", path: ["a", "k"], value: { type: "alias", path: ["c", "y"] }, pending: true, scope: 2 })
    for (const path of LEAVES) {
        for (const scope of scopes(path)) {
            others.push({ kind: "assign", path, value: { type: "num", n: 1 }, scope })
            others.push({ kind: "delete", path, scope })
        }
        others.push({ kind: "assign", path, value: { type: "obj" }, scope: path.length })
        others.push({ kind: "assign", path, value: { type: "alias", path: ["c", "y"] }, scope: path.length })
        others.push({ kind: "repair", path })
    }
    for (const target of [["a", "x"], ["c", "y", "z"], ["b", 0]]) for (const scope of [target.length + 1, 0])
        others.push({ kind: "fail", path: [...target, "q"], scope })
    for (const [method, args] of ARRAY_CALLS) for (const scope of [1, 0])
        others.push({ kind: "array", path: ["b"], method, args, scope })
    const pendingArgs = [
        { kind: "array", path: ["b"], method: "fill", args: [7, 1, 2], pendingArg: 1, scope: 1 },
        { kind: "array", path: ["b"], method: "fill", args: [7, 1, 1], pendingArg: 2, scope: 1 },
        { kind: "array", path: ["b"], method: "copyWithin", args: [0, 1, 2], pendingArg: 1, scope: 0 },
        { kind: "array", path: ["b"], method: "push", args: [9], pendingArg: 0, scope: 1 },
        { kind: "array", path: ["b"], method: "splice", args: [1, 1], pendingArg: 0, scope: 1 },
    ]
    const methods = [
        { kind: "method", path: ["a"], method: "inc", mutate: true, scope: 1 },
        { kind: "method", path: ["a"], method: "inc", mutate: true, scope: 0 },
        { kind: "method", path: ["a"], method: "get", mutate: false },
        { kind: "method", path: ["a"], method: "missing", mutate: true, scope: 1 },
    ]
    return { pending: [...entries, ...pendingAssigns, ...pendingArgs], all: [...entries, ...pendingAssigns, ...pendingArgs, ...others, ...methods] }
}


const [part, parts] = (process.argv[2] ?? "0/1").split("/").map(Number)
const { pending, all } = vocabulary()
const profiles = [{ name: "runtime" }, { name: "imported", imported: true },
    { name: "cycle", cycle: true }, { name: "entry", nested: true }]
let index = 0, pairs = 0, runs = 0, modeled = 0, modeledFailures = 0
const coverage = new Set()
for (const profile of profiles) for (const first of pending) for (const second of all) {
    if (index++ % parts !== part) continue
    const pair = [first, second]
    const program = profile.nested ? [{ kind: "enter", path: [], async: false, body: pair }] : pair
    try {
        const expected = await execute(program, "ready", createRandom(index), profile)
        const model = !profile.cycle && modelPublications(program, CAPTURE_PATHS)
        if (model) {
            for (const [label, same] of model.comparisons) assert.equal(expected[label], String(same), `publication model: ${label}`)
            modeled++
            if (model.failed) modeledFailures++
        }
        for (const mode of ["sync", "native", "ordered"]) {
            const actual = await execute(program, mode, createRandom(index * 31), profile)
            assert.deepStrictEqual(actual, expected, `delivery=${mode}`)
            runs++
            coverage.add(`${profile.name}:${mode}:${first.kind}:${second.kind}`)
        }
        pairs++
    } catch (error) {
        console.error(JSON.stringify({ index: index - 1, profile: profile.name, program }))
        throw error
    }
}
assert.equal(pairs, Math.max(0, Math.ceil((profiles.length * pending.length * all.length - part) / parts)))
console.log(JSON.stringify({ pairs, runs, modeled, modeledFailures, coverage: [...coverage].sort() }))
